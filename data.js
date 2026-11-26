/* Braille PCV — dados, utilizadores e importação SAP.
   Modo GitHub: a app (repositório público) lê e grava os dados num repositório PRIVADO através da API do GitHub.
   Cada utilizador tem uma palavra-passe que decifra o token GitHub do seu perfil (AES-GCM + PBKDF2).
   Modo demonstração: quando config.json ainda não está preenchido, tudo fica guardado só neste navegador. */
(function () {
"use strict";

const ROLES = {
  operador:   { code: "OPER", label: "Operador",   level: 1 },
  supervisor: { code: "SUPV", label: "Supervisor", level: 2 },
  manager:    { code: "MNGR", label: "Manager",    level: 3 },
  // fornecedor dos machos: só verifica machos antes de os enviar
  famag:      { code: "FMAG", label: "FAMAG (fornecedor)", level: 1, views: ["verificar", "como"], machoOnly: true },
};
const ROLE_LIST = ["operador", "supervisor", "manager", "famag"];
const DEFAULT_SETTINGS = { maxDays: 7, emails: [], appUrl: "", extraHolidays: [], allowedOrigins: ["https://jscampos87.github.io"] };
const PAT_PATH = "padroes/padroes.json";   // padrões de pontos extraídos dos PDFs (para tablets sem a pasta)
const REP_PATH = "relatorios/relatorios.json";
/* registo de verificações (partilhado, no repositório de dados) */
const LOG_PATH = "registos/registo.json";
const LOG_LIMIT = 1500; // acima disto a app pede para exportar e começar um registo novo
const LOG_FORM = "RLM04-CV.Registo verificação de Braille pela APP - 26W47";
const logFileName = v => `${LOG_FORM} V${String(v).padStart(2, "0")}.xlsx`;
const PROC_TITLE = "PLM009.CV-Atualização de relação MM-Braille na APP - 26W47";

/* ================= Configuração ================= */
async function loadConfig() {
  let cfg = {};
  try { const r = await fetch("config.json", { cache: "no-store" }); if (r.ok) cfg = await r.json(); } catch (e) {}
  cfg.branch = cfg.branch || "main";
  cfg.demo = !cfg.appRepo || !cfg.dataRepo || /OWNER/i.test(cfg.appRepo + cfg.dataRepo);
  return cfg;
}

/* ================= Base64 / texto ================= */
const enc = new TextEncoder(), dec = new TextDecoder();
function bytesToB64(bytes) { let s = ""; const ch = 0x8000; for (let i = 0; i < bytes.length; i += ch) s += String.fromCharCode.apply(null, bytes.subarray(i, i + ch)); return btoa(s); }
function b64ToBytes(b64) { const s = atob(b64.replace(/\s/g, "")); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
const textToB64 = t => bytesToB64(enc.encode(t));

/* ================= Armazenamento: GitHub ================= */
class GitHubStore {
  constructor(cfg) { this.cfg = cfg; this.kind = "github"; }
  repo(which) { return which === "app" ? this.cfg.appRepo : this.cfg.dataRepo; }
  url(which, path) { return `https://api.github.com/repos/${this.repo(which)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`; }
  headers(token, accept) { const h = { "Accept": accept || "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }; if (token) h.Authorization = "Bearer " + token; return h; }
  async readText(which, path, token) {
    const r = await fetch(this.url(which, path) + "?ref=" + encodeURIComponent(this.cfg.branch) + "&t=" + Date.now(), { headers: this.headers(token, "application/vnd.github.raw+json"), cache: "no-store" });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(await ghError(r, `ler ${path}`));
    return await r.text();
  }
  async readJSON(which, path, token) { const t = await this.readText(which, path, token); return t == null ? null : JSON.parse(t); }
  async sha(which, path, token) {
    const r = await fetch(this.url(which, path) + "?ref=" + encodeURIComponent(this.cfg.branch) + "&t=" + Date.now(), { headers: this.headers(token), cache: "no-store" });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(await ghError(r, `ler ${path}`));
    return (await r.json()).sha;
  }
  async writeB64(which, path, b64, message, token) {
    const sha = await this.sha(which, path, token);
    const body = { message, content: b64, branch: this.cfg.branch }; if (sha) body.sha = sha;
    const r = await fetch(this.url(which, path), { method: "PUT", headers: { ...this.headers(token), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await ghError(r, `gravar ${path}`));
  }
  writeJSON(which, path, obj, message, token) { return this.writeB64(which, path, textToB64(JSON.stringify(obj, null, 1) + "\n"), message, token); }
  async readBytes(which, path, token) {
    const r = await fetch(this.url(which, path) + "?ref=" + encodeURIComponent(this.cfg.branch) + "&t=" + Date.now(), { headers: this.headers(token, "application/vnd.github.raw+json"), cache: "no-store" });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(await ghError(r, `ler ${path}`));
    return new Uint8Array(await r.arrayBuffer());
  }
  /* lê, altera e grava com controlo de versão; repete se outra pessoa gravou ao mesmo tempo */
  async updateJSON(which, path, fn, message, token) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await fetch(this.url(which, path) + "?ref=" + encodeURIComponent(this.cfg.branch) + "&t=" + Date.now(), { headers: this.headers(token), cache: "no-store" });
      let obj = null, sha = null;
      if (r.ok) {
        const j = await r.json(); sha = j.sha;
        const text = j.encoding === "base64" && j.content ? dec.decode(b64ToBytes(j.content)) : await this.readText(which, path, token);
        obj = text ? JSON.parse(text) : null;
      } else if (r.status !== 404) throw new Error(await ghError(r, `ler ${path}`));
      const next = fn(obj);
      const body = { message, content: textToB64(JSON.stringify(next) + "\n"), branch: this.cfg.branch }; if (sha) body.sha = sha;
      const w = await fetch(this.url(which, path), { method: "PUT", headers: { ...this.headers(token), "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (w.ok) return next;
      if (w.status !== 409 && w.status !== 422) throw new Error(await ghError(w, `gravar ${path}`));
      await new Promise(res => setTimeout(res, 600 + Math.random() * 900));
    }
    throw new Error(`Não foi possível gravar ${path}: o ficheiro está a ser alterado por outra pessoa. Tente outra vez.`);
  }
  async remove(which, path, message, token) {
    const sha = await this.sha(which, path, token); if (!sha) return false;
    const r = await fetch(this.url(which, path), { method: "DELETE", headers: { ...this.headers(token), "Content-Type": "application/json" }, body: JSON.stringify({ message, sha, branch: this.cfg.branch }) });
    if (!r.ok && r.status !== 404) throw new Error(await ghError(r, `apagar ${path}`));
    return true;
  }
  async list(which, dir, token) {
    const r = await fetch(this.url(which, dir) + "?ref=" + encodeURIComponent(this.cfg.branch) + "&t=" + Date.now(), { headers: this.headers(token), cache: "no-store" });
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(await ghError(r, `listar ${dir}`));
    const j = await r.json(); return Array.isArray(j) ? j.map(f => ({ name: f.name, path: f.path, type: f.type, size: f.size })) : [];
  }
  async readUsers() {
    // 1) ficheiro publicado no GitHub Pages (mesma origem); 2) API pública como alternativa
    try { const r = await fetch("users.json?t=" + Date.now(), { cache: "no-store" }); if (r.ok) return await r.json(); if (r.status !== 404) throw 0; } catch (e) {}
    return await this.readJSON("app", "users.json", null);
  }
  writeUsers(obj, token) { return this.writeJSON("app", "users.json", obj, "Utilizadores atualizados na app", token); }
  async dispatch(workflow, inputs, token) {
    const r = await fetch(`https://api.github.com/repos/${this.cfg.dataRepo}/actions/workflows/${workflow}/dispatches`, { method: "POST", headers: { ...this.headers(token), "Content-Type": "application/json" }, body: JSON.stringify({ ref: this.cfg.branch, inputs }) });
    if (r.status === 404) throw new Error(`Não foi possível iniciar o envio de teste: o GitHub não encontrou o workflow .github/workflows/${workflow} no repositório ${this.cfg.dataRepo}, ou o token Manager não tem a permissão “Actions: Read and write” nesse repositório.`);
    if (!r.ok) throw new Error(await ghError(r, "iniciar o envio de teste"));
  }
}
async function ghError(r, what) {
  let msg = ""; try { msg = (await r.json()).message || ""; } catch (e) {}
  if (r.status === 401) return `Não foi possível ${what}: o token GitHub é inválido ou expirou. Peça ao Manager para atualizar o seu acesso.`;
  if (r.status === 403) return `Não foi possível ${what}: o token não tem permissão para esta operação (${msg}).`;
  if (r.status === 404) return `Não foi possível ${what}: repositório ou ficheiro não encontrado. Confirme o config.json e as permissões do token.`;
  if (r.status === 409) return `Não foi possível ${what}: o ficheiro foi alterado por outra pessoa. Recarregue a página e tente outra vez.`;
  return `Não foi possível ${what} (erro ${r.status}${msg ? ": " + msg : ""}).`;
}

/* ================= Armazenamento: demonstração (este navegador) ================= */
class LocalStore {
  constructor() { this.kind = "demo"; this.mem = {}; }
  key(which, path) { return `bpcv-demo:${which}:${path}`; }
  get(k) { try { return localStorage.getItem(k); } catch (e) { return this.mem[k] ?? null; } }
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { this.mem[k] = v; } }
  async readText(which, path) { return this.get(this.key(which, path)); }
  async readJSON(which, path) { const t = this.get(this.key(which, path)); return t == null ? null : JSON.parse(t); }
  async writeJSON(which, path, obj) { this.set(this.key(which, path), JSON.stringify(obj)); }
  /* ficheiros (fotos, Excel) só em memória: desaparecem ao recarregar a página */
  async writeB64(which, path, b64) { (this.bin = this.bin || {})[which + ":" + path] = b64; }
  async readBytes(which, path) { const b = (this.bin || {})[which + ":" + path]; return b ? b64ToBytes(b) : null; }
  async remove(which, path) { if (this.bin) delete this.bin[which + ":" + path]; return true; }
  async list(which, dir) { const p = which + ":" + dir.replace(/\/$/, "") + "/"; return Object.keys(this.bin || {}).filter(k => k.startsWith(p) && !k.slice(p.length).includes("/")).map(k => ({ name: k.slice(p.length), path: k.slice(which.length + 1), type: "file" })); }
  async updateJSON(which, path, fn) { const next = fn(await this.readJSON(which, path)); await this.writeJSON(which, path, next); return next; }
  async readUsers() { return this.readJSON("app", "users.json"); }
  writeUsers(obj) { return this.writeJSON("app", "users.json", obj); }
  async dispatch() { throw new Error("No modo demonstração não há envio de emails. O envio funciona depois de instalar no GitHub."); }
}

/* ================= Utilizadores (palavra-passe → token cifrado) ================= */
async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
/* Cofre de tokens (users.json versão 2):
   - cada perfil tem uma chave própria (aleatória); os tokens desse perfil ficam no cofre cifrados com ela;
   - cada utilizador guarda só a chave do seu perfil, cifrada com a sua palavra-passe (o Manager guarda todas);
   - para renovar tokens, o Manager volta a cifrar o cofre com as mesmas chaves: ninguém tem de mudar a palavra-passe.
   Utilizadores antigos (versão 1, com os tokens dentro do registo) continuam a entrar: o cofre tem uma
   entrada "legacy" com a chave do perfil cifrada com o token antigo, que só eles conhecem. */
async function sealWith(key, obj) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)))); return { iv: bytesToB64(iv), ct: bytesToB64(ct) }; }
async function openWith(key, box) { const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(box.iv) }, key, b64ToBytes(box.ct)); return JSON.parse(dec.decode(pt)); }
const rawKey = b64 => crypto.subtle.importKey("raw", b64ToBytes(b64), "AES-GCM", false, ["encrypt", "decrypt"]);
async function tokenKey(tok) { const h = await crypto.subtle.digest("SHA-256", enc.encode("bpcv-legacy|" + tok)); return crypto.subtle.importKey("raw", h, "AES-GCM", false, ["encrypt", "decrypt"]); }
const newRoleKeys = () => Object.fromEntries(ROLE_LIST.map(r => [r, bytesToB64(crypto.getRandomValues(new Uint8Array(32)))]));
const roleToken = (role, t) => role === "manager" ? t.admin : role === "supervisor" ? t.write : t.read;
/* tokens que cada perfil recebe */
function tokensForRole(role, all) {
  if (role === "operador" || role === "famag") return { read: all.read };
  if (role === "supervisor") return { read: all.read, write: all.write };
  return { read: all.read, write: all.write, admin: all.admin };
}
async function sealVault(all, keys, old) {
  const roles = {};
  for (const r of ROLE_LIST) roles[r] = await sealWith(await rawKey(keys[r]), tokensForRole(r, all));
  return { ...(old || {}), roles, renewed: new Date().toISOString() };
}
/* entradas para os utilizadores antigos, a partir dos tokens com que foram criados */
async function legacyEntries(legacyAll, keys) {
  const out = {};
  for (const r of ["operador", "supervisor", "manager"]) { const t = roleToken(r, legacyAll); if (t) out[r] = await sealWith(await tokenKey(t), { keys: r === "manager" ? keys : { [r]: keys[r] } }); }
  return out;
}
async function makeUser({ u, name, role }, password, keys) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const own = role === "manager" ? keys : { [role]: keys[role] };
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify({ u, role, keys: own }))));
  return { v: 2, u: u.toLowerCase(), name, role, salt: bytesToB64(salt), iv: bytesToB64(iv), ct: bytesToB64(ct), created: new Date().toISOString() };
}
/* devolve { tokens, keys } ou null se a palavra-passe estiver errada */
async function openUser(rec, password, vault) {
  let data;
  try {
    const key = await deriveKey(password, b64ToBytes(rec.salt));
    data = JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(rec.iv) }, key, b64ToBytes(rec.ct))));
  } catch (e) { return null; }
  if (data.u !== rec.u || data.role !== rec.role) return null; // perfil alterado à mão no ficheiro
  let keys = data.keys || null;
  if (!keys && vault?.legacy?.[rec.role]) { try { keys = (await openWith(await tokenKey(roleToken(rec.role, data.tokens)), vault.legacy[rec.role])).keys; } catch (e) { keys = null; } }
  if (keys && vault?.roles?.[rec.role]) return { keys, tokens: await tokensFromVault(vault, rec.role, keys) };
  return data.tokens ? { keys: null, tokens: data.tokens } : null;
}
async function tokensFromVault(vault, role, keys) { return openWith(await rawKey(keys[role]), vault.roles[role]); }

