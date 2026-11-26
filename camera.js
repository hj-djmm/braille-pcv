/* Braille PCV — câmara com moldura-guia.
   A moldura tem a forma do braille do PDF (com os pontos desenhados como aparecem no verso),
   o nível do telemóvel e avisos de foto escura ou tremida. A zona da moldura passa a ser a zona
   marcada na foto, por isso o operador já não tem de desenhar o retângulo. */
(function () {
"use strict";
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* qualidade de uma zona da imagem: luminosidade média e nitidez (variância do laplaciano, normalizada) */
function quality(src, sx, sy, sw, sh) {
  const W = 320, H = Math.max(40, Math.round(W * sh / sw));
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true }); ctx.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
  let sum = 0; for (let i = 0; i < W * H; i++) { g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; sum += g[i]; }
  const mean = sum / (W * H); let s = 0, s2 = 0, n = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W]; s += l; s2 += l * l; n++; }
  const lapVar = s2 / n - (s / n) ** 2;
  return { mean, sharp: lapVar };
}
const LIM = { dark: 55, bright: 235, blur: 6 };
function verdictOf(q) {
  const w = [];
  if (q.mean < LIM.dark) w.push("Foto escura: aproxime a luz ou acenda a lanterna lateral.");
  if (q.mean > LIM.bright) w.push("Foto com demasiada luz: afaste a luz ou incline-a mais (luz rasante).");
  if (q.sharp < LIM.blur) w.push("Foto tremida ou desfocada: apoie o telemóvel e toque no ecrã para focar.");
  return w;
}

let ui = null;
function build() {
  const el = document.createElement("div"); el.className = "cam"; el.hidden = true;
  el.innerHTML = `
    <div class="cam-top"><b id="cam-title">Foto do braille</b><span class="cam-sub" id="cam-sub"></span><button class="cam-x" id="cam-x" aria-label="Fechar">✕</button></div>
    <div class="cam-stage" id="cam-stage"><video id="cam-v" playsinline muted autoplay></video><canvas id="cam-g"></canvas><img id="cam-still" alt="" hidden></div>
    <div class="cam-bar">
      <div class="cam-ind"><span id="cam-level" class="ind" hidden><i id="cam-bub"></i>Nível</span><span id="cam-light" class="ind">Luz</span><span id="cam-sharp" class="ind">Nitidez</span></div>
      <div class="cam-msg" id="cam-msg">Encaixe o braille dentro da moldura, com o telemóvel paralelo à caixa e a luz de lado.</div>
      <div class="cam-btns" id="cam-live"><label class="btn cam-gal">Galeria<input type="file" accept="image/*" id="cam-file" hidden></label><button class="cam-shot" id="cam-shot" aria-label="Tirar foto"></button><span class="cam-gal"></span></div>
      <div class="cam-btns" id="cam-review" hidden><button class="btn" id="cam-again">Repetir</button><button class="btn primary" id="cam-use">Usar esta foto</button></div>
    </div>`;
  document.body.appendChild(el);
  return { el, v: el.querySelector("#cam-v"), g: el.querySelector("#cam-g"), still: el.querySelector("#cam-still"), $: s => el.querySelector(s) };
}

