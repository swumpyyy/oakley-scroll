// ───── Maschera in 3D dalle foto vere ─────
// assets/goggle.bin è la forma 3D della maschera, ricavata dalle 12 foto (piattaforma girevole) con la camera
// ricalibrata su migliaia di punti in comune tra foto vicine. Due parti:
//  - corpo (montatura, lente, schiuma): superficie liscia che sfiora il contorno di ogni foto a metà di ogni
//    faccia della sagoma e passa per i punti misurati per triangolazione (schiuma, montatura);
//  - cinghia: nastro spesso 7 px lungo il percorso misurato su 600 mila punti, bordi dalle sagome.
// A ogni angolo la maschera prende il colore dalle due foto più vicine, proiettate sulla forma con la
// stessa camera che le ha scattate: agli angoli delle foto il risultato è la foto stessa. Tra due foto,
// assets/flow.png dice di quanto si spostano i dettagli dall'una all'altra: le due proiezioni scivolano
// l'una verso l'altra, così i dettagli coincidono e non ci sono doppi contorni. Dove le due foto restano diverse
// (dettagli coperti in una delle due) si passa dall'una all'altra in fretta invece di sovrapporle; dove una foto
// è trasparente (fuori dalla sua sagoma) conta solo l'altra.
// La foto grande (n. 11) viene da un altro servizio fotografico, con la cinghia in un'altra posizione: la cinghia
// prende il colore solo dalle altre 11.
// Serve WebGL2; se manca, createGoggle3D restituisce null e il sito usa le foto in 2D.

// Camera stimata dalle foto (tela 1000×500 px): distanza, inclinazione, angolo di ogni foto, spostamento
// dovuto al ricentraggio, e dove sta ogni immagine ritagliata dentro la sua tela [x, y, larghezza, altezza].
const GOGGLE_CAM = {
  D: 2600,
  elev: 3.01,
  angles: [0, 33.03, 63.43, 92.99, 122.44, 151.29, 180.2, 208.51, 237.06, 266.62, 295.86, 327.97],
  offs: [[1, -15], [-43.51, -18.5], [8.81, -14.13], [38.05, -6.26], [55.4, -16.86], [13.16, -23.59], [8.16, -25.94], [-1.09, -23], [-42.59, -16.57], [-47.72, -4.8], [-24.16, -12.63], [-15.85, 2.48]],
  crops: [[147, 42, 706, 416], [125, 41, 750, 418], [63, 46, 874, 408], [33, 55, 933, 390], [52, 45, 896, 410],
    [117, 40, 765, 420], [194, 39, 612, 422], [112, 41, 776, 418], [51, 45, 898, 409], [30, 56, 940, 388],
    [62, 46, 877, 408], [91.17, 59.45, 736.28, 412.72]],
  hi: 11,   // la foto grande viene da un altro servizio fotografico: la cinghia lì è in un'altra posizione
};

