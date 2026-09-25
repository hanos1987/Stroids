'use strict';
// ============================================================
//  STROIDS — main game
// ============================================================
const cv = document.getElementById('screen');
const ctx = cv.getContext('2d', { alpha: false, desynchronized: true });
cv.width = W; cv.height = H;
ctx.imageSmoothingEnabled = false;
buildSprites();

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const rndi = (a, b) => Math.floor(rnd(a, b + 1));
const dist = (a, b, c, d) => Math.hypot(c - a, d - b);

function fitCanvas() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  const sc = s >= 2 ? Math.floor(s) : s;
  cv.style.width = Math.floor(W * sc) + 'px';
  cv.style.height = Math.floor(H * sc) + 'px';
}
addEventListener('resize', fitCanvas);
fitCanvas();

// ------------------------------------------------------------
//  Input (keyboard / gamepad / touch)
// ------------------------------------------------------------
const keys = {}, hitKeys = {};
const KB = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
  focus: ['ShiftLeft', 'ShiftRight', 'KeyZ'], bomb: ['KeyX', 'Space'],
  start: ['Enter', 'Space', 'KeyZ'], pause: ['Escape', 'KeyP', 'Enter'], mute: ['KeyM'],
};
addEventListener('keydown', e => {
  if (!keys[e.code]) hitKeys[e.code] = true;
  keys[e.code] = true;
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  Sound.init();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (G.state === 'play') setPause(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'play') setPause(true); });

const held = a => a.some(c => keys[c]);
const tapped = a => a.some(c => hitKeys[c]);

let padPrev = {};
function readPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const p = pads && pads[0];
  const out = { x: 0, y: 0, focus: false, bomb: false, start: false, pause: false };
  if (!p) return out;
  const b = i => p.buttons[i] && p.buttons[i].pressed;
  const edge = i => { const v = b(i), was = padPrev[i]; padPrev[i] = v; return v && !was; };
  let ax = p.axes[0] || 0, ay = p.axes[1] || 0;
  if (Math.abs(ax) < 0.3) ax = 0;
  if (Math.abs(ay) < 0.3) ay = 0;
  if (b(14)) ax = -1; if (b(15)) ax = 1; if (b(12)) ay = -1; if (b(13)) ay = 1;
  out.x = ax; out.y = ay;
  out.focus = b(2) || b(4) || b(5) || b(6) || b(7);
  out.bomb = edge(0) | edge(1);
  const st = edge(9);
  out.start = st || out.bomb; out.pause = st;
  return out;
}

// Touch: relative drag (ship doesn't sit under your finger) + bomb button
const touch = { on: false, id: null, sx: 0, sy: 0, px: 0, py: 0, cx: 0, cy: 0, bomb: false, tap: false, used: false };
const BOMB_BTN = { x: W - 20, y: H - 36, r: 13 };
function toGame(t) {
  const r = cv.getBoundingClientRect();
  return [(t.clientX - r.left) / r.width * W, (t.clientY - r.top) / r.height * H];
}
cv.addEventListener('touchstart', e => {
  e.preventDefault();
  Sound.init();
  touch.used = true;
  for (const t of e.changedTouches) {
    const [x, y] = toGame(t);
    if (G.state === 'play' && dist(x, y, BOMB_BTN.x, BOMB_BTN.y) < BOMB_BTN.r + 6) { touch.bomb = true; continue; }
    if (G.state === 'play' && x > W - 26 && y < 20) { setPause(true); continue; }
    touch.tap = true;
    if (touch.id === null) {
      touch.id = t.identifier; touch.on = true;
      touch.sx = x; touch.sy = y; touch.cx = x; touch.cy = y;
      touch.px = P ? P.x : 0; touch.py = P ? P.y : 0;
    }
  }
}, { passive: false });
cv.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) if (t.identifier === touch.id) [touch.cx, touch.cy] = toGame(t);
}, { passive: false });
const endTouch = e => {
  for (const t of e.changedTouches) if (t.identifier === touch.id) { touch.id = null; touch.on = false; }
};
cv.addEventListener('touchend', endTouch);
cv.addEventListener('touchcancel', endTouch);
cv.addEventListener('mousedown', () => { Sound.init(); touch.tap = true; });

// ------------------------------------------------------------
//  Game state
// ------------------------------------------------------------
function loadHi() { try { return +localStorage.getItem('stroids_hi') || 30000; } catch (e) { return 30000; } }
function saveHi(v) { try { localStorage.setItem('stroids_hi', v); } catch (e) { /* ignore */ } }

const G = {
  state: 'title', t: 0, stage: 0, loop: 0, stageT: 0, score: 0, hi: loadHi(),
  shake: 0, flash: 0, banner: null, scroll: 0, pscroll: 0, warn: 0, sched: [], waveIdx: 0, nextWave: 0,
  kills: 0, nextExtend: 50000, livesFlash: 0, clearT: 0, overT: 0, paused: false, bg: null,
};
let P = null, shots = [], ebs = [], enemies = [], items = [], fx = [], boss = null;

const diff = () => G.stage + G.loop * 3;
const bspd = () => 1 + 0.07 * diff();
const rateF = () => 1 / (1 + 0.1 * diff());

function later(frames, fn) { G.sched.push({ t: G.stageT + frames, fn }); }

function addScore(v) {
  G.score += v;
  if (G.score >= G.nextExtend) {
    G.nextExtend += G.nextExtend < 100000 ? 100000 : 150000;
    P.lives++;
    Sound.sfx.oneup();
    popText(P.x, P.y - 16, '1UP!', '#ff9ad0');
  }
  if (G.score > G.hi) G.hi = G.score;
}

function popText(x, y, str, col = '#ffffff', life = 50) { fx.push({ type: 'text', x, y, str, col, life, max: life }); }

// ------------------------------------------------------------
//  Backgrounds (dithered gradient sky, nebula, planet, starfield)
// ------------------------------------------------------------
const THEMES = [
  { sky: ['#01010a', '#040820', '#0a1436', '#12204c', '#1a2c60'], neb: PAL.purple, nebA: 0.55,
    planet: { r: 44, pal: PAL.steel, bands: 7, x: 170 }, star: ['#8090c0', '#c0d0ff', '#ffffff'] },
  { sky: ['#040203', '#0e0708', '#1a0e10', '#261418', '#321c1c'], neb: PAL.fire.slice(0, 4), nebA: 0.35,
    planet: { r: 30, pal: PAL.red, noise: 0.8, x: 50 }, star: ['#907060', '#e0c0a0', '#ffffff'], dust: true },
  { sky: ['#040006', '#0e0216', '#1c0426', '#2c0834', '#3c0c3c'], neb: PAL.pink, nebA: 0.5,
    planet: { r: 38, pal: PAL.green, noise: 1.2, x: 60 }, star: ['#a06090', '#ffb0e0', '#ffffff'] },
];

function makeBG(i) {
  const th = THEMES[i];
  const sky = pixelArt(W, H, (x, y) => ramp(th.sky, y / H + (hash2(x, y, 9) - 0.5) * 0.04, x, y));
  const neb = pixelArt(W, H, (x, y) => {
    const f = y / H;
    const n = fbm(x * 0.018, y * 0.018, 21 + i) * (1 - f) + fbm(x * 0.018, (y - H) * 0.018, 21 + i) * f;
    const v = (n - 0.45) * 2.4;
    if (v < bayer(x, y) * 0.5) return null;
    return ramp(th.neb, v * 0.7, x, y);
  });
  const planet = makeSphere(th.planet.r, th.planet.pal, { bands: th.planet.bands, noise: th.planet.noise, seed: i + 3 });
  const stars = [];
  for (let l = 0; l < 3; l++) {
    const n = [45, 25, 10][l];
    for (let k = 0; k < n; k++) stars.push({ x: rnd(0, W), y: rnd(0, H), l, tw: rnd(0, TAU) });
  }
  const dust = [];
  if (th.dust) for (let k = 0; k < 14; k++) dust.push({ x: rnd(0, W), y: rnd(0, H), s: rndi(0, 2), sp: rnd(0.25, 0.5) });
  const dustSpr = SPR.rockS.map(r => silhouette(r, '#3a2024'));
  return { th, sky, neb, planet, stars, dust, dustSpr };
}
const BGS = [0, 1, 2].map(makeBG);