/* moldura: proporção do braille no PDF + margem; ocupa ~84% da largura útil */
function guideRect(P, vw, vh, doc) {
  if (doc) { const w = vw * 0.92, h = vh * 0.9; return { x: (vw - w) / 2, y: (vh - h) / 2, w, h, m: 0, aw: 1, ah: 1 }; }
  const m = P ? P.ds * 1.6 : 0, aw = P ? P.W + 2 * m : 4, ah = P ? P.H + 2 * m : 1;
  let w = vw * 0.84, h = w * ah / aw;
  if (h > vh * 0.62) { h = vh * 0.62; w = h * aw / ah; }
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h, m, aw, ah };
}
function drawGuide(P, mirror, ok) {
  const st = ui.$("#cam-stage"), r = st.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, cv = ui.g;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); cv.style.width = r.width + "px"; cv.style.height = r.height + "px";
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, r.width, r.height);
  const G = guideRect(P, r.width, r.height, ui.doc);
  c.fillStyle = "rgba(0,0,0,.45)"; c.beginPath(); c.rect(0, 0, r.width, r.height); c.rect(G.x, G.y + G.h, G.w, -G.h); c.fill("evenodd");
  c.strokeStyle = ok ? "#2fbf62" : "#ffffff"; c.lineWidth = 3; c.setLineDash(ok ? [] : [10, 6]); c.strokeRect(G.x, G.y, G.w, G.h); c.setLineDash([]);
  const k = 18; c.lineWidth = 5; c.strokeStyle = ok ? "#2fbf62" : "#e8b21f";
  [[G.x, G.y, 1, 1], [G.x + G.w, G.y, -1, 1], [G.x, G.y + G.h, 1, -1], [G.x + G.w, G.y + G.h, -1, -1]].forEach(([x, y, sx, sy]) => { c.beginPath(); c.moveTo(x + sx * k, y); c.lineTo(x, y); c.lineTo(x, y + sy * k); c.stroke(); });
  if (P) {
    const sc = G.w / G.aw; c.fillStyle = "rgba(255,255,255,.32)";
    P.pts.forEach(p => { const X = mirror ? P.W - p.X : p.X; c.beginPath(); c.arc(G.x + (G.m + X) * sc, G.y + (G.m + p.Y) * sc, Math.max(1.5, sc * 0.55), 0, 7); c.fill(); });
  }
  return G;
}
/* converte a moldura (coordenadas do ecrã) em coordenadas da imagem (o vídeo usa object-fit: cover) */
function toImageBox(G, stage, vw, vh) {
  const s = Math.max(stage.width / vw, stage.height / vh), ox = (stage.width - vw * s) / 2, oy = (stage.height - vh * s) / 2;
  const x = (G.x - ox) / s, y = (G.y - oy) / s, w = G.w / s, h = G.h / s;
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  return [Math.round(x0), Math.round(y0), Math.round(Math.min(vw, x + w) - x0), Math.round(Math.min(vh, y + h) - y0)];
}

