// ───── La scena: 12 foto reali della maschera (una ogni 30°) disegnate in tempo reale ─────
// Niente video pre-calcolato: a ogni aggiornamento dello schermo la maschera viene ridisegnata
// esattamente dove la porta lo scroll, quindi il movimento è continuo.
// Le misure sono in pixel di una tela virtuale (1920×1080 desktop, 960×1440 mobile) adattata
// allo schermo in modalità "cover".
const SCENE = {
  dir: 'assets/views/',
  views: 12, // view_00 … view_11 = 0°, 30°, … 330°
  hero: 'view_hi', // stessa posa di view_11 a risoluzione più alta, per l'apertura
  heroSwap: [0.11, 0.14], // dove la foto grande lascia il posto a view_11
  margin: 4, // px trasparenti attorno alla sagoma in ogni foto
  fade: [0.42, 0.58], // dentro ogni passo di 30°: tiene la vista, sfuma, tiene la successiva
  frame: { desktop: [1920, 1080], mobile: [960, 1440] },
  // [p, angolo°]: cresce = la maschera gira
  angle: [[0, 330], [0.10, 330], [0.18, 360], [0.35, 720], [0.40, 720], [0.47, 750], [0.52, 750], [0.58, 870],
    [0.63, 870], [0.70, 900], [0.72, 900], [0.78, 990], [0.82, 990], [0.90, 1020], [1, 1020]],
  // [p, altezza a schermo (px della tela), spostamento x, spostamento y (frazioni della tela)]
  place: {
    desktop: [[0, 520, 0.16, -0.10], [0.06, 490, 0.12, -0.08], [0.12, 372, 0.07, -0.05], [0.18, 370, 0, -0.02],
      [0.35, 370, 0, -0.02], [0.40, 378, -0.15, 0.07], [0.50, 380, -0.17, 0.09], [0.58, 372, 0.16, -0.06],
      [0.70, 380, 0.18, -0.07], [0.78, 372, -0.08, 0.12], [0.90, 380, -0.10, 0.14], [1, 380, -0.11, 0.14]],
    mobile: [[0, 330, 0, -0.17], [0.06, 310, 0, -0.16], [0.12, 252, 0, -0.12], [0.18, 250, 0, -0.06],
      [0.35, 250, 0, -0.06], [0.40, 250, 0, -0.19], [0.50, 254, 0, -0.19], [0.58, 250, 0, -0.19],
      [0.70, 254, 0, -0.19], [0.78, 234, 0, -0.19], [0.90, 236, 0, -0.19], [1, 236, 0, -0.19]],
  },
  dark: [[0, 0], [0.10, 0], [0.18, 1], [1, 1]], // da neve chiara a notte
};
// Punti della timeline (0–1) usati per i link della nav e per la versione statica: tutti su una foto ferma
const STOPS = { hero: 0, blocks: [0.45, 0.65, 0.88] };

const smooth = (t) => { t = Math.min(Math.max(t, 0), 1); return t * t * (3 - 2 * t); };
// valori dei keyframe [p, ...valori] nel punto p, con raccordo morbido tra un keyframe e l'altro
function at(keys, p) {
  if (p <= keys[0][0]) return keys[0].slice(1);
  for (let k = 1; k < keys.length; k++) {
    const a = keys[k - 1], b = keys[k];
    if (p <= b[0]) {
      const t = smooth((p - a[0]) / (b[0] - a[0]));
      return a.slice(1).map((v, j) => v + (b[j + 1] - v) * t);
    }
  }
  return keys[keys.length - 1].slice(1);
}

console.assert(at([[0, 0], [1, 10]], 0.5)[0] === 5 && at([[0, 0], [1, 10]], 2)[0] === 10, 'at() non interpola');
console.assert(STOPS.blocks.every((p) => {
  const f = at(SCENE.angle, p)[0] / 30 % 1;
  return f <= SCENE.fade[0] || f >= SCENE.fade[1];
}), 'STOPS: un punto cade a metà di una dissolvenza');

const mobile = matchMedia('(max-width: 768px)').matches; // shortcut: impaginazione scelta al caricamento, ruotare il tablet non la cambia
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