const STAR_SPEED = [0.25, 0.6, 1.4];
const starRate = () => (G.state === 'play' || G.state === 'title' ? 1 : 0.3);

// Background motion runs on the fixed 60 Hz game clock, not per screen refresh
function updateBG() {
  const bg = G.bg;
  if (!bg) return;
  const k = starRate();
  for (const s of bg.stars) {
    s.y += STAR_SPEED[s.l] * k;
    if (s.y > H) { s.y -= H; s.x = rnd(0, W); }
  }
  for (const d of bg.dust) {
    d.y += d.sp;
    if (d.y > H + 12) { d.y = -12; d.x = rnd(0, W); }
  }
}

function drawBG(g) {
  const bg = G.bg;
  const scroll = G.pscroll + (G.scroll - G.pscroll) * alpha;
  g.drawImage(bg.sky, 0, 0);
  // planet (very slow parallax)
  const pr = bg.th.planet.r, span = H + pr * 4;
  const py = ((scroll * 0.06) % span) - pr * 2;
  g.globalAlpha = 0.6;
  g.drawImage(bg.planet, Math.round(bg.th.planet.x - pr), Math.round(py - pr));
  g.globalAlpha = 1;
  // nebula
  g.globalAlpha = bg.th.nebA;
  const ny = Math.floor((scroll * 0.25) % H);
  g.drawImage(bg.neb, 0, ny);
  g.drawImage(bg.neb, 0, ny - H);
  g.globalAlpha = 1;
  // stars
  const k = starRate() * alpha;
  for (const s of bg.stars) {
    const tw = s.l === 0 ? (Math.sin(G.t * 0.05 + s.tw) > 0.6 ? 2 : 0) : s.l;
    g.fillStyle = bg.th.star[tw];
    g.fillRect(Math.floor(s.x), Math.floor(s.y + STAR_SPEED[s.l] * k), 1, s.l === 2 ? 3 : 1);
  }
  // distant drifting rocks (belt stage)
  for (const d of bg.dust) g.drawImage(bg.dustSpr[d.s], Math.floor(d.x), Math.floor(d.y + d.sp * alpha));
}

// ------------------------------------------------------------
//  Player
// ------------------------------------------------------------
const WEAPON_NAMES = ['VULCAN', 'LASER', 'HOMING'];
const WEAPON_COLS = ['#ff8a1a', '#60f0ff', '#5ee06a'];

function newPlayer() {
  return { x: W / 2, y: H - 40, lives: 3, bombs: 3, power: 1, weapon: 0, options: 0, shield: false,
    inv: 120, dead: 0, fireT: 0, misT: 0, trail: [], bombT: 0, focus: false, hr: 1.5, vx: 0 };
}

function resetTrail() {
  P.trail = [];
  for (let i = 0; i < 40; i++) P.trail.push([P.x, P.y]);
}

function optionPos(i) {
  const tr = P.trail, k = Math.max(0, tr.length - 1 - (i + 1) * 12);
  if (P.focus) return [P.x + (i ? 12 : -12), P.y + 2];
  return tr[k] || [P.x, P.y];
}

function updatePlayer(pad) {
  const p = P;
  if (p.dead > 0) {
    p.dead--;
    if (p.dead === 0) {
      if (p.lives <= 0) { gameOver(); return; }
      p.x = p.px = W / 2; p.y = p.py = H - 30; p.inv = 150; p.bombs = Math.max(p.bombs, 2);
      popText(p.x, p.y - 20, p.lives === 1 ? 'LAST LIFE!' : p.lives + ' LIVES LEFT', p.lives === 1 ? '#ff5050' : '#ffffff', 90);
      resetTrail();
      touch.sx = touch.cx; touch.sy = touch.cy; touch.px = p.x; touch.py = p.y;
    }
    return;
  }
  let ix = 0, iy = 0;
  if (held(KB.left)) ix -= 1;
  if (held(KB.right)) ix += 1;
  if (held(KB.up)) iy -= 1;
  if (held(KB.down)) iy += 1;
  if (pad.x || pad.y) { ix = pad.x; iy = pad.y; }
  const m = Math.hypot(ix, iy);
  if (m > 1) { ix /= m; iy /= m; }
  p.focus = held(KB.focus) || pad.focus;
  const spd = p.focus ? 1.15 : 2.35;
  const ox = p.x, oy = p.y;
  if (touch.on) {
    p.x = touch.px + (touch.cx - touch.sx) * 1.5;
    p.y = touch.py + (touch.cy - touch.sy) * 1.5;
  } else {
    p.x += ix * spd; p.y += iy * spd;
  }
  p.x = clamp(p.x, 7, W - 7);
  p.y = clamp(p.y, 12, H - 12);
  if (touch.on && (p.x !== ox || p.y !== oy)) {
    // re-anchor so clamping at the edges doesn't build up "dead" finger travel
    touch.px = p.x; touch.py = p.y; touch.sx = touch.cx; touch.sy = touch.cy;
  }
  p.vx = p.x - ox;
  if (p.x !== ox || p.y !== oy) { p.trail.push([p.x, p.y]); if (p.trail.length > 40) p.trail.shift(); }

  if (tapped(KB.bomb) || pad.bomb || touch.bomb) useBomb();
  touch.bomb = false;

  if (p.inv > 0) p.inv--;
  if (--p.fireT <= 0) playerFire();
  if (p.bombT > 0) {
    p.bombT--;
    ebs.length = 0;
    if (p.bombT % 4 === 0) {
      for (const e of enemies) if (e.y > -8) damageEnemy(e, 3);
      if (boss && !boss.enter && !boss.dying) damageBoss(2.5);
    }
  }
}

function shot(x, y, ang, spd, sprite, dmg, r, extra) {
  shots.push(Object.assign({ x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, spr: sprite, dmg, r, ang, spd }, extra || {}));
}

const VULCAN = [
  [[-3, 0], [3, 0]],
  [[-3, 0], [3, 0], [-2, -0.12], [2, 0.12]],
  [[-3, 0], [3, 0], [-2, -0.1], [2, 0.1], [-1, -0.22], [1, 0.22]],
  [[-4, 0], [0, 0], [4, 0], [-2, -0.1], [2, 0.1], [-1, -0.22], [1, 0.22]],
  [[-4, 0], [0, 0], [4, 0], [-2, -0.1], [2, 0.1], [-1, -0.2], [1, 0.2], [-1, -0.32], [1, 0.32]],
];

function playerFire() {
  const p = P, pw = p.power, up = -Math.PI / 2;
  if (p.weapon === 0) {
    p.fireT = pw >= 4 ? 4 : 5;
    const mul = p.focus ? 0.3 : 1;
    for (const [dx, a] of VULCAN[pw - 1]) shot(p.x + dx, p.y - 8, up + a * mul, 7, SPR.shotV, 1, 3);
    Sound.sfx.shoot();
  } else if (p.weapon === 1) {
    p.fireT = pw >= 4 ? 3 : 4;
    const wi = pw <= 1 ? 0 : pw <= 3 ? 1 : 2;
    shot(p.x, p.y - 12, up, 11, SPR.shotL[wi], [1.4, 1.8, 2.2, 2.6, 3][pw - 1], [2, 3, 3, 4, 4][pw - 1], { pierce: true, hit: new Set() });
    Sound.sfx.laser();
  } else {
    p.fireT = 6;
    shot(p.x - 3, p.y - 8, up, 7, SPR.shotV, 1, 3);
    shot(p.x + 3, p.y - 8, up, 7, SPR.shotV, 1, 3);
    Sound.sfx.shoot();
    if (--p.misT <= 0) {
      p.misT = 4;
      const n = [1, 2, 2, 3, 4][pw - 1];
      for (let i = 0; i < n; i++) {
        const s = i % 2 ? 1 : -1, a = up + s * (0.5 + (i >> 1) * 0.4);
        shot(p.x + s * 5, p.y, a, 4, SPR.shotM, 2.5, 3, { homing: true });
      }
      if (n) Sound.sfx.missile();
    }
  }
  // options
  for (let i = 0; i < p.options; i++) {
    const [ox, oy] = optionPos(i);
    if (p.weapon === 1) shot(ox, oy - 8, up, 11, SPR.shotL[0], 1, 2, { pierce: true, hit: new Set() });
    else if (p.weapon === 2 && p.misT === 4) shot(ox, oy - 4, up, 4, SPR.shotM, 2, 3, { homing: true });
    else shot(ox, oy - 4, up, 7, SPR.shotV, 1, 3);
  }
}

