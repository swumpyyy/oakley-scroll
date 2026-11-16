// ───── Configurazione della sequenza ─────
// Per usare un video vero: estrai i frame in queste cartelle con gli stessi nomi (0001.webp …)
// e aggiorna count. I frame seguono lo scroll in modo lineare dall'inizio alla fine dello stage.
const FRAMES = {
  count: 280,
  desktop: 'assets/frames/desktop/',
  mobile: 'assets/frames/mobile/',
  ext: '.webp',
  digits: 4,
};
// Punti della timeline (0–1) usati per i link della nav e per la versione statica
const STOPS = { hero: 0, blocks: [0.45, 0.65, 0.88] };

console.assert(FRAMES.count > 1 && STOPS.blocks.length === 3, 'FRAMES/STOPS non validi');

const mobile = matchMedia('(max-width: 768px)').matches; // shortcut: serie scelta al caricamento, ruotare il tablet non la cambia
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const base = mobile ? FRAMES.mobile : FRAMES.desktop;
const frameUrl = (i) => base + String(i + 1).padStart(FRAMES.digits, '0') + FRAMES.ext;

const stage = document.querySelector('.stage');
const pin = stage.querySelector('.pin');
const canvas = stage.querySelector('.video');
const ctx = canvas.getContext('2d');
const blocks = [...stage.querySelectorAll('.block')];
let lenis = null;

// ───── Carrello ─────
let cart = 0;
const cartCount = document.querySelector('.cart-count');
const status = document.querySelector('.card__status');
document.querySelector('.pill').addEventListener('click', () => {
  cart += 1;
  cartCount.textContent = cart;
  status.textContent = `Aggiunto al carrello · ${cart} ${cart === 1 ? 'pezzo' : 'pezzi'}`;
});

// ───── Canvas: frame disegnati in modalità "cover" ─────
const images = new Array(FRAMES.count);
const ready = new Uint8Array(FRAMES.count);
let current = 0; // frame richiesto dallo scroll
let drawn = -1; // frame effettivamente disegnato

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  drawn = -1;
  draw();
}

function nearestReady(i) {
  for (let d = 0; d < FRAMES.count; d++) {
    if (ready[i - d]) return i - d;
    if (ready[i + d]) return i + d;
  }
  return -1;
}

function draw() {
  const i = nearestReady(current);
  if (i < 0 || i === drawn) return;
  const img = images[i];
  const cw = canvas.width, ch = canvas.height;
  ctx.imageSmoothingQuality = 'high'; // si azzera a ogni resize del canvas
  const s = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
  const w = img.naturalWidth * s, h = img.naturalHeight * s;
  ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
  drawn = i;
}

function load(i) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      images[i] = img;
      ready[i] = 1;
      // se è più vicino al frame richiesto di quello a schermo, ridisegna
      if (Math.abs(i - current) < Math.abs(drawn - current) || drawn < 0) { drawn = -1; draw(); }
      resolve();
    };
    img.onerror = resolve; // un frame mancante non blocca gli altri: si usa il più vicino
    img.src = frameUrl(i);
  });
}

// Prima il frame 0, poi gli altri a passi sempre più fitti, 6 alla volta
async function loadAll() {
  await load(0);
  const order = [];
  for (const step of [16, 8, 4, 2, 1]) {
    for (let i = 0; i < FRAMES.count; i += step) if (!order.includes(i) && i) order.push(i);
  }
  let next = 0;
  const worker = async () => { while (next < order.length) await load(order[next++]); };
  await Promise.all(Array.from({ length: 6 }, worker));
}

// ───── Versione statica: riduci movimento o librerie non arrivate ─────
function staticLayout() {
  document.body.classList.add('is-static');
  stage.classList.add('is-static');
  const items = [stage.querySelector('.hero'), ...blocks];
  [STOPS.hero, ...STOPS.blocks].forEach((p, k) => {
    const panel = document.createElement('div');
    panel.className = 'panel';
    const img = new Image();
    img.src = frameUrl(Math.round(p * (FRAMES.count - 1)));
    img.alt = '';
    img.loading = k ? 'lazy' : 'eager';
    panel.append(img, items[k]);
    pin.append(panel);
  });
}

// ───── Timeline: lunga 100, le posizioni sono percentuali di scroll ─────
function buildTimeline() {
  const state = { frame: 0 };
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
      frame: FRAMES.count - 1, duration: 100, ease: 'none',
      onUpdate: () => { current = Math.round(state.frame); draw(); },
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

  // 90–100: resta solo il primo piano
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
    const at = a.dataset.at;
    const target = document.querySelector(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    lenis.scrollTo(at ? stage.offsetTop + range() * at : target, { duration: 1.6 });
  }));
}

addEventListener('resize', resize);
resize();
loadAll();

if (reduce || !(window.gsap && window.ScrollTrigger && window.Lenis)) staticLayout();
else init();
