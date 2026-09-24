'use strict';
// ============================================================
//  AUDIO — tiny chip-style synth: SFX + sequenced music
// ============================================================
const Sound = (() => {
  let ac = null, master, sfxBus, musBus, noiseBuf;
  let muted = false;
  const lastPlay = {};

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
    sfxBus = ac.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
    musBus = ac.createGain(); musBus.gain.value = 0.45; musBus.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    setInterval(schedule, 25);
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.55;
    return muted;
  }

  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function tone(type, f0, dur, vol, f1, when, dest) {
    if (!ac) return;
    const t = when || ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, freq, when, dest, type = 'lowpass') {
    if (!ac) return;
    const t = when || ac.currentTime;
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf;
    f.type = type; f.frequency.setValueAtTime(freq, t);
    if (type === 'lowpass') f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.15), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || sfxBus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  function throttle(name, ms) {
    const now = performance.now();
    if (lastPlay[name] && now - lastPlay[name] < ms) return false;
    lastPlay[name] = now;
    return true;
  }

  const sfx = {
    shoot() { if (throttle('shoot', 70)) tone('square', 1320, 0.05, 0.035, 660); },
    laser() { if (throttle('shoot', 70)) tone('sawtooth', 1800, 0.06, 0.03, 900); },
    missile() { if (throttle('missile', 120)) noise(0.12, 0.06, 3000, 0, 0, 'bandpass'); },
    hit() { if (throttle('hit', 40)) tone('square', 300, 0.04, 0.04, 180); },
    explodeS() { if (throttle('exS', 30)) { noise(0.22, 0.22, 2400); tone('triangle', 180, 0.15, 0.12, 50); } },
    explodeL() { noise(0.7, 0.4, 1800); tone('triangle', 110, 0.5, 0.3, 30); },
    power() {
      if (!ac) return;
      const t = ac.currentTime;
      [72, 76, 79, 84].forEach((m, i) => tone('square', mtof(m), 0.08, 0.07, 0, t + i * 0.05));
    },
    gem() { if (throttle('gem', 40)) tone('square', 1760, 0.05, 0.03, 2400); },
    oneup() {
      if (!ac) return;
      const t = ac.currentTime;
      [76, 79, 88, 84, 86, 91].forEach((m, i) => tone('square', mtof(m), 0.09, 0.07, 0, t + i * 0.07));
    },
    shield() { tone('sawtooth', 220, 0.3, 0.1, 880); },
    shieldBreak() { noise(0.3, 0.2, 5000, 0, 0, 'highpass'); tone('square', 880, 0.25, 0.08, 110); },
    bomb() { noise(1.2, 0.45, 1200); tone('sawtooth', 60, 1.0, 0.25, 30); tone('square', 880, 0.6, 0.06, 55); },
    die() { noise(1.0, 0.4, 3000); tone('square', 440, 0.8, 0.12, 40); },
    warning() {
      if (!ac) return;
      const t = ac.currentTime;
      for (let i = 0; i < 6; i++) tone('square', i % 2 ? 440 : 660, 0.24, 0.07, 0, t + i * 0.25);
    },
    select() { tone('square', 988, 0.06, 0.06); tone('square', 1318, 0.1, 0.06, 0, ac && ac.currentTime + 0.06); },
    pause() { tone('square', 660, 0.06, 0.05); },
  };

  // ---------------- music ----------------
  function buildSong(chords, bpm, melody, transpose, opts = {}) {
    const bass = [], arp = [], lead = [], drum = [];
    const bassPat = opts.driving ? [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 12, 7, 12]
                                 : [0, null, 0, 12, null, 0, 12, null, 0, null, 0, 12, null, 0, 7, 12];
    chords.forEach((ch, bi) => {
      for (let s = 0; s < 16; s++) {
        const b = bassPat[s];
        bass.push(b === null ? null : ch[0] - 12 + b + transpose);
        arp.push(ch[(s + (opts.driving ? s >> 2 : 0)) % 3] + 12 + transpose);
        const m = melody ? melody[bi * 16 + s] : null;
        lead.push(m ? m + transpose : null);
        let dr = null;
        if (s % 8 === 0) dr = 'k';
        else if (s % 8 === 4) dr = 's';
        else if (s % 2 === 1) dr = 'h';
        if (opts.driving && s % 4 === 2) dr = 'k';
        drum.push(dr);
      }
    });
    return { bpm, bass, arp, lead, drum, len: bass.length };
  }

  const _ = null;
  const MELODY_A = [
    76, _, _, _, 81, _, _, _, 79, _, 76, _, 72, _, 74, _,
    72, _, _, _, 69, _, 72, _, 77, _, _, _, 76, _, _, _,
    74, _, _, _, 71, _, 74, _, 79, _, _, _, 77, _, 76, _,
    76, _, _, _, _, _, _, _, 71, _, _, _, 74, _, 76, _,
    76, _, 81, _, 83, _, 84, _, 83, _, 81, _, 79, _, 76, _,
    77, _, _, _, 76, _, 72, _, 69, _, _, _, 72, _, 77, _,
    79, _, _, _, 77, _, 76, _, 74, _, 71, _, 74, _, 79, _,
    76, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
  ];
  const PROG_A = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]];
  const PROG_BOSS = [[52, 55, 59], [48, 52, 55], [50, 54, 57], [47, 51, 54]];
  const MELODY_BOSS = [
    64, _, _, 64, _, _, 67, _, 66, _, _, 64, _, _, 62, _,
    60, _, _, 60, _, _, 64, _, 67, _, _, 64, _, _, 60, _,
    62, _, _, 62, _, _, 66, _, 69, _, _, 66, _, _, 62, _,
    63, _, _, 66, _, _, 71, _, 70, _, 69, _, 68, _, 67, _,
  ];

  const SONGS = {
    stage0: buildSong([...PROG_A, ...PROG_A], 138, MELODY_A, 0),
    stage1: buildSong([...PROG_A, ...PROG_A], 146, MELODY_A, 2),
    stage2: buildSong([...PROG_A, ...PROG_A], 150, MELODY_A, -3),
    boss: buildSong(PROG_BOSS, 168, MELODY_BOSS, 0, { driving: true }),
    title: buildSong(PROG_A, 110, null, 0),
  };

  let song = null, step = 0, nextTime = 0;

  function playSong(name) {
    if (!ac) return;
    const s = SONGS[name];
    if (song === s) return;
    song = s; step = 0; nextTime = ac.currentTime + 0.05;
  }
  function stopMusic() { song = null; }

  function schedule() {
    if (!ac || !song) return;
    const stepDur = 60 / song.bpm / 4;
    while (nextTime < ac.currentTime + 0.12) {
      const t = nextTime, i = step;
      if (song.bass[i] !== null) tone('triangle', mtof(song.bass[i]), stepDur * 1.6, 0.22, 0, t, musBus);
      tone('square', mtof(song.arp[i]), stepDur * 0.7, 0.022, 0, t, musBus);
      if (song.lead[i]) {
        tone('square', mtof(song.lead[i]), stepDur * 3.2, 0.06, 0, t, musBus);
        tone('square', mtof(song.lead[i]) * 1.005, stepDur * 3.2, 0.025, 0, t + stepDur * 0.5, musBus);
      }
      const dr = song.drum[i];
      if (dr === 'k') tone('sine', 150, 0.14, 0.4, 40, t, musBus);
      else if (dr === 's') noise(0.12, 0.14, 1800, t, musBus, 'highpass');
      else if (dr === 'h') noise(0.03, 0.04, 8000, t, musBus, 'highpass');
      nextTime += stepDur;
      step = (step + 1) % song.len;
    }
  }

  return { init, sfx, playSong, stopMusic, toggleMute, get muted() { return muted; } };
})();