function useBomb() {
  if (P.bombs <= 0 || P.dead || P.bombT > 0) return;
  P.bombs--;
  P.bombT = 70;
  P.inv = Math.max(P.inv, 110);
  for (const b of ebs) fx.push({ type: 'spark', x: b.x, y: b.y, vx: 0, vy: -0.5, life: 20, col: '#ffe070' });
  ebs.length = 0;
  G.flash = 10; G.shake = 18;
  fx.push({ type: 'ring', x: P.x, y: P.y, r: 4, vr: 6, life: 40, col: '#ffffff' });
  fx.push({ type: 'ring', x: P.x, y: P.y, r: 2, vr: 4, life: 40, col: '#ffd23f' });
  Sound.sfx.bomb();
}

function hurtPlayer() {
  if (P.dead || P.inv > 0) return;
  if (P.shield) {
    P.shield = false; P.inv = 90; G.shake = 8;
    for (const b of ebs) if (dist(b.x, b.y, P.x, P.y) < 40) b.dead = true;
    fx.push({ type: 'ring', x: P.x, y: P.y, r: 8, vr: 3, life: 20, col: '#80f0ff' });
    Sound.sfx.shieldBreak();
    return;
  }
  explode(P.x, P.y, 'l');
  Sound.sfx.die();
  G.shake = 20; G.flash = 6;
  P.lives--;
  G.livesFlash = 120;
  P.dead = 80;
  P.power = Math.max(1, P.power - 1);
  P.options = Math.max(0, P.options - 1);
  dropItem('W', P.x, P.y - 20);
  ebs.length = 0;
}

// ------------------------------------------------------------
//  Enemies
// ------------------------------------------------------------
const ETYPE = {
  drone:   { spr: 'droneG', hp: 2, r: 6, score: 100 },
  droneR:  { spr: 'droneR', hp: 3, r: 6, score: 150, shoot: { every: 110, first: 30, kind: 'aim' } },
  droneB:  { spr: 'droneB', hp: 2, r: 6, score: 120 },
  swoop:   { spr: 'swoopP', hp: 4, r: 7, score: 200 },
  swoopC:  { spr: 'swoopC', hp: 5, r: 7, score: 250, shoot: { every: 120, first: 50, kind: 'aim' } },
  carrier: { spr: 'swoopGold', hp: 12, r: 8, score: 500, carrier: true },
  gun:     { spr: 'gunO', hp: 18, r: 9, score: 600, shoot: { every: 75, first: 40, kind: 'spread3' } },
  gunS:    { spr: 'gunS', hp: 34, r: 10, score: 1000, shoot: { every: 60, first: 30, kind: 'ring' } },
  gunV:    { spr: 'gunV', hp: 24, r: 9, score: 800, shoot: { every: 55, first: 30, kind: 'spread5' } },
  rockL:   { hp: 26, r: 13, score: 300, rock: 3 },
  rockM:   { hp: 8, r: 8, score: 120, rock: 2 },
  rockS:   { hp: 2, r: 4, score: 50, rock: 1 },
};

function spawn(type, x, y, o = {}) {
  const d = ETYPE[type];
  let spr;
  if (d.rock) {
    const arr = SPR[['', 'rockS', 'rockM', 'rockL'][d.rock] + (G.stage === 1 ? 'B' : '')];
    spr = arr[rndi(0, arr.length - 1)];
  } else spr = SPR[d.spr];
  const hp = d.hp * (1 + 0.2 * G.loop);
  const e = Object.assign({ type, d, x, y, vx: 0, vy: 1, hp, r: d.r, spr, flash: 0, t: 0, beh: 'straight',
    shootT: d.shoot ? d.shoot.first + rndi(0, 30) : 0 }, o);
  if (e.beh === 'sine' && e.x0 === undefined) e.x0 = x;
  enemies.push(e);
  return e;
}

function moveEnemy(e) {
  e.t++;
  switch (e.beh) {
    case 'straight': e.x += e.vx; e.y += e.vy; break;
    case 'sine': e.y += e.vy; e.x = e.x0 + Math.sin(e.t * e.freq) * e.amp; break;
    case 'curve':
      if (e.t > (e.turnStart || 0) && e.t < (e.turnEnd || 1e9)) e.ang += e.turn;
      e.x += Math.cos(e.ang) * e.spd; e.y += Math.sin(e.ang) * e.spd;
      break;
    case 'stop':
      if (e.t < e.hold) e.y += (e.ty - e.y) * 0.05;
      else e.y -= 0.9;
      break;
    case 'chase':
      e.y += e.vy;
      if (e.y < P.y - 30) e.vx = clamp(e.vx + Math.sign(P.x - e.x) * 0.04, -1.3, 1.3);
      e.x += e.vx;
      break;
  }
  if (e.flash > 0) e.flash--;
  if (e.y > H + 24 || e.y < -90 || e.x < -40 || e.x > W + 40) e.gone = true;

  const s = e.d.shoot;
  if (s && !P.dead && e.y > 10 && e.y < P.y - 50 && e.x > 4 && e.x < W - 4) {
    if (--e.shootT <= 0) {
      e.shootT = Math.round(s.every * rateF());
      enemyFire(e.x, e.y + 4, s.kind);
    }
  }
}

function fireAt(x, y, a, spd, spr = 'ebSmall') {
  const s = SPR[spr];
  ebs.push({ x, y, vx: Math.cos(a) * spd * bspd(), vy: Math.sin(a) * spd * bspd(), spr: s,
    r: spr === 'ebBig' ? 3.2 : 1.8 });
}
const aim = (x, y) => Math.atan2(P.y - y, P.x - x);
function spread(x, y, a, n, step, spd, spr) {
  for (let i = 0; i < n; i++) fireAt(x, y, a + (i - (n - 1) / 2) * step, spd, spr);
}
function ring(x, y, n, spd, off = 0, spr) {
  for (let i = 0; i < n; i++) fireAt(x, y, off + i * TAU / n, spd, spr);
}

function enemyFire(x, y, kind) {
  const a = aim(x, y);
  if (kind === 'aim') fireAt(x, y, a, 1.8);
  else if (kind === 'spread3') spread(x, y, a, 3, 0.25, 1.8);
  else if (kind === 'spread5') spread(x, y, a, 5, 0.18, 1.7, 'ebBlue');
  else if (kind === 'ring') ring(x, y, 10, 1.3, rnd(0, 1), 'ebBig');
}

