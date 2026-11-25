/* Braille PCV — interface. */
(async function () {
"use strict";
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const V = window.Vision, D = window.Data;
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const VIEW_LEVEL = { inicio: 1, verificar: 1, biblioteca: 1, como: 1, atualizacao: 2, definicoes: 3 };
const S = {
  cfg: null, store: null, session: null, users: null,
  pairs: [], meta: null, settings: { ...D.DEFAULT_SETTINGS }, pdfIndex: [],
  MM2B: new Map(), B2MM: new Map(), DESC: new Map(), PDFS: new Map(), folder: null,
  pattern: null, img: null, imgName: "", box: null, side: "verso", sens: 1, mmQuery: "", expectCodes: null, last: null,
};

/* ================= utilitários de interface ================= */
function toast(msg, ms = 3500) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }
function msg(el, text, ok) { el.hidden = !text; el.className = ok ? "ok-msg" : "err"; el.textContent = text || ""; }
const level = () => D.ROLES[S.session?.role]?.level || 0;
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
  if (S.session) await enterApp(); else await showLogin();
}

async function seedDemo() {
  if (await S.store.readUsers()) return;
  const all = { read: "demo", write: "demo", admin: "demo" }, users = [];
  for (const [u, role, name] of [["operador", "operador", "Operador de teste"], ["supervisor", "supervisor", "Supervisor de teste"], ["manager", "manager", "Manager de teste"]])
    users.push(await D.makeUser({ u, name, role }, u, D.tokensForRole(role, all)));
  await S.store.writeUsers({ version: 1, users });
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
    const tokens = rec ? await D.openUser(rec, p) : null;
    if (!tokens) { msg(err, "Utilizador ou palavra-passe errados."); return; }
    S.session = { u: rec.u, name: rec.name, role: rec.role, tokens };
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
    const rec = await D.makeUser({ u, name, role: "manager" }, p1, all);
    if (!(await S.store.readJSON("data", "settings.json", all.read)))
      await S.store.writeJSON("data", "settings.json", { ...D.DEFAULT_SETTINGS, appUrl: location.origin + location.pathname }, "Definições iniciais", all.write);
    if (!(await S.store.readJSON("data", "meta.json", all.read)))
      await S.store.writeJSON("data", "meta.json", { lastUpdate: null, history: [] }, "Estado inicial", all.write);
    await S.store.writeUsers({ version: 1, users: [rec] }, all.admin);
    S.session = { u, name, role: "manager", tokens: all };
    D.saveSession(S.session, false);
    toast("Manager criado. Os outros utilizadores criam-se em Definições.");
    await enterApp();
  } catch (x) { msg(err, x.message); }
  finally { $("#su-btn").disabled = false; $("#su-btn").textContent = "Criar e entrar"; }
});