function createGoggle3D(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true });
  if (!gl) return null;
  const C = GOGGLE_CAM;
  const N = C.angles.length;
  const NEAR = C.D - 700, RANGE = 1400; // profondità lineare 0–1 sull'ingombro della maschera

  // rotazione: oggetto girato di theta sulla piattaforma, poi camera alzata di elev (colonne per GLSL)
  function rot(thetaDeg) {
    const t = thetaDeg * Math.PI / 180, e = C.elev * Math.PI / 180;
    const c = Math.cos(t), s = Math.sin(t), ce = Math.cos(e), se = Math.sin(e);
    // R = Rx(e) · Ry(t), righe: [c, 0, s], [se*s, ce, -se*c], [-ce*s, se, ce*c]
    return new Float32Array([c, se * s, -ce * s, 0, ce, se, s, -se * c, ce * c]);
  }

  const PROJECT = `
    uniform float uD;
    vec3 proj(mat3 R, vec2 off, vec3 p) {        // -> (u, v) nella tela della foto, profondità lineare 0–1
      vec3 q = R * p;
      float z = uD - q.z;
      return vec3(499.5 + uD * q.x / z + off.x, 249.5 - uD * q.y / z + off.y, (z - ${NEAR.toFixed(1)}) / ${RANGE.toFixed(1)});
    }`;

  function compile(vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      gl.attachShader(p, sh);
    }
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.bindAttribLocation(p, 1, 'aNrm');
    gl.bindAttribLocation(p, 2, 'aPart');
    gl.bindAttribLocation(p, 3, 'aLens');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const loc = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i); loc[u.name] = gl.getUniformLocation(p, u.name); }
    return { p, loc };
  }

  // profondità vista da ogni foto: serve a sapere se un punto in quella foto era visibile o coperto
  const depthProg = compile(`#version 300 es
    in vec3 aPos;
    uniform mat3 uR; uniform vec2 uOff;
    ${PROJECT}
    void main() {
      vec3 t = proj(uR, uOff, aPos);
      gl_Position = vec4(t.x / 1000.0 * 2.0 - 1.0, 1.0 - t.y / 500.0 * 2.0, t.z * 2.0 - 1.0, 1.0);
    }`, `#version 300 es
    precision mediump float;
    void main() {}`);

  const mainProg = compile(`#version 300 es
    in vec3 aPos;
    in vec3 aNrm;    // normale morbida (media sui triangoli attorno al vertice)
    in float aPart;  // 0 corpo, 1 cinghia
    in float aLens;  // 0–1: lente a specchio (riconosciuta dal colore nelle foto frontali)
    uniform mat3 uR; uniform vec2 uOff;
    uniform vec2 uCenter; uniform float uScale; uniform float uRoll; uniform vec2 uViewport;
    out vec3 vPos;
    out vec3 vNrm;
    out vec2 vOut;   // punto nella tela della scena (serve a leggere il campo di spostamento)
    flat out float vPart;
    out float vLens;
    ${PROJECT}
    void main() {
      vPart = aPart;
      vLens = aLens;
      vec3 t = proj(uR, uOff, aPos);
      vOut = t.xy;
      vec2 d = (t.xy - vec2(499.5, 249.5)) * uScale;
      float c = cos(uRoll), s = sin(uRoll);
      vec2 sp = uCenter + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
      vec2 ndc = vec2(sp.x / uViewport.x * 2.0 - 1.0, 1.0 - sp.y / uViewport.y * 2.0);
      float w = (t.z * ${RANGE.toFixed(1)} + ${NEAR.toFixed(1)}) / uD;   // prospettiva corretta sulle texture
      gl_Position = vec4(ndc * w, (t.z * 2.0 - 1.0) * w, w);
      vPos = aPos;
      vNrm = aNrm;
    }`, `#version 300 es
    precision highp float;
    precision highp sampler2DArray;
    in vec3 vPos;
    in vec3 vNrm;
    in vec2 vOut;
    flat in float vPart;
    in float vLens;
    uniform mat3 uR;               // camera della scena (per la direzione di vista)
    uniform mat3 uRA, uRB; uniform vec2 uOffA, uOffB; uniform float uLayerA, uLayerB, uW;
    uniform mat3 uRA2, uRB2; uniform vec2 uOffA2, uOffB2; uniform float uLayerA2, uLayerB2, uW2, uFlow2;   // coppia per la cinghia
    uniform float uPair, uFlowOn, uDebug;
    uniform sampler2DArray uTex;   // le 12 foto
    uniform sampler2DArray uDep;   // profondità vista da ogni foto
    uniform sampler2D uFlow;       // spostamento dei dettagli tra le due foto di ogni coppia
    out vec4 outColor;
    ${PROJECT}
    float seen(float layer, vec3 t) {
      // visibile in quella foto e non a ridosso di ciò che lo copre: lungo quei bordi la foto mostra ancora
      // l'oggetto davanti (aloni), quindi lì conta poco. Passaggio graduale, niente puntinature.
      vec2 dc = vec2(t.x / 1000.0, 1.0 - t.y / 500.0), px = vec2(1.0 / 1024.0, 1.0 / 512.0);
      float v = 0.0;   // visibile: 5 campioni vicini, soglia stretta
      for (int k = 0; k < 5; k++) {
        vec2 o = k == 0 ? vec2(0.0) : k == 1 ? vec2(1.5, 0.0) : k == 2 ? vec2(-1.5, 0.0) : k == 3 ? vec2(0.0, 1.5) : vec2(0.0, -1.5);
        float z = texture(uDep, vec3(dc + o * px, layer)).r;
        v += clamp(1.0 - (t.z - z - 0.004) / 0.010, 0.0, 1.0);
      }
      v /= 5.0;
      // vicino al bordo di qualcosa che sta molto più avanti (salto di oltre ~30 px): conta poco
      for (int k = 0; k < 4; k++) {
        float an = float(k) * 1.5707963 + 0.7853982;
        float z = texture(uDep, vec3(dc + vec2(cos(an), sin(an)) * 4.0 * px, layer)).r;
        v = min(v, clamp(1.0 - (t.z - z - 0.02) / 0.02, 0.0, 1.0));
      }
      return v;
    }
    vec4 photo(float layer, vec2 uv) {
      vec2 p = (uv + 0.5) / vec2(1000.0, 500.0);   // centro del pixel i a coordinata i, come per le sagome
      if (any(lessThan(p, vec2(0.0))) || any(greaterThan(p, vec2(1.0)))) return vec4(0.0);
      return texture(uTex, vec3(p, layer));
    }
    void main() {
      // la cinghia prende il colore solo dalle 11 foto dello stesso servizio
      bool st = vPart > 0.5;
      mat3 RA = st ? uRA2 : uRA, RB = st ? uRB2 : uRB;
      vec2 offA = st ? uOffA2 : uOffA, offB = st ? uOffB2 : uOffB;
      float LA = st ? uLayerA2 : uLayerA, LB = st ? uLayerB2 : uLayerB, W = st ? uW2 : uW;
      vec3 ta = proj(RA, offA, vPos);
      vec3 tb = proj(RB, offB, vPos);
      vec2 fl = vec2(0.0);
      if (uFlowOn > 0.5) {
        vec2 c = vec2(vOut.x / 1000.0, (uPair + clamp(vOut.y / 500.0, 0.004, 0.996)) / ${N}.0);
        fl = (texture(uFlow, c).rg * 255.0 - 128.0) / 2.0;
      }
      if (st && uFlow2 < 0.5) fl = vec2(0.0);   // la cinghia salta la foto grande: lo spostamento misurato non vale
      vec4 a = photo(LA, ta.xy + W * fl);
      vec4 b = photo(LB, tb.xy - (1.0 - W) * fl);
      // ogni foto conta in base a quanto vede di fronte la superficie: quelle che la vedono di taglio
      // la stirerebbero (strisciate), quindi pesano poco
      vec3 n = normalize(vNrm);
      vec3 dirOut = vec3(0.0, 0.0, 1.0) * uR;
      if (dot(n, dirOut) < 0.0) n = -n;
      float ca = dot(n, vec3(0.0, 0.0, 1.0) * RA), cb = dot(n, vec3(0.0, 0.0, 1.0) * RB);
      // peso continuo (coseno): a parità di distanza in angolo vince la foto che vede la superficie più di fronte
      float fa = max(smoothstep(0.05, 0.3, ca) * ca, 0.002), fb = max(smoothstep(0.05, 0.3, cb) * cb, 0.002);
      // dove una foto è trasparente (fuori dalla sua sagoma) conta l'altra: niente buchi né bordi sfrangiati
      float ga = (1.0 - W) * seen(LA, ta) * fa, gb = W * seen(LB, tb) * fb;   // quanto ogni foto vede questo punto
      float wa = ga * smoothstep(0.02, 0.5, a.a);
      float wb = gb * smoothstep(0.02, 0.5, b.a);
      if (wa + wb < 1e-4) { wa = 1.0 - W; wb = W; }   // nessuna delle due lo vede: si usa comunque la più vicina
      float wB = wb / (wa + wb);
      // dove le due foto non combaciano, sovrapporle darebbe doppi contorni: lì si passa dall'una all'altra
      // più in fretta, attorno a metà. Il disaccordo si misura sulle foto sfocate (mipmap), così è morbido.
      vec2 pa = (ta.xy + W * fl + 0.5) / vec2(1000.0, 500.0), pb = (tb.xy - (1.0 - W) * fl + 0.5) / vec2(1000.0, 500.0);
      vec4 aS = textureLod(uTex, vec3(pa, LA), 2.5);
      vec4 bS = textureLod(uTex, vec3(pb, LB), 2.5);
      // sulla lente (superficie rivolta in avanti) i riflessi cambiano da foto a foto e devono dissolversi:
      // lì il passaggio rapido vale solo per il dettaglio stampato (scritte, logo)
      float detail = clamp((length(a - aS) + length(b - bS)) * 5.0 - 0.1, 0.0, 1.0);
      float lensLike = smoothstep(0.2, 0.8, vLens);
      // disaccordo anche sui dettagli fini (scritte piccole spostate di pochi px), allargato ai vicini così una
      // lettera passa tutta insieme da una foto all'altra invece di strapparsi
      float fine = 0.0;
      for (int k = 0; k < 3; k++) {
        vec2 o = vec2(float(k - 1) * 5.0, 0.0) / vec2(1000.0, 500.0);   // le scritte scorrono in orizzontale
        fine = max(fine, length(textureLod(uTex, vec3(pa + o, LA), 1.0) - textureLod(uTex, vec3(pb + o, LB), 1.0)));
      }
      float dis = max(clamp(length(aS - bS) * 4.0 - 0.2, 0.0, 1.0), clamp(fine * 2.5 - 0.35, 0.0, 1.0) * (1.0 - lensLike)) * mix(1.0, detail, lensLike);
      wB = clamp((wB - 0.5) * (1.0 + 7.0 * dis) + 0.5, 0.0, 1.0);
      vec4 col = mix(a, b, wB);
      // contorno: la trasparenza segue quanto ogni foto vede davvero il punto (rinforzata): vicino a una foto il bordo
      // dell'altra non compare come doppio bordo, una foto che vede di taglio non buca la superficie, e dentro
      // l'occhiale piccoli disallineamenti non fanno buchi
      float al = ga + gb > 1e-4 ? (ga * a.a + gb * b.a) / (ga + gb) : (1.0 - W) * a.a + W * b.a;
      al = clamp(al * 1.6, 0.0, 1.0);
      if (col.a > 1e-4) col *= min(al, col.a) / col.a;
      if (uDebug > 0.5) col = vec4(vec3(0.25 + 0.7 * abs(dot(n, normalize(vec3(0.3, 0.6, 1.0) * uR)))), 1.0);   // solo per controlli: forma ombreggiata
      if (uDebug > 1.5) col = vec4(vec3(lensLike), 1.0);   // solo per la preparazione: dove sta la lente
      if (col.a < 0.02) discard;                        // trasparente: non copre ciò che sta dietro
      outColor = col;
    }`);

  const vao = gl.createVertexArray();
  const texPhoto = gl.createTexture();
  const texDepth = gl.createTexture();
  const texFlow = gl.createTexture();
  let count = 0;
  let flowOn = false;
  let ok = false;

  // images: 12 immagini ritagliate (la 11 è la foto grande); mesh: ArrayBuffer di goggle.bin;
  // flow: immagine del campo di spostamento (facoltativa)
  function setup(images, mesh, flow) {
    const magic = String.fromCharCode(...new Uint8Array(mesh, 0, 4));
    if (magic !== 'OAK6') throw new Error('goggle.bin: formato inatteso');
    const [nv, nf] = new Uint32Array(mesh.slice(4, 12));
    const pos = new Float32Array(mesh.slice(12, 12 + nv * 12));
    const part = new Uint8Array(mesh.slice(12 + nv * 12, 12 + nv * 13));
    const lens = new Uint8Array(mesh.slice(12 + nv * 13, 12 + nv * 14));
    const io = 12 + nv * 14 + ((4 - ((2 * nv) % 4)) % 4);
    const idx = new Uint16Array(mesh.slice(io, io + nf * 6));
    count = idx.length;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    // normali morbide: media (pesata per area) delle normali dei triangoli attorno a ogni vertice
    const nrm = new Float32Array(nv * 3);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) { nrm[k] += nx; nrm[k + 1] += ny; nrm[k + 2] += nz; }
    }
    for (let k = 0; k < nrm.length; k += 3) {
      const l = Math.hypot(nrm[k], nrm[k + 1], nrm[k + 2]) || 1;
      nrm[k] /= l; nrm[k + 1] /= l; nrm[k + 2] /= l;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, nrm, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, part, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.UNSIGNED_BYTE, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, lens, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.UNSIGNED_BYTE, true, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    // le 12 foto nella loro tela 1000×500, una per strato
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texPhoto);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 10, gl.RGBA8, 1000, 500, N);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    const layer = document.createElement('canvas');
    layer.width = 1000; layer.height = 500;
    const lc = layer.getContext('2d');
    images.forEach((img, i) => {
      const [x, y, w, h] = C.crops[i];
      lc.clearRect(0, 0, 1000, 500);
      lc.imageSmoothingQuality = 'high';
      lc.drawImage(img, x, y, w, h);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, 1000, 500, 1, gl.RGBA, gl.UNSIGNED_BYTE, layer);
    });
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    // profondità vista da ogni foto
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texDepth);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.DEPTH_COMPONENT24, 1024, 512, N);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(depthProg.p);
    gl.uniform1f(depthProg.loc.uD, C.D);
    gl.viewport(0, 0, 1024, 512);
    for (let i = 0; i < N; i++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, texDepth, 0, i);
      gl.clearDepth(1);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix3fv(depthProg.loc.uR, false, rot(C.angles[i]));
      gl.uniform2fv(depthProg.loc.uOff, C.offs[i]);
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);

    // campo di spostamento: valori esatti, senza conversioni di colore
    if (flow) {
      gl.bindTexture(gl.TEXTURE_2D, texFlow);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, flow);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      flowOn = true;
    }

    const L = mainProg.loc;
    gl.useProgram(mainProg.p);
    gl.uniform1f(L.uD, C.D);
    gl.uniform1i(L.uTex, 0);
    gl.uniform1i(L.uDep, 1);
    gl.uniform1i(L.uFlow, 2);
    ok = gl.getError() === gl.NO_ERROR;
    return ok;
  }

  // coppia di foto attorno all'angolo a (gradi 0–360) e posizione tra le due (0–1);
  // skipHi: senza la foto grande (per la cinghia)
  const ALL = C.angles.map((_, i) => i), KSET = ALL.filter((i) => i !== C.hi);
  function pairAt(a, skipHi) {
    const L = skipHi ? KSET : ALL;
    for (let n = 0; n < L.length; n++) {
      const i = L[n], j = L[(n + 1) % L.length];
      const a0 = C.angles[i], a1 = n + 1 < L.length ? C.angles[j] : 360 + C.angles[L[0]];
      if (a >= a0 && a < a1) return [i, j, (a - a0) / (a1 - a0)];
    }
    return [L[0], L[1], 0];
  }

  // v: { x, y, scale (px del canvas per px della foto), roll (rad), angle (gradi), W, H }
