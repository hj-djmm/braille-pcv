/* Braille PCV — leitura do PDF e comparação com a foto.
   Tudo corre no navegador; nada é enviado para fora. */
(function () {
"use strict";

/* ================= Letras (só para mostrar uma leitura aproximada) ================= */
const LETTERS = {a:[1],b:[1,2],c:[1,4],d:[1,4,5],e:[1,5],f:[1,2,4],g:[1,2,4,5],h:[1,2,5],i:[2,4],j:[2,4,5],k:[1,3],l:[1,2,3],m:[1,3,4],n:[1,3,4,5],o:[1,3,5],p:[1,2,3,4],q:[1,2,3,4,5],r:[1,2,3,5],s:[2,3,4],t:[2,3,4,5],u:[1,3,6],v:[1,2,3,6],w:[2,4,5,6],x:[1,3,4,6],y:[1,3,4,5,6],z:[1,3,5,6]};
const MASK2CH = {};
for (const [k, v] of Object.entries(LETTERS)) MASK2CH[v.reduce((m, d) => m | (1 << (d - 1)), 0)] = k;
MASK2CH[0b111100] = "#"; MASK2CH[0b101000] = "⇧";
const maskChar = m => m === 0 ? "" : (MASK2CH[m] || String.fromCharCode(0x2800 + m));

/* ================= Utilitários ================= */
function median(a) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function nnDists(P, key = ["X", "Y"]) {
  const [kx, ky] = key;
  return P.map((p, i) => { let b = Infinity; for (let j = 0; j < P.length; j++) if (j !== i) { const d = Math.hypot(P[j][kx] - p[kx], P[j][ky] - p[ky]); if (d < b) b = d; } return b; });
}
function modeOf(arr, bin) {
  const v = arr.filter(Number.isFinite); if (!v.length) return 0;
  const h = new Map(); v.forEach(x => { const k = Math.round(x / bin); h.set(k, (h.get(k) || 0) + 1); });
  let best = null, bc = -1;
  for (const [k] of h) { const c = (h.get(k - 1) || 0) * .5 + h.get(k) + (h.get(k + 1) || 0) * .5; if (c > bc || (c === bc && k < best)) { bc = c; best = k; } }
  return median(v.filter(x => Math.abs(x / bin - best) <= 1.5));
}
function cluster1d(vals, tol) {
  const s = [...vals].sort((a, b) => a - b), out = [];
  let grp = [s[0]];
  for (let i = 1; i < s.length; i++) { if (s[i] - grp[grp.length - 1] <= tol) grp.push(s[i]); else { out.push(grp.reduce((a, b) => a + b) / grp.length); grp = [s[i]]; } }
  out.push(grp.reduce((a, b) => a + b) / grp.length);
  return out;
}
function fitPeriod(vals, ds, nOff, candsBase, pMin, pMax) {
  let best = { score: Infinity };
  const offs = [...Array(nOff).keys()].map(k => k * ds);
  for (const b0 of candsBase) for (let P = pMin; P <= pMax; P += ds * 0.005) {
    let s = 0;
    for (const v of vals) { const r = ((v - b0) % P + P) % P; s += Math.min(...offs.map(o => Math.abs(r - o)), Math.abs(r - P)); }
    if (s < best.score - 0.02 * ds) best = { score: s, base: b0, P };
  }
  return best;
}

/* ================= Padrão (grelha de células) ================= */
function makePattern(pts, name, source, dotD) {
  const ds = modeOf(nnDists(pts), 0.04);
  const ys = cluster1d(pts.map(p => p.Y), 0.3 * ds), xs = cluster1d(pts.map(p => p.X), 0.3 * ds);
  const minY = ys[0], minX = xs[0];
  let y0 = minY, Lp = 4 * ds;
  if (ys[ys.length - 1] - minY > 2.4 * ds) { const f = fitPeriod(ys, ds, 3, [minY, minY - ds, minY - 2 * ds], 3.4 * ds, 9 * ds); y0 = f.base; Lp = f.P; }
  else { const f = fitPeriod(ys, ds, 3, [minY, minY - ds, minY - 2 * ds], 30 * ds, 30 * ds); y0 = f.base; }
  const fx = fitPeriod(xs, ds, 2, [minX, minX - ds], 2.0 * ds, 3.6 * ds);
  const x0 = fx.base, Cp = fx.P;
  const nL = Math.round((Math.max(...pts.map(p => p.Y)) - y0 - 2 * ds) / Lp) + 1;
  const cells = Array.from({ length: nL }, () => []);
  pts.forEach(p => {
    const l = Math.max(0, Math.floor((p.Y - y0 + 0.5 * ds) / Lp));
    const row = Math.min(2, Math.max(0, Math.round((p.Y - y0 - l * Lp) / ds)));
    const c = Math.max(0, Math.floor((p.X - x0 + 0.5 * ds) / Cp));
    const col = Math.min(1, Math.max(0, Math.round((p.X - x0 - c * Cp) / ds)));
    const n = col * 3 + row; p.l = l; p.c = c; p.n = n + 1;
    while (cells[l].length <= c) cells[l].push(0);
    cells[l][c] |= 1 << n;
  });
  const W = Math.max(...pts.map(p => p.X)), H = Math.max(...pts.map(p => p.Y));
  return { name, source, pts, ds, dotD, x0, y0, Cp, Lp, cells, W, H,
    pos(l, c, n) { return { X: x0 + c * Cp + (n >= 3 ? ds : 0), Y: y0 + l * Lp + (n % 3) * ds }; } };
}
const patternText = P => P.cells.map(row => row.map(m => maskChar(m) || " ").join("")).join(" / ");

/* ================= Leitura do PDF (vetores ArtPro) ================= */
async function extractPattern(buf, name) {
  if (!window.pdfjsLib) throw new Error("A biblioteca de PDF não carregou. Verifica a ligação à internet e recarrega a página.");
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const O = pdfjsLib.OPS, U = pdfjsLib.Util;
  const all = [];
  for (let pn = 1; pn <= Math.min(pdf.numPages, 2); pn++) {
    const page = await pdf.getPage(pn);
    const ol = await page.getOperatorList();
    let ctm = [1, 0, 0, 1, 0, 0]; const st = []; let pend = [];
    const FILL = new Set([O.fill, O.eoFill, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
    const STROKE = new Set([O.stroke, O.closeStroke]);
    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i], a = ol.argsArray[i];
      if (fn === O.save) st.push(ctm);
      else if (fn === O.restore) ctm = st.pop() || ctm;
      else if (fn === O.transform) ctm = U.transform(ctm, a);
      else if (fn === O.paintFormXObjectBegin) { st.push(ctm); if (a && a[0]) ctm = U.transform(ctm, a[0]); }
      else if (fn === O.paintFormXObjectEnd) ctm = st.pop() || ctm;
      else if (fn === O.constructPath) pend = pend.concat(pathCircles(a[0], a[1], ctm));
      else if (FILL.has(fn)) { pend.forEach(c => { c.filled = true; all.push(c); }); pend = []; }
      else if (STROKE.has(fn)) { pend.forEach(c => { c.filled = false; all.push(c); }); pend = []; }
      else if (fn === O.endPath) pend = [];
    }
    if (all.some(c => c.filled)) break;
  }
  const MM = 25.4 / 72;
  const plausible = c => c.d * MM > 0.7 && c.d * MM < 2.6;
  let dots = all.filter(c => c.filled && plausible(c)), source = "pontos preenchidos (camada Braille)";
  if (dots.length < 3) { dots = all.filter(c => !c.filled && plausible(c)); source = "círculos com contorno (confirmar!)"; }
  if (dots.length < 3) throw new Error("Não encontrei pontos de braille neste PDF. Confirma que é o PDF vetorial do braille (ArtPro) e não uma imagem digitalizada.");
  const md = median(dots.map(c => c.d));
  dots = dots.filter(c => c.d > md * 0.75 && c.d < md * 1.33);
  const uniq = [];
  for (const c of dots) if (!uniq.some(u => Math.hypot(u.x - c.x, u.y - c.y) < 0.5)) uniq.push(c);
  let pts = uniq.map(c => ({ X: c.x * MM, Y: -c.y * MM }));
  const ds = modeOf(nnDists(pts), 0.04), nn = nnDists(pts);
  pts = pts.filter((p, i) => nn[i] < 4 * ds);
  const mnx = Math.min(...pts.map(p => p.X)), mny = Math.min(...pts.map(p => p.Y));
  pts.forEach(p => { p.X -= mnx; p.Y -= mny; });
  return makePattern(pts, name, source, md * MM);
}
function pathCircles(ops, co, ctm) {
  const O = pdfjsLib.OPS, out = []; let j = 0, cur = null;
  const add = (x, y) => { if (!cur) cur = { a: x, b: x, c: y, d: y, curves: 0, lines: 0 }; else { cur.a = Math.min(cur.a, x); cur.b = Math.max(cur.b, x); cur.c = Math.min(cur.c, y); cur.d = Math.max(cur.d, y); } };
  const flush = () => {
    if (cur && cur.curves >= 3 && cur.lines <= 1) {
      const w = cur.b - cur.a, h = cur.d - cur.c;
      if (w > 0.2 && h > 0.2 && w / h > 0.8 && w / h < 1.25) {
        const p = pdfjsLib.Util.applyTransform([(cur.a + cur.b) / 2, (cur.c + cur.d) / 2], ctm);
        const sc = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]));
        out.push({ x: p[0], y: p[1], d: (w + h) / 2 * sc });
      }
    }
    cur = null;
  };
  for (const op of ops) {
    if (op === O.moveTo) { flush(); add(co[j], co[j + 1]); j += 2; }
    else if (op === O.lineTo) { add(co[j], co[j + 1]); if (cur) cur.lines++; j += 2; }
    else if (op === O.curveTo) { add(co[j], co[j + 1]); add(co[j + 2], co[j + 3]); add(co[j + 4], co[j + 5]); cur.curves++; j += 6; }
    else if (op === O.curveTo2 || op === O.curveTo3) { add(co[j], co[j + 1]); add(co[j + 2], co[j + 3]); cur.curves++; j += 4; }
    else if (op === O.rectangle) { flush(); j += 4; }
  }
  flush();
  return out;
}