function damageEnemy(e, dmg) {
  if (e.dead) return;
  e.hp -= dmg;
  e.flash = 2;
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  e.dead = true;
  G.kills++;
  addScore(e.d.score * (G.loop + 1));
  const big = e.r >= 9;
  explode(e.x, e.y, e.d.rock === 3 || big ? 'm' : 's');
  if (big) { G.shake = Math.max(G.shake, 5); Sound.sfx.explodeL(); } else Sound.sfx.explodeS();
  if (e.d.carrier) dropItem('W', e.x, e.y);
  else if (e.d.rock === 3) {
    for (let i = 0; i < 3; i++) spawn('rockM', e.x, e.y, { vx: Math.cos(i * 2.1 + 0.4) * 0.9, vy: 0.6 + Math.sin(i * 2.1 + 0.4) * 0.6 });
    for (let i = 0; i < 3; i++) dropItem('G', e.x, e.y);
  } else if (e.d.rock === 2) {
    for (let i = 0; i < 2; i++) spawn('rockS', e.x, e.y, { vx: i ? 0.9 : -0.9, vy: e.vy * 0.8 + 0.4 });
    if (Math.random() < 0.5) dropItem('G', e.x, e.y);
  } else if (big) {
    const r = Math.random();
    if (r < 0.16) dropItem('O', e.x, e.y);
    else if (r < 0.3) dropItem('S', e.x, e.y);
    else if (r < 0.4) dropItem('B', e.x, e.y);
    else dropItem('G', e.x, e.y);
    if (big) popText(e.x, e.y - 8, String(e.d.score * (G.loop + 1)), '#ffe070', 40);
  }
  // Every 30 kills, guarantee a power drop — keeps the upgrade drip steady
  if (G.kills % 30 === 0 && !e.d.carrier) dropItem('W', e.x, e.y);
  if (G.kills % 120 === 0) dropItem('1', e.x, e.y);
}

// ------------------------------------------------------------
//  Items
// ------------------------------------------------------------
function dropItem(kind, x, y) {
  items.push({ kind, x, y, vx: rnd(-0.6, 0.6), vy: kind === 'G' ? rnd(-2, -0.5) : -1.6, t: 0, w: rndi(0, 2) });
}

function updateItems() {
  for (const it of items) {
    it.t++;
    if (it.kind === 'W' && it.t % 150 === 0) it.w = (it.w + 1) % 3;
    it.vy = Math.min(it.vy + 0.05, it.kind === 'G' ? 1.2 : 0.7);
    let magnet = false;
    if (!P.dead) {
      const d = dist(it.x, it.y, P.x, P.y);
      magnet = d < (it.kind === 'G' ? 60 : 30) || P.y < H * 0.3;
      if (magnet) {
        const a = Math.atan2(P.y - it.y, P.x - it.x);
        it.x += Math.cos(a) * 4; it.y += Math.sin(a) * 4;
      }
      if (d < 12) { collect(it); it.dead = true; continue; }
    }
    if (!magnet) {
      it.x += it.vx; it.y += it.vy;
      if (it.x < 7 || it.x > W - 7) it.vx *= -1;
    }
    if (it.y > H + 10) it.dead = true;
  }
}

function collect(it) {
  const p = P;
  switch (it.kind) {
    case 'W':
      if (p.weapon === it.w && p.power >= 5) { addScore(5000); popText(p.x, p.y - 14, 'MAX 5000', '#ffe070'); }
      else {
        const swap = p.weapon !== it.w;
        p.weapon = it.w;
        p.power = Math.min(5, p.power + 1);
        popText(p.x, p.y - 14, swap ? WEAPON_NAMES[it.w] + '!' : 'POWER UP', WEAPON_COLS[it.w]);
      }
      Sound.sfx.power();
      break;
    case 'O':
      if (p.options < 2) { p.options++; popText(p.x, p.y - 14, 'OPTION', '#e8c0ff'); resetTrail(); }
      else { addScore(3000); popText(p.x, p.y - 14, '3000', '#ffe070'); }
      Sound.sfx.power();
      break;
    case 'S':
      if (!p.shield) { p.shield = true; popText(p.x, p.y - 14, 'SHIELD', '#80f0ff'); Sound.sfx.shield(); }
      else { addScore(2000); popText(p.x, p.y - 14, '2000', '#ffe070'); Sound.sfx.gem(); }
      break;
    case 'B':
      p.bombs = Math.min(6, p.bombs + 1);
      popText(p.x, p.y - 14, 'BOMB', '#ffb080'); Sound.sfx.power();
      break;
    case '1':
      p.lives++; popText(p.x, p.y - 14, '1UP!', '#ff9ad0'); Sound.sfx.oneup();
      break;
    case 'G':
      addScore(100 * (G.loop + 1)); Sound.sfx.gem();
      break;
  }
}

// ------------------------------------------------------------
//  Waves & stages
// ------------------------------------------------------------
function snake(x0) {
  for (let i = 0; i < 7; i++) later(i * 12, () => spawn('drone', x0, -10, { beh: 'sine', x0, amp: 45, freq: 0.035, vy: 1.3 }));
}
function swoop(side) {
  const type = G.stage === 0 ? 'swoop' : 'swoopC';
  for (let i = 0; i < 5; i++) later(i * 14, () => spawn(type, side < 0 ? -12 : W + 12, 30, {
    beh: 'curve', ang: side < 0 ? 0.35 : Math.PI - 0.35, spd: 2, turn: side < 0 ? 0.018 : -0.018, turnStart: 20, turnEnd: 110 }));
}
const WAVES = {
  vDrones: [110, () => {
    const cx = rnd(50, W - 50), t = G.stage === 2 ? 'droneB' : 'drone';
    for (let i = -2; i <= 2; i++) later(Math.abs(i) * 8, () => spawn(t, cx + i * 16, -10, { vy: 1.5 }));
  }],
  snakeL: [140, () => snake(W * 0.3)],
  snakeR: [140, () => snake(W * 0.7)],
  swoopL: [150, () => swoop(-1)],
  swoopR: [150, () => swoop(1)],
  swoopBoth: [190, () => { swoop(-1); later(30, () => swoop(1)); }],
  rocks: [120, () => {
    const n = G.stage === 1 ? 7 : 4;
    for (let i = 0; i < n; i++) later(i * 18, () => spawn(Math.random() < 0.35 ? 'rockM' : 'rockS', rnd(16, W - 16), -14,
      { vy: rnd(0.7, 1.4), vx: rnd(-0.4, 0.4) }));
  }],
  bigRock: [150, () => spawn('rockL', rnd(40, W - 40), -20, { vy: 0.55, vx: rnd(-0.2, 0.2) })],
  gunPair: [220, () => { for (const s of [0.28, 0.72]) spawn('gun', W * s, -16, { beh: 'stop', ty: rnd(50, 80), hold: 220 }); }],
  cruiser: [220, () => spawn('gunS', W / 2, -16, { beh: 'stop', ty: 70, hold: 280 })],
  gunV: [230, () => { [0.2, 0.5, 0.8].forEach((s, i) => later(i * 30, () => spawn('gunV', W * s, -16, { beh: 'stop', ty: 40 + i * 14, hold: 200 }))); }],
  turretLine: [250, () => { [0.2, 0.5, 0.8].forEach(s => spawn('gun', W * s, -16, { beh: 'stop', ty: 50, hold: 200 })); }],
  carrier: [90, () => {
    const s = Math.random() < 0.5 ? -1 : 1;
    spawn('carrier', s < 0 ? -12 : W + 12, rnd(40, 70), { beh: 'curve', ang: s < 0 ? 0.05 : Math.PI - 0.05, spd: 1.2, turn: 0 });
  }],
  redSweep: [130, () => { for (let i = 0; i < 6; i++) later(i * 12, () => spawn('droneR', 20 + i * 37, -10, { beh: 'chase', vy: 1.3 })); }],
  swarm: [160, () => {
    for (let i = 0; i < 10; i++) later(i * 8, () => {
      const x = rnd(20, W - 20);
      spawn('droneB', x, -10, { beh: 'sine', x0: x, amp: rnd(10, 30), freq: 0.05, vy: 1.8 });
    });
  }],
};

