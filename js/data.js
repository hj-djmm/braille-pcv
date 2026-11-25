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
};
const DEFAULT_SETTINGS = { maxDays: 7, emails: [], appUrl: "" };

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
  async readUsers() {
    // 1) ficheiro publicado no GitHub Pages (mesma origem); 2) API pública como alternativa
    try { const r = await fetch("users.json?t=" + Date.now(), { cache: "no-store" }); if (r.ok) return await r.json(); if (r.status !== 404) throw 0; } catch (e) {}
    return await this.readJSON("app", "users.json", null);
  }
  writeUsers(obj, token) { return this.writeJSON("app", "users.json", obj, "Utilizadores atualizados na app", token); }
  async dispatch(workflow, inputs, token) {
    const r = await fetch(`https://api.github.com/repos/${this.cfg.dataRepo}/actions/workflows/${workflow}/dispatches`, { method: "POST", headers: { ...this.headers(token), "Content-Type": "application/json" }, body: JSON.stringify({ ref: this.cfg.branch, inputs }) });
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
  async writeB64() { /* na demonstração não se guarda o Excel original */ }
  async readUsers() { return this.readJSON("app", "users.json"); }
  writeUsers(obj) { return this.writeJSON("app", "users.json", obj); }
  async dispatch() { throw new Error("No modo demonstração não há envio de emails. O envio funciona depois de instalar no GitHub."); }
}

/* ================= Utilizadores (palavra-passe → token cifrado) ================= */
async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function makeUser({ u, name, role }, password, tokens) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify({ u, role, tokens }))));
  return { u: u.toLowerCase(), name, role, salt: bytesToB64(salt), iv: bytesToB64(iv), ct: bytesToB64(ct), created: new Date().toISOString() };
}
async function openUser(rec, password) {
  try {
    const key = await deriveKey(password, b64ToBytes(rec.salt));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(rec.iv) }, key, b64ToBytes(rec.ct));
    const data = JSON.parse(dec.decode(pt));
    if (data.u !== rec.u || data.role !== rec.role) return null; // perfil alterado à mão no ficheiro
    return data.tokens;
  } catch (e) { return null; }
}
/* tokens que cada perfil recebe */
function tokensForRole(role, all) {
  if (role === "operador") return { read: all.read };
  if (role === "supervisor") return { read: all.read, write: all.write };
  return { read: all.read, write: all.write, admin: all.admin };
}

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
  let mmCol = -1, brCol = -1, bm = 0, bb = 0;
  for (let i = 0; i < width; i++) { const a = score(i, isMM), b = score(i, isBR); if (a > bm) { bm = a; mmCol = i; } if (b > bb) { bb = b; brCol = i; } }
  let descCol = -1, bd = 0;
  for (let i = 0; i < width; i++) {
    if (i === mmCol || i === brCol) continue;
    let n = 0, txt = 0; for (const r of body.slice(0, 300)) { const v = String(r[i] || "").trim(); if (!v) continue; n++; if (/[a-zA-Z]{3}/.test(v)) txt++; }
    const s = n ? txt / n : 0; if (s > bd && s > 0.5) { bd = s; descCol = i; }
  }
  return { header, body, hasHeader, mmCol: bm > 0.3 ? mmCol : -1, brCol: bb > 0.3 ? brCol : -1, descCol };
}
function buildRelation(an, mmCol, brCol, descCol) {
  const seen = new Set(), pairs = [], skipped = [], unusual = [];
  an.body.forEach((r, i) => {
    const mm = normCode(r[mmCol]), br = normCode(r[brCol]);
    const line = i + (an.hasHeader ? 2 : 1);
    if (!mm || !br) { if (mm || br) skipped.push(line); return; }
    if (!/^\d+$/.test(mm) || !/^\d+$/.test(br)) { skipped.push(line); return; }
    if (!isMM(mm) || !isBR(br)) unusual.push(line);
    const k = mm + "|" + br; if (seen.has(k)) return; seen.add(k);
    pairs.push({ mm, braille: br, desc: descCol >= 0 ? String(r[descCol] || "").trim() : "" });
  });
  pairs.sort((a, b) => a.mm.localeCompare(b.mm) || a.braille.localeCompare(b.braille));
  return { pairs, skipped, unusual };
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

Por favor extraia o ficheiro do SAP e carregue-o na app, no separador Atualização, seguindo o procedimento PR-PCV-BRL-01:
${link}

Enquanto o ficheiro não for atualizado, as verificações podem usar códigos de braille desatualizados.

Mensagem automática da app Braille PCV · Hinojosa PCV. Este lembrete repete-se todos os dias até o ficheiro ser atualizado.`
  };
}

window.Data = { ROLES, DEFAULT_SETTINGS, loadConfig, GitHubStore, LocalStore, makeUser, openUser, tokensForRole, saveSession, loadSession, clearSession,
  readWorkbook, analyseSheet, buildRelation, diffRelations, normCode, ageDays, isOverdue, fmtDate, fmtDateTime, emailTemplate, bytesToB64, textToB64 };
})();