/* ================= Processamento da foto ================= */
function gblur(src, w, h, sig) {
  const r = Math.max(1, Math.ceil(sig * 3)), k = new Float32Array(2 * r + 1); let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sig * sig)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) { const row = y * w; for (let x = 0; x < w; x++) { let a = 0; for (let i = -r; i <= r; i++) { let xx = x + i; xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx; a += src[row + xx] * k[i + r]; } t[row + x] = a; } }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -r; i <= r; i++) { let yy = y + i; yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy; a += t[yy * w + x] * k[i + r]; } o[y * w + x] = a; }
  return o;
}
function workImage(im, box, k) {
  const mx = box[2] * 0.06, my = box[3] * 0.06;
  const sx = Math.max(0, box[0] - mx), sy = Math.max(0, box[1] - my);
  const sw = Math.min(im.naturalWidth - sx, box[2] + 2 * mx), sh = Math.min(im.naturalHeight - sy, box[3] + 2 * my);
  let w = Math.round(sw * k), h = Math.round(sh * k);
  const cap = 2600 / Math.max(w, h); if (cap < 1) { k *= cap; w = Math.round(sw * k); h = Math.round(sh * k); }
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high"; ctx.drawImage(im, sx, sy, sw, sh, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return { cv, g, w, h, k, sx, sy };
}
function detect(W, dsPx, sens) {
  const { g, w, h } = W;
  const bg = gblur(g, w, h, dsPx * 1.2);
  const hp = new Float32Array(w * h); for (let i = 0; i < hp.length; i++) hp[i] = g[i] - bg[i];
  const a = gblur(hp, w, h, dsPx * 0.09), b = gblur(hp, w, h, dsPx * 0.32);
  const sq = new Float32Array(w * h); for (let i = 0; i < sq.length; i++) { const v = a[i] - b[i]; sq[i] = v * v; }
  const en = gblur(sq, w, h, dsPx * 0.3);
  const sorted = Float32Array.from(en).sort(); const med = sorted[sorted.length >> 1] || 1e-6;
  const R = Math.max(2, Math.round(dsPx * 0.42)), m = Math.round(dsPx * 0.3);
  const peaks = [];
  for (let y = m; y < h - m; y++) for (let x = m; x < w - m; x++) {
    const v = en[y * w + x]; if (v < med * 2.5) continue;
    let isMax = true;
    for (let dy = -R; dy <= R && isMax; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -R; dx <= R; dx++) { const xx = x + dx; if (xx < 0 || xx >= w || (dx === 0 && dy === 0)) continue; if (dx * dx + dy * dy > R * R) continue; const u = en[yy * w + xx]; if (u > v || (u === v && (dy < 0 || (dy === 0 && dx < 0)))) { isMax = false; break; } } }
    if (isMax) peaks.push({ x, y, e: v });
  }
  let T = med * 6;
  if (peaks.length > 4) {
    const L = peaks.map(p => Math.log(p.e)), lo = Math.min(...L), hi = Math.max(...L), nb = 64;
    const hist = new Array(nb).fill(0); L.forEach(v => hist[Math.min(nb - 1, Math.floor((v - lo) / (hi - lo + 1e-9) * nb))]++);
    const tot = L.length; let sum = 0; hist.forEach((c, i) => sum += i * c);
    let sB = 0, wB = 0, best = -1, bi = 0;
    for (let i = 0; i < nb; i++) { wB += hist[i]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF; const v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; bi = i; } }
    T = Math.exp(lo + (bi + 1) / nb * (hi - lo));
    const strong = peaks.filter(p => p.e >= T).map(p => p.e);
    if (strong.length) T = Math.min(T, median(strong) * 0.3);
  }
  T /= sens;
  return { en, w, h, med, T, all: peaks, dets: peaks.filter(p => p.e >= T) };
}
function energyAt(D, x, y, r) {
  let best = 0; const R = Math.max(1, Math.round(r));
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= D.w || yi >= D.h) return -1;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { if (dx * dx + dy * dy > R * R) continue; const xx = xi + dx, yy = yi + dy; if (xx < 0 || yy < 0 || xx >= D.w || yy >= D.h) continue; const v = D.en[yy * D.w + xx]; if (v > best) best = v; }
  return best;
}