const stage = document.querySelector('.stage');
const pin = stage.querySelector('.pin');
const canvas = stage.querySelector('.video');
const ctx = canvas.getContext('2d');
const off = document.createElement('canvas'); // qui si fondono due foto durante una dissolvenza
const offCtx = off.getContext('2d');
const blocks = [...stage.querySelectorAll('.block')];
const panels = []; // [canvas, p] della versione statica
let lenis = null;
let progress = 0; // dove si trova la scena (0–1)
let views = null; // { img, w, h } con w/h della sagoma
let hero = null;

// ───── Carrello ─────
let cart = 0;
const cartCount = document.querySelector('.cart-count');
const status = document.querySelector('.card__status');
document.querySelector('.pill').addEventListener('click', () => {
  cart += 1;
  cartCount.textContent = cart;
  status.textContent = `Aggiunto al carrello · ${cart} ${cart === 1 ? 'pezzo' : 'pezzi'}`;
});

// ───── Disegno della scena ─────
// macchia ellittica sfumata (bagliore, ombra): stops = [[posizione 0–1, opacità]]
function blob(g, cx, cy, rx, ry, rgb, stops) {
  g.save();
  g.translate(cx, cy);
  g.scale(rx, ry);
  const r = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  stops.forEach(([t, a]) => r.addColorStop(t, `rgba(${rgb},${a})`));
  g.fillStyle = r;
  g.fillRect(-1, -1, 2, 2);
  g.restore();
}

// geometria della scena nel punto p, in pixel della tela di destinazione (W×H)
function scene(W, H, p) {
  const [FW, FH] = SCENE.frame[mobile ? 'mobile' : 'desktop'];
  const k = Math.max(W / FW, H / FH);
  const left = (W - FW * k) / 2, top = (H - FH * k) / 2;
  const [dark] = at(SCENE.dark, p);
  const [hd, ox, oy] = at(SCENE.place[mobile ? 'mobile' : 'desktop'], p);
  const [angle] = at(SCENE.angle, p);
  const x = left + (FW / 2 + ox * FW) * k;
  const y = top + (FH / 2 + oy * FH + Math.sin(p * Math.PI * 6) * FH * 0.006) * k; // galleggia appena
  const roll = Math.sin(p * Math.PI * 4) * 1.6 * Math.PI / 180;

  // quale foto e quanto: tra due viste vicine le sagome si raccordano e sfumano
  const step = angle / 30;
  const i = Math.floor(step) % SCENE.views;
  const w = smooth((step - Math.floor(step) - SCENE.fade[0]) / (SCENE.fade[1] - SCENE.fade[0]));
  const A = views[i], B = views[(i + 1) % SCENE.views];
  const dw = (A.w * hd / A.h) * (1 - w) + (B.w * hd / B.h) * w; // larghezza a schermo condivisa
  const layers = [];
  if (w < 1) {
    const hw = i === SCENE.views - 1 && hero ? smooth((p - SCENE.heroSwap[0]) / (SCENE.heroSwap[1] - SCENE.heroSwap[0])) : 1;
    if (hw < 1) layers.push([hero, (1 - w) * (1 - hw)]);
    if (hw > 0) layers.push([A, (1 - w) * hw]);
  }
  if (w > 0) layers.push([B, w]);
  return { k, x, y, roll, dw, hd, dark, layers: layers.filter(([v, a]) => v && a > 0) };
}

// sfondo su canvas (solo versione statica): neve che sfuma nella notte, ombra, bagliore blu
function paintBackground(g, W, H, s) {
  const { k, x, y, dw, hd, dark } = s;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.fillStyle = '#040404';
  g.fillRect(0, 0, W, H);
  if (dark < 1) {
    g.globalAlpha = 1 - dark;
    const snow = g.createLinearGradient(0, 0, 0, H);
    snow.addColorStop(0, 'rgb(247,249,251)');
    snow.addColorStop(1, 'rgb(221,226,232)');
    g.fillStyle = snow;
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
    const a = 0.22 * (1 - dark);
    blob(g, x, y + hd * 0.62 * k, dw * 0.48 * k, dw * 0.09 * k, '60,70,90', [[0, a], [0.45, a * 0.8], [1, 0]]);
  }
  if (dark > 0) {
    g.globalCompositeOperation = 'lighter';
    blob(g, x, y, dw * 0.95 * 1.8 * k, dw * 0.55 * 1.8 * k, '24,32,66', GLOW.map(([t, a]) => [t, a * dark]));
    g.globalCompositeOperation = 'source-over';
  }
}
// bagliore: intensità exp(-1.5 r²) campionata su un raggio di 1,8 unità
const GLOW = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => [t, +Math.exp(-4.86 * t * t).toFixed(3)]);

