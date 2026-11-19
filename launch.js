/*
 * Shared launch-page engine — Leo District 306 D2 / Project Web Weavers.
 *
 * Reads `window.LAUNCH_CONFIG` (set inline in each club's index.html). Clicking
 * "Launch this site" starts a launch sequence: the page splits into club
 * details (left) and a 5→1 countdown ring (right), then lifts off into
 * confetti and the post-launch CTA.
 *
 * Sound: if `countdown.mp3` (or `countdownAudio` in the config) exists next to
 * the page, it is played as the whole launch soundtrack. Otherwise a
 * synthesised Web Audio countdown + brass fanfare plays, keyed off `music`.
 *
 * Config shape:
 *   {
 *     name: 'Leo Club of X',
 *     countdownAudio: 'countdown.mp3', // optional, this is the default path
 *     accent: '#rrggbb',            // confetti + countdown ring colour
 *     accent2: '#rrggbb',
 *     music: {
 *       waveform: 'sine'|'triangle'|'square'|'sawtooth',  // lead voice
 *       root: 440,                  // Hz — sets the key
 *       scale: [0, 4, 7, 12, 16],   // semitone offsets for the arpeggio; a 3 makes it minor
 *       tempoMs: 150,               // unused by the sequence, kept for compatibility
 *       chordHold: 900,             // unused by the sequence, kept for compatibility
 *     },
 *   }
 */
