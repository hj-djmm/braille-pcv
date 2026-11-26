/* Braille PCV — interface. */
(async function () {
"use strict";
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const V = window.Vision, D = window.Data;
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const VIEW_LEVEL = { inicio: 1, verificar: 1, biblioteca: 1, como: 1, atualizacao: 2, registo: 2, definicoes: 3 };
const S = {
  cfg: null, store: null, session: null, users: null,
  pairs: [], meta: null, settings: { ...D.DEFAULT_SETTINGS }, pdfIndex: [],
  MM2B: new Map(), B2MM: new Map(), DESC: new Map(), PDFS: new Map(), folder: null,
  pattern: null, img: null, imgName: "", box: null, side: "verso", sens: 1, mmQuery: "", expectCodes: null, last: null,
  mode: "caixa", ctx: null, patterns: null, reports: null, ofHint: null,
};
/* pedido vindo de outra app (ex.: checklist de receção da PCV Ferramentas): ?macho=1300…&ferramenta=…&ref=… */
(() => { const q = new URLSearchParams(location.search); const m = q.get("macho"); if (m) S.ctx = { macho: m.replace(/\D/g, ""), ferramenta: q.get("ferramenta") || "", ref: q.get("ref") || "", origem: q.get("origem") || "" }; })();

/* ================= utilitários de interface ================= */
function toast(msg, ms = 3500) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }
function msg(el, text, ok) { el.hidden = !text; el.className = ok ? "ok-msg" : "err"; el.textContent = text || ""; }
const level = () => D.ROLES[S.session?.role]?.level || 0;
const roleDef = () => D.ROLES[S.session?.role] || {};
const canView = v => !!VIEW_LEVEL[v] && (roleDef().views ? roleDef().views.includes(v) : VIEW_LEVEL[v] <= level());
const token = kind => S.session?.tokens?.[kind];
let HIST = [];
try { HIST = JSON.parse(localStorage.getItem("braille-pcv-hist") || "[]"); } catch (e) { HIST = []; }
function saveHist() { try { localStorage.setItem("braille-pcv-hist", JSON.stringify(HIST.slice(0, 100))); } catch (e) {} }

/* ================= arranque (chamado no fim do ficheiro) ================= */
async function boot() {
  S.cfg = await D.loadConfig();
  S.store = S.cfg.demo ? new D.LocalStore() : new D.GitHubStore(S.cfg);
  if (S.cfg.demo) await seedDemo();
  S.session = D.loadSession();
  if (S.session) { await refreshTokens(); await enterApp(); } else await showLogin();
}
/* com o cofre, a sessão guarda as chaves do perfil e os tokens são lidos sempre do cofre atual */
async function refreshTokens() {
  try {
    if (!S.users) S.users = await S.store.readUsers();
    const v = S.users?.vault, k = S.session?.keys;
    if (k && v?.roles?.[S.session.role]) S.session.tokens = await D.tokensFromVault(v, S.session.role, k);
  } catch (e) { /* fica com os tokens da sessão */ }
}

async function seedDemo() {
  if (await S.store.readUsers()) return;
  const all = { read: "demo", write: "demo", admin: "demo" }, keys = D.newRoleKeys(), users = [];
  for (const [u, role, name] of [["operador", "operador", "Operador de teste"], ["supervisor", "supervisor", "Supervisor de teste"], ["manager", "manager", "Manager de teste"], ["famag", "famag", "FAMAG (teste)"]])
    users.push(await D.makeUser({ u, name, role }, u, keys));
  await S.store.writeUsers({ version: 2, vault: await D.sealVault(all, keys), users });
  await S.store.writeJSON("data", "settings.json", { ...D.DEFAULT_SETTINGS, appUrl: location.origin + location.pathname });
  await S.store.writeJSON("data", "meta.json", { lastUpdate: null, history: [] });
}

/* ================= login ================= */
function onlyView(id) { $("#boot")?.remove(); $$("section.view").forEach(s => s.hidden = s.id !== id); }
async function showLogin() {
  $("#hdr").hidden = true; $("#banner").hidden = true;
  try { S.users = await S.store.readUsers(); } catch (e) { S.users = null; }
  if (!S.users || !S.users.users?.length) {
    if (S.cfg.demo) { await seedDemo(); S.users = await S.store.readUsers(); }
    else { $("#setup-repos").textContent = `App: ${S.cfg.appRepo} · Dados (privado): ${S.cfg.dataRepo} · ramo ${S.cfg.branch}`; onlyView("v-setup"); return; }
  }
  $("#demo-note").hidden = !S.cfg.demo;
  onlyView("v-login");
  $("#lg-u").focus();
}
$("#login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const u = $("#lg-u").value.trim().toLowerCase(), p = $("#lg-p").value, err = $("#lg-err");
  msg(err, ""); $("#lg-btn").disabled = true; $("#lg-btn").innerHTML = '<span class="spinner"></span>A entrar…';
  try {
    const rec = (S.users?.users || []).find(x => x.u === u);
    const open = rec ? await D.openUser(rec, p, S.users.vault) : null;
    if (!open) { msg(err, "Utilizador ou palavra-passe errados."); return; }
    S.session = { u: rec.u, name: rec.name, role: rec.role, tokens: open.tokens, keys: open.keys };
    // primeira entrada de um Manager depois da atualização: cria o cofre de tokens
    if (rec.role === "manager" && !S.users.vault && open.tokens.admin) { try { await createVault(rec, p); } catch (x) { toast("Não foi possível criar o cofre de tokens: " + x.message, 6000); } }
    D.saveSession(S.session, $("#lg-r").checked);
    $("#lg-p").value = "";
    await enterApp();
  } finally { $("#lg-btn").disabled = false; $("#lg-btn").textContent = "Entrar"; }
});
$("#role-chip").addEventListener("click", () => { D.clearSession(); S.session = null; location.hash = ""; location.reload(); });

/* configuração inicial (só no GitHub, quando ainda não há users.json) */
$("#setup-form").addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("#su-err"); msg(err, "");
  const name = $("#su-name").value.trim(), u = $("#su-u").value.trim().toLowerCase(), p1 = $("#su-p1").value, p2 = $("#su-p2").value;
  const all = { admin: $("#su-ta").value.trim(), write: $("#su-tw").value.trim(), read: $("#su-tr").value.trim() };
  if (!/^[a-z0-9._-]{3,30}$/.test(u)) return msg(err, "O utilizador só pode ter letras, números, ponto, hífen ou _ (3 a 30).");
  if (p1.length < 10) return msg(err, "A palavra-passe tem de ter pelo menos 10 caracteres.");
  if (p1 !== p2) return msg(err, "As palavras-passe não coincidem.");
  $("#su-btn").disabled = true; $("#su-btn").innerHTML = '<span class="spinner"></span>A validar tokens…';
  try {
    const check = async (tok, repo, label) => {
      const r = await fetch(`https://api.github.com/repos/${repo}`, { headers: { Authorization: "Bearer " + tok, "X-GitHub-Api-Version": "2022-11-28" } });
      if (!r.ok) throw new Error(`O token ${label} não consegue aceder a ${repo} (erro ${r.status}). Confirme o token e o repositório.`);
    };
    await check(all.read, S.cfg.dataRepo, "Operador"); await check(all.write, S.cfg.dataRepo, "Supervisor");
    await check(all.admin, S.cfg.dataRepo, "Manager"); await check(all.admin, S.cfg.appRepo, "Manager");
    const keys = D.newRoleKeys(), rec = await D.makeUser({ u, name, role: "manager" }, p1, keys);
    if (!(await S.store.readJSON("data", "settings.json", all.read)))
      await S.store.writeJSON("data", "settings.json", { ...D.DEFAULT_SETTINGS, appUrl: location.origin + location.pathname }, "Definições iniciais", all.write);
    if (!(await S.store.readJSON("data", "meta.json", all.read)))
      await S.store.writeJSON("data", "meta.json", { lastUpdate: null, history: [] }, "Estado inicial", all.write);
    S.users = { version: 2, vault: await D.sealVault(all, keys), users: [rec] };
    await S.store.writeUsers(S.users, all.admin);
    S.session = { u, name, role: "manager", tokens: all, keys };
    D.saveSession(S.session, false);
    toast("Manager criado. Os outros utilizadores criam-se em Definições.");
    await enterApp();
  } catch (x) { msg(err, x.message); }
  finally { $("#su-btn").disabled = false; $("#su-btn").textContent = "Criar e entrar"; }
});

/* cofre de tokens: criado na primeira entrada de um Manager (os utilizadores antigos continuam a funcionar) */
async function createVault(rec, password) {
  const all = S.session.tokens, keys = D.newRoleKeys();
  const vault = await D.sealVault(all, keys); vault.legacy = await D.legacyEntries(all, keys);
  const me = await D.makeUser({ u: rec.u, name: rec.name, role: "manager" }, password, keys); me.created = rec.created;
  const obj = { version: 2, vault, users: S.users.users.map(x => x.u === rec.u ? me : x) };
  await S.store.writeUsers(obj, all.admin);
  S.users = obj; S.session.keys = keys;
  toast("Cofre de tokens criado. A partir de agora, os tokens renovam-se em Definições › Cofre de tokens.", 6000);
}

/* ================= entrada na app ================= */
async function enterApp() {
  $("#hdr").hidden = false;
  $("#role-code").textContent = D.ROLES[S.session.role]?.code || "—";
  $("#user-name").textContent = S.session.name;
  $("#conn").innerHTML = S.cfg.demo ? '<span class="dot-ok demo"></span>Modo demonstração · dados só neste navegador' : '<span class="dot-ok"></span>Ligado · GitHub';
  $$("nav.tabs button").forEach(b => b.hidden = !canView(b.dataset.view));
  if (!S.cfg.demo) $("#btn-demo").hidden = false;
  const como = $("#como-foto");
  if (como && !como.children.length) { const c = $("#foto-card").cloneNode(true); c.removeAttribute("id"); como.appendChild(c); }
  $("#mode-seg").hidden = !!roleDef().machoOnly;
  setMode(roleDef().machoOnly || S.ctx ? "macho" : "caixa");
  await loadData();
  const v = location.hash.slice(1);
  show(S.ctx ? "verificar" : canView(v) ? v : roleDef().machoOnly ? "verificar" : "inicio");
  if (S.ctx) { $("#mm-in").value = S.ctx.macho; lookupMM(S.ctx.macho); }
  flushLog();
  loadPatterns().then(() => { const q = S.mode === "macho" ? S.machoCode : S.mmQuery; if (q && !S.pattern) lookupMM(q); renderPatStatus(); });
  restoreFolder();
  if (level() >= 2) ensureReports();
}
async function loadData() {
  S.loadError = null;
  try {
    const t = token("read");
    const [rel, meta, settings, log] = await Promise.all([
      S.store.readJSON("data", "relacao.json", t), S.store.readJSON("data", "meta.json", t),
      S.store.readJSON("data", "settings.json", t), level() >= 2 ? S.store.readJSON("data", D.LOG_PATH, t) : null]);
    S.pairs = rel?.pairs || []; S.relInfo = rel || null;
    S.meta = meta || { lastUpdate: null, history: [] };
    S.settings = { ...D.DEFAULT_SETTINGS, ...(settings || {}) };
    S.log = log || emptyLog(1, []);
  } catch (e) {
    S.loadError = e.message;
  }
  buildIndexes(); renderBanner(); renderHome(); renderLib();
}
function buildIndexes() {
  S.MM2B = new Map(); S.B2MM = new Map(); S.DESC = new Map();
  for (const p of S.pairs) {
    if (!S.MM2B.has(p.mm)) S.MM2B.set(p.mm, new Set()); S.MM2B.get(p.mm).add(p.braille);
    if (!S.B2MM.has(p.braille)) S.B2MM.set(p.braille, new Set()); S.B2MM.get(p.braille).add(p.mm);
    if (p.desc && !S.DESC.has(p.mm)) S.DESC.set(p.mm, p.desc);
  }
  buildPdfIndex();
}
/* PDFs: lidos da pasta 00 - BRAILLES ligada neste dispositivo (não há lista guardada) */
function buildPdfIndex() {
  S.PDFS = new Map();
  if (S.folder) for (const [c, files] of S.folder) S.PDFS.set(c, files.map(f => f.name));
}
/* avisos: só Supervisor e Manager (o Operador não vê os avisos de prazo nem de registo) */
function renderBanner() {
  const b = $("#banner"), items = [];
  if (S.loadError) items.push(`<div class="banner red"><span><b>Sem acesso aos dados.</b> ${esc(S.loadError)}</span></div>`);
  if (level() >= 2 && !S.loadError) {
    const a = D.ageDays(S.meta), max = S.settings.maxDays;
    if (D.isOverdue(S.meta, S.settings)) {
      const txt = a == null ? "<b>A relação MM ↔ Braille ainda não foi carregada.</b> A pesquisa por MM só funciona depois de carregar o ficheiro do SAP."
        : `<b>A relação SAP está fora do prazo.</b> Última atualização há ${Math.floor(a)} dias (${D.fmtDate(S.meta.lastUpdate)}); o prazo é de ${max} dias.`;
      items.push(`<div class="banner ${a == null ? "" : "red"}"><span>${txt}</span><button class="btn" data-go="atualizacao">Atualizar agora</button></div>`);
    }
    const R = S.reports?.reports || {}, last = Object.keys(R).sort().pop(), open = last ? (R[last].incidents || []).filter(i => !i.tratado).length : 0;
    if (open) items.push(`<div class="banner red"><span><b>Relatório diário de ${last.slice(8, 10)}/${last.slice(5, 7)}:</b> ${open} ${open === 1 ? "incidência" : "incidências"} por tratar.</span><button class="btn" data-go="registo">Ver relatório</button></div>`);
    const n = S.log?.records?.length || 0;
    if (n >= D.LOG_LIMIT) items.push(`<div class="banner"><span><b>O registo V${pad2(S.log.version)} tem ${n} verificações.</b> Exporte-o para Excel e comece um registo novo, para o ficheiro não ficar demasiado pesado.</span><button class="btn" data-go="registo">Abrir Registo</button></div>`);
  }
  b.innerHTML = items.join(""); b.hidden = !items.length;
}
const pad2 = v => String(v).padStart(2, "0");
const emptyLog = (version, archives) => ({ version, started: new Date().toISOString(), records: [], archives });