// solo per i controlli: forceW (0/1 = una sola foto), noFlow, debug (forma ombreggiata)
  function draw(v) {
    if (!ok) return;
    const a = ((v.angle % 360) + 360) % 360;
    const [i, j, f] = pairAt(a);
    const w = v.forceW ?? f * f * (3 - 2 * f);
    const [i2, j2, f2] = pairAt(a, true);
    const w2 = v.forceW ?? f2 * f2 * (3 - 2 * f2);
    const off = [C.offs[i][0] * (1 - f) + C.offs[j][0] * f, C.offs[i][1] * (1 - f) + C.offs[j][1] * f];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, v.W, v.H);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const L = mainProg.loc;
    gl.useProgram(mainProg.p);
    gl.uniformMatrix3fv(L.uR, false, rot(a));
    gl.uniform2fv(L.uOff, off);
    gl.uniform2f(L.uCenter, v.x, v.y);
    gl.uniform1f(L.uScale, v.scale);
    gl.uniform1f(L.uRoll, v.roll);
    gl.uniform2f(L.uViewport, v.W, v.H);
    gl.uniformMatrix3fv(L.uRA, false, rot(C.angles[i]));
    gl.uniformMatrix3fv(L.uRB, false, rot(C.angles[j]));
    gl.uniform2fv(L.uOffA, C.offs[i]);
    gl.uniform2fv(L.uOffB, C.offs[j]);
    gl.uniform1f(L.uLayerA, i);
    gl.uniform1f(L.uLayerB, j);
    gl.uniform1f(L.uW, w);
    gl.uniformMatrix3fv(L.uRA2, false, rot(C.angles[i2]));
    gl.uniformMatrix3fv(L.uRB2, false, rot(C.angles[j2]));
    gl.uniform2fv(L.uOffA2, C.offs[i2]);
    gl.uniform2fv(L.uOffB2, C.offs[j2]);
    gl.uniform1f(L.uLayerA2, i2);
    gl.uniform1f(L.uLayerB2, j2);
    gl.uniform1f(L.uW2, w2);
    gl.uniform1f(L.uFlow2, i2 === i && j2 === j ? 1 : 0);
    gl.uniform1f(L.uPair, i);
    gl.uniform1f(L.uFlowOn, flowOn && !v.noFlow ? 1 : 0);
    gl.uniform1f(L.uDebug, +v.debug || 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, texPhoto);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, texDepth);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texFlow);
    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
  }

  return { setup, draw, pairAt, gl };
}