// la maschera; restituisce il rettangolo toccato, per cancellare solo quello al giro dopo
function paintMask(g, s) {
  const { k, x, y, roll, dw, hd, layers } = s;
  const R = Math.ceil(Math.hypot(dw * k, hd * k) / 2) + 4;
  const cos = Math.cos(roll), sin = Math.sin(roll);
  const put = (gg, v, cx, cy) => {
    const sx = dw / v.w * k, sy = hd / v.h * k;
    gg.setTransform(cos * sx, sin * sx, -sin * sy, cos * sy, cx, cy);
    gg.drawImage(v.img, -v.img.naturalWidth / 2, -v.img.naturalHeight / 2);
  };
  g.imageSmoothingQuality = 'high';
  if (layers.length === 1) {
    g.globalAlpha = layers[0][1];
    put(g, layers[0][0], x, y);
  } else if (layers.length > 1) {
    // dissolvenza esatta: le foto si sommano su una tela piccola trasparente, poi vanno sulla scena
    if (off.width < 2 * R || off.height < 2 * R) { off.width = 2 * R; off.height = 2 * R; }
    const o = offCtx;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalAlpha = 1;
    o.globalCompositeOperation = 'source-over';
    o.clearRect(0, 0, 2 * R, 2 * R);
    o.globalCompositeOperation = 'lighter';
    o.imageSmoothingQuality = 'high';
    for (const [v, a] of layers) { o.globalAlpha = a; put(o, v, R, R); }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.drawImage(off, 0, 0, 2 * R, 2 * R, x - R, y - R, 2 * R, 2 * R);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  return [Math.floor(x - R) - 2, Math.floor(y - R) - 2, 2 * R + 4, 2 * R + 4];
}

// scena completa su un canvas (versione statica)
function paint(c, g, p) {
  const s = scene(c.width, c.height, p);
  paintBackground(g, c.width, c.height, s);
  paintMask(g, s);
}

// scena animata: lo sfondo sono livelli CSS (solo opacity/transform, li muove la scheda grafica),
// il canvas disegna solo la maschera e cancella solo dove era prima
const bg = {
  snow: pin.querySelector('.scene-bg__snow'),
  shade: pin.querySelector('.scene-bg__shade'),
  glow: pin.querySelector('.scene-bg__glow'),
};
const BLOB = 100; // raggio in px dei livelli ombra e bagliore prima della scala
function blobStyle(el, cx, cy, rx, ry, opacity) {
  el.style.opacity = opacity;
  el.style.transform = `translate(${(cx - BLOB).toFixed(1)}px, ${(cy - BLOB).toFixed(1)}px) scale(${(rx / BLOB).toFixed(4)}, ${(ry / BLOB).toFixed(4)})`;
}

let painted = -1;
let dirty = null;
function draw(force) {
  if (!views || canvas.width === 0 || (!force && progress === painted)) return;
  const s = scene(canvas.width, canvas.height, progress);
  const d = canvas.width / canvas.clientWidth; // pixel del canvas per pixel CSS
  const { k, x, y, dw, hd, dark } = s;
  bg.snow.style.opacity = 1 - dark;
  blobStyle(bg.shade, x / d, (y + hd * 0.62 * k) / d, dw * 0.48 * k / d, dw * 0.09 * k / d, 0.22 * (1 - dark));
  blobStyle(bg.glow, x / d, y / d, dw * 0.95 * 1.8 * k / d, dw * 0.55 * 1.8 * k / d, dark);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (dirty) ctx.clearRect(...dirty);
  else ctx.clearRect(0, 0, canvas.width, canvas.height);
  dirty = paintMask(ctx, s);
  painted = progress;
}

function fit(c) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  c.width = Math.round(c.clientWidth * dpr);
  c.height = Math.round(c.clientHeight * dpr);
}

function resize() {
  fit(canvas);
  dirty = null;
  draw(true);
  panels.forEach(([c, p]) => { fit(c); if (views) paint(c, c.getContext('2d'), p); });
}

function loadView(name) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    const done = () => resolve({ img, w: img.naturalWidth - 2 * SCENE.margin, h: img.naturalHeight - 2 * SCENE.margin });
    // decodificata subito: la prima volta che compare non fa scattare lo scroll
    img.onload = () => img.decode().then(done, done);
    img.onerror = () => resolve(null); // una foto mancante non blocca le altre: quella vista resta vuota
    img.src = SCENE.dir + name + '.webp';
  });
}