/* ================= navegação ================= */
function show(view) {
  if (!S.session) return;
  if (!canView(view)) view = roleDef().machoOnly ? "verificar" : "inicio";
  onlyView("v-" + view);
  $$("nav.tabs button").forEach(b => { if (b.dataset.view === view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  if (location.hash !== "#" + view) history.replaceState(null, "", "#" + view);
  if (view === "verificar") requestAnimationFrame(() => { drawPhoto(); drawPattern(); });
  if (view === "inicio") { renderHome(); requestAnimationFrame(drawHero); }
  if (view === "biblioteca") renderLib();
  if (view === "atualizacao") renderUpdate();
  if (view === "definicoes") renderSettings();
  if (view === "registo") renderRegisto(true);
  if (view === "definicoes") renderVault();
  window.scrollTo(0, 0);
}
$$("nav.tabs button").forEach(b => b.addEventListener("click", () => show(b.dataset.view)));
window.addEventListener("hashchange", () => { const v = location.hash.slice(1); if (VIEW_LEVEL[v]) show(v); });
document.addEventListener("click", e => {
  const g = e.target.closest("[data-go]");
  if (g) { if (g.dataset.filter) setLibFilter(g.dataset.filter); show(g.dataset.go); }
  const fg = e.target.closest("[data-filter-go]");
  if (fg) { $("#lib-q").value = ""; setLibFilter(fg.dataset.filterGo); show("biblioteca"); }
  const v = e.target.closest("[data-verify]");
  if (v) { setMode("caixa"); $("#mm-in").value = v.dataset.verify; lookupMM(v.dataset.verify); show("verificar"); }
  if (e.target.closest("[data-folder]")) pickFolder();
});

/* ================= modo: caixa ou macho ================= */
function setMode(m) {
  if (roleDef().machoOnly) m = "macho";
  if (S.mode !== m) { $("#mm-out").innerHTML = ""; $("#pdf-check").innerHTML = ""; S.expectCodes = null; S.mmQuery = ""; S.machoCode = ""; }
  S.mode = m;
  $$("#mode-seg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
  $("#mm-in").placeholder = m === "macho" ? "Código do braille, ex.: 130009554" : "MM do produto, ex.: 8000020749";
  $("#mm-in").setAttribute("aria-label", m === "macho" ? "Código do braille" : "MM do produto");
  $("#of-btn").hidden = m === "macho"; $("#of-out").innerHTML = "";
  $("#img-name").textContent = S.img ? S.imgName : m === "macho" ? "Foto da face do macho (pinos), de frente e com luz de lado." : "Foto tirada ao verso da caixa, a 90º e com luz de lado.";
  // macho: o lado é detetado sozinho; caixa: verso por omissão
  setSide(m === "macho" ? "auto" : "verso");
  renderMachoCtx();
}
function setSide(s) { S.side = s; $$(".seg button[data-side]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.side === s))); }
$$("#mode-seg button").forEach(b => b.addEventListener("click", () => { if (S.mode === b.dataset.mode) return; setMode(b.dataset.mode); $("#mm-in").value = ""; }));
const momento = () => S.session?.role === "famag" ? "famag" : "rececao";
async function renderMachoCtx() {
  const el = $("#macho-ctx"); if (!el) return;
  if (S.mode !== "macho") { el.hidden = true; return; }
  const c = S.ctx, who = momento() === "famag" ? "Verificação FAMAG, antes de enviar o macho" : "Verificação PCV, na receção do macho";
  el.hidden = false;
  el.innerHTML = `<div class="found"><span class="hint">${who}</span>${c ? `<span>Pedido da checklist da PCV Ferramentas${c.ferramenta ? ` · ferramenta <b>${esc(c.ferramenta)}</b>` : ""}. O resultado volta para a checklist.</span>` : ""}<span id="macho-prev"></span></div>`;
}
/* na receção, mostra a última verificação da FAMAG deste código */
async function showFamagPrev(code) {
  const el = $("#macho-prev"); if (!el || momento() === "famag") return;
  try {
    const log = S.log && level() >= 2 ? S.log : await S.store.readJSON("data", D.LOG_PATH, token("read"));
    const r = [...(log?.records || [])].reverse().find(x => x.tipo === "macho" && x.momento === "famag" && x.braille === code);
    el.innerHTML = r ? `FAMAG verificou este macho em <b>${esc(D.fmtDT(r.t))}</b>: <span class="tag ${r.result === "OK" ? "green" : "red"}" style="margin-left:0">${esc(r.result)}</span>` : `<span class="hint">Sem verificação da FAMAG registada para ${esc(code)}.</span>`;
  } catch (e) { el.textContent = ""; }
}

/* ================= Início ================= */
function renderHome() {
  $("#p-mm").textContent = S.MM2B.size;
  $("#p-codes").textContent = S.B2MM.size;
  $("#p-ver").textContent = HIST.length;
  $("#k-ok").textContent = HIST.filter(h => h.r === "ok").length;
  $("#k-nok").textContent = HIST.filter(h => h.r === "nok").length;
  $("#k-chk").textContent = HIST.filter(h => h.r === "chk" || h.r === "inc").length;
  const a = D.ageDays(S.meta);
  $("#k-age").textContent = a == null ? "—" : Math.floor(a);
  $("#k-max").textContent = S.settings.maxDays;
  $("#tile-sap .kv div:first-child").className = D.isOverdue(S.meta, S.settings) ? "bad" : "";
  $("#sap-txt").textContent = S.meta?.lastUpdate ? `Atualizada em ${D.fmtDateTime(S.meta.lastUpdate)} por ${S.meta.updatedBy || "—"} (${S.meta.file || "ficheiro SAP"}).` : "Ainda não foi carregado nenhum ficheiro do SAP.";
  const lab = { ok: "OK", nok: "NOK", chk: "CONF.", inc: "INC." };
  $("#hist").innerHTML = HIST.length ? HIST.slice(0, 6).map(h => `<div><span class="r ${h.r}">${lab[h.r]}</span><span class="num">${esc(h.code || "—")}</span><span class="hint">${esc(h.mm || "")}</span><span class="hint" style="margin-left:auto">${esc(h.t)}</span></div>`).join("") : `<div class="hint">Ainda não há verificações neste dispositivo.</div>`;
}
function drawHero() {
  const cv = $("#hero-cv"); if (!cv || cv.offsetParent === null) return;
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
  const W = r.width, H = r.height;
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--kraft").trim() || "#a8a397"; ctx.fillRect(0, 0, W, H);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 1400; i++) { ctx.fillStyle = rnd() < .5 ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.07)"; ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1); }
  const lines = ["hinojosa", "braille pcv", "verificacao por foto"];
  const cells = Math.max(...lines.map(l => l.length));
  const pitch = Math.min((W - 60) / cells, 30), ds = pitch * 0.375, lp = ds * 3.9;
  const x0 = (W - (cells - 1) * pitch - ds) / 2, y0 = (H - (2 * lp + 2 * ds)) / 2, rad = ds * 0.33;
  lines.forEach((ln, li) => [...ln].forEach((ch, ci) => (V.LETTERS[ch] || []).forEach(d => {
    const cx = x0 + ci * pitch + (d > 3 ? ds : 0), cy = y0 + li * lp + ((d - 1) % 3) * ds;
    const g = ctx.createRadialGradient(cx - rad * .35, cy - rad * .35, rad * .1, cx, cy, rad * 1.25);
    g.addColorStop(0, "rgba(255,255,255,.55)"); g.addColorStop(.55, "rgba(255,255,255,.08)"); g.addColorStop(1, "rgba(0,0,0,.28)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rad * 1.25, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx + .6, cy + .6, rad, .2, 2.2); ctx.stroke();
  })));
}

/* ================= Biblioteca ================= */
let libFilter = "all";
function setLibFilter(f) { libFilter = f; $$("#lib-filters .chip").forEach(c => c.setAttribute("aria-pressed", String(c.dataset.f === f))); renderLib(); }
$$("#lib-filters .chip").forEach(c => c.addEventListener("click", () => setLibFilter(c.dataset.f)));
$("#lib-search").addEventListener("submit", e => { e.preventDefault(); renderLib(); });
$("#lib-q").addEventListener("input", () => renderLib());
function hl(s, q) { s = String(s ?? ""); if (!q) return esc(s); const i = s.toLowerCase().indexOf(q.toLowerCase()); if (i < 0) return esc(s); return esc(s.slice(0, i)) + "<mark>" + esc(s.slice(i, i + q.length)) + "</mark>" + esc(s.slice(i + q.length)); }
function renderLib() {
  if (!$("#lib-body")) return;
  const q = $("#lib-q").value.trim(), ql = q.toLowerCase();
  const rows = S.pairs.filter(p => {
    const pdfs = S.PDFS.get(p.braille) || [];
    if (libFilter === "sempdf" && (!S.folder || pdfs.length)) return false;
    if (libFilter === "multi" && S.MM2B.get(p.mm).size < 2) return false;
    if (libFilter === "partilhado" && S.B2MM.get(p.braille).size < 2) return false;
    if (!ql) return true;
    return p.mm.includes(ql) || p.braille.includes(ql) || (p.desc || "").toLowerCase().includes(ql) || pdfs.some(f => f.toLowerCase().includes(ql));
  });
  $("#lib-count").textContent = S.pairs.length ? `${rows.length} de ${S.pairs.length} pares MM – braille` : "";
  $("#lib-src").textContent = (S.relInfo ? `Relação SAP de ${D.fmtDateTime(S.relInfo.updatedAt)} · ${S.relInfo.sourceFile || ""}` : "") + (S.folder ? "" : " · Ligue a pasta dos PDFs para ver a coluna “PDF na pasta”.");
  if (libFilter === "sempdf" && !S.folder) { $("#lib-body").innerHTML = `<tr><td colspan="5" class="hint">Para ver os brailles sem PDF, use primeiro <b>Ligar pasta dos PDFs</b> e escolha a pasta 00 - BRAILLES.</td></tr>`; return; }
  if (!S.pairs.length) { $("#lib-body").innerHTML = `<tr><td colspan="5" class="hint">Ainda não há relação SAP carregada. ${level() >= 2 ? 'Carregue-a no separador <button class="btn small" data-go="atualizacao">Atualização</button>' : "Peça ao Supervisor para a carregar."}</td></tr>`; return; }
  $("#lib-body").innerHTML = rows.slice(0, 500).map(p => {
    const pdfs = S.PDFS.get(p.braille) || [];
    return `<tr>
    <td class="mono">${hl(p.mm, q)}${S.MM2B.get(p.mm).size > 1 ? '<span class="tag blue">vários brailles</span>' : ""}</td>
    <td class="mono">${hl(p.braille, q)}${S.B2MM.get(p.braille).size > 1 ? `<span class="tag green">${S.B2MM.get(p.braille).size} MM</span>` : ""}</td>
    <td>${hl(p.desc, q)}</td>
    <td class="file">${!S.folder ? '<span class="hint">—</span>' : pdfs.length ? pdfs.map(f => hl(f, q)).join("<br>") : '<span class="tag">sem PDF</span>'}</td>
    <td><button class="btn small" data-verify="${esc(p.mm)}">Verificar</button></td></tr>`;
  }).join("") + (rows.length > 500 ? `<tr><td colspan="5" class="hint">A mostrar 500 de ${rows.length}. Refine a pesquisa.</td></tr>` : "") ||
    `<tr><td colspan="5" class="hint">Nenhum resultado. Confirme o número ou procure por parte da descrição.</td></tr>`;
}

/* ================= Verificar: passo 1 ================= */
function lookupMM(q) {
  q = D.normCode(q || ""); const out = $("#mm-out");
  if (!q) { out.innerHTML = ""; S.expectCodes = null; S.mmQuery = ""; return; }
  if (S.mode === "macho") {
    // macho: identifica-se pelo código do braille (1300…); não há MM
    S.mmQuery = ""; S.machoCode = q;
    if (!/^13\d{7}$/.test(q)) { S.expectCodes = null; out.innerHTML = `<div class="found bad"><span class="code">Código inválido</span><span>O código do braille tem 9 dígitos e começa por 13 (ex.: 130009554).</span></div>`; return; }
    S.expectCodes = [q];
    out.innerHTML = `<div class="found"><span class="hint">Macho do braille</span><span class="code">${esc(q)}</span>${S.B2MM.has(q) ? `<span class="hint">Usado em ${S.B2MM.get(q).size} MM: ${[...S.B2MM.get(q)].slice(0, 6).map(esc).join(", ")}${S.B2MM.get(q).size > 6 ? "…" : ""}</span>` : ""}<div id="mm-pick"></div></div>`;
    loadForCodes([q]); checkPdfMatch(); renderMachoCtx().then(() => showFamagPrev(q)); return;
  }
  S.mmQuery = q;
  let codes = [], kind = "mm";
  if (S.MM2B.has(q)) codes = [...S.MM2B.get(q)];
  else if (S.B2MM.has(q) || /^13\d{7}$/.test(q)) { codes = [q]; kind = "braille"; }
  const of = S.ofHint && S.ofHint.mm === q ? S.ofHint : null;
  if (!codes.length && of?.braille) { codes = [of.braille]; kind = "of"; }
  if (!codes.length) {
    S.expectCodes = null;
    out.innerHTML = `<div class="found bad"><span class="code">Sem braille para ${esc(q)}</span><span>${S.pairs.length ? "Este MM não está na relação SAP. Confirme o número ou peça ao Supervisor para atualizar a relação." : "A relação SAP ainda não foi carregada."}</span></div>`;
    checkPdfMatch(); return;
  }
  S.expectCodes = codes;
  const desc = S.DESC.get(q) || of?.desc;
  const ofWarn = of?.braille && kind !== "of" && !codes.includes(of.braille)
    ? `<span class="tag red" style="margin-left:0">A OF indica o braille ${esc(of.braille)}, mas a relação SAP tem ${codes.map(esc).join(" / ")}. Confirme qual está certo antes de verificar.</span>`
    : of?.braille && kind !== "of" ? `<span class="hint">O braille da OF é igual ao da relação SAP.</span>` : kind === "of" ? `<span class="tag" style="margin-left:0">Este MM não está na relação SAP: a usar o braille lido da OF.</span>` : "";
  out.innerHTML = `<div class="found ${codes.length > 1 || (of && ofWarn.includes("red")) ? "warn" : ""}">
     <span class="hint">${codes.length > 1 ? "Atenção: este MM tem mais do que um código de braille no SAP" : kind === "braille" ? "Código de braille" : `Braille do MM ${esc(q)}${desc ? " · " + esc(desc) : ""}`}</span>
     <span class="code">${codes.map(esc).join(" · ")}</span>${ofWarn}
     ${S.folder ? codes.map(c => (S.PDFS.get(c) || []).map(f => `<span class="file">${esc(f)}</span>`).join("") || `<span class="file">Sem PDF com o código ${esc(c)} na pasta ligada.</span>`).join("") : ""}
     <div id="mm-pick"></div></div>`;
  loadForCodes(codes);
  checkPdfMatch();
}
$("#mm-form").addEventListener("submit", e => { e.preventDefault(); lookupMM($("#mm-in").value); });
/* Ler OF: foto da ordem de fabrico → lista de MM com o braille da linha "Braille" */
$("#of-btn").addEventListener("click", async () => {
  const shot = await window.Camera.open({ doc: true, title: "Foto da ordem de fabrico", subtitle: "Página com a tabela de características (Chave / Descritivo / Valor)" });
  if (shot) readOF(shot.url);
});
async function readOF(url) {
  const out = $("#of-out");
  out.innerHTML = `<div class="found"><span class="hint"><span class="spinner"></span><span id="of-prog">A preparar o leitor de texto (só demora da primeira vez)…</span></span></div>`;
  try {
    const r = await window.OF.read(url, p => { const el = $("#of-prog"); if (el) el.textContent = `A ler a OF… ${Math.round(p * 100)}%`; });
    const list = (r?.entries || []);
    if (!list.length) { out.innerHTML = `<div class="found bad"><span class="code">Não encontrei MM na foto</span><span>Fotografe a página das características, com a tabela toda visível e sem reflexos. Também pode escrever o MM.</span></div>`; return; }
    out.innerHTML = `<div class="found"><span class="hint">MM lidos da OF${list.length > 1 ? " · toque no que está a verificar" : ""}</span>
      ${list.map((e, i) => { const sap = S.MM2B.get(e.mm), diff = e.braille && sap && !sap.has(e.braille);
        return `<button class="ofpick ${diff ? "warn" : ""}" data-of="${i}"><b class="mono">${esc(e.mm)}</b> ${e.braille ? `· Braille <b class="mono">${esc(e.braille)}</b>` : "· <i>sem linha Braille</i>"}${e.desc ? `<small>${esc(e.desc)}</small>` : ""}${diff ? `<small class="bad-txt">A relação SAP tem ${[...sap].map(esc).join(" / ")}</small>` : ""}</button>`; }).join("")}</div>`;
    out.querySelectorAll("[data-of]").forEach(b => b.addEventListener("click", () => { const e = list[+b.dataset.of]; S.ofHint = e; $("#mm-in").value = e.mm; lookupMM(e.mm); }));
    if (list.length === 1) { S.ofHint = list[0]; $("#mm-in").value = list[0].mm; lookupMM(list[0].mm); }
  } catch (e) { out.innerHTML = `<div class="found bad"><span class="code">Não foi possível ler a OF</span><span>${esc(e.message || e)}</span></div>`; }
}
/* PDF do braille: 1) pasta ligada neste computador; 2) padrões sincronizados (tablets, FAMAG) */
const isBraillePdf = n => !/tinta|report|cortante/i.test(n);
const pdfRank = n => (/braill?e/i.test(n) ? 0 : 1) + (/aprovad/i.test(n) ? 0 : 0.5);
function loadForCodes(codes) {
  const pick = $("#mm-pick"); if (!pick) return;
  const files = S.folder ? codes.flatMap(c => S.folder.get(c) || []).filter(f => isBraillePdf(f.name)).sort((a, b) => pdfRank(a.name) - pdfRank(b.name)) : [];
  const stored = storedFor(codes);
  const choose = (items, label, load) => {
    if (items.length === 1) { load(items[0]); pick.innerHTML = `<span class="hint">${label}</span>`; return; }
    pick.innerHTML = `<span class="hint">Há vários PDFs com este código. Escolha:</span>` + items.map((f, i) => `<button class="btn small" data-pick="${i}" style="margin:4px 6px 0 0">${esc(f.name)}</button>`).join("");
    pick.querySelectorAll("[data-pick]").forEach(b => b.addEventListener("click", () => load(items[+b.dataset.pick])));
  };
  if (files.length) return choose(files, "PDF aberto da pasta ligada.", loadPdfFile);
  if (stored.length) return choose(stored, "Padrão sincronizado do PDF (não é preciso o ficheiro).", e => setPattern(V.fromStored(e)));
  pick.innerHTML = S.patterns || S.folder ? `<span class="hint">Não encontrei o PDF ${S.folder ? "na pasta ligada" : ""}${S.folder && S.patterns ? " nem " : ""}${S.patterns ? "nos padrões sincronizados" : ""}. Carregue o PDF à mão${level() >= 2 ? " ou ligue a pasta 00 - BRAILLES" : " ou peça a um Supervisor para sincronizar os padrões"}.</span>` : `<span class="hint">A carregar os padrões sincronizados…</span>`;
}
function storedFor(codes) {
  const f = S.patterns?.files || {};
  return Object.entries(f).filter(([n, e]) => !e.err && e.blocks && codes.some(c => (e.codes || []).includes(c)) && isBraillePdf(n))
    .map(([n, e]) => ({ ...e, name: n })).sort((a, b) => pdfRank(a.name) - pdfRank(b.name));
}
async function loadPatterns() {
  try { S.patterns = (await S.store.readJSON("data", D.PAT_PATH, token("read"))) || { version: 1, files: {} }; }
  catch (e) { S.patterns = S.patterns || null; }
}
function folderMap(fileList) {
  const m = new Map(); let n = 0; const all = [];
  for (const f of fileList) { if (!/\.pdf$/i.test(f.name)) continue; n++; all.push(f); for (const c of new Set(f.name.match(/1300\d{5}/g) || [])) { if (!m.has(c)) m.set(c, []); m.get(c).push(f); } }
  return { m, n, all };
}
function applyFolder(files, how) {
  const { m, n, all } = folderMap(files); S.folder = m; S.folderFiles = all; buildPdfIndex();
  $("#folder-hint").innerHTML = `Pasta ligada${how ? " (" + how + ")" : ""}: <b>${n}</b> PDFs, <b>${m.size}</b> códigos de braille. Os ficheiros não saem do computador.`;
  $("#folder-btn").textContent = "Ligar outra pasta";
  if (S.mmQuery || S.machoCode) lookupMM(S.mode === "macho" ? S.machoCode : S.mmQuery);
  renderLib(); renderPatStatus();
  if (level() >= 2) syncPatterns(false);
}
$("#folder-in").addEventListener("change", e => { if (e.target.files.length) { applyFolder(e.target.files); toast(`Pasta ligada: ${S.folderFiles.length} PDFs.`); } e.target.value = ""; });
$("#folder-btn").addEventListener("click", () => pickFolder());

/* pasta lembrada em cada computador (File System Access API; o acesso fica guardado no navegador) */
const inFrame = (() => { try { return window.top !== window && !window.top.location.href; } catch (e) { return true; } })();
const fsa = () => !!window.showDirectoryPicker && !inFrame;
function idb(op, val) {
  return new Promise((res) => {
    let rq; try { rq = indexedDB.open("bpcv", 1); } catch (e) { return res(null); }
    rq.onupgradeneeded = () => rq.result.createObjectStore("kv");
    rq.onerror = () => res(null);
    rq.onsuccess = () => { try { const tx = rq.result.transaction("kv", op === "get" ? "readonly" : "readwrite"), st = tx.objectStore("kv"); const r = op === "get" ? st.get("folder") : st.put(val, "folder"); r.onsuccess = () => res(r.result ?? null); r.onerror = () => res(null); } catch (e) { res(null); } };
  });
}
async function readDir(h, out = [], depth = 0) {
  for await (const e of h.values()) {
    if (e.kind === "file" && /\.pdf$/i.test(e.name)) out.push(await e.getFile());
    else if (e.kind === "directory" && depth < 1) await readDir(e, out, depth + 1);
  }
  return out;
}
async function pickFolder() {
  if (!fsa()) return $("#folder-in").click();
  try {
    let h = S.folderHandle;
    if (h && (await h.queryPermission({ mode: "read" })) !== "granted" && (await h.requestPermission({ mode: "read" })) === "granted") { /* reabrir a pasta lembrada */ }
    else { h = await window.showDirectoryPicker({ id: "brailles", mode: "read" }); S.folderHandle = h; await idb("put", h); }
    $("#folder-hint").innerHTML = `<span class="spinner"></span>A ler a pasta ${esc(h.name)}…`;
    const files = await readDir(h); applyFolder(files, h.name); toast(`Pasta ligada: ${files.length} PDFs. Fica lembrada neste computador.`);
  } catch (e) { if (e.name !== "AbortError") toast(e.message); }
}
async function restoreFolder() {
  if (!fsa() || S.folder) return;
  const h = await idb("get"); if (!h) return;
  S.folderHandle = h;
  try {
    if ((await h.queryPermission({ mode: "read" })) === "granted") { const files = await readDir(h); applyFolder(files, h.name); }
    else { $("#folder-btn").textContent = "Reabrir pasta " + h.name; $("#folder-hint").innerHTML = `A pasta <b>${esc(h.name)}</b> está lembrada neste computador. Carregue em <b>Reabrir pasta</b> para a app voltar a ter acesso (o navegador pede autorização uma vez por sessão).`; }
  } catch (e) { /* pasta movida ou apagada */ }
}

/* ================= padrões sincronizados (Supervisor/Manager com a pasta ligada) ================= */
function renderPatStatus() {
  const el = $("#pat-status"); if (!el) return;
  const f = S.patterns?.files || {}, n = Object.values(f).filter(e => !e.err).length, bad = Object.values(f).filter(e => e.err).length;
  el.innerHTML = S.patterns ? `Padrões sincronizados: <b>${n}</b> PDFs${bad ? ` · ${bad} PDFs sem pontos legíveis` : ""}${S.patterns.updated ? ` · ${D.fmtDateTime(S.patterns.updated)}` : ""}. Os tablets usam estes padrões quando não têm a pasta.` : "";
  $("#pat-sync").hidden = !(level() >= 2 && S.folder);
}
$("#pat-sync").addEventListener("click", () => syncPatterns(true));
let syncing = false;
async function syncPatterns(force) {
  if (syncing || !S.folderFiles || level() < 2) return;
  syncing = true; const el = $("#pat-status");
  try {
    if (!S.patterns) await loadPatterns();
    const cur = S.patterns?.files || {}, files = S.folderFiles.filter(f => /1300\d{5}/.test(f.name));
    const todo = files.filter(f => { const e = cur[f.name]; return force || !e || e.size !== f.size || e.mtime !== f.lastModified; });
    const names = new Set(files.map(f => f.name)), gone = Object.keys(cur).filter(n => !names.has(n));
    if (!todo.length && !gone.length) { renderPatStatus(); return; }
    const changed = {}; let done = 0;
    const push = async () => {
      const ch = { ...changed }; Object.keys(changed).forEach(k => delete changed[k]);
      S.patterns = await S.store.updateJSON("data", D.PAT_PATH, o => {
        o = o || { version: 1, files: {} }; Object.assign(o.files, ch);
        if (files.length >= Object.keys(o.files).length * 0.5) gone.forEach(n => delete o.files[n]); // só apaga se a pasta parece completa
        o.updated = new Date().toISOString(); o.by = S.session.name; return o;
      }, `Padrões de braille: ${Object.keys(ch).length} PDFs (${S.session.name})`, token("write"));
    };
    for (const f of todo) {
      if (el) el.innerHTML = `<span class="spinner"></span>A extrair os pontos dos PDFs novos ou alterados: ${done + 1} de ${todo.length}…`;
      const base = { codes: [...new Set(f.name.match(/1300\d{5}/g))], size: f.size, mtime: f.lastModified, at: new Date().toISOString() };
      try { const P = await V.extractPattern(await f.arrayBuffer(), f.name); changed[f.name] = { ...base, ...V.toStored(P), name: undefined }; }
      catch (e) { changed[f.name] = { ...base, err: String(e.message || e).slice(0, 120) }; }
      done++;
      if (Object.keys(changed).length >= 40) await push();
    }
    await push();
    toast(`Padrões sincronizados: ${todo.length} PDFs novos ou alterados.`);
    renderPatStatus();
  } catch (e) { if (el) el.textContent = "Não foi possível sincronizar os padrões: " + e.message; }
  finally { syncing = false; }
}
function checkPdfMatch() {
  const box = $("#pdf-check");
  if (!S.pattern || !S.expectCodes) { box.innerHTML = ""; return; }
  const ok = S.expectCodes.some(c => S.pattern.name.includes(c));
  box.innerHTML = ok ? `<div class="found"><span class="hint">${S.mode === "macho" ? "O PDF carregado corresponde ao código do macho." : "O PDF carregado corresponde ao braille do MM no SAP."}</span></div>` :
    `<div class="found bad"><span class="code">PDF diferente do esperado</span><span>O nome do PDF não tem o código ${S.expectCodes.map(esc).join(" / ")}. Confirme se carregou o ficheiro certo.</span></div>`;
}

/* PDF */
function drawPattern() {
  const P = S.pattern, cv = $("#pat-cv"); if (!P || cv.offsetParent === null) return;
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const bl = P.blocks || [P], gap = 5, W = Math.max(...bl.map(B => B.W)), Htot = bl.reduce((a, B) => a + B.H + 2, 0) + gap * (bl.length - 1);
  const pad = 14, sc = Math.min((r.width - 2 * pad) / (W + 2), 26), hCss = Htot * sc + 2 * pad;
  cv.style.height = hCss + "px"; cv.width = Math.round(r.width * dpr); cv.height = Math.round(hCss * dpr);
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(document.documentElement);
  let oyMM = 0;
  bl.forEach((B, i) => {
    const ox = pad + sc, oy = pad + sc + oyMM * sc;
    if (bl.length > 1) { ctx.fillStyle = css.getPropertyValue("--muted").trim(); ctx.font = "11px IBM Plex Sans, sans-serif"; ctx.fillText(`Bloco ${i + 1}`, pad, oy - sc * 0.4); }
    ctx.fillStyle = css.getPropertyValue("--line").trim();
    B.cells.forEach((row, l) => row.forEach((m, c) => { for (let n = 0; n < 6; n++) { const q = B.pos(l, c, n); ctx.beginPath(); ctx.arc(ox + q.X * sc, oy + q.Y * sc, Math.max(1.2, sc * 0.18), 0, 7); ctx.fill(); } }));
    ctx.fillStyle = css.getPropertyValue("--ink").trim();
    B.pts.forEach(p => { ctx.beginPath(); ctx.arc(ox + p.X * sc, oy + p.Y * sc, Math.max(2, sc * (B.dotD || 1.6) / 2), 0, 7); ctx.fill(); });
    oyMM += B.H + 2 + gap;
  });
}
function setPattern(P) {
  S.pattern = P;
  $("#pdf-name").textContent = P.name;
  $("#pattern-box").hidden = false;
  const bl = P.blocks || [P];
  $("#pat-meta").innerHTML = `<span><b>${bl.reduce((a, B) => a + B.pts.length, 0)}</b> pontos</span>${bl.length > 1 ? `<span><b>${bl.length}</b> blocos de braille (faces diferentes): a foto é comparada com o bloco que lá estiver</span>` : `<span><b>${P.cells.length}</b> linhas</span><span><b>${Math.max(...P.cells.map(r => r.length))}</b> células máx.</span>`}<span>ponto a ponto <b>${P.ds.toFixed(2)} mm</b></span><span>célula <b>${P.Cp.toFixed(2)} mm</b></span>${bl.map((B, i) => `<span>${bl.length > 1 ? `Bloco ${i + 1}` : "Leitura aprox."}: <b>${esc(V.patternText(B))}</b></span>`).join("")}<span>Origem: ${esc(P.source)}</span>`;
  $("#n1").classList.add("done");
  checkPdfMatch(); drawPattern(); updateRun();
}
async function loadPdfBuffer(buf, name) {
  $("#pdf-name").innerHTML = `<span class="spinner"></span>A ler ${esc(name)}…`;
  try { setPattern(await V.extractPattern(buf, name)); }
  catch (err) { S.pattern = null; $("#pattern-box").hidden = true; $("#n1").classList.remove("done"); $("#pdf-name").textContent = name; $("#pdf-check").innerHTML = `<div class="found bad"><span class="code">PDF não lido</span><span>${esc(err.message || err)}</span></div>`; updateRun(); }
}
async function loadPdfFile(f) { await loadPdfBuffer(await f.arrayBuffer(), f.name); }
$("#pdf-in").addEventListener("change", e => { const f = e.target.files[0]; if (f) loadPdfFile(f); });
function setupDrop(sel, cb) {
  const el = $(sel);
  el.addEventListener("dragover", e => { e.preventDefault(); el.classList.add("over"); });
  el.addEventListener("dragleave", () => el.classList.remove("over"));
  el.addEventListener("drop", e => { e.preventDefault(); el.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) cb(f); });
}
setupDrop("#pdf-drop", f => { if (/\.pdf$/i.test(f.name)) loadPdfFile(f); });

/* ================= Verificar: foto ================= */
function loadImage(url, name) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => { flushLog(); S.imgSeq = (S.imgSeq || 0) + 1; S.img = im; S.imgName = name; S.box = null; $("#img-name").textContent = name; $("#n2").classList.add("done"); $("#n3").classList.remove("done"); $("#photo-empty").hidden = true; $("#photo-cv").hidden = false; drawPhoto(); updateRun(); res(im); }; im.onerror = () => rej(new Error("Não consegui abrir a imagem.")); im.src = url; });
}
$("#img-in").addEventListener("change", e => { const f = e.target.files[0]; if (f) { $("#img-warn").hidden = true; loadImage(URL.createObjectURL(f), f.name); } e.target.value = ""; });
/* câmara com moldura: a zona da moldura passa a ser a zona marcada e a comparação começa sozinha */
$("#cam-btn").addEventListener("click", async () => {
  const P = S.pattern;
  // a face do macho vê-se como a frente da caixa (sem espelho); a caixa fotografa-se pelo verso
  const shot = await window.Camera.open({ pattern: P, side: S.mode === "macho" || S.side === "frente" ? "frente" : "verso",
    title: S.mode === "macho" ? "Foto do macho" : "Foto do braille",
    subtitle: P ? (S.mode === "macho" ? `Braille ${S.machoCode || ""}` : `MM ${S.mmQuery || "—"}`) + (P.blocks?.length > 1 ? ` · moldura do bloco 1 de ${P.blocks.length}` : "") : "Sem PDF carregado: a moldura é genérica" });
  if (!shot) return;
  await loadImage(shot.url, shot.name);
  const w = $("#img-warn"); w.hidden = !shot.warnings?.length; w.className = "hint bad-txt"; w.textContent = (shot.warnings || []).join(" ");
  if (shot.box) { S.box = shot.box; $("#n3").classList.add("done"); drawPhoto(); updateRun(); if (S.pattern) runCompare(); }
});
setupDrop("#img-drop", f => { if (/^image\//.test(f.type)) loadImage(URL.createObjectURL(f), f.name); });
$$(".seg button[data-side]").forEach(b => b.addEventListener("click", () => setSide(b.dataset.side)));
$("#sens").addEventListener("input", e => { S.sens = +e.target.value; $("#sens-v").textContent = S.sens.toFixed(1); });
$("#sens").addEventListener("change", () => { if (S.last) runCompare(); });
let drag = null, photoScale = 1;
function drawPhoto() {
  const cv = $("#photo-cv"), im = S.img; if (!im || cv.offsetParent === null) return;
  const wrapW = $("#photo-wrap").clientWidth, dpr = window.devicePixelRatio || 1;
  photoScale = wrapW / im.naturalWidth;
  const h = im.naturalHeight * photoScale;
  cv.style.height = h + "px"; cv.width = Math.round(wrapW * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr * photoScale, 0, 0, dpr * photoScale, 0, 0);
  ctx.drawImage(im, 0, 0);
  const b = S.box;
  if (b) {
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.beginPath(); ctx.rect(0, 0, im.naturalWidth, im.naturalHeight); ctx.rect(b[0], b[1] + b[3], b[2], -b[3]); ctx.fill("evenodd");
    ctx.strokeStyle = "#2fbf62"; ctx.lineWidth = 3 / photoScale; ctx.strokeRect(b[0], b[1], b[2], b[3]);
  }
}
function evPt(e) { const r = $("#photo-cv").getBoundingClientRect(); return [(e.clientX - r.left) / photoScale, (e.clientY - r.top) / photoScale]; }
$("#photo-cv").addEventListener("pointerdown", e => { if (!S.img) return; e.preventDefault(); $("#photo-cv").setPointerCapture(e.pointerId); drag = evPt(e); });
$("#photo-cv").addEventListener("pointermove", e => { if (!drag) return; const p = evPt(e); S.box = [Math.min(drag[0], p[0]), Math.min(drag[1], p[1]), Math.abs(p[0] - drag[0]), Math.abs(p[1] - drag[1])]; drawPhoto(); });
$("#photo-cv").addEventListener("pointerup", () => { if (!drag) return; drag = null; if (S.box && (S.box[2] < 20 || S.box[3] < 10)) S.box = null; $("#n3").classList.toggle("done", !!S.box); drawPhoto(); updateRun(); });
window.addEventListener("resize", () => { clearTimeout(window.__rz); window.__rz = setTimeout(() => { drawPhoto(); drawPattern(); drawHero(); if (S.last) drawOverlay(S.last); }, 120); });
function updateRun() {
  const miss = [];
  if (!S.pattern) miss.push("PDF do braille"); if (!S.img) miss.push("foto"); if (S.img && !S.box) miss.push("zona marcada na foto");
  $("#run").disabled = miss.length > 0;
  $("#run-hint").textContent = miss.length ? "Falta: " + miss.join(", ") + "." : "Pronto para comparar.";
}
$("#run").addEventListener("click", () => runCompare());

async function runCompare() {
  const P = S.pattern; if (!P || !S.img || !S.box) return;
  $("#res").innerHTML = `<div class="empty-res"><span class="spinner"></span>A comparar…</div>`;
  await new Promise(r => setTimeout(r, 30));
  try {
    const res = V.compareBest(P, S.img, S.box, S.side, S.sens);
    S.last = res; renderResult(res);
    HIST.unshift({ r: res.verdict, code: (P.name.match(/1300\d{5}/) || [""])[0], mm: S.mode === "macho" ? "macho" : S.mmQuery, u: S.session?.u, t: new Date().toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) });
    saveHist(); renderHome();
    $("#n4").classList.add("done");
    queueLog(res.verdict, notesFor(res));
    sendResult(res.verdict, notesFor(res));
    return summary(res);
  } catch (err) {
    console.error(err);
    $("#res").innerHTML = `<div class="found bad"><span class="code">Não foi possível comparar</span><span>${esc(err.message || err)}</span></div>`;
    queueLog("inc", "Não foi possível comparar: " + (err.message || err));
    sendResult("inc", String(err.message || err));
    S.last = null; return { error: String(err.message || err) };
  }
}
/* devolve o resultado à app que abriu esta verificação (checklist da PCV Ferramentas), só para origens autorizadas */
function sendResult(verdict, notes) {
  if (!S.ctx || S.mode !== "macho") return;
  const target = window.opener || (window.parent !== window ? window.parent : null);
  const msgObj = { type: "braille-pcv:resultado", ref: S.ctx.ref, codigo: S.machoCode, ferramenta: S.ctx.ferramenta, resultado: RESULT_LABEL[verdict], ok: verdict === "ok",
    momento: momento() === "famag" ? "FAMAG" : "PCV receção", utilizador: S.session.name, data: new Date().toISOString(), notas: notes || "" };
  let sent = false;
  if (target) for (const o of (S.settings.allowedOrigins || D.DEFAULT_SETTINGS.allowedOrigins)) { try { target.postMessage(msgObj, o); sent = true; } catch (e) {} }
  const box = document.createElement("div"); box.className = "found " + (verdict === "ok" ? "" : "warn"); box.style.marginTop = "12px";
  box.innerHTML = sent ? `<span class="hint">Resultado <b>${esc(msgObj.resultado)}</b> enviado para a checklist da PCV Ferramentas.</span>${window.opener ? `<button class="btn small" id="ctx-close" style="margin-top:6px">Fechar e voltar à checklist</button>` : ""}`
    : `<span class="hint">Abra esta verificação a partir da checklist da PCV Ferramentas para o resultado voltar sozinho. O resultado ficou no registo.</span>`;
  $("#res").appendChild(box);
  $("#ctx-close")?.addEventListener("click", () => window.close());
}
function summary(r) { return { verdict: r.verdict, expected: r.expected, ok: r.ok, miss: r.miss, extra: r.extra, doubt: r.doubt, errCells: r.errCells, dets: r.D.dets.length, mmErr: +r.mmErr.toFixed(3), model: r.R.kind, ms: r.ms, text: r.readText }; }
function renderResult(r) {
  const V2 = { ok: ["OK", "ok", "Braille igual ao PDF aprovado. Todos os pontos foram encontrados e não há pontos a mais."],
    nok: ["NOK", "nok", `${r.errCells} ${r.errCells === 1 ? "célula diferente" : "células diferentes"} do PDF aprovado. Ficam marcadas a vermelho abaixo. Confirme à mão antes de parar a ordem.`],
    chk: ["A CONFIRMAR", "chk", "Não há diferenças claras, mas há pontos pouco nítidos (a amarelo). Confirme ao tato ou repita a foto com luz mais rasante."],
    inc: ["INCONCLUSIVO", "inc", "A foto não alinhou com o PDF. Confirme que é o braille certo, tire a foto a 90º da caixa e marque a zona com menos margem."] }[r.verdict];
  const deg = ((r.R.theta * 180 / Math.PI) % 360 + 360) % 360;
  const extra = [r.blockInfo ? `Comparado com o ${esc(r.blockInfo)} do PDF.` : "",
    ...(r.shifts || []).map(s => `A linha ${s.l + 1} está ${s.cells ? `${Math.abs(s.cells)} ${Math.abs(s.cells) === 1 ? "célula" : "células"} mais à ${s.cells > 0 ? "direita" : "esquerda"}` : `${Math.hypot(s.dx, s.dy).toFixed(1)} mm deslocada`} do que no PDF (os pontos estão certos).`)].filter(Boolean);
  $("#res").innerHTML = `
    <div class="verdict"><span class="badge ${V2[1]}">${V2[0]}</span><p>${V2[2]}</p></div>
    ${extra.length ? `<p class="hint" style="margin-top:8px">${extra.join("<br>")}</p>` : ""}
    <div class="stats">
      <div class="stat"><b>${r.expected}</b><small>Pontos no PDF</small></div>
      <div class="stat good"><b>${r.ok}</b><small>Confirmados</small></div>
      <div class="stat ${r.miss ? "bad" : ""}"><b>${r.miss}</b><small>Em falta</small></div>
      <div class="stat ${r.extra ? "bad" : ""}"><b>${r.extra}</b><small>A mais</small></div>
      <div class="stat ${r.doubt ? "warn" : ""}"><b>${r.doubt}</b><small>Duvidosos</small></div>
    </div>
    <div class="overlay"><canvas id="ov-cv"></canvas></div>
    <div class="legend"><span><i style="background:#2fbf62"></i>ponto confirmado</span><span><i style="box-shadow:inset 0 0 0 2px #e0453a"></i>em falta</span><span><i style="background:#e0453a"></i>a mais</span><span><i style="background:#e8b21f"></i>duvidoso</span></div>
    <h3 style="margin-top:20px">Célula a célula <span class="hint">(como no PDF, lido de frente)</span></h3>
    <div class="lines">${r.lines.map((ln, li) => `<div class="bline"><span class="ln">L${li + 1}</span>${ln.map(cellHtml).join("")}</div>`).join("")}</div>
    <div class="meta" style="margin-top:14px"><span>Orientação: <b>${r.R.rf < 0 ? "verso (espelhado)" : "frente"}, rodado ${Math.round(deg)}°</b></span><span>Modelo: <b>${{ similar: "semelhança", affine: "afim", homog: "perspetiva" }[r.R.kind]}</b></span><span>Erro médio de posição: <b>${r.mmErr.toFixed(2)} mm</b></span><span>Distância entre pontos na caixa: <b>${r.R.dsx.toFixed(2)} × ${r.R.dsy.toFixed(2)} mm</b> (PDF ${r.P.ds.toFixed(2)} mm)</span><span>Pontos detetados: <b>${r.D.dets.length}</b></span><span>Tempo: <b>${r.ms} ms</b></span></div>
    <div class="row" style="margin-top:14px"><button class="btn small" id="fb-btn">A app enganou-se?</button><span class="hint" id="fb-msg"></span></div>`;
  $("#fb-btn").addEventListener("click", openFeedback);
  drawOverlay(r);
}
/* "A app enganou-se": fica no registo (com a foto) para se afinar a deteção */
function openFeedback() {
  const v = S.last?.verdict || "inc";
  modal(`<h3>A app enganou-se?</h3><p class="hint">O resultado foi <b>${RESULT_LABEL[v]}</b>. O que verificou ao tato?</p>
    <div class="form" style="margin-top:12px">
      <label class="check"><input type="radio" name="fbk" value="falso-nok" ${v !== "ok" ? "checked" : ""}> O braille está certo (a app não devia ter dado ${RESULT_LABEL[v] === "OK" ? "este resultado" : RESULT_LABEL[v]})</label>
      <label class="check"><input type="radio" name="fbk" value="falso-ok" ${v === "ok" ? "checked" : ""}> O braille tem um erro e a app não o viu</label>
      <label class="check"><input type="radio" name="fbk" value="outro"> Outro problema</label>
      <label>Nota (opcional)<input id="fb-nota" type="text" maxlength="200" placeholder="ex.: falta o ponto 3 na 2.ª célula"></label>
      <div class="row"><button class="btn primary" id="fb-ok">Enviar</button></div></div>`);
  $("#fb-ok").addEventListener("click", () => {
    const kind = (document.querySelector('input[name="fbk"]:checked') || {}).value || "outro", nota = $("#fb-nota").value.trim();
    addFeedback({ kind, nota, by: S.session.name, t: new Date().toISOString() });
    closeModal(); $("#fb-msg").textContent = "Obrigado. O reporte e a foto ficam no registo."; $("#fb-btn").disabled = true;
  });
}
function modal(html) { $("#modal-body").innerHTML = html; $("#modal").hidden = false; }
function closeModal() { $("#modal").hidden = true; $("#modal-body").innerHTML = ""; }
$("#modal-x").addEventListener("click", closeModal);
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
function cellHtml(c) {
  let dots = "";
  for (const b of [0, 3, 1, 4, 2, 5]) {
    const m = 1 << b, e = c.exp & m, rd = c.read & m, d = c.doubt & m;
    dots += `<span class="${d ? "doubt" : e && rd ? "on" : e ? "miss" : rd ? "extra" : ""}"></span>`;
  }
  const tip = c.err ? `PDF ${V.maskChar(c.exp) || "espaço"} · foto ${V.maskChar(c.read) || "espaço"}` : "";
  return `<div class="bcell ${c.err ? "err" : c.doubt ? "dbt" : ""}" title="${esc(tip)}"><div class="g">${dots}</div><small>${esc(V.maskChar(c.exp))}</small></div>`;
}
function drawOverlay(r) {
  const cv = $("#ov-cv"); if (!cv) return;
  const W = r.W, wr = cv.parentElement.clientWidth, dpr = window.devicePixelRatio || 1, sc = wr / W.cv.width;
  cv.style.height = W.cv.height * sc + "px"; cv.width = Math.round(wr * dpr); cv.height = Math.round(W.cv.height * sc * dpr);
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr * sc, 0, 0, dpr * sc, 0, 0);
  ctx.drawImage(W.cv, 0, 0);
  const rad = r.dsPx * 0.36, lw = Math.max(1.5, 2 / sc);
  r.lines.flat().forEach(c => c.marks.forEach(m => {
    if (m.st === "none") return;
    ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(m.u, m.v, rad, 0, 7);
    if (m.st === "ok") { ctx.strokeStyle = "#2fbf62"; ctx.stroke(); }
    else if (m.st === "miss") { ctx.strokeStyle = "#e0453a"; ctx.lineWidth = lw * 1.6; ctx.stroke(); ctx.beginPath(); ctx.moveTo(m.u - rad * .6, m.v - rad * .6); ctx.lineTo(m.u + rad * .6, m.v + rad * .6); ctx.moveTo(m.u + rad * .6, m.v - rad * .6); ctx.lineTo(m.u - rad * .6, m.v + rad * .6); ctx.stroke(); }
    else if (m.st === "extra") { ctx.fillStyle = "rgba(224,69,58,.55)"; ctx.fill(); ctx.strokeStyle = "#e0453a"; ctx.stroke(); }
    else { ctx.strokeStyle = "#e8b21f"; ctx.lineWidth = lw * 1.4; ctx.stroke(); }
  }));
}
/* exemplo guardado no repositório de dados (exemplo/exemplo.json) */
$("#btn-demo").addEventListener("click", async () => {
  try {
    const ex = await S.store.readJSON("data", "exemplo/exemplo.json", token("read"));
    if (!ex) return toast("O exemplo não está instalado no repositório de dados.");
    setPattern(V.makePattern(ex.dots.map(([X, Y]) => ({ X, Y })), ex.name, "pontos preenchidos (camada Braille) · exemplo", 1.6));
    $("#mm-in").value = ex.mm; lookupMM(ex.mm);
    await loadImage(ex.photo, "Exemplo · foto do verso.jpg");
    S.box = ex.box.slice(); $("#n3").classList.add("done"); drawPhoto(); updateRun();
    runCompare();
  } catch (e) { toast(e.message); }
});

/* ================= Atualização (Supervisor+) ================= */
function renderUpdate() {
  const a = D.ageDays(S.meta), max = S.settings.maxDays, st = $("#up-status");
  if (a == null) { st.className = "status-big none"; st.innerHTML = `<b>Sem ficheiro</b><span class="hint">A relação SAP ainda não foi carregada.</span>`; }
  else { const late = a > max; st.className = "status-big " + (late ? "late" : "ok"); st.innerHTML = `<b>${Math.floor(a)} ${Math.floor(a) === 1 ? "dia" : "dias"}</b><span class="hint">desde a última atualização · prazo ${max} dias · ${late ? "fora do prazo, o email de lembrete está a ser enviado" : `próximo prazo: ${D.fmtDate(new Date(new Date(S.meta.lastUpdate).getTime() + max * 86400000).toISOString())}`}</span>`; }
  $("#up-meta").innerHTML = S.meta?.lastUpdate ? `<span>Última: <b>${D.fmtDateTime(S.meta.lastUpdate)}</b></span><span>Por: <b>${esc(S.meta.updatedBy || "—")}</b></span><span>Ficheiro: <b>${esc(S.meta.file || "—")}</b></span><span>Pares: <b>${S.meta.pairs ?? "—"}</b></span><span>MM: <b>${S.meta.mms ?? "—"}</b></span>` : "";
  const h = S.meta?.history || [];
  $("#up-hist").innerHTML = h.length ? h.slice(0, 12).map(x => `<div><span class="num">${D.fmtDateTime(x.date)}</span><span>${esc(x.by)}</span><span class="hint">${esc(x.file)}</span><span class="hint" style="margin-left:auto">${x.pairs} pares · +${x.added} −${x.removed} ~${x.changed}</span></div>`).join("") : `<div class="hint">Ainda sem atualizações.</div>`;
}
let IMP = null;
async function onSapFile(f) {
  $("#sap-name").innerHTML = `<span class="spinner"></span>A ler ${esc(f.name)}…`;
  try {
    const buf = await f.arrayBuffer();
    const sheet = D.readWorkbook(buf), an = D.analyseSheet(sheet);
    IMP = { file: f, buf, sheet, an, mm: an.mmCol, br: an.brCol, desc: an.descCol, confirmBig: false };
    $("#sap-name").textContent = `${f.name} · folha “${sheet.sheet}” · ${an.body.length} linhas`;
    renderImport();
  } catch (e) { IMP = null; $("#sap-name").textContent = f.name; $("#sap-preview").innerHTML = `<div class="found bad"><span class="code">Ficheiro não lido</span><span>${esc(e.message)}</span></div>`; }
}
$("#sap-in").addEventListener("change", e => { const f = e.target.files[0]; if (f) onSapFile(f); e.target.value = ""; });
setupDrop("#sap-drop", onSapFile);
function renderImport() {
  const { an } = IMP, opts = (sel, none) => (none ? `<option value="-1"${sel < 0 ? " selected" : ""}>— nenhuma —</option>` : sel < 0 ? `<option value="-1" selected>— escolha —</option>` : "") + an.header.map((h, i) => `<option value="${i}"${i === sel ? " selected" : ""}>${esc(h)}</option>`).join("");
  let html = `<div class="form" style="margin-top:16px"><div class="row2">
    <label>Coluna do MM (material)<select id="imp-mm">${opts(IMP.mm)}</select></label>
    <label>Coluna do código de braille<select id="imp-br">${opts(IMP.br)}</select></label></div>
    <label>Coluna da descrição (opcional)<select id="imp-desc">${opts(IMP.desc, true)}</select></label></div>`;
  if (IMP.mm < 0 || IMP.br < 0) {
    html += `<div class="found warn"><span class="code">Escolha as colunas</span><span>Não consegui identificar sozinho ${IMP.mm < 0 ? "a coluna do MM (códigos 8000…)" : ""}${IMP.mm < 0 && IMP.br < 0 ? " nem " : ""}${IMP.br < 0 ? "a coluna do código de braille (1300…)" : ""}. Escolha-as acima.</span></div>`;
    $("#sap-preview").innerHTML = html; bindImport(); return;
  }
  const rel = D.buildRelation(an, IMP.mm, IMP.br, IMP.desc), diff = D.diffRelations(S.pairs, rel.pairs);
  IMP.rel = rel; IMP.diff = diff;
  const mms = new Set(rel.pairs.map(p => p.mm)), brs = new Set(rel.pairs.map(p => p.braille));
  const multi = [...mms].filter(m => rel.pairs.filter(p => p.mm === m).length > 1).length;
  const big = S.pairs.length > 20 && rel.pairs.length < S.pairs.length * 0.5;
  const list = (t, arr) => `<div><b>${t}</b> <span class="num">${arr.length}</span>${arr.length ? `<ul>${arr.slice(0, 60).map(x => `<li>${esc(x)}</li>`).join("")}${arr.length > 60 ? `<li>… e mais ${arr.length - 60}</li>` : ""}</ul>` : ""}</div>`;
  html += `<div class="stats" style="margin-top:16px">
      <div class="stat good"><b>${rel.pairs.length}</b><small>Pares MM–braille</small></div>
      <div class="stat"><b>${mms.size}</b><small>MM</small></div>
      <div class="stat"><b>${brs.size}</b><small>Códigos braille</small></div>
      <div class="stat ${multi ? "warn" : ""}"><b>${multi}</b><small>MM com vários</small></div>
      <div class="stat ${rel.skipped.length ? "warn" : ""}"><b>${rel.skipped.length}</b><small>Linhas ignoradas</small></div></div>
    <p class="hint" style="margin-top:8px">${rel.noBraille} materiais do ficheiro não têm braille e não entram na relação (é normal).</p>
    <h3 style="margin-top:18px">Diferenças para a relação atual</h3>
    <div class="diff">${list("Novos MM", diff.added)}${list("MM removidos", diff.removed)}${list("Braille alterado", diff.changed)}</div>
    ${rel.skipped.length ? `<p class="hint" style="margin-top:10px">Linhas ignoradas por não terem MM e código numéricos: ${rel.skipped.slice(0, 30).join(", ")}${rel.skipped.length > 30 ? "…" : ""}</p>` : ""}
    ${rel.unusual.length ? `<p class="hint" style="margin-top:6px">${rel.unusual.length} linhas com códigos fora do formato habitual (MM 8000… / braille 1300…), mas foram incluídas: ${rel.unusual.slice(0, 20).join(", ")}${rel.unusual.length > 20 ? "…" : ""}</p>` : ""}
    ${big ? `<div class="found bad"><span class="code">Muito menos linhas do que a relação atual</span><span>O ficheiro tem ${rel.pairs.length} pares e a relação atual tem ${S.pairs.length}. Confirme que exportou a lista completa do SAP.</span><label class="check" style="margin-top:6px"><input type="checkbox" id="imp-big"> Confirmo que este ficheiro está completo</label></div>` : ""}
    <div class="row" style="margin-top:16px"><button class="btn primary" id="imp-pub" ${rel.pairs.length && !big ? "" : "disabled"}>Publicar atualização</button><button class="btn" id="imp-cancel">Cancelar</button><span class="hint" id="imp-msg"></span></div>`;
  $("#sap-preview").innerHTML = html; bindImport();
}
function bindImport() {
  ["mm", "br", "desc"].forEach(k => { const el = $("#imp-" + k); if (el) el.addEventListener("change", () => { IMP[k] = +el.value; renderImport(); }); });
  const big = $("#imp-big"); if (big) big.addEventListener("change", () => { $("#imp-pub").disabled = !big.checked; });
  const c = $("#imp-cancel"); if (c) c.addEventListener("click", () => { IMP = null; $("#sap-preview").innerHTML = ""; $("#sap-name").textContent = "Arrasta para aqui o Excel exportado do SAP."; });
  const p = $("#imp-pub"); if (p) p.addEventListener("click", publishImport);
}
async function publishImport() {
  const btn = $("#imp-pub"), out = $("#imp-msg"); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>A publicar…';
  try {
    const now = new Date().toISOString(), by = S.session.name, t = token("write"), { an, rel, diff, file } = IMP;
    const stamp = now.slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})(\d{4})$/, "$1-$2");
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    if (S.store.kind === "github") await S.store.writeB64("data", `historico/${stamp}_${safe}`, D.bytesToB64(new Uint8Array(IMP.buf)), `Ficheiro SAP original (${file.name})`, t);
    const mms = new Set(rel.pairs.map(p => p.mm)).size;
    await S.store.writeJSON("data", "relacao.json", { updatedAt: now, updatedBy: by, sourceFile: file.name, sheet: IMP.sheet.sheet,
      columns: { mm: an.header[IMP.mm], braille: an.header[IMP.br], desc: IMP.desc >= 0 ? an.header[IMP.desc] : null }, pairs: rel.pairs }, `Relação MM-Braille atualizada por ${by}`, t);
    const hist = [{ date: now, by, file: file.name, pairs: rel.pairs.length, mms, added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length }, ...(S.meta?.history || [])].slice(0, 50);
    await S.store.writeJSON("data", "meta.json", { lastUpdate: now, updatedBy: by, file: file.name, pairs: rel.pairs.length, mms, history: hist }, `Data da última atualização (${by})`, t);
    IMP = null; $("#sap-preview").innerHTML = ""; $("#sap-name").textContent = "Arrasta para aqui o Excel exportado do SAP.";
    await loadData(); renderUpdate();
    toast("Relação SAP publicada. Todos os utilizadores passam a usar a nova versão.");
  } catch (e) { out.className = "err"; out.textContent = e.message; btn.disabled = false; btn.textContent = "Publicar atualização"; }
}
/* ================= Registo partilhado de verificações ================= */
const RESULT_LABEL = { ok: "OK", nok: "NOK", chk: "A CONFIRMAR", inc: "INCONCLUSIVO" };
const PENDING_KEY = "bpcv-pending-log";
function getPending() { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]"); } catch (e) { return S.pendingMem || []; } }
function setPending(a) { S.pendingMem = a; try { localStorage.setItem(PENDING_KEY, JSON.stringify(a)); } catch (e) {} }
function logStatus(text, ok) { const el = $("#log-status"); if (!el) return; el.hidden = !text; el.textContent = text || ""; el.className = ok ? "ok-msg" : "hint"; }
function cellList(res, pred, fmt) { const out = []; res.lines.forEach((ln, l) => ln.forEach((c, ci) => { if (c && pred(c)) out.push(fmt(c, l, ci)); })); return out; }
/* notas para o registo, quando o resultado não é OK */
function notesFor(res) {
  const parts = [];
  if (S.expectCodes && !S.expectCodes.some(c => res.P.name.includes(c))) parts.push(`PDF diferente do esperado no SAP (${S.expectCodes.join(" / ")})`);
  if (res.verdict === "nok") {
    const cells = cellList(res, c => c.err, (c, l, ci) => `L${l + 1} C${ci + 1}: PDF ${V.maskChar(c.exp) || "espaço"} / caixa ${V.maskChar(c.read) || "espaço"}`);
    parts.push(`${res.errCells} ${res.errCells === 1 ? "célula diferente" : "células diferentes"} do PDF (${res.miss} ${res.miss === 1 ? "ponto" : "pontos"} em falta, ${res.extra} a mais): ${cells.slice(0, 12).join("; ")}${cells.length > 12 ? "; …" : ""}`);
  } else if (res.verdict === "chk") {
    const cells = cellList(res, c => c.doubt, (c, l, ci) => `L${l + 1} C${ci + 1}`);
    parts.push(`${res.doubt} ${res.doubt === 1 ? "ponto pouco nítido" : "pontos pouco nítidos"}, confirmar ao tato: ${cells.slice(0, 15).join(", ")}${cells.length > 15 ? ", …" : ""}`);
  } else if (res.verdict === "inc") parts.push(`A foto não alinhou com o PDF (${res.ok} de ${res.expected} pontos encontrados). Repetir a foto a 90º com luz lateral.`);
  return parts.join(". ");
}
let flushTimer = null, flushing = false;
/* a mesma foto comparada várias vezes seguidas (ex.: a mudar a sensibilidade) conta como uma só verificação */
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
/* foto reduzida da zona do braille (com margem), para guardar no repositório */
function photoB64(maxSide = 1280) {
  const im = S.img; if (!im) return null;
  const b = S.box || [0, 0, im.naturalWidth, im.naturalHeight], mx = b[2] * 0.3, my = b[3] * 0.3;
  const sx = Math.max(0, b[0] - mx), sy = Math.max(0, b[1] - my), sw = Math.min(im.naturalWidth - sx, b[2] + 2 * mx), sh = Math.min(im.naturalHeight - sy, b[3] + 2 * my);
  const k = Math.min(1, maxSide / Math.max(sw, sh)), cv = document.createElement("canvas"); cv.width = Math.round(sw * k); cv.height = Math.round(sh * k);
  cv.getContext("2d").drawImage(im, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/jpeg", 0.72).split(",")[1];
}
const fotoPath = (t, id, label, result) => { const d = new Date(t); return `fotos/${D.ymd(d)}/${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}_${String(label || "sem-mm").replace(/\W+/g, "")}_${result.replace(/\s+/g, "-")}_${id.slice(-4)}.jpg`; };
function queueLog(verdict, notes) {
  if (!S.session) return;
  const P = S.pattern, name = P?.name || "", macho = S.mode === "macho";
  const braille = macho ? (S.machoCode || "") : (S.expectCodes || []).find(c => name.includes(c)) || (name.match(/1300\d{5}/) || [""])[0] || (S.expectCodes || [])[0] || "";
  const t = new Date().toISOString(), id = newId(), result = RESULT_LABEL[verdict];
  const rec = { id, key: `${S.imgSeq || 0}|${name}`, t, mm: macho ? "" : (S.mmQuery || ""), braille, pdf: name, user: `${S.session.name} (${S.session.u})`, result, notes: notes || "", tipo: macho ? "macho" : "caixa" };
  if (macho) { rec.momento = momento(); if (S.ctx?.ferramenta) rec.ferramenta = S.ctx.ferramenta; }
  // fotos: NOK sempre; A CONFIRMAR / INCONCLUSIVO também (apagadas se o mesmo MM der OK no mesmo dia)
  if (verdict !== "ok") { const b = photoB64(); if (b) { rec.fotoB64 = b; rec.foto = fotoPath(t, id, rec.mm || braille, result); } }
  const p = getPending();
  if (p.length && !p[p.length - 1].patch && p[p.length - 1].key === rec.key) p[p.length - 1] = rec; else p.push(rec);
  S.lastRecId = id;
  setPending(p); logStatus("A guardar a verificação no registo…");
  clearTimeout(flushTimer); flushTimer = setTimeout(flushLog, 6000);
}
function addFeedback(fb) {
  const p = getPending(), r = p.find(x => x.id === S.lastRecId && !x.patch);
  const needPhoto = !(r && r.fotoB64) && !(r && r.foto);
  const b64 = needPhoto ? photoB64() : null;
  if (r) { r.feedback = fb; if (b64) { r.fotoB64 = b64; r.foto = fotoPath(r.t, r.id, r.mm || r.braille, "REPORTE"); } }
  else { const t = new Date().toISOString(); p.push({ patch: true, id: S.lastRecId, key: "patch|" + newId(), t, feedback: fb, ...(b64 ? { fotoB64: b64, foto: fotoPath(t, S.lastRecId || newId(), S.mmQuery || S.machoCode, "REPORTE") } : {}) }); }
  setPending(p); clearTimeout(flushTimer); flushTimer = setTimeout(flushLog, 1500);
}
async function flushLog() {
  clearTimeout(flushTimer);
  if (flushing || !S.session || !S.store) return;
  let p = getPending(); if (!p.length) return;
  flushing = true;
  const tok = token("write") || token("read");
  try {
    // 1) fotos primeiro (se falharem, a verificação fica à espera e tenta mais tarde)
    for (const it of p.filter(x => x.fotoB64)) {
      await S.store.writeB64("data", it.foto, it.fotoB64, `Foto ${it.result || "reporte"} ${it.mm || it.braille || ""}`, tok);
      const all = getPending(), x = all.find(y => y.key === it.key && y.t === it.t); if (x) { delete x.fotoB64; setPending(all); }
    }
    p = getPending();
    const recs = p.filter(x => !x.patch).map(({ key, fotoB64, ...r }) => r), patches = p.filter(x => x.patch);
    let toDelete = [];
    const next = await S.store.updateJSON("data", D.LOG_PATH, log => {
      log = log || emptyLog(1, []); log.records = (log.records || []).concat(recs); toDelete = [];
      for (const pt of patches) { const r = log.records.find(x => x.id === pt.id); if (r) { r.feedback = pt.feedback; if (pt.foto && !r.foto) r.foto = pt.foto; } }
      // um OK do mesmo MM (ou macho) no mesmo dia: as fotos A CONFIRMAR / INCONCLUSIVO anteriores deixam de ser precisas
      for (const ok of recs.filter(r => r.result === "OK")) {
        const day = D.ymd(new Date(ok.t));
        for (const r of log.records) if (r.foto && !r.feedback && (r.result === "A CONFIRMAR" || r.result === "INCONCLUSIVO") && D.recKey(r) === D.recKey(ok) && r.t < ok.t && D.ymd(new Date(r.t)) === day) { toDelete.push(r.foto); delete r.foto; r.fotoApagada = true; }
      }
      return log;
    }, `Registo: ${recs.length} ${recs.length === 1 ? "verificação" : "verificações"} · ${S.session.name}`, tok);
    const sent = new Set(p.map(r => r.key + "|" + r.t));
    setPending(getPending().filter(r => !sent.has(r.key + "|" + r.t)));
    if (level() >= 2) { S.log = next; renderBanner(); }
    logStatus("Verificação guardada no registo.", true);
    for (const f of toDelete) { try { await S.store.remove("data", f, "Foto já não é precisa (OK no mesmo dia)", tok); } catch (e) {} }
  } catch (e) {
    logStatus(`A verificação ficou guardada neste dispositivo e é enviada para o registo mais tarde. (${e.message})`);
  } finally { flushing = false; }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushLog(); });
function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
let rgFilter = "";
async function renderRegisto(reload) {
  $("#rg-msg").textContent = "";
  if (reload) { try { S.log = (await S.store.readJSON("data", D.LOG_PATH, token("read"))) || emptyLog(1, []); } catch (e) { $("#rg-msg").textContent = e.message; } renderBanner(); }
  const L = S.log || emptyLog(1, []), n = L.records.length, full = n >= D.LOG_LIMIT;
  $("#rg-status").className = "status-big " + (full ? "late" : "ok");
  $("#rg-status").innerHTML = `<b>V${pad2(L.version)}</b><span class="hint">${n} de ${D.LOG_LIMIT} verificações · iniciado em ${D.fmtDate(L.started)} (${D.weekCode(L.started)})${full ? " · exporte e comece um registo novo" : ""}</span>`;
  const by = r => L.records.filter(x => x.result === r).length, pend = getPending().length;
  $("#rg-meta").innerHTML = `<span>Ficheiro: <b>${esc(D.logFileName(L.version))}</b></span><span>NOK: <b>${by("NOK")}</b></span><span>A confirmar: <b>${by("A CONFIRMAR")}</b></span><span>Inconclusivo: <b>${by("INCONCLUSIVO")}</b></span><span>OK: <b>${by("OK")}</b></span>${pend ? `<span>Por enviar deste dispositivo: <b>${pend}</b></span>` : ""}`;
  const arch = L.archives || [];
  $("#rg-arch").innerHTML = arch.length ? [...arch].reverse().map(a => `<div><span class="num">V${pad2(a.version)}</span><span class="hint">${D.fmtDate(a.from)} – ${D.fmtDate(a.to)} · ${a.count} verificações · ${esc(a.by)}</span>${S.store.kind === "github" ? `<button class="btn small" style="margin-left:auto" data-arch="${esc(a.path)}" data-name="${esc(a.file)}">Descarregar</button>` : ""}</div>`).join("") : `<div class="hint">Ainda não foi fechado nenhum registo.</div>`;
  $$("#rg-arch [data-arch]").forEach(b => b.addEventListener("click", async () => {
    try { const bytes = await S.store.readBytes("data", b.dataset.arch, token("read")); if (!bytes) throw new Error("O ficheiro não foi encontrado no repositório."); download(bytes, b.dataset.name); } catch (e) { toast(e.message); }
  }));
  renderRgTable();
  if (reload && S.reports) { try { S.reports = (await S.store.readJSON("data", D.REP_PATH, token("read"))) || S.reports; } catch (e) {} }
  renderReports();
}
function renderRgTable() {
  const L = S.log || emptyLog(1, []), q = ($("#rg-q").value || "").trim().toLowerCase();
  const rows = [...L.records].reverse().filter(r => (!rgFilter || r.result === rgFilter) && (!q || [r.mm, r.braille, r.pdf, r.user, r.notes].some(v => String(v || "").toLowerCase().includes(q))));
  $("#rg-count").textContent = `${rows.length} de ${L.records.length} verificações no registo V${pad2(L.version)}`;
  $("#rg-body").innerHTML = rows.slice(0, 300).map(r => `<tr><td class="mono">${esc(D.fmtDT(r.t))}</td><td class="mono">${esc(r.mm)}</td><td class="mono">${esc(r.braille)}</td><td class="file">${esc(r.pdf)}</td><td>${esc(r.user)}</td><td><span class="tag ${TAG[r.result] ?? ""}" style="margin-left:0">${esc(r.result)}</span></td><td>${esc(D.recNotes(r))}</td><td>${esc(D.recType(r))}</td><td>${fotoBtn(r.foto)}</td></tr>`).join("")
    + (rows.length > 300 ? `<tr><td colspan="9" class="hint">A mostrar 300 de ${rows.length}. Exporte o Excel para ver todas.</td></tr>` : "")
    || `<tr><td colspan="9" class="hint">Sem verificações${rgFilter || q ? " com este filtro" : " neste registo"}.</td></tr>`;
}
const TAG = { OK: "green", NOK: "red", "A CONFIRMAR": "", INCONCLUSIVO: "blue" };
const fotoBtn = f => f ? `<button class="btn small" data-foto="${esc(f)}">Ver foto</button>` : "";
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-foto]"); if (!b) return;
  try {
    const bytes = await S.store.readBytes("data", b.dataset.foto, token("read"));
    if (!bytes) return toast("A foto já não existe no repositório.");
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
    modal(`<h3>${esc(b.dataset.foto.split("/").pop())}</h3><img src="${url}" alt="Foto da verificação" style="width:100%;margin-top:10px;border-radius:8px">`);
  } catch (x) { toast(x.message); }
});