/* ================= Sessão ================= */
const SESSION_KEY = "bpcv-session";
function saveSession(s, remember) { try { (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {} }
function loadSession() { for (const st of [sessionStorage, localStorage]) { try { const v = st.getItem(SESSION_KEY); if (v) return JSON.parse(v); } catch (e) {} } return null; }
function clearSession() { for (const st of [sessionStorage, localStorage]) { try { st.removeItem(SESSION_KEY); } catch (e) {} } }

/* ================= Importação do Excel SAP ================= */
function normCode(v) {
  if (v == null) return "";
  let s = String(v).trim();
  if (/^\d+(\.0+)?$/.test(s)) s = s.replace(/\.0+$/, "").replace(/^0+(?=\d)/, "");
  return s;
}
const isMM = s => /^8\d{9}$/.test(s);
const isBR = s => /^13\d{7}$/.test(s);
function readWorkbook(buf) {
  if (!window.XLSX) throw new Error("A biblioteca de Excel não carregou. Verifique a ligação à internet e recarregue a página.");
  const wb = XLSX.read(buf, { type: "array" });
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "" }).filter(r => r.some(c => String(c).trim() !== ""));
    if (rows.length) return { sheet: name, rows };
  }
  throw new Error("O ficheiro não tem dados. Confirme que exportou a tabela do SAP.");
}
function analyseSheet(sheet) {
  const rows = sheet.rows, width = Math.max(...rows.map(r => r.length));
  // cabeçalho: primeira linha sem códigos
  const first = rows[0].map(normCode);
  const hasHeader = !first.some(c => isMM(c) || isBR(c));
  const header = Array.from({ length: width }, (_, i) => (hasHeader && String(rows[0][i] || "").trim()) || "Coluna " + String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : ""));
  const body = hasHeader ? rows.slice(1) : rows;
  const score = (i, test) => { let n = 0, ok = 0; for (const r of body) { const v = normCode(r[i]); if (!v) continue; n++; if (test(v)) ok++; } return n ? ok / n : 0; };
  const brScore = i => { let n = 0, ok = 0; for (const r of body) { const cs = codesIn(r[i]); if (!cs.length) continue; n++; if (cs.some(isBR)) ok++; } return n ? ok / n : 0; };
  let mmCol = -1, brCol = -1, bm = 0, bb = 0;
  for (let i = 0; i < width; i++) { const a = score(i, isMM), b = brScore(i); if (a > bm) { bm = a; mmCol = i; } if (b > bb) { bb = b; brCol = i; } }
  if (bm <= 0.3) mmCol = -1; if (bb <= 0.3) brCol = -1;
  let descCol = -1, bd = 0;
  for (let i = 0; i < width; i++) {
    if (i === mmCol || i === brCol) continue;
    let n = 0, txt = 0; for (const r of body.slice(0, 300)) { const v = String(r[i] || "").trim(); if (!v) continue; n++; if (/[a-zA-Z]{3}/.test(v)) txt++; }
    const s = n ? txt / n : 0; if (s > bd && s > 0.5) { bd = s; descCol = i; }
  }
  // exportação da IH09: colunas "Objeto", "Denominação" e "Braille"
  if (hasHeader) {
    const hn = header.map(h => h.toLowerCase()), find = re => hn.findIndex(h => re.test(h));
    const hm = find(/^(objeto|material|mm)\b/), hb = find(/brail+e/), hd = find(/denomina|descri|texto/);
    if (hm >= 0) mmCol = hm; if (hb >= 0) brCol = hb; if (hd >= 0) descCol = hd;
  }
  return { header, body, hasHeader, mmCol, brCol, descCol };
}
/* uma célula pode ter mais do que um código de braille (ex.: "130004513; 130004514") */
function codesIn(v) { const s = String(v ?? "").trim(); if (!s) return []; return [...new Set((s.match(/\d+(?:\.0+)?/g) || []).map(normCode))].filter(c => c.length >= 6); }
function buildRelation(an, mmCol, brCol, descCol) {
  const seen = new Set(), pairs = [], skipped = [], unusual = []; let noBraille = 0;
  an.body.forEach((r, i) => {
    const mm = normCode(r[mmCol]), brs = codesIn(r[brCol]);
    const line = i + (an.hasHeader ? 2 : 1);
    if (!mm && !brs.length) return;
    if (!mm || !/^\d+$/.test(mm)) { skipped.push(line); return; }
    if (!brs.length) { noBraille++; return; } // material sem braille: normal, não é erro
    for (const br of brs) {
      if (!isMM(mm) || !isBR(br)) unusual.push(line);
      const k = mm + "|" + br; if (seen.has(k)) continue; seen.add(k);
      pairs.push({ mm, braille: br, desc: descCol >= 0 ? String(r[descCol] || "").trim() : "" });
    }
  });
  pairs.sort((a, b) => a.mm.localeCompare(b.mm) || a.braille.localeCompare(b.braille));
  return { pairs, skipped, unusual: [...new Set(unusual)], noBraille };
}
function diffRelations(oldPairs, newPairs) {
  const toMap = ps => { const m = new Map(); (ps || []).forEach(p => { if (!m.has(p.mm)) m.set(p.mm, new Set()); m.get(p.mm).add(p.braille); }); return m; };
  const A = toMap(oldPairs), B = toMap(newPairs), added = [], removed = [], changed = [];
  for (const [mm, s] of B) { if (!A.has(mm)) added.push(`${mm} → ${[...s].join(", ")}`); else { const a = [...A.get(mm)].sort().join(", "), b = [...s].sort().join(", "); if (a !== b) changed.push(`${mm}: ${a} → ${b}`); } }
  for (const [mm, s] of A) if (!B.has(mm)) removed.push(`${mm} (era ${[...s].join(", ")})`);
  return { added, removed, changed };
}