/* ================= Geometria ================= */
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null; [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function lsq(rows, rhs, n) { const A = Array.from({ length: n }, () => new Array(n).fill(0)), b = new Array(n).fill(0); rows.forEach((r, i) => { for (let a = 0; a < n; a++) { b[a] += r[a] * rhs[i]; for (let c = 0; c < n; c++) A[a][c] += r[a] * r[c]; } }); return solve(A, b); }
const apply = (H, X, Y) => { const z = H[6] * X + H[7] * Y + H[8]; return [(H[0] * X + H[1] * Y + H[2]) / z, (H[3] * X + H[4] * Y + H[5]) / z]; };
function normT(pts) { const n = pts.length; let mx = 0, my = 0; pts.forEach(p => { mx += p[0]; my += p[1]; }); mx /= n; my /= n; let s = 0; pts.forEach(p => s += Math.hypot(p[0] - mx, p[1] - my)); s = s / n || 1; const k = Math.SQRT2 / s; return [k, 0, -k * mx, 0, k, -k * my, 0, 0, 1]; }
function mul3(A, B) { const C = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]; return C; }
function inv3(m) { const [a, b, c, d, e, f, g, h, i] = m; const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g; const det = a * A + b * B + c * C; return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det]; }
function fitModel(src, dst, kind) {
  const Ts = normT(src), Td = normT(dst);
  const S = src.map(p => apply(Ts, p[0], p[1])), D = dst.map(p => apply(Td, p[0], p[1]));
  let Hn;
  if (kind === "affine") {
    const rows = S.map(p => [p[0], p[1], 1]);
    const ax = lsq(rows, D.map(p => p[0]), 3), ay = lsq(rows, D.map(p => p[1]), 3);
    if (!ax || !ay) return null; Hn = [...ax, ...ay, 0, 0, 1];
  } else {
    const rows = [], rhs = [];
    S.forEach((p, i) => { const [u, v] = D[i]; rows.push([p[0], p[1], 1, 0, 0, 0, -u * p[0], -u * p[1]]); rhs.push(u); rows.push([0, 0, 0, p[0], p[1], 1, -v * p[0], -v * p[1]]); rhs.push(v); });
    const h = lsq(rows, rhs, 8); if (!h) return null; Hn = [...h, 1];
  }
  return mul3(inv3(Td), mul3(Hn, Ts));
}
function buildHash(dets, cell) { const m = new Map(); dets.forEach((d, i) => { const k = Math.floor(d.x / cell) * 100003 + Math.floor(d.y / cell); if (!m.has(k)) m.set(k, []); m.get(k).push(i); }); return { m, cell }; }
function nearest(hash, dets, x, y, tol) {
  const cx = Math.floor(x / hash.cell), cy = Math.floor(y / hash.cell); let bi = -1, bd = tol;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = hash.m.get((cx + a) * 100003 + cy + b); if (!l) continue; for (const i of l) { const d = Math.hypot(dets[i].x - x, dets[i].y - y); if (d < bd) { bd = d; bi = i; } } }
  return [bi, bd];
}
function register(P, dets, dsPx, side, scaleRange, quads) {
  const ptsMM = P.pts.map(p => [p.X, p.Y]);
  const cx = ptsMM.reduce((a, p) => a + p[0], 0) / ptsMM.length, cy = ptsMM.reduce((a, p) => a + p[1], 0) / ptsMM.length;
  const sEst = dsPx / P.ds, th0 = 0;
  const refls = side === "verso" ? [-1] : side === "frente" ? [1] : [-1, 1];
  const hash = buildHash(dets, dsPx * 0.5), bin = dsPx * 0.25, tol = dsPx * 0.35;
  const scales = []; for (let f = 1 - scaleRange; f <= 1 + scaleRange + 1e-9; f += 0.04) scales.push(f);
  const angles = []; for (let a = -14; a <= 14; a += 2) angles.push(a);
  let best = { score: -1 };
  for (const rf of refls) for (const q of (quads || [0, 1, 2, 3])) for (const da of angles) for (const sf of scales) {
    const th = th0 + q * Math.PI / 2 + da * Math.PI / 180, s = sEst * sf, c = Math.cos(th) * s, sn = Math.sin(th) * s;
    const T = ptsMM.map(p => { const X = p[0] - cx, Y = rf * (p[1] - cy); return [c * X - sn * Y, sn * X + c * Y]; });
    const votes = new Map(); let topK = 0, topC = 0;
    for (const t of T) for (const d of dets) { const k = Math.round((d.x - t[0]) / bin) * 65536 + Math.round((d.y - t[1]) / bin); const v = (votes.get(k) || 0) + 1; votes.set(k, v); if (v > topC) { topC = v; topK = k; } }
    let kx = Math.round(topK / 65536), ky = topK - kx * 65536; if (ky > 32768) { ky -= 65536; kx += 1; } else if (ky < -32768) { ky += 65536; kx -= 1; }
    const tx = kx * bin, ty = ky * bin;
    let score = 0, err = 0;
    for (const t of T) { const [i, d] = nearest(hash, dets, t[0] + tx, t[1] + ty, tol); if (i >= 0) { score++; err += d; } }
    if (score > best.score || (score === best.score && err < best.err)) best = { score, err, rf, th, s, tx, ty };
  }
  const { rf, th, s, tx, ty } = best, c = Math.cos(th) * s, sn = Math.sin(th) * s;
  let H = mul3([c, -sn, tx, sn, c, ty, 0, 0, 1], [1, 0, -cx, 0, rf, -rf * cy, 0, 0, 1]);
  // Afinação. A gravura pode espaçar os pontos dentro da célula de forma ligeiramente diferente do PDF,
  // por isso o espaçamento interno (dsx, dsy) é estimado à parte da grelha de células.
  let kind = "similar", rms = 0, matched = 0, dsx = P.ds, dsy = P.ds;
  const geo = p => { const n = p.n - 1, q = P.pos(p.l, p.c, 0); return [q.X + (n >= 3 ? dsx : 0), q.Y + (n % 3) * dsy]; };
  for (let it = 0; it < 12; it++) {
    const t2 = it < 6 ? dsPx * 0.45 : dsPx * 0.32;
    const src = [], dst = [], who = []; const used = new Set();
    P.pts.forEach(p => { const g = geo(p); const [u, v] = apply(H, g[0], g[1]); const [i] = nearest(hash, dets, u, v, t2); if (i >= 0 && !used.has(i)) { used.add(i); src.push(g); dst.push([dets[i].x, dets[i].y]); who.push(p); } });
    if (src.length < 4) break;
    const want = it < 2 || src.length < 12 ? "affine" : "homog";
    let Hn = fitModel(src, dst, want); if (!Hn) break;
    const res0 = src.map((g, i) => { const [u, v] = apply(Hn, g[0], g[1]); return Math.hypot(u - dst[i][0], v - dst[i][1]); });
    const cut = Math.max(median(res0) * 3, dsPx * 0.08);
    const keep = res0.map(r => r <= cut);
    if (keep.filter(Boolean).length >= 6 && keep.some(k => !k)) { const H2 = fitModel(src.filter((_, i) => keep[i]), dst.filter((_, i) => keep[i]), want); if (H2) Hn = H2; }
    const res = src.map((g, i) => { const [u, v] = apply(Hn, g[0], g[1]); return Math.hypot(u - dst[i][0], v - dst[i][1]); });
    const r = Math.sqrt(res.reduce((a, b) => a + b * b, 0) / res.length);
    if (!(src.length < matched * 0.9 && r > rms)) { H = Hn; kind = want; rms = r; matched = src.length; }
    if (it >= 1) {
      const Hi = inv3(H), obs = new Map();
      who.forEach((p, i) => obs.set(p, apply(Hi, dst[i][0], dst[i][1])));
      const sx = [], sy = [];
      for (const [a, oa] of obs) for (const [b, ob] of obs) {
        if (a === b || a.l !== b.l || a.c !== b.c) continue;
        const na = a.n - 1, nb = b.n - 1, ca = na >= 3 ? 1 : 0, cb = nb >= 3 ? 1 : 0, ra = na % 3, rb = nb % 3;
        if (ra === rb && ca === 0 && cb === 1) sx.push(ob[0] - oa[0]);
        if (ca === cb && rb > ra) sy.push((ob[1] - oa[1]) / (rb - ra));
      }
      const clamp = v => Math.min(P.ds * 1.25, Math.max(P.ds * 0.8, v));
      if (sx.length >= 3) dsx = clamp(median(sx));
      if (sy.length >= 3) dsy = clamp(median(sy));
    }
  }
  const c0 = apply(H, cx, cy), c1 = apply(H, cx + 1, cy), c2 = apply(H, cx, cy + 1);
  const pxPerMM = Math.sqrt(Math.abs((c1[0] - c0[0]) * (c2[1] - c0[1]) - (c1[1] - c0[1]) * (c2[0] - c0[0])));
  const theta = Math.atan2(c1[1] - c0[1], c1[0] - c0[0]);
  return { H, rf, theta, s, kind, rms, coarseScore: best.score, dsx, dsy, pxPerMM };
}