/* ================= entrada na app ================= */
async function enterApp() {
  $("#hdr").hidden = false;
  $("#role-code").textContent = D.ROLES[S.session.role]?.code || "—";
  $("#user-name").textContent = S.session.name;
  $("#conn").innerHTML = S.cfg.demo ? '<span class="dot-ok demo"></span>Modo demonstração · dados só neste navegador' : '<span class="dot-ok"></span>Ligado · GitHub';
  $$("nav.tabs button").forEach(b => b.hidden = VIEW_LEVEL[b.dataset.view] > level());
  if (!S.cfg.demo) $("#btn-demo").hidden = false;
  await loadData();
  const v = location.hash.slice(1);
  show(VIEW_LEVEL[v] && VIEW_LEVEL[v] <= level() ? v : "inicio");
}
async function loadData() {
  try {
    const t = token("read");
    const [rel, meta, settings, pidx] = await Promise.all([
      S.store.readJSON("data", "relacao.json", t), S.store.readJSON("data", "meta.json", t),
      S.store.readJSON("data", "settings.json", t), S.store.readJSON("data", "pdf-index.json", t)]);
    S.pairs = rel?.pairs || []; S.relInfo = rel || null;
    S.meta = meta || { lastUpdate: null, history: [] };
    S.settings = { ...D.DEFAULT_SETTINGS, ...(settings || {}) };
    S.pdfIndex = pidx?.files || []; S.pdfInfo = pidx || null;
  } catch (e) {
    S.loadError = e.message;
  }
  buildIndexes(); renderBanner(); renderHome(); renderLib();
}
function buildIndexes() {
  S.MM2B = new Map(); S.B2MM = new Map(); S.DESC = new Map(); S.PDFS = new Map();
  for (const p of S.pairs) {
    if (!S.MM2B.has(p.mm)) S.MM2B.set(p.mm, new Set()); S.MM2B.get(p.mm).add(p.braille);
    if (!S.B2MM.has(p.braille)) S.B2MM.set(p.braille, new Set()); S.B2MM.get(p.braille).add(p.mm);
    if (p.desc && !S.DESC.has(p.mm)) S.DESC.set(p.mm, p.desc);
  }
  for (const f of S.pdfIndex) for (const c of f.codes || []) { if (!S.PDFS.has(c)) S.PDFS.set(c, []); S.PDFS.get(c).push(f.f); }
}
function renderBanner() {
  const b = $("#banner");
  if (S.loadError) { b.className = "banner red"; b.innerHTML = `<span><b>Sem acesso aos dados.</b> ${esc(S.loadError)}</span>`; b.hidden = false; return; }
  const a = D.ageDays(S.meta), max = S.settings.maxDays;
  if (!D.isOverdue(S.meta, S.settings)) { b.hidden = true; return; }
  const txt = a == null ? "<b>A relação MM ↔ Braille ainda não foi carregada.</b> A pesquisa por MM só funciona depois de carregar o ficheiro do SAP."
    : `<b>A relação SAP está fora do prazo.</b> Última atualização há ${Math.floor(a)} dias (${D.fmtDate(S.meta.lastUpdate)}); o prazo é de ${max} dias.`;
  b.className = a == null ? "banner" : "banner red";
  b.innerHTML = `<span>${txt}</span>${level() >= 2 ? '<button class="btn" data-go="atualizacao">Atualizar agora</button>' : '<span class="hint">Avise o Supervisor.</span>'}`;
  b.hidden = false;
}