const STAGES = [
  { name: 'OUTER RIM', len: 60 * 70, song: 'stage0',
    waves: ['vDrones', 'snakeL', 'swoopL', 'rocks', 'carrier', 'vDrones', 'swoopR', 'gunPair', 'snakeR', 'rocks',
            'carrier', 'redSweep', 'gunPair', 'swoopBoth', 'vDrones', 'carrier', 'cruiser', 'snakeL', 'rocks'] },
  { name: 'STROID BELT', len: 60 * 75, song: 'stage1',
    waves: ['rocks', 'bigRock', 'swoopL', 'carrier', 'gunPair', 'rocks', 'redSweep', 'bigRock', 'cruiser', 'carrier',
            'swoopBoth', 'rocks', 'turretLine', 'bigRock', 'carrier', 'vDrones', 'rocks', 'gunPair', 'bigRock'] },
  { name: 'HIVE CORE', len: 60 * 80, song: 'stage2',
    waves: ['swarm', 'swoopBoth', 'carrier', 'gunV', 'redSweep', 'swarm', 'turretLine', 'carrier', 'snakeL', 'snakeR',
            'gunV', 'swarm', 'carrier', 'cruiser', 'swoopBoth', 'gunV', 'redSweep', 'swarm'] },
];

function startStage() {
  G.stageT = 0; G.sched = []; G.waveIdx = 0; G.nextWave = 150; G.warn = 0; G.clearT = 0;
  G.bg = BGS[G.stage];
  boss = null;
  const st = STAGES[G.stage];
  G.banner = { title: 'STAGE ' + (G.stage + 1 + G.loop * 3), sub: st.name, t: 180 };
  Sound.playSong(st.song);
}

function updateStage() {
  G.stageT++;
  for (let i = G.sched.length - 1; i >= 0; i--) {
    if (G.stageT >= G.sched[i].t) { const s = G.sched[i]; G.sched.splice(i, 1); s.fn(); }
  }
  const st = STAGES[G.stage];
  if (G.stageT < st.len) {
    if (G.stageT >= G.nextWave) {
      const w = WAVES[st.waves[G.waveIdx % st.waves.length]];
      G.waveIdx++;
      w[1]();
      G.nextWave = G.stageT + Math.round(w[0] * Math.max(0.55, 1 - 0.06 * diff()));
    }
    // extra ambient rocks in the belt
    if (G.stage === 1 && G.stageT % 70 === 0) spawn('rockS', rnd(10, W - 10), -8, { vy: rnd(1, 1.8), vx: rnd(-0.3, 0.3) });
  } else if (!boss && !G.warn && !G.clearT && (enemies.length === 0 || G.stageT > st.len + 360)) {
    G.warn = 200;
    Sound.stopMusic();
    Sound.sfx.warning();
  }
  if (G.warn > 0 && --G.warn === 0) spawnBoss();
  if (G.clearT > 0 && --G.clearT === 0) {
    G.stage++;
    if (G.stage >= STAGES.length) { G.stage = 0; G.loop++; }
    startStage();
    if (G.stage === 0) G.banner.sub = 'LOOP ' + (G.loop + 1) + ' - HARDER!';
  }
}

// ------------------------------------------------------------
//  Bosses
// ------------------------------------------------------------
const BOSSES = [
  { name: 'WARDEN', hp: 600, hit: [[0, -2, 16], [-24, 9, 9], [24, 9, 9], [-31, 5, 8], [31, 5, 8]], y: 62 },
  { name: 'STROID TITAN', hp: 800, hit: [[0, 0, 33]], y: 66 },
  { name: 'HIVE QUEEN', hp: 1000, hit: [[0, -6, 28], [-30, 5, 8], [30, 5, 8]], y: 58 },
];

function spawnBoss() {
  const d = BOSSES[G.stage];
  const hp = d.hp * (1 + 0.4 * G.loop);
  boss = { d, idx: G.stage, x: W / 2, y: -60, hp, maxhp: hp, t: 0, phase: 0, enter: true, flash: 0, spr: SPR.boss[G.stage], cool: 0, dying: 0 };
  Sound.playSong('boss');
}

function damageBoss(dmg) {
  const b = boss;
  if (!b || b.enter || b.dying) return;
  b.hp -= dmg;
  b.flash = 2;
  if (b.hp <= 0) {
    b.dying = 200;
    ebs.length = 0;
    for (const e of enemies) if (!e.dead) killEnemy(e);
    addScore(20000 * (b.idx + 1) * (G.loop + 1));
    Sound.stopMusic();
  }
}

function bossHit(x, y, r) {
  const b = boss;
  for (const [dx, dy, hr] of b.d.hit) if (dist(x, y, b.x + dx, b.y + dy) < hr + r) return true;
  return false;
}

function updateBoss() {
  const b = boss;
  b.t++;
  if (b.flash > 0) b.flash--;
  if (b.enter) {
    b.y += (b.d.y - b.y) * 0.025;
    if (b.t > 160) { b.enter = false; b.t = 0; }
    return;
  }
  if (b.dying) {
    b.dying--;
    G.shake = Math.max(G.shake, 4);
    if (b.dying % 6 === 0) {
      explode(b.x + rnd(-30, 30), b.y + rnd(-22, 22), Math.random() < 0.3 ? 'm' : 's');
      Sound.sfx.explodeS();
    }
    if (b.dying === 0) {
      explode(b.x, b.y, 'l');
      explode(b.x - 20, b.y + 8, 'm'); explode(b.x + 20, b.y - 8, 'm');
      G.flash = 16; G.shake = 30;
      Sound.sfx.explodeL();
      dropItem('W', b.x, b.y); dropItem('O', b.x - 16, b.y); dropItem('B', b.x + 16, b.y);
      for (let i = 0; i < 12; i++) dropItem('G', b.x + rnd(-30, 30), b.y + rnd(-20, 20));
      boss = null;
      G.clearT = 300;
      G.banner = { title: 'STAGE CLEAR!', sub: 'BOSS BONUS ' + 20000 * (b.idx + 1) * (G.loop + 1), t: 240 };
    }
    return;
  }
  const f = b.hp / b.maxhp, ph = f > 0.66 ? 0 : f > 0.33 ? 1 : 2;
  if (ph !== b.phase) {
    b.phase = ph; b.cool = 70;
    explode(b.x + rnd(-20, 20), b.y + rnd(-10, 10), 'm');
    G.shake = 10;
    Sound.sfx.explodeL();
  }
  if (b.cool > 0) { b.cool--; return; }
  if (P.dead) return; // hold fire while the player respawns
  const t = b.t;
  if (b.idx === 0) patternWarden(b, ph, t);
  else if (b.idx === 1) patternTitan(b, ph, t);
  else patternQueen(b, ph, t);
}

// Boss patterns are tuned to leave clear gaps: few streams at once, and
// every pattern has a lane you can find by moving a little.
function patternWarden(b, ph, t) {
  b.x = W / 2 + Math.sin(t * 0.012) * 50;
  const tur = s => [b.x + s * 24, b.y + 21];
  if (ph === 0) {
    if (t % 90 === 0) for (const s of [-1, 1]) { const [x, y] = tur(s); spread(x, y, aim(x, y), 3, 0.3, 1.7); }
    if (t % 180 === 90) ring(b.x, b.y + 2, 10, 1.2, t * 0.1, 'ebBig');
  } else if (ph === 1) {
    if (t % 80 === 0) for (const s of [-1, 1]) { const [x, y] = tur(s); spread(x, y, aim(x, y), 3, 0.25, 1.9); }
    if (t % 160 === 40) for (const s of [-1, 1]) spread(b.x + s * 35, b.y + 22, Math.PI / 2 + s * 0.3, 3, 0.2, 1.4, 'ebBlue');
    if (t % 160 === 120) ring(b.x, b.y + 2, 12, 1.2, t * 0.05, 'ebBig');
  } else {
    if (t % 10 === 0) { const a = t * 0.07; fireAt(b.x, b.y + 2, a, 1.4); fireAt(b.x, b.y + 2, a + Math.PI, 1.4); }
    if (t % 110 === 0) { const [x, y] = tur(t % 220 ? 1 : -1); fireAt(x, y, aim(x, y), 2, 'ebBlue'); }
  }
}