/* abre a câmara; devolve { url, name, box, warnings } ou null */
async function open(opts = {}) {
  if (!ui) ui = build();
  const P = opts.pattern || null, mirror = opts.side !== "frente"; ui.doc = !!opts.doc;
  ui.$("#cam-msg").textContent = opts.doc ? "Enquadre a página da OF com a tabela de características. Pode estar rodada." : "Encaixe o braille dentro da moldura, com o telemóvel paralelo à caixa e a luz de lado.";
  ui.$("#cam-msg").className = "cam-msg"; ui.$("#cam-shot").disabled = false;
  ui.$("#cam-title").textContent = opts.title || "Foto do braille";
  ui.$("#cam-sub").textContent = opts.subtitle || "";
  ui.el.hidden = false; document.body.classList.add("cam-open");
  ui.$("#cam-live").hidden = false; ui.$("#cam-review").hidden = true; ui.still.hidden = true; ui.v.hidden = false;
  let stream = null, timer = null, levelOk = null, G = null, shot = null, done;
  const result = new Promise(r => done = r);
  const stop = () => { clearInterval(timer); if (stream) stream.getTracks().forEach(t => t.stop()); window.removeEventListener("deviceorientation", onTilt); window.removeEventListener("resize", redraw); };
  const close = val => { stop(); ui.el.hidden = true; document.body.classList.remove("cam-open"); done(val); };
  const setInd = (id, ok, txt) => { const e = ui.$(id); e.className = "ind " + (ok == null ? "" : ok ? "good" : "bad"); e.lastChild.textContent = txt; };
  function onTilt(e) {
    if (e.beta == null) return; ui.$("#cam-level").hidden = false;
    const b = e.beta, g = e.gamma, ok = Math.abs(b) < 5 && Math.abs(g) < 5; levelOk = ok;
    const bub = ui.$("#cam-bub"); bub.style.transform = `translate(${Math.max(-7, Math.min(7, g / 2))}px, ${Math.max(-7, Math.min(7, b / 2))}px)`;
    setInd("#cam-level", ok, ok ? "Nivelado" : "Incline");
  }
  const redraw = () => { G = drawGuide(P, mirror, levelOk !== false && ui.okQ); };
  ui.$("#cam-x").onclick = () => close(null);
  ui.$("#cam-file").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) close({ url: URL.createObjectURL(f), name: f.name, box: null, warnings: [] }); };
  ui.$("#cam-again").onclick = () => { shot = null; ui.still.hidden = true; ui.v.hidden = false; ui.$("#cam-live").hidden = false; ui.$("#cam-review").hidden = true; ui.$("#cam-msg").textContent = "Encaixe o braille dentro da moldura."; ui.$("#cam-msg").className = "cam-msg"; };
  ui.$("#cam-use").onclick = () => close(shot);
  try {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") { try { await DeviceOrientationEvent.requestPermission(); } catch (e) {} }
    window.addEventListener("deviceorientation", onTilt); window.addEventListener("resize", redraw);
    redraw(); // a moldura aparece logo, mesmo antes de a câmara arrancar
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador não dá acesso à câmara. Use “Galeria” para escolher uma foto.");
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } } });
    ui.v.srcObject = stream; ui.v.play().catch(() => {});
    await new Promise(r => { if (ui.v.videoWidth) return r(); ui.v.onloadedmetadata = r; setTimeout(r, 4000); });
    redraw();
    timer = setInterval(() => {
      if (!ui.v.videoWidth || shot) return;
      const st = ui.$("#cam-stage").getBoundingClientRect(); G = drawGuide(P, mirror, levelOk !== false && ui.okQ);
      const b = toImageBox(G, st, ui.v.videoWidth, ui.v.videoHeight); if (b[2] < 10 || b[3] < 10) return;
      const q = quality(ui.v, ...b), w = verdictOf(q);
      ui.okQ = !w.length;
      setInd("#cam-light", q.mean >= LIM.dark && q.mean <= LIM.bright, q.mean < LIM.dark ? "Escura" : q.mean > LIM.bright ? "Demasiada luz" : "Luz OK");
      setInd("#cam-sharp", q.sharp >= LIM.blur, q.sharp >= LIM.blur ? "Nítida" : "Tremida");
    }, 300);
  } catch (e) {
    ui.$("#cam-msg").textContent = (e && e.name === "NotAllowedError") ? "A câmara foi bloqueada. Autorize a câmara nas definições do navegador, ou use “Galeria”." : (e.message || String(e));
    ui.$("#cam-msg").className = "cam-msg bad"; ui.$("#cam-shot").disabled = true;
  }
  ui.$("#cam-shot").disabled = !stream;
  ui.$("#cam-shot").onclick = async () => {
    if (!ui.v.videoWidth) return;
    const vw = ui.v.videoWidth, vh = ui.v.videoHeight, cv = document.createElement("canvas"); cv.width = vw; cv.height = vh;
    cv.getContext("2d").drawImage(ui.v, 0, 0);
    const st = ui.$("#cam-stage").getBoundingClientRect(), box = toImageBox(G, st, vw, vh);
    const q = quality(cv, ...box), warnings = verdictOf(q);
    const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.92));
    const url = URL.createObjectURL(blob), t = new Date();
    shot = { url, name: `foto ${t.toLocaleString("pt-PT").replace(/[/:,]/g, "-")}.jpg`, box, warnings, q };
    ui.still.src = url; ui.still.hidden = false; ui.v.hidden = true;
    ui.$("#cam-live").hidden = true; ui.$("#cam-review").hidden = false;
    ui.$("#cam-msg").innerHTML = warnings.length ? warnings.map(esc).join("<br>") + "<br><b>Recomendado: repetir a foto.</b>" : "Foto nítida. Confirme que o braille está todo dentro da moldura.";
    ui.$("#cam-msg").className = "cam-msg " + (warnings.length ? "bad" : "good");
  };
  return result;
}

window.Camera = { open, quality, verdictOf, LIM };
})();