/* ================= navegação ================= */
function show(view) {
  if (!S.session) return;
  if (!VIEW_LEVEL[view] || VIEW_LEVEL[view] > level()) view = "inicio";
  onlyView("v-" + view);
  $$("nav.tabs button").forEach(b => { if (b.dataset.view === view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  if (location.hash !== "#" + view) history.replaceState(null, "", "#" + view);
  if (view === "verificar") requestAnimationFrame(() => { drawPhoto(); drawPattern(); });
  if (view === "inicio") { renderHome(); requestAnimationFrame(drawHero); }
  if (view === "biblioteca") renderLib();
  if (view === "atualizacao") renderUpdate();
  if (view === "definicoes") renderSettings();
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
  if (v) { $("#mm-in").value = v.dataset.verify; lookupMM(v.dataset.verify); show("verificar"); }
});
$("#home-search").addEventListener("submit", e => { e.preventDefault(); $("#lib-q").value = $("#home-q").value.trim(); setLibFilter("all"); show("biblioteca"); });

/* ================= Início ================= */
function renderHome() {
  $("#p-mm").textContent = S.MM2B.size;
  $("#p-codes").textContent = S.B2MM.size;
  $("#p-sempdf").textContent = [...S.B2MM.keys()].filter(c => !S.PDFS.has(c)).length;
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
    if (libFilter === "sempdf" && pdfs.length) return false;
    if (libFilter === "multi" && S.MM2B.get(p.mm).size < 2) return false;
    if (libFilter === "partilhado" && S.B2MM.get(p.braille).size < 2) return false;
    if (!ql) return true;
    return p.mm.includes(ql) || p.braille.includes(ql) || (p.desc || "").toLowerCase().includes(ql) || pdfs.some(f => f.toLowerCase().includes(ql));
  });
  $("#lib-count").textContent = S.pairs.length ? `${rows.length} de ${S.pairs.length} pares MM – braille` : "";
  $("#lib-src").textContent = S.relInfo ? `Relação SAP de ${D.fmtDateTime(S.relInfo.updatedAt)} · ${S.relInfo.sourceFile || ""}` : "";
  if (!S.pairs.length) { $("#lib-body").innerHTML = `<tr><td colspan="5" class="hint">Ainda não há relação SAP carregada. ${level() >= 2 ? 'Carregue-a no separador <button class="btn small" data-go="atualizacao">Atualização</button>' : "Peça ao Supervisor para a carregar."}</td></tr>`; return; }
  $("#lib-body").innerHTML = rows.slice(0, 500).map(p => {
    const pdfs = S.PDFS.get(p.braille) || [];
    return `<tr>
    <td class="mono">${hl(p.mm, q)}${S.MM2B.get(p.mm).size > 1 ? '<span class="tag blue">vários brailles</span>' : ""}</td>
    <td class="mono">${hl(p.braille, q)}${S.B2MM.get(p.braille).size > 1 ? `<span class="tag green">${S.B2MM.get(p.braille).size} MM</span>` : ""}</td>
    <td>${hl(p.desc, q)}</td>
    <td class="file">${pdfs.length ? pdfs.map(f => hl(f, q)).join("<br>") : '<span class="tag">sem PDF</span>'}</td>
    <td><button class="btn small" data-verify="${esc(p.mm)}">Verificar</button></td></tr>`;
  }).join("") + (rows.length > 500 ? `<tr><td colspan="5" class="hint">A mostrar 500 de ${rows.length}. Refine a pesquisa.</td></tr>` : "") ||
    `<tr><td colspan="5" class="hint">Nenhum resultado. Confirme o número ou procure por parte da descrição.</td></tr>`;
}