async function loadViews() {
  const names = Array.from({ length: SCENE.views }, (_, i) => 'view_' + String(i).padStart(2, '0'));
  const [h, ...v] = await Promise.all([loadView(SCENE.hero), ...names.map(loadView)]);
  // senza la vista di riserva si usa quella successiva: il disegno non si rompe mai
  views = v.map((x, i) => x || v.find(Boolean) || h);
  hero = h;
  if (!views[0]) return;
  resize();
}

// ───── Versione statica: riduci movimento o librerie non arrivate ─────
function staticLayout() {
  document.body.classList.add('is-static');
  stage.classList.add('is-static');
  const items = [stage.querySelector('.hero'), ...blocks];
  [STOPS.hero, ...STOPS.blocks].forEach((p, k) => {
    const panel = document.createElement('div');
    panel.className = 'panel';
    const c = document.createElement('canvas');
    c.setAttribute('aria-hidden', 'true');
    panel.append(c, items[k]);
    pin.append(panel);
    panels.push([c, p]);
  });
}

// ───── Timeline: lunga 100, le posizioni sono percentuali di scroll ─────
function buildTimeline() {
  const state = { p: 0 };
  const q = gsap.utils.selector(stage);
  const sharp = { opacity: 1, filter: 'blur(0px)' };
  const soft = { opacity: 0, filter: 'blur(14px)' };
  const nums = q('.counter__now > span');

  gsap.set(q('.hero'), { filter: 'blur(0px)' });
  gsap.set('.nav', { filter: 'invert(0)' });
  gsap.set(blocks, soft);
  gsap.set(q('.mask'), { xPercent: -101 });
  gsap.set(q('.mask__in'), { xPercent: 101 });
  gsap.set(q('.specs div'), { opacity: 0, y: 12 });

  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.out' } })
    .to(state, {
      p: 1, duration: 100, ease: 'none',
      onUpdate: () => { progress = state.p; draw(); },
    }, 0)
    // 0–10: l'hero si sfoca e sparisce
    .to(q('.hero'), { opacity: 0, filter: 'blur(20px)', duration: 10, ease: 'power1.in' }, 0)
    // 10–18: buio, nav bianca, compare il contatore
    .to('.nav', { filter: 'invert(1)', duration: 6, ease: 'none' }, 11)
    .to(q('.counter'), { opacity: 1, duration: 5 }, 13);

  // tre blocchi: entrano, restano, escono
  [[35, 52], [55, 72], [75, 90]].forEach(([a, b], k) => {
    const el = blocks[k];
    const sel = gsap.utils.selector(el);
    tl.to(el, { ...sharp, duration: 5 }, a)
      .to(sel('.mask'), { xPercent: 0, duration: 5, ease: 'power3.out' }, a)
      .to(sel('.mask__in'), { xPercent: 0, duration: 5, ease: 'power3.out' }, a)
      .to(sel('.specs div'), { opacity: 1, y: 0, duration: 3, stagger: 0.8 }, a + 2)
      .to(el, { ...soft, duration: 3, ease: 'power1.in' }, b - 3);
    if (k) tl.to(nums[k - 1], { opacity: 0, duration: 2 }, a).to(nums[k], { opacity: 1, duration: 2 }, a);
  });

  // 90–100: resta solo la maschera
  return tl.to(q('.counter'), { opacity: 0, duration: 3 }, 91).to({}, { duration: 6 }, 94);
}

function init() {
  gsap.registerPlugin(ScrollTrigger);
  stage.classList.add('is-pinned');

  lenis = new Lenis();
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  ScrollTrigger.create({
    animation: buildTimeline(),
    trigger: stage,
    start: 'top top',
    end: 'bottom bottom',
    scrub: 0.8,
  });

  // i link della nav portano al punto della timeline dove compare il blocco
  const range = () => stage.offsetHeight - innerHeight;
  document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
    const where = a.dataset.at;
    const target = document.querySelector(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    lenis.scrollTo(where ? stage.offsetTop + range() * where : target, { duration: 1.6 });
  }));
}

if (reduce || !(window.gsap && window.ScrollTrigger && window.Lenis)) staticLayout();
else init();

addEventListener('resize', resize);
fit(canvas);
loadViews();