/* ================= Comparação completa ================= */
function compare(P, im, box, side, sens) {
  const t0 = performance.now();
  const TARGET = 18; // px entre pontos na imagem de trabalho
  const s0 = Math.sqrt(box[2] * box[3] / ((P.W + P.ds * 0.7) * (P.H + P.ds * 0.7)));
  let k = TARGET / (P.ds * s0);
  let W, D, R, dsPx = TARGET;
  for (let pass = 0; pass < 3; pass++) {
    W = workImage(im, box, k); D = detect(W, TARGET, sens);
    if (D.dets.length < 3) throw new Error("Não encontrei pontos na zona marcada. Aumenta a sensibilidade, melhora a luz rasante ou marca melhor a zona.");
    const boxLand = W.w >= W.h, patLand = P.W >= P.H;
    R = register(P, D.dets, TARGET, side, pass === 0 ? 0.25 : 0.08, boxLand === patLand ? [0, 2] : [1, 3]);
    dsPx = R.pxPerMM * P.ds;
    if (Math.abs(dsPx / TARGET - 1) < 0.06) break;
    k *= TARGET / dsPx;
  }
  const maxCells = Math.max(...P.cells.map(r => r.length));
  const G = [];
  P.cells.forEach((row, l) => { const n = Math.min(maxCells, row.length + 1); for (let c = 0; c < n; c++) for (let b = 0; b < 6; b++) {
    const q = P.pos(l, c, 0), X = q.X + (b >= 3 ? R.dsx : 0), Y = q.Y + (b % 3) * R.dsy; const [u, v] = apply(R.H, X, Y);
    G.push({ l, c, b, u, v, exp: !!((row[c] || 0) & (1 << b)), det: null, dd: Infinity }); } });
  // cada ponto detetado conta só para a posição da grelha mais próxima
  const atol = dsPx * 0.4;
  D.dets.forEach(d => { let bi = null, bd = atol; for (const g of G) { const dd = Math.hypot(g.u - d.x, g.v - d.y); if (dd < bd) { bd = dd; bi = g; } } if (bi && bd < bi.dd) { bi.det = d; bi.dd = bd; } });
  const ref = median(G.filter(g => g.exp && g.det).map(g => g.det.e)) || D.T * 3;
  const cellsMap = new Map();
  for (const g of G) {
    const e = energyAt(D, g.u, g.v, dsPx * 0.15);
    let st;
    if (e < 0) st = "doubt";
    else if (g.exp) st = g.det || e / ref >= 0.5 ? "ok" : e / ref >= 0.3 ? "doubt" : "miss";
    else if (g.det) st = g.det.e / ref >= 0.45 ? "extra" : "doubt";
    else st = e / ref >= 0.65 ? "doubt" : "none";
    const key = g.l + ":" + g.c;
    if (!cellsMap.has(key)) cellsMap.set(key, { l: g.l, c: g.c, exp: 0, read: 0, doubt: 0, marks: [] });
    const cell = cellsMap.get(key), m = 1 << g.b;
    if (g.exp) cell.exp |= m;
    if (st === "ok" || st === "extra") cell.read |= m;
    if (st === "doubt") cell.doubt |= m;
    cell.marks.push({ u: g.u, v: g.v, st, b: g.b });
  }
  const lines = P.cells.map(() => []);
  for (const cell of cellsMap.values()) { cell.err = ((cell.exp ^ cell.read) & ~cell.doubt) !== 0; lines[cell.l][cell.c] = cell; }
  const allMarks = lines.flat().flatMap(c => c.marks);
  const cnt = st => allMarks.filter(m => m.st === st).length;
  const res = { P, R, W, D, dsPx, lines, expected: P.pts.length, ok: cnt("ok"), miss: cnt("miss"), extra: cnt("extra"), doubt: cnt("doubt"),
    errCells: lines.flat().filter(c => c.err).length, ms: Math.round(performance.now() - t0) };
  res.alignFrac = res.ok / res.expected;
  res.mmErr = R.rms / dsPx * P.ds;
  res.verdict = res.alignFrac < 0.6 ? "inc" : res.errCells > 0 ? "nok" : res.doubt > 0 ? "chk" : "ok";
  res.readText = lines.map(l => l.map(c => maskChar(c.read) || " ").join("")).join(" / ");
  return res;
}

window.Vision = { LETTERS, maskChar, makePattern, patternText, extractPattern, compare, median };
})();