/* ================= Verificar: passo 1 ================= */
function lookupMM(q) {
  q = D.normCode(q || ""); S.mmQuery = q; const out = $("#mm-out");
  if (!q) { out.innerHTML = ""; S.expectCodes = null; return; }
  let codes = [], kind = "mm";
  if (S.MM2B.has(q)) codes = [...S.MM2B.get(q)];
  else if (S.B2MM.has(q) || /^13\d{7}$/.test(q)) { codes = [q]; kind = "braille"; }
  if (!codes.length) {
    S.expectCodes = null;
    out.innerHTML = `<div class="found bad"><span class="code">Sem braille para ${esc(q)}</span><span>${S.pairs.length ? "Este MM não está na relação SAP. Confirme o número ou peça ao Supervisor para atualizar a relação." : "A relação SAP ainda não foi carregada."}</span></div>`;
    checkPdfMatch(); return;
  }
  S.expectCodes = codes;
  const desc = S.DESC.get(q);
  out.innerHTML = `<div class="found ${codes.length > 1 ? "warn" : ""}">
     <span class="hint">${codes.length > 1 ? "Atenção: este MM tem mais do que um código de braille no SAP" : kind === "mm" ? `Braille do MM ${esc(q)}${desc ? " · " + esc(desc) : ""}` : "Código de braille"}</span>
     <span class="code">${codes.map(esc).join(" · ")}</span>
     ${codes.map(c => (S.PDFS.get(c) || []).map(f => `<span class="file">${esc(f)}</span>`).join("") || `<span class="file">Sem PDF com o código ${esc(c)} na lista de PDFs.</span>`).join("")}
     <div id="mm-pick"></div></div>`;
  autoLoadFromFolder(codes);
  checkPdfMatch();
}
$("#mm-form").addEventListener("submit", e => { e.preventDefault(); lookupMM($("#mm-in").value); });
function autoLoadFromFolder(codes) {
  if (!S.folder) return;
  const files = codes.flatMap(c => S.folder.get(c) || []);
  const pick = $("#mm-pick"); if (!pick) return;
  if (!files.length) { pick.innerHTML = `<span class="hint">Não encontrei o PDF na pasta ligada.</span>`; return; }
  if (files.length === 1) { loadPdfFile(files[0]); pick.innerHTML = `<span class="hint">PDF aberto da pasta ligada.</span>`; return; }
  pick.innerHTML = `<span class="hint">Há vários PDFs com este código. Escolha:</span>` + files.map((f, i) => `<button class="btn small" data-pick="${i}" style="margin:4px 6px 0 0">${esc(f.name)}</button>`).join("");
  pick.querySelectorAll("[data-pick]").forEach(b => b.addEventListener("click", () => loadPdfFile(files[+b.dataset.pick])));
}
function folderMap(fileList) {
  const m = new Map(); let n = 0;
  for (const f of fileList) { if (!/\.pdf$/i.test(f.name)) continue; n++; for (const c of new Set(f.name.match(/1300\d{5}/g) || [])) { if (!m.has(c)) m.set(c, []); m.get(c).push(f); } }
  return { m, n };
}
$("#folder-in").addEventListener("change", e => {
  const { m, n } = folderMap(e.target.files); S.folder = m;
  $("#folder-hint").innerHTML = `Pasta ligada: <b>${n}</b> PDFs, <b>${m.size}</b> códigos de braille. Os ficheiros não saem do computador.`;
  if (S.expectCodes) autoLoadFromFolder(S.expectCodes);
});
function checkPdfMatch() {
  const box = $("#pdf-check");
  if (!S.pattern || !S.expectCodes) { box.innerHTML = ""; return; }
  const ok = S.expectCodes.some(c => S.pattern.name.includes(c));
  box.innerHTML = ok ? `<div class="found"><span class="hint">O PDF carregado corresponde ao braille do MM no SAP.</span></div>` :
    `<div class="found bad"><span class="code">PDF diferente do esperado</span><span>O nome do PDF não tem o código ${S.expectCodes.map(esc).join(" / ")}. Confirme se carregou o ficheiro certo.</span></div>`;
}