function patternTitan(b, ph, t) {
  b.x = W / 2 + Math.sin(t * 0.008) * 40;
  b.y = b.d.y + Math.sin(t * 0.02) * 6;
  const can = s => [b.x + s * 20, b.y + 18], eye = [b.x, b.y + 6];
  const throwRock = s => { const [x, y] = can(s); spawn('rockM', x, y, { vx: s * 0.5, vy: 1.2 }); };
  if (ph === 0) {
    if (t % 160 === 0) throwRock(t % 320 ? 1 : -1);
    if (t % 80 === 40) spread(eye[0], eye[1], aim(eye[0], eye[1]), 3, 0.28, 1.7);
  } else if (ph === 1) {
    if (t % 80 === 0) ring(eye[0], eye[1], 10, 1.1, t * 0.03, 'ebBig');
    if (t % 120 === 60) {
      const a = aim(eye[0], eye[1]);
      for (let i = 0; i < 3; i++) later(i * 6, () => boss && fireAt(boss.x, boss.y + 6, a, 2.4, 'ebNeedle'));
    }
    if (t % 200 === 100) throwRock(Math.random() < 0.5 ? -1 : 1);
  } else {
    if (t % 18 === 0) ring(eye[0], eye[1], 5, 1.3, t * 0.035);
    if (t % 180 === 0) throwRock(t % 360 ? 1 : -1);
    if (t % 120 === 60) { const [x, y] = can(t % 240 ? 1 : -1); spread(x, y, aim(x, y), 3, 0.25, 2, 'ebNeedle'); }
  }
}

function patternQueen(b, ph, t) {
  b.x = W / 2 + Math.sin(t * 0.01) * 44;
  b.y = b.d.y + Math.sin(t * 0.017) * 8;
  const eye = [b.x, b.y - 3], pod = s => [b.x + s * 30, b.y + 5];
  if (ph === 0) {
    if (t % 14 === 0) {
      const a = Math.PI / 2 + Math.sin(t * 0.025) * 1.0;
      fireAt(eye[0], eye[1], a - 0.4, 1.5); fireAt(eye[0], eye[1], a + 0.4, 1.5);
    }
    if (t % 260 === 130) for (const s of [-1, 1]) { const [x, y] = pod(s); spawn('droneB', x, y, { beh: 'chase', vy: 1.1 }); }
  } else if (ph === 1) {
    if (t % 80 === 0) ring(eye[0], eye[1], 12, 1.1, (t / 80) % 2 ? 0.26 : 0, 'ebBig');
    if (t % 80 === 40) { const s = (t / 80) % 2 ? 1 : -1, [x, y] = pod(s); spread(x, y, aim(x, y), 3, 0.28, 1.8, 'ebBlue'); }
  } else {
    if (t % 11 === 0) {
      fireAt(eye[0], eye[1], t * 0.06, 1.4);
      fireAt(eye[0], eye[1], -t * 0.06 + Math.PI, 1.4, 'ebBlue');
    }
    if (t % 150 === 0) spread(eye[0], eye[1], aim(eye[0], eye[1]), 3, 0.3, 1.8, 'ebBig');
  }
}

// ------------------------------------------------------------
//  FX
// ------------------------------------------------------------
function explode(x, y, size) {
  const frames = size === 'l' ? SPR.explL : size === 'm' ? SPR.explM : SPR.explS;
  fx.push({ type: 'ex', frames, x, y, f: 0 });
  const n = size === 'l' ? 26 : size === 'm' ? 14 : 7;
  for (let i = 0; i < n; i++) {
    const a = rnd(0, TAU), s = rnd(0.5, size === 'l' ? 4 : 2.6);
    fx.push({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rndi(12, 30),
      col: PAL.fire[rndi(3, 6)] });
  }
}

function updateFx() {
  for (const f of fx) {
    if (f.type === 'ex') { f.f += 0.5; if (f.f >= f.frames.length) f.dead = true; }
    else if (f.type === 'spark') { f.x += f.vx; f.y += f.vy; f.vx *= 0.94; f.vy *= 0.94; if (--f.life <= 0) f.dead = true; }
    else if (f.type === 'ring') { f.r += f.vr; f.vr *= 0.97; if (--f.life <= 0) f.dead = true; }
    else if (f.type === 'text') { f.y -= 0.4; if (--f.life <= 0) f.dead = true; }
  }
}

// ------------------------------------------------------------
//  Main update
// ------------------------------------------------------------
function newGame() {
  G.score = 0; G.stage = 0; G.loop = 0; G.kills = 0; G.nextExtend = 50000; G.overT = 0;
  P = newPlayer();
  resetTrail();
  shots = []; ebs = []; enemies = []; items = []; fx = [];
  G.state = 'play';
  startStage();
}

function gameOver() {
  G.state = 'over'; G.overT = 0;
  saveHi(G.hi);
  Sound.stopMusic();
}

function setPause(v) {
  if (G.state !== 'play' && G.state !== 'pause') return;
  G.state = v ? 'pause' : 'play';
  Sound.sfx.pause();
}

function update() {
  G.t++;
  updateBG();
  const pad = readPad();
  if (tapped(KB.mute)) Sound.toggleMute();

  if (G.state === 'title') {
    G.scroll += 1;
    if (tapped(KB.start) || pad.start || touch.tap) { Sound.init(); Sound.sfx.select(); newGame(); }
  } else if (G.state === 'pause') {
    if (tapped(KB.pause) || pad.pause || touch.tap) setPause(false);
  } else if (G.state === 'over') {
    G.overT++;
    updateFx();
    if (G.overT > 90 && (tapped(KB.start) || pad.start || touch.tap)) { G.state = 'title'; G.bg = BGS[0]; Sound.playSong('title'); }
  } else if (G.state === 'play') {
    if (tapped(KB.pause) || pad.pause) { setPause(true); endFrameInput(); return; }
    G.scroll += 1;
    updatePlayer(pad);
    if (G.state !== 'play') { endFrameInput(); return; }
    updateStage();
    for (const e of enemies) moveEnemy(e);
    if (boss) updateBoss();

    // player shots
    for (const s of shots) {
      if (s.homing) {
        let tgt = null, best = 1e9;
        for (const e of enemies) {
          if (e.dead || e.y < 0) continue;
          const d = dist(s.x, s.y, e.x, e.y);
          if (d < best) { best = d; tgt = e; }
        }
        if (boss && !boss.enter && !boss.dying) {
          const d = dist(s.x, s.y, boss.x, boss.y);
          if (d < best) tgt = boss;
        }
        if (tgt) {
          const want = Math.atan2(tgt.y - s.y, tgt.x - s.x);
          let da = ((want - s.ang + Math.PI * 3) % TAU) - Math.PI;
          s.ang += clamp(da, -0.13, 0.13);
        }
        s.spd = Math.min(s.spd + 0.25, 7);
        s.vx = Math.cos(s.ang) * s.spd; s.vy = Math.sin(s.ang) * s.spd;
        if (G.t % 3 === 0) fx.push({ type: 'spark', x: s.x, y: s.y + 3, vx: 0, vy: 0.3, life: 10, col: '#7a7a90' });
      }
      s.x += s.vx; s.y += s.vy;
      if (s.y < -16 || s.y > H + 16 || s.x < -16 || s.x > W + 16) s.dead = true;
    }
    // enemy bullets
    for (const b of ebs) {
      b.x += b.vx; b.y += b.vy;
      if (b.y < -12 || b.y > H + 12 || b.x < -12 || b.x > W + 12) b.dead = true;
    }

    // collisions: shots vs enemies/boss
    for (const s of shots) {
      if (s.dead) continue;
      for (const e of enemies) {
        if (e.dead || e.y < -6) continue;
        if (s.hit && s.hit.has(e)) continue;
        if (dist(s.x, s.y, e.x, e.y) < e.r + s.r) {
          damageEnemy(e, s.dmg);
          if (s.pierce) s.hit.add(e); else { s.dead = true; break; }
        }
      }
      if (!s.dead && boss && !boss.enter && !boss.dying && bossHit(s.x, s.y, s.r)) {
        damageBoss(s.dmg);
        s.dead = true;
        if (G.t % 2 === 0) fx.push({ type: 'spark', x: s.x, y: s.y, vx: rnd(-1, 1), vy: rnd(-1.5, 0), life: 8, col: '#ffffff' });
        Sound.sfx.hit();
      }
    }
    // player vs danger
    if (!P.dead) {
      for (const b of ebs) if (!b.dead && dist(b.x, b.y, P.x, P.y + 1) < b.r + P.hr) { b.dead = true; hurtPlayer(); break; }
      for (const e of enemies) {
        if (!e.dead && dist(e.x, e.y, P.x, P.y) < e.r * 0.6 + 3) { damageEnemy(e, 10); hurtPlayer(); break; }
      }
      if (boss && !boss.dying && bossHit(P.x, P.y, 2)) hurtPlayer();
    }
    updateItems();
    updateFx();
    shots = shots.filter(s => !s.dead);
    ebs = ebs.filter(b => !b.dead);
    enemies = enemies.filter(e => !e.dead && !e.gone);
    items = items.filter(i => !i.dead);
  }
  if (G.state !== 'play' && G.state !== 'over') { /* frozen */ }
  fx = fx.filter(f => !f.dead);
  if (G.shake > 0) G.shake *= 0.85, G.shake < 0.5 && (G.shake = 0);
  if (G.flash > 0) G.flash--;
  if (G.livesFlash > 0) G.livesFlash--;
  if (G.banner && --G.banner.t <= 0) G.banner = null;
  endFrameInput();
}

