'use strict';
// ============================================================
//  GFX — SNES-style sprite generation (pixel art + dithering)
// ============================================================
const W = 224, H = 288;

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// 4x4 ordered (Bayer) dither — the classic 16-bit look
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
function bayer(x, y) { return BAYER4[(y & 3) * 4 + (x & 3)]; }

function hexRGB(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// Pick a color from a ramp with ordered dithering between neighbours
function ramp(pal, v, x, y) {
  const f = clamp(v, 0, 0.999) * (pal.length - 1);
  let i = Math.floor(f);
  if (f - i > bayer(x, y)) i++;
  return pal[clamp(i, 0, pal.length - 1)];
}

// Deterministic hash noise
function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s) {
  return vnoise(x, y, s) * 0.55 + vnoise(x * 2, y * 2, s + 7) * 0.3 + vnoise(x * 4, y * 4, s + 13) * 0.15;
}

// Light from top-left, slightly toward viewer
const LX = -0.45, LY = -0.6, LZ = 0.66;
function light(nx, ny, nz) { return nx * LX + ny * LY + nz * LZ; }
function sphereL(dx, dy, r) {
  const nx = dx / r, ny = dy / r, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  return light(nx, ny, nz);
}

// Build a sprite pixel-by-pixel. fn(x,y) returns '#rrggbb' or null. Auto outline.
function pixelArt(w, h, fn, outline) {
  const c = mkCanvas(w, h), g = c.getContext('2d');
  const img = g.createImageData(w, h), d = img.data;
  const solid = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const col = fn(x, y);
    if (!col) continue;
    const rgb = hexRGB(col), i = (y * w + x) * 4;
    d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255;
    solid[y * w + x] = 1;
  }
  if (outline) {
    const o = hexRGB(outline);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (solid[y * w + x]) continue;
      const n = (x > 0 && solid[y * w + x - 1]) || (x < w - 1 && solid[y * w + x + 1]) ||
                (y > 0 && solid[(y - 1) * w + x]) || (y < h - 1 && solid[(y + 1) * w + x]);
      if (n) { const i = (y * w + x) * 4; d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; d[i + 3] = 255; }
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Sprite from character rows. mirror=true → rows describe left half.
function spriteFromRows(rows, pal, mirror) {
  const hw = rows[0].length, w = mirror ? hw * 2 : hw, h = rows.length;
  const c = mkCanvas(w, h), g = c.getContext('2d');
  for (let y = 0; y < h; y++) for (let x = 0; x < hw; x++) {
    const ch = rows[y][x];
    if (!ch || ch === '.') continue;
    g.fillStyle = pal[ch];
    g.fillRect(x, y, 1, 1);
    if (mirror) g.fillRect(w - 1 - x, y, 1, 1);
  }
  return c;
}

function silhouette(src, color) {
  const c = mkCanvas(src.width, src.height), g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}
function withFlash(c) { c.white = silhouette(c, '#ffffff'); return c; }

// ------------------------------------------------------------
//  Pixel font (3x5), each glyph = 5 rows of 3 bits
// ------------------------------------------------------------
const FONT = {
  '0': '75557', '1': '26227', '2': '71747', '3': '71317', '4': '55711', '5': '74717', '6': '74757',
  '7': '71222', '8': '75757', '9': '75717',
  A: '25755', B: '65656', C: '34443', D: '65556', E: '74647', F: '74644', G: '34553', H: '55755',
  I: '72227', J: '11152', K: '55655', L: '44447', M: '57755', N: '65555', O: '25552', P: '65644',
  Q: '25563', R: '65655', S: '34216', T: '72222', U: '55557', V: '55552', W: '55775', X: '55255',
  Y: '55222', Z: '71247', ' ': '00000', '.': '00002', ':': '02020', '!': '22202', '-': '00700',
  '/': '11244', '+': '02720', '?': '71302', "'": '22000', ',': '00024', '<': '12421', '>': '42124',
  '%': '51245', '=': '07070', '(': '24442', ')': '42224', '*': '05250'
};

function glyphs(g, str, x, y, col, s) {
  if (!Array.isArray(col)) g.fillStyle = col;
  for (let i = 0; i < str.length; i++) {
    const gl = FONT[str[i]];
    if (!gl) continue;
    for (let r = 0; r < 5; r++) {
      const bits = +gl[r];
      if (!bits) continue;
      if (Array.isArray(col)) g.fillStyle = col[r];
      for (let c = 0; c < 3; c++) if (bits & (4 >> c)) g.fillRect(x + i * 4 * s + c * s, y + r * s, s, s);
    }
  }
}
function textWidth(str, s = 1) { return String(str).length * 4 * s - s; }
function drawText(g, str, x, y, col, s = 1, align = 'left', shadow = '#000') {
  str = String(str).toUpperCase();
  const w = textWidth(str, s);
  if (align === 'center') x -= Math.floor(w / 2);
  else if (align === 'right') x -= w;
  x = Math.round(x); y = Math.round(y);
  if (shadow) glyphs(g, str, x + s, y + s, shadow, s);
  glyphs(g, str, x, y, col, s);
}

// ------------------------------------------------------------
//  Palettes
// ------------------------------------------------------------
const PAL = {
  fire: ['#3a0a14', '#8a1a1a', '#d8401a', '#ff8a1a', '#ffd23f', '#fff8d0', '#ffffff'],
  rock: ['#1c1420', '#3a2c38', '#5e4a4c', '#86705e', '#b39a7c', '#dcc8a4'],
  rockBlue: ['#10141e', '#232c40', '#3c4a62', '#5f7288', '#8ea4b4', '#c8dce0'],
  steel: ['#10142a', '#1f2a4a', '#34487a', '#5774b0', '#8fb0e0', '#d8ecff'],
  metal: ['#141418', '#2c2c38', '#4c4c60', '#7a7a90', '#b0b0c4', '#e8e8f4'],
  red: ['#2a0810', '#6a1020', '#b02030', '#e85040', '#ffb080', '#fff0d0'],
  cyan: ['#08303a', '#0e6a80', '#20b0c8', '#60f0ff', '#d0ffff', '#ffffff'],
  green: ['#062a14', '#0c5a28', '#1fa040', '#5ee06a', '#c0ffb0', '#ffffff'],
  purple: ['#12061e', '#2e0f4a', '#522080', '#7e3cb8', '#b070e8', '#e8c0ff'],
  pink: ['#2a0620', '#6a1048', '#b02878', '#f050a8', '#ff9ad0', '#fff0f8'],
  gold: ['#2a1a04', '#6a4008', '#b07810', '#f0b020', '#ffe070', '#fffff0'],
};

// ------------------------------------------------------------
//  Sprite definitions
// ------------------------------------------------------------
const SHIP_ROWS = [
  '.......o',
  '......ow',
  '......ol',
  '......oc',
  '.....oCc',
  '.....oCw',
  '.....olb',
  '....olbb',
  '..o.olbd',
  '.oro.obd',
  '.ogo.odl',
  'ogGoobbl',
  'ogGolbbd',
  'oGGbbddn',
  'oGRddnno',
  '.oRo.orr',
  '..o...oo',
];
const SHIP_PAL = {
  o: '#12102a', w: '#ffffff', l: '#9fd8ff', b: '#3f7fe0', d: '#23408f', n: '#15225a',
  c: '#5ff2ff', C: '#1a8fb0', g: '#c8cfe0', G: '#6b7390', r: '#e8403a', R: '#8a1c2a', y: '#ffd23f'
};

const DRONE_ROWS = [
  '.o....',
  '..o.oo',
  '..oogg',
  '.ogGgg',
  'oggGrw',
  'oGgggg',
  'oGDGgg',
  '.oDoGG',
  '.o.oDo',
  'o..o..',
];
const SWOOP_ROWS = [
  '.......o',
  '......op',
  '.....opp',
  'o...opPm',
  'po.opPmy',
  'ppoppPmw',
  'oPppPPmm',
  '.oPPPPPp',
  '..oDPDPP',
  '...oDoDP',
  '....o.oD',
  '......oo',
];
const GUN_ROWS = [
  '......oooo',
  '.....oaaaa',
  '....oaAAgg',
  '...oaAAgcc',
  '..oaAAgGcc',
  'ooaAAAgGcw',
  'oaAADAAgGG',
  'oAADoDAAAA',
  'oADo.oDAAa',
  'oDo..oDAAa',
  '.o...oGGGG',
  '......oGrr',
  '......oGrr',
  '.......oGG',
  '........oo',
];

const ENEMY_PALS = {
  droneG: { o: '#0a1a0e', g: '#5ee06a', G: '#1f8a3a', D: '#0f4a22', r: '#ff4040', w: '#ffffff' },
  droneR: { o: '#1e0808', g: '#ff7a5a', G: '#b02a2a', D: '#5a1010', r: '#ffe040', w: '#ffffff' },
  droneB: { o: '#060e20', g: '#6ac8ff', G: '#2a5ab0', D: '#122a5a', r: '#ff40c0', w: '#ffffff' },
  swoopP: { o: '#1a0f24', p: '#b760ff', P: '#6a2fb0', D: '#3a1560', m: '#ff8ae0', y: '#ffe060', w: '#ffffff' },
  swoopC: { o: '#061a1e', p: '#50f0d0', P: '#1a9a90', D: '#0a4a48', m: '#e0ff80', y: '#ff6080', w: '#ffffff' },
  swoopGold: { o: '#2a1a04', p: '#ffe070', P: '#f0b020', D: '#b07810', m: '#ffffff', y: '#ff5040', w: '#ffffff' },
  gunO: { o: '#200c06', a: '#ffa040', A: '#c05a18', D: '#6a2a10', g: '#d8d8e8', G: '#7a7a90', c: '#60ffb0', r: '#ff3030', w: '#ffffff' },
  gunS: { o: '#0c0e18', a: '#a8b8d8', A: '#5a6a90', D: '#2a3050', g: '#e8e0c0', G: '#8a7a58', c: '#ff6060', r: '#ffe040', w: '#ffffff' },
  gunV: { o: '#14061a', a: '#e070ff', A: '#8a30b0', D: '#401858', g: '#c0ffe0', G: '#50a080', c: '#fff060', r: '#60ff80', w: '#ffffff' },
};

function makeAsteroid(r, seed, pal) {
  const size = Math.ceil(r * 2) + 4, c = size / 2;
  const rnd = (i) => hash2(i, seed, 99);
  const N = 10, radii = [];
  for (let i = 0; i < N; i++) radii.push(r * (0.78 + rnd(i) * 0.22));
  const craters = [];
  const nc = Math.max(1, Math.floor(r / 5));
  for (let i = 0; i < nc; i++) {
    const a = rnd(i + 20) * Math.PI * 2, d = rnd(i + 40) * r * 0.55;
    craters.push({ x: c + Math.cos(a) * d, y: c + Math.sin(a) * d, r: 1.5 + rnd(i + 60) * r * 0.28 });
  }
  const spr = pixelArt(size, size, (x, y) => {
    const dx = x + 0.5 - c, dy = y + 0.5 - c;
    const ang = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1 * N;
    const i0 = Math.floor(ang), f = ang - i0;
    const R = radii[i0 % N] * (1 - f) + radii[(i0 + 1) % N] * f;
    const d = Math.hypot(dx, dy);
    if (d > R) return null;
    let l = sphereL(dx, dy, R + 0.5);
    for (const cr of craters) {
      const cd = Math.hypot(x + 0.5 - cr.x, y + 0.5 - cr.y);
      if (cd < cr.r) l = l * 0.5 - 0.15 + ((x - cr.x) * 0.45 + (y - cr.y) * 0.6) / cr.r * 0.35;
      else if (cd < cr.r + 1) l += 0.12;
    }
    l += (hash2(x, y, seed) - 0.5) * 0.25;
    return ramp(pal, 0.5 + 0.55 * l, x, y);
  }, '#08060c');
  return withFlash(spr);
}

function makeSphere(r, pal, opts = {}) {
  const size = Math.ceil(r * 2) + 2, c = size / 2;
  return pixelArt(size, size, (x, y) => {
    const dx = x + 0.5 - c, dy = y + 0.5 - c;
    if (Math.hypot(dx, dy) > r) return null;
    let l = sphereL(dx, dy, r);
    if (opts.bands) l += Math.sin((dy / r) * opts.bands + fbm(x * 0.15, y * 0.4, 5) * 3) * 0.18;
    if (opts.noise) l += (fbm(x * 0.12, y * 0.12, opts.seed || 3) - 0.5) * opts.noise;
    return ramp(pal, 0.45 + 0.55 * l, x, y);
  }, opts.outline || null);
}

// Explosion frames — dithered fireball
function makeExplosion(R, frames, seed) {
  const out = [];
  const size = Math.ceil(R * 2) + 2, c = size / 2;
  for (let f = 0; f < frames; f++) {
    const t = f / (frames - 1);
    const rad = R * (0.3 + 0.7 * Math.sqrt(t));
    out.push(pixelArt(size, size, (x, y) => {
      const dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.hypot(dx, dy);
      const n = fbm(x * 4 / R + seed, y * 4 / R, seed);
      if (d > rad * (0.75 + 0.45 * n)) return null;
      let heat = (1 - d / rad) * 1.4 * (1 - t) + n * 0.5 - t * 0.55;
      if (t > 0.5 && heat < bayer(x, y) * 0.35) return null;
      if (heat < 0.02) return t > 0.35 ? null : PAL.fire[0];
      return ramp(PAL.fire, heat, x, y);
    }));
  }
  return out;
}

function makeBullet(r, pal, core) {
  const s = Math.ceil(r * 2) + 2, c = s / 2;
  return pixelArt(s, s, (x, y) => {
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
    if (d > r) return null;
    const v = 1 - d / r;
    return v > 0.55 ? core : ramp(pal, 0.35 + v, x, y);
  }, '#200010');
}

function makeItem(letter, pal) {
  const r = 5.5;
  const spr = pixelArt(13, 13, (x, y) => {
    const dx = x + 0.5 - 6.5, dy = y + 0.5 - 6.5;
    if (Math.hypot(dx, dy) > r) return null;
    return ramp(pal, 0.45 + 0.55 * sphereL(dx, dy, r), x, y);
  }, '#0a0612');
  const g = spr.getContext('2d');
  glyphs(g, letter, 6, 5, '#000000', 1);
  glyphs(g, letter, 5, 4, '#ffffff', 1);
  return spr;
}

// ------------------------------------------------------------
//  Bosses (procedural pixel art)
// ------------------------------------------------------------
function makeBossWarden() {
  const w = 80, h = 58, cx = 40;
  return withFlash(pixelArt(w, h, (x, y) => {
    const px = x + 0.5, py = y + 0.5, dx = px - cx, adx = Math.abs(dx);
    // core
    let d = Math.hypot(dx, py - 30);
    if (d < 5.5) return ramp(PAL.cyan, 1 - (d / 5.5) * 0.6 + 0.2 * sphereL(dx, py - 30, 5.5), x, y);
    // turrets + barrels
    for (const s of [-1, 1]) {
      const tx = cx + s * 24, ty = 38;
      d = Math.hypot(px - tx, py - ty);
      if (d < 6.5) return ramp(PAL.red, 0.45 + 0.55 * sphereL(px - tx, py - ty, 6.5), x, y);
      if (Math.abs(px - tx) < 1.6 && py > ty && py < ty + 12) return ramp(PAL.metal, Math.abs(px - tx) < 0.6 ? 0.8 : 0.35, x, y);
    }
    // central hull
    const ex = dx / 13, ey = (py - 26) / 26;
    if (ex * ex + ey * ey < 1) {
      const nz = Math.sqrt(1 - ex * ex - ey * ey);
      let l = light(ex, ey * 0.5, nz);
      if (y % 8 === 0) l -= 0.3;
      return ramp(PAL.steel, 0.5 + 0.5 * l, x, y);
    }
    // wings
    if (py > 14 && adx < Math.min(38, 13 + (py - 14) * 1.3) && py < 46 - adx * 0.3) {
      let l = 0.62 - adx / 38 * 0.2 - (py - 14) / 32 * 0.25;
      if (Math.floor(adx) % 9 === 0) l -= 0.18;
      if (py < 16 + (adx - 13) / 1.3) l += 0.25;
      return ramp(PAL.steel, l, x, y);
    }
    // wingtip cannons
    if (adx > 33 && adx < 37 && py > 30 && py < 50) return ramp(PAL.metal, 0.3 + (37 - adx) * 0.12, x, y);
    return null;
  }, '#05060e'));
}

function makeBossTitan() {
  const w = 86, h = 82, cx = 43, cy = 40, R = 38;
  const radii = [];
  for (let i = 0; i < 14; i++) radii.push(R * (0.85 + hash2(i, 7, 1) * 0.15));
  return withFlash(pixelArt(w, h, (x, y) => {
    const px = x + 0.5, py = y + 0.5, dx = px - cx, dy = py - cy;
    // cannons
    for (const s of [-1, 1]) {
      const tx = cx + s * 20, ty = cy + 18;
      const d = Math.hypot(px - tx, py - ty);
      if (d < 3) return ramp(PAL.red, 1 - d / 3 + 0.2, x, y);
      if (d < 6.5) return ramp(PAL.metal, 0.45 + 0.55 * sphereL(px - tx, py - ty, 6.5), x, y);
    }
    // eye/core
    const dc = Math.hypot(dx, dy - 6);
    if (dc < 7) return ramp(PAL.green, 1.05 - dc / 7 * 0.7, x, y);
    if (dc < 9) return ramp(PAL.metal, 0.55 + 0.4 * sphereL(dx, dy - 6, 9), x, y);
    const ang = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1 * 14;
    const i0 = Math.floor(ang), f = ang - i0;
    const rr = radii[i0 % 14] * (1 - f) + radii[(i0 + 1) % 14] * f;
    const d = Math.hypot(dx, dy);
    if (d > rr) return null;
    let l = sphereL(dx, dy, rr + 0.5);
    // metal band
    if (Math.abs(dy - 6) < 5) {
      let m = 0.55 + 0.35 * l - Math.abs(dy - 6) * 0.04;
      if (Math.abs(dy - 6) > 4) m -= 0.3;
      if (Math.floor(px) % 7 === 0 && Math.floor(py) === cy + 4) m += 0.4;
      return ramp(PAL.metal, m, x, y);
    }
    const cr = fbm(x * 0.12, y * 0.12, 11);
    if (cr > 0.62) l = l * 0.4 - 0.2 + (cr - 0.62) * 2;
    l += (hash2(x, y, 4) - 0.5) * 0.22;
    return ramp(PAL.rock, 0.5 + 0.55 * l, x, y);
  }, '#08060c'));
}

function makeBossQueen() {
  const w = 90, h = 66, cx = 45;
  return withFlash(pixelArt(w, h, (x, y) => {
    const px = x + 0.5, py = y + 0.5, dx = px - cx;
    // eye
    const dy = py - 30, de = Math.hypot(dx, dy);
    if (de < 10) {
      if (Math.abs(dx) < 1.6 && Math.abs(dy) < 5.5) return '#100008';
      if (de < 6.5) return ramp(PAL.red, 1 - de / 6.5 * 0.5 + 0.2 * sphereL(dx, dy, 10), x, y);
      return ramp(PAL.gold, 0.55 + 0.5 * sphereL(dx, dy, 10), x, y);
    }
    // pods
    for (const s of [-1, 1]) {
      const tx = cx + s * 30, ty = 38, d = Math.hypot(px - tx, py - ty);
      if (d < 7) return ramp(PAL.green, 0.4 + 0.6 * sphereL(px - tx, py - ty, 7) + (d < 3 ? 0.4 : 0), x, y);
    }
    // mandibles
    for (const s of [-1, 1]) {
      const mx = cx + s * 12, my = 44, d = Math.hypot(px - mx, py - my);
      const a = Math.atan2(py - my, (px - mx) * s);
      if (d > 9 && d < 14 && a > 0.1 && a < 2.4) return ramp(PAL.pink, 0.8 - (d - 9) * 0.1 - a * 0.15, x, y);
    }
    // body
    const ex = dx / 32, ey = (py - 26) / 22;
    if (ex * ex + ey * ey < 1) {
      const nz = Math.sqrt(1 - ex * ex - ey * ey);
      let l = light(ex, ey, nz) + Math.sin(py * 0.9 + Math.abs(dx) * 0.15) * 0.18;
      return ramp(PAL.purple, 0.5 + 0.55 * l, x, y);
    }
    // spikes on top
    const sp = Math.abs(((dx + 64) % 12) - 6);
    if (py < 12 && py > 2 && Math.abs(dx) < 26 && py > 2 + sp * 1.6) return ramp(PAL.pink, 0.4 + (12 - py) * 0.05, x, y);
    return null;
  }, '#0a020e'));
}

// ------------------------------------------------------------
//  Build everything once
// ------------------------------------------------------------
const SPR = {};
function buildSprites() {
  SPR.ship = withFlash(spriteFromRows(SHIP_ROWS, SHIP_PAL, true));
  SPR.shipLife = spriteFromRows(SHIP_ROWS, SHIP_PAL, true);
  for (const k of ['droneG', 'droneR', 'droneB']) SPR[k] = withFlash(spriteFromRows(DRONE_ROWS, ENEMY_PALS[k], true));
  for (const k of ['swoopP', 'swoopC', 'swoopGold']) SPR[k] = withFlash(spriteFromRows(SWOOP_ROWS, ENEMY_PALS[k], true));
  for (const k of ['gunO', 'gunS', 'gunV']) SPR[k] = withFlash(spriteFromRows(GUN_ROWS, ENEMY_PALS[k], true));
  SPR.gold = silhouette(SPR.swoopGold, '#ffffff');

  SPR.rockL = [0, 1].map(s => makeAsteroid(15, 10 + s, PAL.rock));
  SPR.rockM = [0, 1, 2].map(s => makeAsteroid(9, 20 + s, PAL.rock));
  SPR.rockS = [0, 1, 2].map(s => makeAsteroid(5, 30 + s, PAL.rock));
  SPR.rockLB = [0, 1].map(s => makeAsteroid(15, 40 + s, PAL.rockBlue));
  SPR.rockMB = [0, 1, 2].map(s => makeAsteroid(9, 50 + s, PAL.rockBlue));
  SPR.rockSB = [0, 1, 2].map(s => makeAsteroid(5, 60 + s, PAL.rockBlue));

  SPR.boss = [makeBossWarden(), makeBossTitan(), makeBossQueen()];

  SPR.explS = makeExplosion(7, 9, 1);
  SPR.explM = makeExplosion(14, 11, 2);
  SPR.explL = makeExplosion(28, 14, 3);

  // enemy bullets — high contrast
  SPR.ebSmall = makeBullet(2.8, PAL.pink, '#ffffff');
  SPR.ebBig = makeBullet(4.6, PAL.fire.slice(2), '#ffffff');
  SPR.ebBlue = makeBullet(2.8, PAL.cyan, '#ffffff');
  SPR.ebNeedle = pixelArt(5, 9, (x, y) => {
    const dx = Math.abs(x - 2), v = 1 - dx / 2 - Math.abs(y - 4) / 5;
    return (dx <= 1 - (y < 2 || y > 6 ? 1 : 0)) ? ramp(PAL.green, 0.4 + v, x, y) : null;
  }, '#001008');

  // player shots
  SPR.shotV = pixelArt(3, 7, (x, y) => (x === 1 ? (y < 5 ? '#ffffff' : '#ffd23f') : (y > 1 ? '#ff8a1a' : null)));
  SPR.shotL = [3, 5, 7].map(wd => pixelArt(wd, 16, (x, y) => {
    const c = (wd - 1) / 2, dx = Math.abs(x - c);
    if (y === 0 && dx > 0) return null;
    return dx === 0 ? '#ffffff' : dx === 1 ? '#80f0ff' : '#2a80e0';
  }));
  SPR.shotM = pixelArt(5, 8, (x, y) => {
    const dx = Math.abs(x - 2);
    if (y < 2 && dx > 0) return null;
    if (y > 5) return dx === 0 ? '#ffd23f' : null;
    return dx === 0 ? '#ffffff' : dx === 1 ? '#5ee06a' : (y > 3 ? '#1f8a3a' : null);
  });
  SPR.option = [PAL.fire.slice(1), PAL.cyan, PAL.green].map(p => makeSphere(3.5, p, { outline: '#0a0612' }));

  SPR.itemW = [makeItem('V', PAL.red), makeItem('L', PAL.cyan), makeItem('H', PAL.green)];
  SPR.itemO = makeItem('O', PAL.purple);
  SPR.itemS = makeItem('S', PAL.steel);
  SPR.itemB = makeItem('B', PAL.fire.slice(1));
  SPR.item1 = makeItem('1', PAL.pink);
  SPR.gem = pixelArt(7, 7, (x, y) => {
    const d = Math.abs(x - 3) + Math.abs(y - 3);
    if (d > 3) return null;
    return ramp(PAL.gold, 1 - d / 4 + (x < 3 && y < 3 ? 0.2 : -0.1), x, y);
  }, '#2a1a04');
}