/* ================= Prazo e email ================= */
function ageDays(meta) { if (!meta || !meta.lastUpdate) return null; return (Date.now() - new Date(meta.lastUpdate).getTime()) / 86400000; }
function isOverdue(meta, settings) { const a = ageDays(meta); return a == null || a > (settings?.maxDays || DEFAULT_SETTINGS.maxDays); }
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
const fmtDateTime = iso => iso ? new Date(iso).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) : "—";
/* o mesmo texto está em scripts/lembrete.py, no repositório de dados */
function emailTemplate(meta, settings) {
  const a = ageDays(meta), max = settings?.maxDays || DEFAULT_SETTINGS.maxDays;
  const quando = meta?.lastUpdate ? `em ${fmtDate(meta.lastUpdate)} (há ${Math.floor(a)} dias)` : "ainda nunca";
  const link = (settings?.appUrl || "<link da app>").replace(/#.*$/, "") + "#atualizacao";
  return {
    subject: `[Braille PCV] Atualizar relação MM ↔ Braille (prazo de ${max} dias ultrapassado)`,
    body: `Olá,

A relação entre materiais (MM) e códigos de braille usada na app Braille PCV foi atualizada ${quando}. O prazo máximo definido é de ${max} dias.

Por favor extraia o ficheiro do SAP (transação IH09) e carregue-o na app, no separador Atualização, seguindo o procedimento ${PROC_TITLE}:
${link}

Enquanto o ficheiro não for atualizado, as verificações podem usar códigos de braille desatualizados.

Mensagem automática da APP Braille PCV · Hinojosa CV. Este lembrete repete-se todos os dias até o ficheiro ser atualizado.`
  };
}

/* semana ISO, ex.: 26W48 */
function weekCode(d) {
  d = new Date(d); const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)), w = Math.ceil(((t - y0) / 86400000 + 1) / 7);
  return String(t.getUTCFullYear()).slice(2) + "W" + String(w).padStart(2, "0");
}
const fmtDT = iso => iso ? new Date(iso).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", "") : "";
const recType = r => r.tipo === "macho" ? `Macho · ${r.momento === "famag" ? "FAMAG (expedição)" : "PCV (receção)"}${r.ferramenta ? " · " + r.ferramenta : ""}` : "Caixa";
const recNotes = r => [r.notes || "", r.feedback ? `Reportado por ${r.feedback.by}: ${r.feedback.kind === "falso-nok" ? "o braille está certo, a app enganou-se" : r.feedback.kind === "falso-ok" ? "o braille tem erro e a app não o viu" : "a app enganou-se"}${r.feedback.nota ? " (" + r.feedback.nota + ")" : ""}` : ""].filter(Boolean).join(" · ");
/* Excel do registo: MM, Código de Braille, Nome do ficheiro, Data, Utilizador, Resultado, Notas (+ Tipo, Foto) */
function logToXlsx(log) {
  const rows = [["MM (Material)", "Código de Braille", "Nome do ficheiro", "Data", "Utilizador", "Resultado", "Notas", "Tipo", "Foto"]];
  for (const r of [...(log.records || [])].sort((a, b) => a.t.localeCompare(b.t)))
    rows.push([r.mm || "", r.braille || "", r.pdf || "", fmtDT(r.t), r.user || "", r.result || "", recNotes(r), recType(r), r.foto || ""]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 14 }, { wch: 17 }, { wch: 52 }, { wch: 17 }, { wch: 28 }, { wch: 15 }, { wch: 90 }, { wch: 26 }, { wch: 40 }];
  ws["!autofilter"] = { ref: ws["!ref"] };
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Registo");
  wb.Props = { Title: logFileName(log.version).replace(/\.xlsx$/, ""), Author: "APP Braille PCV" };
  return { name: logFileName(log.version), bytes: new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })) };
}