function endFrameInput() {
  for (const k in hitKeys) delete hitKeys[k];
  touch.tap = false;
}

// ------------------------------------------------------------
//  Rendering
// ------------------------------------------------------------
// Interpolated draw position between the last two 60 Hz updates
const lx = o => (o.px === undefined ? o.x : o.px + (o.x - o.px) * alpha);
const ly = o => (o.py === undefined ? o.y : o.py + (o.y - o.py) * alpha);

function spr(img, x, y) { ctx.drawImage(img, Math.round(x - img.width / 2), Math.round(y - img.height / 2)); }

function drawPlayer() {
  const p = { x: lx(P), y: ly(P), inv: P.inv, options: P.options, weapon: P.weapon, focus: P.focus, shield: P.shield };
  const odx = p.x - P.x, ody = p.y - P.y;
  if (P.dead) return;
  if (p.inv > 0 && (G.t >> 2) % 2 === 0) return;
  // options
  for (let i = 0; i < p.options; i++) {
    const [ox, oy] = optionPos(i);
    spr(SPR.option[p.weapon], ox + odx, oy + ody + Math.sin(G.t * 0.2 + i) * 1);
  }
  // engine flame
  const fl = (G.t >> 1) % 2;
  ctx.fillStyle = '#fff8d0'; ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) + 8, 2, 2 + fl);
  ctx.fillStyle = '#ffd23f'; ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) + 10 + fl, 2, 2);
  ctx.fillStyle = '#ff8a1a'; ctx.fillRect(Math.round(p.x) - 6, Math.round(p.y) + 8, 1, 1 + fl); ctx.fillRect(Math.round(p.x) + 5, Math.round(p.y) + 8, 1, 1 + fl);
  spr(SPR.ship, p.x, p.y);
  // hitbox core — always visible, bigger when focusing
  const cx = Math.round(p.x), cy = Math.round(p.y) + 1;
  if (p.focus) {
    ctx.fillStyle = '#ff3fa0'; ctx.fillRect(cx - 2, cy - 1, 4, 2); ctx.fillRect(cx - 1, cy - 2, 2, 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(cx, cy, 10 + Math.sin(G.t * 0.2), 0, TAU); ctx.stroke();
  }
  ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - 1, cy - 1, 2, 2);
  if (p.shield) {
    ctx.strokeStyle = (G.t >> 3) % 2 ? '#80f0ff' : '#2a80e0';
    ctx.beginPath(); ctx.arc(cx, cy - 1, 13, 0, TAU); ctx.stroke();
  }
}

function drawHUD() {
  drawText(ctx, 'SCORE', 4, 3, '#8090c0');
  drawText(ctx, String(G.score).padStart(8, '0'), 4, 10, '#ffffff');
  drawText(ctx, 'HI', W - 4, 3, '#8090c0', 1, 'right');
  drawText(ctx, String(G.hi).padStart(8, '0'), W - 4, 10, '#ffe070', 1, 'right');
  // lives (includes the ship you're flying) and bombs, each on a labeled row
  const lf = G.livesFlash > 0 && (G.livesFlash >> 3) % 2;
  drawText(ctx, 'LIVES', 4, H - 21, lf ? '#ff5050' : '#8090c0');
  for (let i = 0; i < Math.min(P.lives, 5); i++) ctx.drawImage(SPR.shipLife, 26 + i * 9, H - 23, 8, 9);
  if (P.lives > 5) drawText(ctx, '+' + (P.lives - 5), 72, H - 21, '#ffffff');
  drawText(ctx, 'BOMBS', 4, H - 10, '#8090c0');
  for (let i = 0; i < P.bombs; i++) ctx.drawImage(SPR.itemB, 26 + i * 9, H - 12, 8, 8);
  // weapon + power
  drawText(ctx, WEAPON_NAMES[P.weapon], W - 4, H - 18, WEAPON_COLS[P.weapon], 1, 'right');
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = '#000'; ctx.fillRect(W - 44 + i * 8, H - 10, 7, 5);
    ctx.fillStyle = i < P.power ? WEAPON_COLS[P.weapon] : '#282838';
    ctx.fillRect(W - 44 + i * 8, H - 10, 6, 4);
  }
  // boss bar
  if (boss && !boss.dying) {
    const f = boss.enter ? Math.min(1, boss.t / 150) : boss.hp / boss.maxhp;
    drawText(ctx, boss.d.name, W / 2, 20, '#ff9ad0', 1, 'center');
    ctx.fillStyle = '#000'; ctx.fillRect(31, 27, 164, 6);
    ctx.fillStyle = '#401020'; ctx.fillRect(32, 28, 160, 4);
    ctx.fillStyle = f > 0.33 ? '#f050a8' : (G.t >> 2) % 2 ? '#ff3030' : '#ffffff';
    ctx.fillRect(32, 28, Math.round(160 * f), 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(32 + Math.round(160 * 0.66), 28, 1, 4);
    ctx.fillRect(32 + Math.round(160 * 0.33), 28, 1, 4);
  }
  // touch bomb button
  if (touch.used && G.state === 'play') {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = P.bombs ? '#d8401a' : '#404040';
    ctx.beginPath(); ctx.arc(BOMB_BTN.x, BOMB_BTN.y, BOMB_BTN.r, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    drawText(ctx, 'BOMB', BOMB_BTN.x, BOMB_BTN.y - 2, '#ffffff', 1, 'center');
    drawText(ctx, 'II', W - 8, 20, '#ffffff', 1, 'center');
  }
}

function drawBanner() {
  const b = G.banner;
  if (!b) return;
  const y = 110;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, y - 6, W, 34);
  drawText(ctx, b.title, W / 2, y, ['#ffffff', '#fff8d0', '#ffd23f', '#ff8a1a', '#d8401a'], 2, 'center');
  drawText(ctx, b.sub, W / 2, y + 16, '#9fd8ff', 1, 'center');
}