/* PDF */
function drawPattern() {
  const P = S.pattern, cv = $("#pat-cv"); if (!P || cv.offsetParent === null) return;
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const pad = 14, sc = Math.min((r.width - 2 * pad) / (P.W + 2), 26), hCss = (P.H + 2) * sc + 2 * pad;
  cv.style.height = hCss + "px"; cv.width = Math.round(r.width * dpr); cv.height = Math.round(hCss * dpr);
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(document.documentElement), ox = pad + sc, oy = pad + sc;
  ctx.fillStyle = css.getPropertyValue("--line").trim();
  P.cells.forEach((row, l) => row.forEach((m, c) => { for (let n = 0; n < 6; n++) { const q = P.pos(l, c, n); ctx.beginPath(); ctx.arc(ox + q.X * sc, oy + q.Y * sc, Math.max(1.2, sc * 0.18), 0, 7); ctx.fill(); } }));
  ctx.fillStyle = css.getPropertyValue("--ink").trim();
  P.pts.forEach(p => { ctx.beginPath(); ctx.arc(ox + p.X * sc, oy + p.Y * sc, Math.max(2, sc * (P.dotD || 1.6) / 2), 0, 7); ctx.fill(); });
}
function setPattern(P) {
  S.pattern = P;
  $("#pdf-name").textContent = P.name;
  $("#pattern-box").hidden = false;
  $("#pat-meta").innerHTML = `<span><b>${P.pts.length}</b> pontos</span><span><b>${P.cells.length}</b> linhas</span><span><b>${Math.max(...P.cells.map(r => r.length))}</b> células máx.</span><span>ponto a ponto <b>${P.ds.toFixed(2)} mm</b></span><span>célula <b>${P.Cp.toFixed(2)} mm</b></span><span>Leitura aprox.: <b>${esc(V.patternText(P))}</b></span><span>Origem: ${esc(P.source)}</span>`;
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
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => { S.img = im; S.imgName = name; S.box = null; $("#img-name").textContent = name; $("#n2").classList.add("done"); $("#n3").classList.remove("done"); $("#photo-empty").hidden = true; $("#photo-cv").hidden = false; drawPhoto(); updateRun(); res(im); }; im.onerror = () => rej(new Error("Não consegui abrir a imagem.")); im.src = url; });
}
$("#img-in").addEventListener("change", e => { const f = e.target.files[0]; if (f) loadImage(URL.createObjectURL(f), f.name); });
setupDrop("#img-drop", f => { if (/^image\//.test(f.type)) loadImage(URL.createObjectURL(f), f.name); });
$$(".seg button").forEach(b => b.addEventListener("click", () => { S.side = b.dataset.side; $$(".seg button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); }));
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
    const res = V.compare(P, S.img, S.box, S.side, S.sens);
    S.last = res; renderResult(res);
    HIST.unshift({ r: res.verdict, code: (P.name.match(/1300\d{5}/) || [""])[0], mm: S.mmQuery, u: S.session?.u, t: new Date().toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) });
    saveHist(); renderHome();
    $("#n4").classList.add("done");
    return summary(res);
  } catch (err) {
    console.error(err);
    $("#res").innerHTML = `<div class="found bad"><span class="code">Não foi possível comparar</span><span>${esc(err.message || err)}</span></div>`;
    S.last = null; return { error: String(err.message || err) };
  }
}
function summary(r) { return { verdict: r.verdict, expected: r.expected, ok: r.ok, miss: r.miss, extra: r.extra, doubt: r.doubt, errCells: r.errCells, dets: r.D.dets.length, mmErr: +r.mmErr.toFixed(3), model: r.R.kind, ms: r.ms, text: r.readText }; }
function renderResult(r) {
  const V2 = { ok: ["OK", "ok", "Braille igual ao PDF aprovado. Todos os pontos foram encontrados e não há pontos a mais."],
    nok: ["NOK", "nok", `${r.errCells} ${r.errCells === 1 ? "célula diferente" : "células diferentes"} do PDF aprovado. Ficam marcadas a vermelho abaixo. Confirme à mão antes de parar a ordem.`],
    chk: ["A CONFIRMAR", "chk", "Não há diferenças claras, mas há pontos pouco nítidos (a amarelo). Confirme ao tato ou repita a foto com luz mais rasante."],
    inc: ["INCONCLUSIVO", "inc", "A foto não alinhou com o PDF. Confirme que é o braille certo, tire a foto a 90º da caixa e marque a zona com menos margem."] }[r.verdict];
  const deg = ((r.R.theta * 180 / Math.PI) % 360 + 360) % 360;
  $("#res").innerHTML = `
    <div class="verdict"><span class="badge ${V2[1]}">${V2[0]}</span><p>${V2[2]}</p></div>
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
    <div class="meta" style="margin-top:14px"><span>Orientação: <b>${r.R.rf < 0 ? "verso (espelhado)" : "frente"}, rodado ${Math.round(deg)}°</b></span><span>Modelo: <b>${{ similar: "semelhança", affine: "afim", homog: "perspetiva" }[r.R.kind]}</b></span><span>Erro médio de posição: <b>${r.mmErr.toFixed(2)} mm</b></span><span>Distância entre pontos na caixa: <b>${r.R.dsx.toFixed(2)} × ${r.R.dsy.toFixed(2)} mm</b> (PDF ${r.P.ds.toFixed(2)} mm)</span><span>Pontos detetados: <b>${r.D.dets.length}</b></span><span>Tempo: <b>${r.ms} ms</b></span></div>`;
  drawOverlay(r);
}
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
  if (S.pdfInfo) $("#pdfs-out").innerHTML = `<span class="hint">Lista atual: <b>${S.pdfIndex.length}</b> PDFs, atualizada em ${D.fmtDateTime(S.pdfInfo.updatedAt)} por ${esc(S.pdfInfo.updatedBy || "—")}.</span>`;
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
/* lista de PDFs a partir da pasta */
let PDFLIST = null;
$("#pdfs-in").addEventListener("change", e => {
  const files = [...e.target.files].filter(f => /\.pdf$/i.test(f.name));
  const folder = (e.target.files[0]?.webkitRelativePath || "").split("/")[0];
  PDFLIST = { folder, files: files.map(f => ({ f: f.name, codes: [...new Set(f.name.match(/1300\d{5}/g) || [])] })).sort((a, b) => a.f.localeCompare(b.f)) };
  const sem = PDFLIST.files.filter(x => !x.codes.length);
  const codes = new Set(PDFLIST.files.flatMap(x => x.codes));
  const missing = [...S.B2MM.keys()].filter(c => !codes.has(c));
  $("#pdfs-out").innerHTML = `<div class="meta"><span>Pasta: <b>${esc(folder)}</b></span><span>PDFs: <b>${files.length}</b></span><span>Códigos: <b>${codes.size}</b></span><span>Sem código 1300…: <b>${sem.length}</b></span><span>Códigos do SAP sem PDF: <b>${missing.length}</b></span></div>
    ${sem.length ? `<p class="hint" style="margin-top:8px">Sem código no nome: ${sem.slice(0, 8).map(x => esc(x.f)).join(" · ")}${sem.length > 8 ? " …" : ""}</p>` : ""}
    <div class="row" style="margin-top:12px"><button class="btn primary" id="pdfs-save" ${files.length ? "" : "disabled"}>Guardar lista de PDFs</button><span class="hint" id="pdfs-msg"></span></div>`;
  $("#pdfs-save").addEventListener("click", async () => {
    const b = $("#pdfs-save"); b.disabled = true; b.innerHTML = '<span class="spinner"></span>A guardar…';
    try {
      await S.store.writeJSON("data", "pdf-index.json", { updatedAt: new Date().toISOString(), updatedBy: S.session.name, folder: PDFLIST.folder, files: PDFLIST.files }, `Lista de PDFs atualizada por ${S.session.name}`, token("write"));
      await loadData(); renderUpdate(); toast("Lista de PDFs guardada.");
    } catch (x) { $("#pdfs-msg").className = "err"; $("#pdfs-msg").textContent = x.message; b.disabled = false; b.textContent = "Guardar lista de PDFs"; }
  });
  e.target.value = "";
});

/* ================= Definições (Manager) ================= */
function renderSettings() {
  $("#set-days").value = S.settings.maxDays; $("#set-days-r").value = S.settings.maxDays;
  $("#set-emails").value = (S.settings.emails || []).join(", ");
  $("#set-url").value = S.settings.appUrl || location.origin + location.pathname;
  renderMailPreview(); renderUsers();
}
function formSettings() {
  return { maxDays: Math.min(30, Math.max(1, Math.round(+$("#set-days").value || 7))),
    emails: $("#set-emails").value.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean),
    appUrl: $("#set-url").value.trim() };
}
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
  const obj = { version: 1, users };
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
  const tk = D.tokensForRole(role, S.session.tokens);
  if (!tk.read || (role !== "operador" && !tk.write)) return msg(out, "A sua sessão não tem os tokens necessários. Volte a entrar.");
  $("#nu-btn").disabled = true;
  try {
    const rec = await D.makeUser({ u, name, role }, p1, tk);
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
  run: () => runCompare(), state: S, show,
};

await boot();
})();