/* ================= Calendário da fábrica ================= */
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function easter(y) { // algoritmo de Meeus/Jones/Butcher
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, da);
}
/* feriados nacionais + dias de fecho da fábrica (São João, segunda-feira a seguir à Páscoa, 24/12, 31/12) + extra das Definições */
function holidays(y, extra) {
  const out = new Map();
  [["01-01", "Ano Novo"], ["04-25", "Dia da Liberdade"], ["05-01", "Dia do Trabalhador"], ["06-10", "Dia de Portugal"], ["06-24", "São João"], ["08-15", "Assunção de Nossa Senhora"],
   ["10-05", "Implantação da República"], ["11-01", "Todos os Santos"], ["12-01", "Restauração da Independência"], ["12-08", "Imaculada Conceição"], ["12-24", "Véspera de Natal"], ["12-25", "Natal"], ["12-31", "Véspera de Ano Novo"]]
    .forEach(([md, n]) => out.set(`${y}-${md}`, n));
  const e = easter(y), add = (days, n) => { const d = new Date(e); d.setDate(d.getDate() + days); out.set(ymd(d), n); };
  add(-2, "Sexta-feira Santa"); add(0, "Páscoa"); add(1, "Segunda-feira de Páscoa"); add(60, "Corpo de Deus");
  (extra || []).forEach(s => { if (String(s).startsWith(String(y))) out.set(String(s).slice(0, 10), "Fecho (Definições)"); });
  return out;
}
function isWorkday(d, extra) { const w = d.getDay(); return w !== 0 && w !== 6 && !holidays(d.getFullYear(), extra).has(ymd(d)); }
const at6 = d => { const x = new Date(d); x.setHours(6, 0, 0, 0); return x; };
function prevWorkday(d, extra) { const x = new Date(d); do { x.setDate(x.getDate() - 1); } while (!isWorkday(x, extra)); return x; }
/* relatório do dia D: das 6h do dia útil anterior às 6h de D (segunda-feira cobre sexta 6h → segunda 6h) */
function reportWindowFor(day, extra) { const to = at6(day), from = at6(prevWorkday(day, extra)); return { day: ymd(day), from: from.toISOString(), to: to.toISOString() }; }
function latestReportDay(now, extra) {
  const d = new Date(now); if (d < at6(d)) d.setDate(d.getDate() - 1);
  while (!isWorkday(d, extra)) d.setDate(d.getDate() - 1);
  return d;
}
/* relatórios que ainda faltam criar (do mais recente para trás, no máximo `max`) */
function dueReports(now, existing, extra, max = 10) {
  const out = []; let d = latestReportDay(now, extra);
  for (let i = 0; i < max; i++) { if (existing && existing[ymd(d)]) break; out.push(reportWindowFor(d, extra)); d = prevWorkday(d, extra); }
  return out;
}
/* incidências: NOK; A CONFIRMAR / INCONCLUSIVO só se não houve depois um OK do mesmo MM (ou macho) no mesmo dia; e reportes "a app enganou-se" */
const recKey = r => (r.tipo === "macho" ? "M|" + r.braille : "C|" + (r.mm || r.braille));
function laterOk(records, r) { const day = ymd(new Date(r.t)); return records.some(x => x.result === "OK" && recKey(x) === recKey(r) && x.t > r.t && ymd(new Date(x.t)) === day); }
function computeReport(records, win) {
  const inWin = records.filter(r => r.t >= win.from && r.t < win.to);
  const c = k => inWin.filter(r => r.result === k).length;
  const incidents = inWin.filter(r => r.result === "NOK" || r.feedback || ((r.result === "A CONFIRMAR" || r.result === "INCONCLUSIVO") && !laterOk(records, r)))
    .map(r => ({ id: r.id || r.t, t: r.t, mm: r.mm, braille: r.braille, pdf: r.pdf, user: r.user, result: r.result, notes: recNotes(r), tipo: recType(r), foto: r.foto || "" }));
  return { ...win, created: new Date().toISOString(), total: inWin.length, ok: c("OK"), nok: c("NOK"), chk: c("A CONFIRMAR"), inc: c("INCONCLUSIVO"), machos: inWin.filter(r => r.tipo === "macho").length, incidents };
}

window.Data = { ROLES, ROLE_LIST, DEFAULT_SETTINGS, PAT_PATH, REP_PATH, LOG_PATH, LOG_LIMIT, LOG_FORM, logFileName, PROC_TITLE, weekCode, fmtDT, logToXlsx, loadConfig, GitHubStore, LocalStore,
  makeUser, openUser, tokensForRole, newRoleKeys, sealVault, legacyEntries, tokensFromVault, saveSession, loadSession, clearSession,
  readWorkbook, analyseSheet, buildRelation, diffRelations, normCode, ageDays, isOverdue, fmtDate, fmtDateTime, emailTemplate, bytesToB64, b64ToBytes, textToB64,
  ymd, holidays, isWorkday, dueReports, computeReport, laterOk, recKey, recType, recNotes };
})();