function drawWarning() {
  if (!G.warn) return;
  if ((G.warn >> 4) % 2) {
    ctx.fillStyle = 'rgba(160,0,20,0.35)';
    ctx.fillRect(0, 100, W, 44);
    ctx.fillStyle = '#ff3030';
    for (let x = -16; x < W + 16; x += 16) {
      const o = (G.t % 16);
      ctx.fillRect(x + o, 100, 8, 3); ctx.fillRect(x - o + 8, 141, 8, 3);
    }
    drawText(ctx, 'WARNING', W / 2, 110, ['#ffffff', '#ffd0d0', '#ff8080', '#ff3030', '#b01020'], 3, 'center');
    drawText(ctx, 'HUGE ENEMY APPROACHING', W / 2, 131, '#ffd0d0', 1, 'center');
  }
}

function drawTitle() {
  // drifting rocks for flavour
  for (let i = 0; i < 4; i++) {
    const y = ((G.t * (0.4 + i * 0.15) + i * 90) % (H + 40)) - 20;
    ctx.drawImage(SPR.rockM[i % 3], 20 + i * 55, Math.floor(y));
  }
  drawText(ctx, 'STROIDS', W / 2, 44, ['#fff8d0', '#ffd23f', '#ff8a1a', '#d8401a', '#8a1a1a'], 5, 'center', '#1a0610');
  drawText(ctx, 'A 16-BIT SPACE SHOOTER', W / 2, 76, '#9fd8ff', 1, 'center');
  spr(SPR.ship, W / 2, 120 + Math.sin(G.t * 0.05) * 3);
  const fl = (G.t >> 1) % 2;
  ctx.fillStyle = '#ffd23f'; ctx.fillRect(W / 2 - 1, 129 + Math.round(Math.sin(G.t * 0.05) * 3), 2, 3 + fl);
  if ((G.t >> 5) % 2 === 0) drawText(ctx, touch.used ? 'TAP TO START' : 'PRESS ENTER', W / 2, 150, '#ffffff', 1, 'center');
  const lines = [
    ['MOVE', 'ARROWS / WASD'],
    ['FOCUS', 'SHIFT / Z  (SLOW + TIGHT)'],
    ['BOMB', 'X / SPACE'],
    ['PAUSE', 'P / ESC     MUTE: M'],
    ['FIRE', 'AUTOMATIC!'],
  ];
  lines.forEach(([a, b], i) => {
    drawText(ctx, a, 30, 174 + i * 10, '#ffd23f');
    drawText(ctx, b, 64, 174 + i * 10, '#c8cfe0');
  });
  ctx.drawImage(SPR.itemW[0], 30, 229); ctx.drawImage(SPR.itemW[1], 44, 229); ctx.drawImage(SPR.itemW[2], 58, 229);
  drawText(ctx, 'COLOR ORBS: SWAP / POWER UP', 76, 233, '#c8cfe0');
  drawText(ctx, 'HI ' + String(G.hi).padStart(8, '0'), W / 2, 262, '#ffe070', 1, 'center');
  drawText(ctx, 'TOUCH: DRAG TO FLY', W / 2, 274, '#607090', 1, 'center');
}

function render() {
  ctx.save();
  if (G.shake) ctx.translate(Math.round(rnd(-G.shake, G.shake)), Math.round(rnd(-G.shake, G.shake)));
  if (!G.bg) G.bg = BGS[0];
  drawBG(ctx);

  if (G.state === 'title') {
    ctx.restore();
    drawTitle();
    return;
  }

  // items
  for (const it of items) {
    let img = it.kind === 'W' ? SPR.itemW[it.w] : it.kind === 'G' ? SPR.gem : SPR['item' + it.kind];
    const bob = it.kind === 'G' ? 0 : Math.sin(it.t * 0.15) * 1;
    spr(img, lx(it), ly(it) + bob);
  }
  // enemies
  for (const e of enemies) {
    const ex = lx(e), ey = ly(e);
    spr(e.flash ? e.spr.white : e.spr, ex, ey);
    if (e.d.carrier && (G.t >> 3) % 2) { ctx.globalAlpha = 0.5; spr(SPR.gold, ex, ey); ctx.globalAlpha = 1; }
  }
  // boss
  if (boss) {
    const b = boss;
    const bx = lx(b), by = ly(b);
    spr(b.spr, bx, by);
    if ((b.flash && G.t % 3 === 0) || (b.dying && (G.t >> 2) % 2)) { ctx.globalAlpha = 0.45; spr(b.spr.white, bx, by); ctx.globalAlpha = 1; }
  }
  // player shots
  for (const s of shots) spr(s.spr, lx(s), ly(s));
  if (P) drawPlayer();
  // fx
  for (const f of fx) {
    if (f.type === 'ex') spr(f.frames[Math.floor(f.f)], lx(f), ly(f));
    else if (f.type === 'spark') { ctx.fillStyle = f.col; ctx.fillRect(Math.round(lx(f)), Math.round(ly(f)), f.life > 15 ? 2 : 1, f.life > 15 ? 2 : 1); }
    else if (f.type === 'ring') {
      ctx.strokeStyle = f.col; ctx.globalAlpha = Math.min(1, f.life / 20);
      ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.stroke();
      ctx.lineWidth = 1; ctx.globalAlpha = 1;
    }
  }
  // enemy bullets on top of everything for readability
  for (const b of ebs) spr(b.spr, lx(b), ly(b));
  for (const f of fx) if (f.type === 'text') drawText(ctx, f.str, lx(f), ly(f), (f.life >> 2) % 2 ? f.col : '#ffffff', 1, 'center');
  ctx.restore();

  if (G.flash) { ctx.fillStyle = `rgba(255,255,255,${G.flash / 16})`; ctx.fillRect(0, 0, W, H); }
  drawHUD();
  drawWarning();
  drawBanner();

  if (G.state === 'pause') {
    ctx.fillStyle = 'rgba(0,0,10,0.6)'; ctx.fillRect(0, 0, W, H);
    drawText(ctx, 'PAUSED', W / 2, 120, '#ffffff', 3, 'center');
    drawText(ctx, touch.used ? 'TAP TO RESUME' : 'PRESS P TO RESUME', W / 2, 146, '#9fd8ff', 1, 'center');
  } else if (G.state === 'over') {
    ctx.fillStyle = `rgba(0,0,10,${Math.min(0.65, G.overT / 60)})`; ctx.fillRect(0, 0, W, H);
    drawText(ctx, 'GAME OVER', W / 2, 110, ['#ffffff', '#ffd0d0', '#ff8080', '#ff3030', '#b01020'], 3, 'center');
    drawText(ctx, 'SCORE ' + G.score, W / 2, 136, '#ffffff', 1, 'center');
    if (G.score >= G.hi && G.score > 0) drawText(ctx, 'NEW HIGH SCORE!', W / 2, 148, '#ffe070', 1, 'center');
    if (G.overT > 90 && (G.t >> 5) % 2 === 0) drawText(ctx, 'PRESS START', W / 2, 170, '#9fd8ff', 1, 'center');
  }
}

// ------------------------------------------------------------
//  Loop — fixed 60 Hz simulation for consistent feel
// ------------------------------------------------------------
// Fixed 60 Hz simulation; rendering interpolates between the last two steps so
// motion stays smooth on 120/144 Hz screens and when frames arrive unevenly.
let acc = 0, last = performance.now(), alpha = 1;
const STEP = 1000 / 60;
function snapshot() {
  G.pscroll = G.scroll;
  if (P) { P.px = P.x; P.py = P.y; }
  if (boss) { boss.px = boss.x; boss.py = boss.y; }
  for (const list of [enemies, shots, ebs, items, fx]) for (const o of list) { o.px = o.x; o.py = o.y; }
}
function frame(now) {
  let dt = Math.min(100, now - last);
  last = now;
  // absorb timer jitter so a 60 Hz screen gets exactly one step per frame
  if (Math.abs(dt - STEP) < 1.5) dt = STEP;
  acc += dt;
  while (acc >= STEP) { snapshot(); update(); acc -= STEP; }
  alpha = acc / STEP;
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug/test hook
window.__stroids = { G, get P() { return P; }, get enemies() { return enemies; }, get boss() { return boss; }, spawnBoss, newGame, startStage };
