/* Braille PCV — leitura da ordem de fabrico (OF) por foto.
   Procura, em cada MM da OF, a linha "Braille" e o código 1300… na mesma linha da tabela.
   (A OF tem outros códigos 1300…, por exemplo Cortante e Reserva de verniz: só conta a linha Braille.)
   O motor de OCR (Tesseract.js) só é descarregado da primeira vez que se usa. */
(function () {
"use strict";
const TESS = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
let workerP = null;
function loadScript(src) { return new Promise((res, rej) => { if (window.Tesseract) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Não foi possível descarregar o leitor de texto (sem internet?).")); document.head.appendChild(s); }); }
async function worker(progress) {
  if (!workerP) workerP = (async () => {
    await loadScript(TESS);
    return Tesseract.createWorker("eng", 1, { logger: m => { if (m.status === "recognizing text" && OF._prog) OF._prog(m.progress); } });
  })().catch(e => { workerP = null; throw e; });
  OF._prog = progress; return workerP;
}
function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("Não consegui abrir a foto da OF.")); im.src = src; }); }
/* desenha a foto rodada (0, 90, 180, 270) com o lado maior ≈ 2400 px, em tons de cinzento */
function rotated(im, deg, maxSide = 2400) {
  const k = Math.min(1.6, maxSide / Math.max(im.naturalWidth, im.naturalHeight)), w = Math.round(im.naturalWidth * k), h = Math.round(im.naturalHeight * k);
  const cv = document.createElement("canvas"), sw = deg % 180 ? h : w, sh = deg % 180 ? w : h; cv.width = sw; cv.height = sh;
  const c = cv.getContext("2d"); c.filter = "grayscale(1) contrast(1.25)"; c.translate(sw / 2, sh / 2); c.rotate(deg * Math.PI / 180); c.drawImage(im, -w / 2, -h / 2, w, h);
  return cv;
}
/* orientação das linhas de texto: perfil de tinta por linha vs por coluna */
function textIsVertical(im) {
  const cv = rotated(im, 0, 500), c = cv.getContext("2d"), { width: W, height: H } = cv, d = c.getImageData(0, 0, W, H).data;
  const rows = new Float32Array(H), cols = new Float32Array(W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = d[(y * W + x) * 4] < 110 ? 1 : 0; rows[y] += v; cols[x] += v; }
  const vr = a => { const m = a.reduce((s, v) => s + v, 0) / a.length; let s = 0; for (const v of a) s += (v - m) ** 2; return s / a.length / (m * m + 1e-9); };
  // linhas horizontais → o perfil por linha alterna muito (texto / entrelinha)
  return vr(cols) > vr(rows);
}
const digitsFix = t => /^[\dOoIlSB|]{7,}$/.test(t) && /\d{5}/.test(t) ? t.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/S/g, "5").replace(/B/g, "8") : t;
function parse(data) {
  // inclinação da foto: mediana da inclinação das linhas de texto compridas (as linhas da tabela não ficam horizontais)
  const sl = (data.lines || []).filter(l => l.baseline?.has_baseline && l.baseline.x1 - l.baseline.x0 > 300).map(l => (l.baseline.y1 - l.baseline.y0) / (l.baseline.x1 - l.baseline.x0)).sort((a, b) => a - b);
  const s = sl.length ? sl[sl.length >> 1] : 0;
  const words = (data.words || []).map(w => ({ t: digitsFix(w.text.trim().replace(/[.,;:]+$/, "")), x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 }))
    .filter(w => w.t).map(w => ({ ...w, cy: (w.y0 + w.y1) / 2 - s * (w.x0 + w.x1) / 2, h: w.y1 - w.y0 }));
  const out = new Map(), mmAll = new Set(), cnt = new Map();
  // MM da OF: aparecem em várias linhas da tabela (um número 8000… isolado pode ser um valor, ex.: material base)
  words.forEach(w => { if (/^8000\d{6}$/.test(w.t)) cnt.set(w.t, (cnt.get(w.t) || 0) + 1); });
  for (const [m, n] of cnt) if (n >= 3) mmAll.add(m);
  for (const w of words) {
    if (!/^brai?l+e?$/i.test(w.t)) continue;
    const row = words.filter(o => Math.abs(o.cy - w.cy) < Math.max(w.h, o.h) * 0.7).sort((a, b) => a.x0 - b.x0);
    const mm = row.filter(o => /^8000\d{6}$/.test(o.t) && o.x1 <= w.x0 + 4).sort((a, b) => b.x1 - a.x1)[0];
    // a palavra "Braille" tem de ser a característica (logo a seguir ao MM), não parte de um valor como "Corte e Vinco e Braille"
    if (!mm || row[row.indexOf(mm) + 1] !== w) continue;
    const code = row.filter(o => /^13\d{7}$/.test(o.t) && o.x0 >= w.x1 - 4).sort((a, b) => a.x0 - b.x0)[0];
    const cur = out.get(mm.t);
    if (!cur || (!cur.braille && code)) out.set(mm.t, { mm: mm.t, braille: code ? code.t : "", desc: cur?.desc || "" });
  }
  // descrições das linhas de cabeçalho: "<nº OF> <MM> <descrição>"
  for (const line of (data.lines || [])) {
    const m = line.text.replace(/\s+/g, " ").match(/\b1\d{6}\s+(8000\d{6})\s+(.{4,}?)\s*(?:\d[\d.]*\s*UN.*)?$/);
    if (m) { const e = out.get(m[1]) || { mm: m[1], braille: "", desc: "" }; e.desc = e.desc || m[2].replace(/\s+\d{5,}.*$/, "").trim(); out.set(m[1], e); mmAll.add(m[1]); }
  }
  for (const mm of mmAll) if (!out.has(mm)) out.set(mm, { mm, braille: "", desc: "" });
  return [...out.values()].sort((a, b) => (!a.braille) - (!b.braille) || a.mm.localeCompare(b.mm));
}
async function read(src, progress) {
  const im = await loadImg(src), w = await worker(progress);
  const vert = textIsVertical(im), order = vert ? [90, 270, 0, 180] : [0, 180, 90, 270];
  // 1) orientação: leitura rápida em baixa resolução, conta os números 8000… legíveis
  let rot = order[0], bestN = -1;
  const prog = OF._prog; OF._prog = null;
  for (const deg of order) {
    const { data } = await w.recognize(rotated(im, deg, 1100));
    const n = (data.words || []).filter(x => /^8000\d{6}$/.test(digitsFix(x.text.trim()))).length;
    if (n > bestN) { bestN = n; rot = deg; }
    if (n >= 3) break;
  }
  OF._prog = prog;
  // 2) leitura completa na orientação escolhida
  const { data } = await w.recognize(rotated(im, rot));
  return { entries: parse(data), rot, text: data.text };
}
const OF = { read, parse, _prog: null };
window.OF = OF;
})();