(function () {
  const cfg = window.LAUNCH_CONFIG;
  if (!cfg) return;

  const body = document.body;
  const stage = document.querySelector('.stage');
  const launchBtn = document.querySelector('.launch-btn');
  const soundToggle = document.querySelector('.sound-toggle');
  const canvas = document.getElementById('burst');
  const ctx2d = canvas ? canvas.getContext('2d') : null;
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const COUNT_FROM = 5;
  const STEP_TEXT = {
    5: 'Initialising systems',
    4: 'Loading club profile',
    3: 'Connecting the district',
    2: 'Final checks',
    1: 'Ignition',
  };

  let muted = false;
  let started = false;

  // ---------- Sound toggle ----------
  function renderSoundIcon() {
    if (!soundToggle) return;
    soundToggle.innerHTML = muted
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  }
  if (soundToggle) {
    renderSoundIcon();
    soundToggle.addEventListener('click', () => {
      muted = !muted;
      renderSoundIcon();
      if (ac && master) master.gain.setTargetAtTime(muted ? 0 : MASTER_VOL, ac.currentTime, 0.03);
      if (countdownAudio) countdownAudio.muted = muted;
    });
  }

  // ---------- Countdown audio file ----------
  const COUNTDOWN_AUDIO = cfg.countdownAudio || 'countdown.mp3';
  let countdownAudio = null;
  fetch(COUNTDOWN_AUDIO, { method: 'HEAD' })
    .then((res) => {
      if (!res.ok) return;
      countdownAudio = new Audio(COUNTDOWN_AUDIO);
      countdownAudio.preload = 'auto';
    })
    .catch(() => {});

  // ---------- Audio engine ----------
  const MASTER_VOL = 0.55;
  const music = cfg.music || {};
  const scale = music.scale && music.scale.length ? music.scale : [0, 4, 7, 12];
  const leadWave = music.waveform || 'triangle';
  let key = music.root || 440;
  while (key >= 330) key /= 2;
  while (key < 196) key *= 2;
  const hz = (semi) => key * Math.pow(2, semi / 12);
  const minor = scale.includes(3);
  const PROG = minor
    ? [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [0, 3, 7, 12]]
    : [[0, 4, 7], [5, 9, 12], [7, 11, 14], [12, 16, 19]];
  const LEADS = minor ? [19, 24, 20, 22, 24] : [19, 24, 21, 23, 24];

  let ac = null;
  let master = null;
  let wet = null;
  let noiseBuf = null;

  function initAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ac) {
      ac = new AC();
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.connect(ac.destination);

      master = ac.createGain();
      master.gain.value = muted ? 0 : MASTER_VOL;
      master.connect(comp);

      const verb = ac.createConvolver();
      verb.buffer = makeImpulse(2.4);
      wet = ac.createGain();
      wet.gain.value = 0.3;
      wet.connect(verb).connect(master);

      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function makeImpulse(sec) {
    const len = Math.floor(ac.sampleRate * sec);
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  function out(node, send) {
    node.connect(master);
    if (send) {
      const s = ac.createGain();
      s.gain.value = send;
      node.connect(s).connect(wet);
    }
  }

  function env(g, t, attack, peak, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function tone(t, freq, dur, type, vol, send = 0.3, attack = 0.01) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    env(g, t, attack, vol, dur);
    o.connect(g);
    out(g, send);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  function noise(t, dur, type, freq, vol, send = 0.2, q = 0.8) {
    const s = ac.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ac.createGain();
    env(g, t, 0.003, vol, dur);
    s.connect(f).connect(g);
    out(g, send);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  function kick(t, vol = 0.9) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.22);
    env(g, t, 0.004, vol, 0.42);
    o.connect(g);
    out(g, 0.05);
    o.start(t);
    o.stop(t + 0.5);
  }

  const hat = (t, vol = 0.14) => noise(t, 0.05, 'highpass', 8000, vol, 0.05);
  const crash = (t, vol = 0.35) => noise(t, 2.2, 'highpass', 5000, vol, 0.4, 0.5);

  function snare(t, vol = 0.35) {
    noise(t, 0.18, 'bandpass', 1900, vol, 0.25, 0.7);
    tone(t, 190, 0.1, 'triangle', vol * 0.5, 0.1, 0.002);
  }

  function brass(t, freq, dur, vol = 0.08) {
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + 0.08);
    f.frequency.exponentialRampToValueAtTime(1400, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.04);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    f.connect(g);
    out(g, 0.35);
    [-7, 7].forEach((detune) => {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.3);
    });
  }

  function riser(t, dur) {
    const s = ac.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    s.connect(f).connect(g);
    out(g, 0.3);
    s.start(t);
    s.stop(t + dur + 0.1);

    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(hz(-12), t);
    o.frequency.exponentialRampToValueAtTime(hz(12), t + dur);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(4000, t + dur);
    const og = ac.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.07, t + dur);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    o.connect(lp).connect(og);
    out(og, 0.3);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  function boom(t) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
    env(g, t, 0.005, 1, 1.6);
    o.connect(g);
    out(g, 0.2);
    o.start(t);
    o.stop(t + 1.8);
    noise(t, 1.2, 'lowpass', 900, 0.5, 0.4);
    crash(t, 0.4);
  }

  function playCountdownMusic(t0) {
    tone(t0, hz(-12), COUNT_FROM, 'triangle', 0.06, 0.5, 1);
    tone(t0, hz(-5), COUNT_FROM, 'triangle', 0.04, 0.5, 1.5);

    for (let i = 0; i < COUNT_FROM; i++) {
      const t = t0 + i;
      kick(t, 0.55 + i * 0.1);
      hat(t + 0.5);
      if (i >= 2) {
        hat(t + 0.25, 0.08);
        hat(t + 0.75, 0.08);
      }

      const per = i < 2 ? 2 : i < 4 ? 4 : 8;
      for (let k = 0; k < per; k++) {
        const semi = scale[(i * per + k) % scale.length] + 12 + (i >= 3 ? 12 : 0);
        tone(t + k / per, hz(semi), Math.min(0.5, 1.6 / per), leadWave, 0.045, 0.45);
      }
    }
    for (let k = 0; k < 8; k++) snare(t0 + COUNT_FROM - 1 + k / 8, 0.08 + k * 0.035);
    riser(t0 + 1.5, COUNT_FROM - 1.5);
  }

  function playFanfare(t) {
    const b = 0.16;
    const [I, X, Y, F] = PROG;

    for (let k = 0; k < 3; k++) {
      const tt = t + k * b;
      I.forEach((s) => brass(tt, hz(s), b * 0.6, 0.06));
      tone(tt, hz(LEADS[0]), b * 0.6, leadWave, 0.06, 0.3, 0.005);
      snare(tt, 0.18);
    }

    const hit = (tt, chord, dur, lead) => {
      chord.forEach((s) => brass(tt, hz(s), dur, 0.07));
      brass(tt, hz(chord[0] - 12), dur, 0.09);
      tone(tt, hz(lead), dur, leadWave, 0.07, 0.4, 0.02);
      kick(tt, 0.9);
    };

    const t1 = t + 3 * b;
    hit(t1, I, 0.7, LEADS[1]);
    crash(t1, 0.25);
    hit(t1 + 0.75, X, 0.33, LEADS[2]);
    hit(t1 + 1.1, Y, 0.33, LEADS[3]);
    for (let k = 0; k < 6; k++) snare(t1 + 1.1 + k * 0.066, 0.1 + k * 0.04);

    const tf = t1 + 1.5;
    hit(tf, F, 2.4, LEADS[4]);
    crash(tf, 0.45);
    kick(tf + 0.01, 1);
    scale.concat(scale.map((s) => s + 12)).forEach((s, i) => {
      tone(tf + 0.1 + i * 0.07, hz(s + 24), 0.6, 'sine', 0.035, 0.6, 0.005);
    });
  }

  // ---------- Confetti ----------
  const particles = [];
  let particleLoop = false;

  function resizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
  }

  function burst(fx, fy, count) {
    if (!ctx2d || reducedMotion()) return;
    const dpr = devicePixelRatio;
    const colors = [cfg.accent || '#ffffff', cfg.accent2 || '#ffffff', '#ffffff'];
    const cx = canvas.width * fx;
    const cy = canvas.height * fy;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (2 + Math.random() * 6) * dpr;
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3 * dpr,
        size: (3 + Math.random() * 5) * dpr,
        color: colors[Math.floor(Math.random() * colors.length)],
        round: Math.random() < 0.3,
        life: 1,
        decay: 1 / (90 + Math.random() * 60),
        spin: Math.random() * Math.PI,
        spinSpeed: (Math.random() - 0.5) * 0.3,
      });
    }
    if (!particleLoop) {
      particleLoop = true;
      requestAnimationFrame(drawParticles);
    }
  }

  function drawParticles() {
    const dpr = devicePixelRatio;
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 0.09 * dpr;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.spin += p.spinSpeed;
      p.life -= p.decay;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      ctx2d.save();
      ctx2d.globalAlpha = p.life;
      ctx2d.translate(p.x, p.y);
      ctx2d.rotate(p.spin);
      ctx2d.fillStyle = p.color;
      if (p.round) {
        ctx2d.beginPath();
        ctx2d.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
        ctx2d.fill();
      } else {
        ctx2d.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      }
      ctx2d.restore();
    }
    if (particles.length) requestAnimationFrame(drawParticles);
    else particleLoop = false;
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // ---------- Launch sequence UI ----------
  let panel = null;
  let numEl = null;
  let stepEl = null;
  let ringEl = null;
  let bars = [];
  let statusEl = null;

  function buildPanel() {
    panel = document.createElement('aside');
    panel.className = 'launch-panel';
    panel.setAttribute('aria-live', 'assertive');
    panel.innerHTML =
      '<p class="lp-label"><span class="dot"></span> Launch sequence</p>' +
      '<div class="lp-ring">' +
      '<canvas class="lp-plasma" aria-hidden="true"></canvas>' +
      '<span class="lp-num"></span>' +
      '</div>' +
      '<p class="lp-step"></p>' +
      '<div class="lp-bars">' + '<span></span>'.repeat(COUNT_FROM) + '</div>';
    body.appendChild(panel);
    numEl = panel.querySelector('.lp-num');
    stepEl = panel.querySelector('.lp-step');
    ringEl = panel.querySelector('.lp-ring');
    bars = Array.from(panel.querySelectorAll('.lp-bars span'));
  }

  function buildMission() {
    const eyebrow = stage.querySelector('.eyebrow');
    const parts = eyebrow ? eyebrow.textContent.split('·').map((s) => s.trim()) : [];
    const rows = [
      ['District', parts[0] || 'Leo District 306 D2'],
      ['Project', parts[1] || 'Project Web Weavers'],
      ['Launch date', new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })],
      ['Status', 'T-minus ' + COUNT_FROM],
    ];
    const dl = document.createElement('dl');
    dl.className = 'mission';
    rows.forEach(([label, value]) => {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label;
      dd.textContent = value;
      row.append(dt, dd);
      dl.appendChild(row);
    });
    statusEl = dl.lastChild.querySelector('dd');
    const anchor = stage.querySelector('.theme-line') || stage.querySelector('.club-name');
    anchor.after(dl);
  }

  // ---------- Shockwave visuals ----------
  // A plasma ring around the number plus warp streaks shooting across the
  // screen from it, drawn on canvases in the club's accent colours.
  function hexToRgb(hex, fallback) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return fallback;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const mixWhite = (rgb, t) => rgb.map((c) => Math.round(c + (255 - c) * t));
  const rgba = (rgb, a) => 'rgba(' + rgb.join(',') + ',' + a + ')';
  const ACCENT = hexToRgb(cfg.accent, [80, 160, 255]);
  const ACCENT2 = hexToRgb(cfg.accent2, [255, 255, 255]);
  const GLOW = mixWhite(ACCENT, 0.45);

  function makeSprite(rgb) {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, rgba(mixWhite(rgb, 0.6), 1));
    grad.addColorStop(0.35, rgba(rgb, 0.55));
    grad.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }

  let fx = null;

  function startFx() {
    if (reducedMotion()) return;
    const dpr = devicePixelRatio;
    const plasma = panel.querySelector('.lp-plasma');
    plasma.width = plasma.offsetWidth * dpr;
    plasma.height = plasma.offsetHeight * dpr;
    const warp = document.createElement('canvas');
    warp.className = 'lp-warp';
    warp.setAttribute('aria-hidden', 'true');
    body.appendChild(warp);
    warp.width = window.innerWidth * dpr;
    warp.height = window.innerHeight * dpr;
    fx = {
      plasma,
      pctx: plasma.getContext('2d'),
      warp,
      wctx: warp.getContext('2d'),
      sprites: [makeSprite(ACCENT), makeSprite(GLOW), makeSprite(ACCENT2)],
      wisps: [],
      streaks: [],
      waves: [],
      pulse: 0,
      intensity: 0.4,
      on: true,
      t: 0,
    };
    requestAnimationFrame(drawFx);
  }

  function ringRadius() {
    return Math.min(fx.plasma.width, fx.plasma.height) * 0.25;
  }

  function spawnStreaks(count, speed) {
    const dpr = devicePixelRatio;
    for (let i = 0; i < count; i++) {
      const r = Math.random();
      fx.streaks.push({
        a: Math.random() * Math.PI * 2,
        d: (50 + Math.random() * 90) * dpr,
        v: (speed + Math.random() * speed * 1.5) * dpr,
        len: (8 + Math.random() * 24) * dpr,
        w: (1 + Math.random() * 2.2) * dpr,
        col: r < 0.18 ? ACCENT2 : mixWhite(ACCENT, 0.25 + Math.random() * 0.45),
        life: 1,
      });
    }
  }

  function spawnWisps(count, speed) {
    const dpr = devicePixelRatio;
    const base = ringRadius();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.3 + Math.random() * speed) * dpr;
      fx.wisps.push({
        x: fx.plasma.width / 2 + Math.cos(a) * base,
        y: fx.plasma.height / 2 + Math.sin(a) * base,
        vx: Math.cos(a) * v + Math.cos(a + Math.PI / 2) * 0.4 * dpr,
        vy: Math.sin(a) * v + Math.sin(a + Math.PI / 2) * 0.4 * dpr,
        size: (10 + Math.random() * 16) * dpr,
        life: 1,
        decay: 1 / (25 + Math.random() * 30),
      });
    }
  }

  function shockwave(strength) {
    if (!fx) return;
    const dpr = devicePixelRatio;
    fx.pulse = strength;
    fx.waves.push({ r: ringRadius(), v: (6 + 6 * strength) * dpr, life: 1 });
    spawnStreaks(Math.round(50 * strength), 6);
    spawnWisps(Math.round(40 * strength), 2.5 * strength);
  }

  function drawPlasma() {
    const g = fx.pctx;
    const w = fx.plasma.width;
    const h = fx.plasma.height;
    const cx = w / 2;
    const cy = h / 2;
    const dpr = devicePixelRatio;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';

    if (fx.on) {
      const base = ringRadius() * (1 + fx.pulse * 0.3);
      const t = fx.t;
      const N = 240;
      g.globalAlpha = Math.min(0.8, 0.22 + fx.intensity * 0.1);
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const wob = Math.sin(a * 5 + t * 2.1) * 0.06 + Math.sin(a * 9 - t * 3.3) * 0.04 + Math.sin(a * 13 + t * 5) * 0.025;
        const r = base * (1 + wob * (1 + fx.pulse));
        const s = (20 + 12 * Math.sin(a * 7 + t * 4)) * dpr * (0.8 + fx.intensity * 0.2);
        g.drawImage(fx.sprites[i % 3 === 0 ? 1 : 0], cx + Math.cos(a) * r - s / 2, cy + Math.sin(a) * r - s / 2, s, s);
      }
      spawnWisps(Math.round(2 + fx.intensity * 2), 0.8);
    }

    for (let i = fx.wisps.length - 1; i >= 0; i--) {
      const p = fx.wisps[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.97;
      p.vy *= 0.97;
      p.life -= p.decay;
      if (p.life <= 0) {
        fx.wisps.splice(i, 1);
        continue;
      }
      const s = p.size * (0.5 + p.life * 0.5);
      g.globalAlpha = p.life * 0.5;
      g.drawImage(fx.sprites[1], p.x - s / 2, p.y - s / 2, s, s);
    }

    g.globalAlpha = 1;
    for (let i = fx.waves.length - 1; i >= 0; i--) {
      const wv = fx.waves[i];
      wv.r += wv.v;
      wv.v *= 0.96;
      wv.life -= 0.035;
      if (wv.life <= 0) {
        fx.waves.splice(i, 1);
        continue;
      }
      g.strokeStyle = rgba(ACCENT, wv.life * 0.35);
      g.lineWidth = 10 * wv.life * dpr;
      g.beginPath();
      g.arc(cx, cy, wv.r, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = rgba(mixWhite(ACCENT, 0.7), wv.life * 0.9);
      g.lineWidth = 2 * dpr;
      g.stroke();
    }
  }

  function drawWarp() {
    const g = fx.wctx;
    const c = fx.warp;
    const dpr = devicePixelRatio;
    const rect = ringEl.getBoundingClientRect();
    if (rect.width) {
      fx.ox = (rect.left + rect.width / 2) * dpr;
      fx.oy = (rect.top + rect.height / 2) * dpr;
    }
    const ox = fx.ox;
    const oy = fx.oy;
    const far = Math.hypot(c.width, c.height);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    if (fx.on) spawnStreaks(Math.round(3 + fx.intensity * 4), 2);

    for (let i = fx.streaks.length - 1; i >= 0; i--) {
      const s = fx.streaks[i];
      s.v *= 1.045;
      s.d += s.v;
      s.len = Math.min(s.len + s.v * 0.6, 240 * dpr);
      s.life -= 0.008;
      if (s.d - s.len > far || s.life <= 0) {
        fx.streaks.splice(i, 1);
        continue;
      }
      const cos = Math.cos(s.a);
      const sin = Math.sin(s.a);
      g.strokeStyle = rgba(s.col, Math.min(1, s.d / (220 * dpr)) * s.life * 0.85);
      g.lineWidth = s.w;
      g.beginPath();
      g.moveTo(ox + cos * Math.max(0, s.d - s.len), oy + sin * Math.max(0, s.d - s.len));
      g.lineTo(ox + cos * s.d, oy + sin * s.d);
      g.stroke();
    }
  }

  function drawFx() {
    if (!fx) return;
    fx.t += 1 / 60;
    fx.pulse *= 0.9;
    drawPlasma();
    drawWarp();
    if (fx.on || fx.streaks.length || fx.wisps.length || fx.waves.length) {
      requestAnimationFrame(drawFx);
    } else {
      fx.warp.remove();
      fx = null;
    }
  }

  function retrigger(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function flip(el, mutate) {
    const first = el.getBoundingClientRect();
    mutate();
    if (reducedMotion()) return;
    const last = el.getBoundingClientRect();
    const dx = first.left + first.width / 2 - (last.left + last.width / 2);
    const dy = first.top + first.height / 2 - (last.top + last.height / 2);
    el.animate(
      [{ transform: 'translate(' + dx + 'px, ' + dy + 'px)' }, { transform: 'none' }],
      { duration: 750, easing: 'cubic-bezier(.2,1,.3,1)' }
    );
  }

  function showCount(n) {
    numEl.textContent = String(n);
    retrigger(numEl, 'tick');
    stepEl.textContent = STEP_TEXT[n] || '';
    bars.forEach((bar, i) => bar.classList.toggle('on', i < COUNT_FROM - n + 1));
    statusEl.textContent = 'T-minus ' + n;
    if (fx) {
      fx.intensity = 0.4 + (COUNT_FROM - n) * 0.35;
      shockwave(0.7 + (COUNT_FROM - n) * 0.1);
    }
    if (n < COUNT_FROM && !reducedMotion()) retrigger(panel, 'jolt');
  }

  function liftoff() {
    numEl.textContent = 'LIFTOFF';
    retrigger(numEl, 'tick');
    panel.classList.add('liftoff');
    stepEl.textContent = 'We have liftoff';
    statusEl.textContent = 'Liftoff';
    if (fx) {
      shockwave(2);
      spawnStreaks(150, 8);
      fx.on = false;
    }
    burst(0.5, 0.45, 140);
    setTimeout(() => burst(0.2, 0.6, 70), 250);
    setTimeout(() => burst(0.8, 0.6, 70), 450);
    if (!reducedMotion()) retrigger(body, 'shake');
  }

  function finish() {
    panel.classList.add('leaving');
    setTimeout(() => {
      flip(stage, () => {
        body.classList.remove('sequence');
        stage.classList.add('launched');
      });
      panel.remove();
      burst(0.5, 0.4, 60);
    }, 450);
  }

  function startSequence() {
    if (started) return;
    started = true;

    if (countdownAudio) {
      countdownAudio.muted = muted;
      countdownAudio.currentTime = 0;
      countdownAudio.play().catch(() => {});
    } else if (initAudio()) {
      const t0 = ac.currentTime + 0.05;
      playCountdownMusic(t0);
      boom(t0 + COUNT_FROM);
      playFanfare(t0 + COUNT_FROM);
    }

    buildPanel();
    buildMission();
    flip(stage, () => body.classList.add('sequence'));
    startFx();

    for (let i = 0; i < COUNT_FROM; i++) {
      setTimeout(() => showCount(COUNT_FROM - i), i * 1000);
    }
    setTimeout(liftoff, COUNT_FROM * 1000);
    setTimeout(finish, COUNT_FROM * 1000 + 1600);
  }

  if (launchBtn) launchBtn.addEventListener('click', startSequence);
})();