/* ================= Relatório diário (Supervisor/Manager) ================= */
async function ensureReports() {
  try {
    const t = token("write") || token("read");
    let reps = await S.store.readJSON("data", D.REP_PATH, token("read"));
    // na primeira vez só se cria o relatório mais recente (não se recuam dias de antes de haver relatórios)
    const first = !reps?.reports || !Object.keys(reps.reports).length;
    const due = D.dueReports(new Date(), reps?.reports, S.settings.extraHolidays, first ? 1 : 10);
    if (due.length && token("write")) {
      if (!S.log) S.log = (await S.store.readJSON("data", D.LOG_PATH, token("read"))) || emptyLog(1, []);
      const recs = S.log.records || [];
      reps = await S.store.updateJSON("data", D.REP_PATH, o => {
        o = o || { version: 1, reports: {} };
        for (const w of due) if (!o.reports[w.day]) o.reports[w.day] = D.computeReport(recs, w);
        const keep = Object.keys(o.reports).sort().slice(-90); o.reports = Object.fromEntries(keep.map(k => [k, o.reports[k]]));
        return o;
      }, `Relatório diário ${due.map(w => w.day).join(", ")}`, t);
    }
    S.reports = reps || { version: 1, reports: {} };
    renderBanner();
    if (!$("#v-registo").hidden) renderReports();
  } catch (e) { console.warn("relatório", e); }
}
let repDay = null;
function renderReports() {
  const R = S.reports?.reports || {}, days = Object.keys(R).sort().reverse();
  if (!days.length) { $("#rep-days").innerHTML = ""; $("#rep-body").innerHTML = `<p class="hint">Ainda não há relatórios. O primeiro é criado no próximo dia útil, depois das 6h.</p>`; return; }
  if (!repDay || !R[repDay]) repDay = days[0];
  const open = d => (R[d].incidents || []).filter(i => !i.tratado).length;
  $("#rep-days").innerHTML = days.slice(0, 7).map(d => `<button class="chip" data-rep="${d}" aria-pressed="${d === repDay}">${d.slice(8, 10)}/${d.slice(5, 7)}${open(d) ? ` <b class="bad-txt">${open(d)}</b>` : ""}</button>`).join("");
  $$("#rep-days [data-rep]").forEach(b => b.addEventListener("click", () => { repDay = b.dataset.rep; renderReports(); }));
  const r = R[repDay], inc = r.incidents || [];
  $("#rep-body").innerHTML = `<p class="hint">${D.fmtDT(r.from)} → ${D.fmtDT(r.to)}</p>
    <div class="stats" style="margin-top:10px"><div class="stat"><b>${r.total}</b><small>Verificações</small></div><div class="stat good"><b>${r.ok}</b><small>OK</small></div>
      <div class="stat ${r.nok ? "bad" : ""}"><b>${r.nok}</b><small>NOK</small></div><div class="stat ${r.chk ? "warn" : ""}"><b>${r.chk}</b><small>A confirmar</small></div>
      <div class="stat"><b>${r.inc}</b><small>Inconclusivo</small></div><div class="stat"><b>${r.machos}</b><small>Machos</small></div></div>
    <h3 style="margin-top:16px">Incidências <span class="hint">(${inc.filter(i => !i.tratado).length} por tratar)</span></h3>
    ${inc.length ? `<div class="tablewrap" style="margin-top:8px"><table><thead><tr><th>Hora</th><th>Tipo</th><th>MM</th><th>Braille</th><th>Resultado</th><th>Notas</th><th>Utilizador</th><th>Foto</th><th>Tratado</th></tr></thead><tbody>
      ${inc.map((i, k) => `<tr><td class="mono">${esc(D.fmtDT(i.t))}</td><td>${esc(i.tipo)}</td><td class="mono">${esc(i.mm)}</td><td class="mono">${esc(i.braille)}</td><td><span class="tag ${TAG[i.result] ?? ""}" style="margin-left:0">${esc(i.result)}</span></td><td>${esc(i.notes)}</td><td>${esc(i.user)}</td><td>${fotoBtn(i.foto)}</td>
        <td>${i.tratado ? `<span class="tag green" style="margin-left:0">Tratado</span><div class="hint">${esc(i.tratado.by)} · ${esc(D.fmtDT(i.tratado.t))}${i.tratado.nota ? "<br>" + esc(i.tratado.nota) : ""}</div>` : `<button class="btn small" data-trat="${k}">Tratado</button>`}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="hint" style="margin-top:6px">Sem incidências neste período.</p>`}`;
  $$("#rep-body [data-trat]").forEach(b => b.addEventListener("click", () => {
    const k = +b.dataset.trat, i = inc[k];
    modal(`<h3>Marcar como tratado</h3><p class="hint">${esc(i.tipo)} · ${esc(i.mm || i.braille)} · ${esc(i.result)} · ${esc(D.fmtDT(i.t))}</p>
      <div class="form" style="margin-top:12px"><label>O que foi feito<textarea id="trat-nota" placeholder="ex.: confirmado ao tato, braille certo; ou ordem parada e macho substituído"></textarea></label>
      <div class="row"><button class="btn primary" id="trat-ok">Guardar</button></div></div>`);
    $("#trat-ok").addEventListener("click", async () => {
      const nota = $("#trat-nota").value.trim(), day = repDay;
      try {
        S.reports = await S.store.updateJSON("data", D.REP_PATH, o => { const it = o?.reports?.[day]?.incidents?.find(x => x.id === i.id && x.t === i.t); if (it) it.tratado = { by: S.session.name, t: new Date().toISOString(), nota }; return o; },
          `Incidência tratada (${day}) por ${S.session.name}`, token("write"));
        closeModal(); renderReports(); renderBanner();
      } catch (x) { toast(x.message); }
    });
  }));
}
$$("#rg-filters .chip").forEach(c => c.addEventListener("click", () => { rgFilter = c.dataset.r; $$("#rg-filters .chip").forEach(x => x.setAttribute("aria-pressed", String(x === c))); renderRgTable(); }));
$("#rg-q").addEventListener("input", renderRgTable);
$("#rg-search").addEventListener("submit", e => e.preventDefault());
$("#rg-export").addEventListener("click", async () => {
  try {
    await flushLog();
    S.log = (await S.store.readJSON("data", D.LOG_PATH, token("read"))) || S.log || emptyLog(1, []);
    const x = D.logToXlsx(S.log); download(x.bytes, x.name); renderRegisto(false);
  } catch (e) { $("#rg-msg").textContent = e.message; }
});
$("#rg-close").addEventListener("click", async () => {
  const b = $("#rg-close"), v = S.log?.version || 1;
  if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = `Confirmar: fechar V${pad2(v)} e começar V${pad2(v + 1)}`; $("#rg-msg").textContent = "O Excel do registo atual é descarregado e guardado no repositório. O registo seguinte começa vazio."; return; }
  b.disabled = true; b.innerHTML = '<span class="spinner"></span>A fechar o registo…';
  try {
    await flushLog();
    const cur = (await S.store.readJSON("data", D.LOG_PATH, token("read"))) || emptyLog(1, []);
    const x = D.logToXlsx(cur), path = `registos/arquivo/${x.name}`, n = cur.records.length, now = new Date().toISOString();
    await S.store.writeB64("data", path, D.bytesToB64(x.bytes), `Registo V${pad2(cur.version)} fechado por ${S.session.name}`, token("write"));
    S.log = await S.store.updateJSON("data", D.LOG_PATH, log => {
      log = log || cur;
      return { version: cur.version + 1, started: now, records: (log.records || []).slice(n), // mantém as verificações chegadas entretanto
        archives: [...(log.archives || []), { version: cur.version, file: x.name, path, from: cur.started, to: now, count: n, by: S.session.name }] };
    }, `Novo registo V${pad2(cur.version + 1)} (${S.session.name})`, token("write"));
    download(x.bytes, x.name);
    toast(`Registo V${pad2(cur.version)} fechado e descarregado. Começou o V${pad2(cur.version + 1)}.`);
    renderBanner(); renderRegisto(false);
  } catch (e) { $("#rg-msg").textContent = e.message; }
  finally { b.disabled = false; b.dataset.armed = ""; b.textContent = "Fechar e começar novo registo"; }
});

/* ================= Definições (Manager) ================= */
function renderSettings() {
  $("#set-days").value = S.settings.maxDays; $("#set-days-r").value = S.settings.maxDays;
  $("#set-emails").value = (S.settings.emails || []).join(", ");
  $("#set-url").value = S.settings.appUrl || location.origin + location.pathname;
  $("#set-hol").value = (S.settings.extraHolidays || []).join(", ");
  renderMailPreview(); renderUsers(); renderHolPreview();
}
function formSettings() {
  return { maxDays: Math.min(30, Math.max(1, Math.round(+$("#set-days").value || 7))),
    emails: $("#set-emails").value.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean),
    appUrl: $("#set-url").value.trim(),
    extraHolidays: $("#set-hol").value.split(/[,;\s]+/).map(s => s.trim()).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)),
    allowedOrigins: S.settings.allowedOrigins || D.DEFAULT_SETTINGS.allowedOrigins };
}
function renderHolPreview() {
  const y = new Date().getFullYear(), h = D.holidays(y, formSettings().extraHolidays);
  $("#hol-prev").innerHTML = `Dias sem relatório em ${y} (além dos fins de semana): ` + [...h].sort().map(([d, n]) => `${d.slice(8, 10)}/${d.slice(5, 7)} ${esc(n)}`).join(" · ");
}
$("#set-hol").addEventListener("input", renderHolPreview);

/* ================= Cofre de tokens (Manager) ================= */
function renderVault() {
  const v = S.users?.vault, legacy = (S.users?.users || []).filter(u => u.v !== 2).length, exp = v?.expires || {};
  const days = d => d ? Math.ceil((new Date(d) - Date.now()) / 86400000) : null;
  const e = (k, lab) => { const n = days(exp[k]); return `<span>${lab}: <b>${exp[k] ? D.fmtDate(exp[k]) : "—"}</b>${n != null ? ` <span class="${n < 15 ? "bad-txt" : "hint"}">(${n < 0 ? "expirado" : n + " dias"})</span>` : ""}</span>`; };
  $("#vault-meta").innerHTML = v ? `<span>Cofre ativo · última renovação <b>${D.fmtDateTime(v.renewed)}</b></span>${e("operador", "Operador")}${e("supervisor", "Supervisor")}${e("manager", "Manager")}${legacy ? `<span>${legacy} utilizadores antigos (continuam a funcionar)</span>` : ""}`
    : `<span class="bad-txt">O cofre ainda não foi criado. É criado sozinho na próxima entrada de um Manager.</span>`;
  $("#vt-re").value = exp.operador || ""; $("#vt-we").value = exp.supervisor || ""; $("#vt-ae").value = exp.manager || "";
  $("#vault-form").hidden = !(v && S.session?.keys);
}
$("#vault-form").addEventListener("submit", async e => {
  e.preventDefault();
  const out = $("#vt-msg"), cur = S.session.tokens, keys = S.session.keys;
  const all = { read: $("#vt-r").value.trim() || cur.read, write: $("#vt-w").value.trim() || cur.write, admin: $("#vt-a").value.trim() || cur.admin };
  $("#vt-btn").disabled = true; $("#vt-btn").innerHTML = '<span class="spinner"></span>A validar…';
  try {
    if (S.store.kind === "github") {
      const check = async (tok, repo, label) => { const r = await fetch(`https://api.github.com/repos/${repo}`, { headers: { Authorization: "Bearer " + tok, "X-GitHub-Api-Version": "2022-11-28" } }); if (!r.ok) throw new Error(`O token ${label} não consegue aceder a ${repo} (erro ${r.status}).`); };
      await check(all.read, S.cfg.dataRepo, "Operador"); await check(all.write, S.cfg.dataRepo, "Supervisor"); await check(all.admin, S.cfg.appRepo, "Manager");
    }
    const vault = await D.sealVault(all, keys, S.users.vault);
    vault.expires = { operador: $("#vt-re").value || null, supervisor: $("#vt-we").value || null, manager: $("#vt-ae").value || null };
    const obj = { ...S.users, version: 2, vault };
    await S.store.writeUsers(obj, all.admin);
    S.users = obj; S.session.tokens = D.tokensForRole("manager", all); D.saveSession(S.session, !!localStorage.getItem("bpcv-session"));
    ["#vt-r", "#vt-w", "#vt-a"].forEach(s => $(s).value = "");
    msg(out, "Cofre atualizado. Todos os utilizadores passam a usar os tokens novos (1–2 minutos, publicação do GitHub Pages).", true); renderVault();
  } catch (x) { msg(out, x.message); }
  finally { $("#vt-btn").disabled = false; $("#vt-btn").textContent = "Guardar no cofre"; }
});
function renderMailPreview() { const m = D.emailTemplate(S.meta, formSettings()); $("#mail-prev").innerHTML = `<b>Para:</b> ${esc(formSettings().emails.join(", ") || "—")}\n<b>Assunto:</b> ${esc(m.subject)}\n\n${esc(m.body)}`; }
$("#set-days-r").addEventListener("input", e => { $("#set-days").value = e.target.value; renderMailPreview(); });
$("#set-days").addEventListener("input", e => { $("#set-days-r").value = e.target.value; renderMailPreview(); });
["#set-emails", "#set-url"].forEach(s => $(s).addEventListener("input", renderMailPreview));
$("#set-form").addEventListener("submit", async e => {
  e.preventDefault();
  const out = $("#set-msg"), s = formSettings();
  const bad = s.emails.filter(x => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  if (+$("#set-days").value < 1 || +$("#set-days").value > 30) return msg(out, "O prazo tem de estar entre 1 e 30 dias.");
  if (!s.emails.length) return msg(out, "Indique pelo menos um email para receber o lembrete.");
  if (bad.length) return msg(out, "Email inválido: " + bad.join(", "));
  try {
    await S.store.writeJSON("data", "settings.json", s, `Definições alteradas por ${S.session.name}`, token("write"));
    S.settings = { ...S.settings, ...s }; renderBanner(); renderHome();
    msg(out, "Definições guardadas.", true);
  } catch (x) { msg(out, x.message); }
});
$("#set-test").addEventListener("click", async () => {
  const out = $("#set-msg");
  try { await S.store.dispatch("lembrete.yml", { teste: "true" }, token("admin")); msg(out, "Pedido enviado ao GitHub. O email de teste chega em 1–2 minutos (usa as definições já guardadas).", true); }
  catch (x) { msg(out, x.message); }
});
function renderUsers() {
  const list = S.users?.users || [];
  $("#users-body").innerHTML = list.map(u => `<tr><td>${esc(u.name)}</td><td class="mono">${esc(u.u)}</td><td>${esc(D.ROLES[u.role]?.label || u.role)}</td><td class="mono">${D.fmtDate(u.created)}</td>
    <td>${u.u === S.session.u ? '<span class="hint">sessão atual</span>' : `<button class="btn small danger" data-del="${esc(u.u)}">Remover</button>`}</td></tr>`).join("");
  $$("#users-body [data-del]").forEach(b => b.addEventListener("click", async () => {
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Confirmar remoção"; return; }
    try { await saveUsers(list.filter(x => x.u !== b.dataset.del), `Utilizador ${b.dataset.del} removido.`); } catch (x) { toast(x.message); }
  }));
}
async function saveUsers(users, okText) {
  const obj = { ...(S.users || {}), version: S.users?.vault ? 2 : 1, users };
  await S.store.writeUsers(obj, token("admin"));
  S.users = obj; renderUsers();
  toast(okText + (S.store.kind === "github" ? " Fica ativo em 1–2 minutos (publicação do GitHub Pages)." : ""));
}
$("#nu-u").addEventListener("input", () => { const ex = (S.users?.users || []).some(x => x.u === $("#nu-u").value.trim().toLowerCase()); $("#nu-btn").textContent = ex ? "Substituir utilizador" : "Adicionar utilizador"; });
$("#user-form").addEventListener("submit", async e => {
  e.preventDefault();
  const out = $("#nu-msg"), name = $("#nu-name").value.trim(), u = $("#nu-u").value.trim().toLowerCase(), p1 = $("#nu-p1").value, p2 = $("#nu-p2").value, role = $("#nu-role").value;
  if (!/^[a-z0-9._-]{3,30}$/.test(u)) return msg(out, "O utilizador só pode ter letras, números, ponto, hífen ou _ (3 a 30).");
  if (p1.length < 10) return msg(out, "A palavra-passe tem de ter pelo menos 10 caracteres.");
  if (p1 !== p2) return msg(out, "As palavras-passe não coincidem.");
  if (u === S.session.u && role !== "manager") return msg(out, "Não pode retirar o perfil Manager a si próprio.");
  if (!S.session.keys || !S.users?.vault) return msg(out, "O cofre de tokens ainda não está ativo. Saia e volte a entrar como Manager para o criar.");
  $("#nu-btn").disabled = true;
  try {
    const rec = await D.makeUser({ u, name, role }, p1, S.session.keys);
    const users = (S.users?.users || []).filter(x => x.u !== u).concat(rec).sort((a, b) => a.u.localeCompare(b.u));
    await saveUsers(users, `Utilizador ${u} guardado.`);
    e.target.reset(); msg(out, "");
  } catch (x) { msg(out, x.message); }
  finally { $("#nu-btn").disabled = false; $("#nu-btn").textContent = "Adicionar utilizador"; }
});

/* ganchos de teste */
window.BraillePCV = {
  loadPdfBase64: async (b64, name) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); await loadPdfBuffer(u.buffer, name); return S.pattern && { n: S.pattern.pts.length, text: V.patternText(S.pattern) }; },
  loadPhoto: (url, name) => loadImage(url, name || "foto"),
  setBox: (x, y, w, h) => { S.box = [x, y, w, h]; drawPhoto(); updateRun(); },
  run: () => runCompare(), state: S, show, flushLog, getPending, setMode, lookupMM, readOF, ensureReports, renderReports, applyFolder, syncPatterns, loadPatterns, addFeedback,
};

await boot();
})();
