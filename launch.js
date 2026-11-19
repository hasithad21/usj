/*
 * Shared launch-page engine — Leo District 306 D2 / Project Web Weavers.
 *
 * Reads `window.LAUNCH_CONFIG` (set inline in each club's index.html). Clicking
 * "Launch this site" starts a launch sequence: the page splits into club
 * details (left) and a 5→1 countdown ring (right), then lifts off into
 * confetti. If the page has a `.cta a.visit` link, the browser then goes
 * straight to that website; otherwise the post-launch CTA is revealed.
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
  // When the page has an official-website link, the sequence ends by going
  // straight to it instead of revealing the CTA.
  const visitLink = stage.querySelector('.cta a.visit');
  const visitUrl = visitLink ? visitLink.href : null;
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
    panel.dataset.intro = STYLE.intro;
    panel.innerHTML =
      '<p class="lp-label"><span class="dot"></span> Launch sequence</p>' +
      '<div class="lp-ring">' +
      '<canvas class="lp-fx" aria-hidden="true"></canvas>' +
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

  // ---------- Countdown effects ----------
  // Each club picks a visual style with `countdownStyle` in its config. Every
  // style draws on a canvas around the number, in the club's accent colours,
  // and names the CSS entrance animation (`intro`) used for each number.
  function hexToRgb(hex, fallback) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return fallback;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const mixWhite = (rgb, t) => rgb.map((c) => Math.round(c + (255 - c) * t));
  const rgba = (rgb, a) => 'rgba(' + rgb.join(',') + ',' + Math.max(0, Math.min(1, a)) + ')';
  const ACCENT = hexToRgb(cfg.accent, [80, 160, 255]);
  const ACCENT2 = hexToRgb(cfg.accent2, [255, 255, 255]);
  const GLOW = mixWhite(ACCENT, 0.45);
  const TAU = Math.PI * 2;

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

  function dot(x, y, size, alpha, sprite) {
    fx.g.globalAlpha = Math.max(0, Math.min(1, alpha));
    fx.g.drawImage(fx.sprites[sprite || 0], x - size / 2, y - size / 2, size, size);
  }

  function stroke(rgb, alpha, width) {
    fx.g.globalAlpha = 1;
    fx.g.strokeStyle = rgba(rgb, alpha);
    fx.g.lineWidth = width * fx.dpr;
    fx.g.stroke();
  }

  function glowStroke(rgb, alpha, width) {
    stroke(rgb, alpha * 0.22, width * 4);
    stroke(mixWhite(rgb, 0.55), alpha, width);
  }

  function circle(r) {
    fx.g.beginPath();
    fx.g.arc(fx.cx, fx.cy, r, 0, TAU);
  }

  function polar(a, r) {
    return [fx.cx + Math.cos(a) * r, fx.cy + Math.sin(a) * r];
  }

  function sparkAt(a, r0, speed) {
    const [x, y] = polar(a, r0);
    const v = (0.5 + Math.random()) * speed * fx.dpr;
    fx.sparks.push({
      x, y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      size: (6 + Math.random() * 10) * fx.dpr,
      life: 1,
      decay: 1 / (35 + Math.random() * 30),
    });
  }

  function sparks(count, speed, r0) {
    for (let i = 0; i < count; i++) sparkAt(Math.random() * TAU, r0 == null ? fx.R : r0, speed);
  }

  function drawSparks() {
    for (let i = fx.sparks.length - 1; i >= 0; i--) {
      const p = fx.sparks[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= p.decay;
      if (p.life <= 0) {
        fx.sparks.splice(i, 1);
        continue;
      }
      dot(p.x, p.y, p.size * (0.4 + p.life * 0.6), p.life, 1);
    }
    return fx.sparks.length > 0;
  }

  // Each style: intro (CSS entrance for the number), optional init(s), frame(s)
  // returning true while it still has something to animate after the countdown,
  // and optional beat(s, n), liftoff(s), stop(s). `s` is the style's own state.
  const STYLES = {
    shockwave: {
      intro: 'slam',
      init(s) {
        s.wisps = [];
        s.streaks = [];
        s.waves = [];
        s.warp = document.createElement('canvas');
        s.warp.className = 'lp-warp';
        s.warp.setAttribute('aria-hidden', 'true');
        body.appendChild(s.warp);
        s.warp.width = window.innerWidth * fx.dpr;
        s.warp.height = window.innerHeight * fx.dpr;
        s.wctx = s.warp.getContext('2d');
      },
      beat(s, n) { this.blast(s, 0.7 + (COUNT_FROM - n) * 0.1); },
      liftoff(s) {
        this.blast(s, 2);
        this.streaks(s, 150, 8);
        fx.on = false;
      },
      stop(s) { s.warp.remove(); },
      blast(s, k) {
        fx.pulse = k;
        s.waves.push({ r: fx.R, v: (6 + 6 * k) * fx.dpr, life: 1 });
        this.streaks(s, Math.round(50 * k), 6);
        this.wisps(s, Math.round(40 * k), 2.5 * k);
      },
      streaks(s, count, speed) {
        for (let i = 0; i < count; i++) {
          s.streaks.push({
            a: Math.random() * TAU,
            d: (50 + Math.random() * 90) * fx.dpr,
            v: (speed + Math.random() * speed * 1.5) * fx.dpr,
            len: (8 + Math.random() * 24) * fx.dpr,
            w: (1 + Math.random() * 2.2) * fx.dpr,
            col: Math.random() < 0.18 ? ACCENT2 : mixWhite(ACCENT, 0.25 + Math.random() * 0.45),
            life: 1,
          });
        }
      },
      wisps(s, count, speed) {
        for (let i = 0; i < count; i++) {
          const a = Math.random() * TAU;
          const v = (0.3 + Math.random() * speed) * fx.dpr;
          const [x, y] = polar(a, fx.R);
          s.wisps.push({
            x, y,
            vx: Math.cos(a) * v + Math.cos(a + Math.PI / 2) * 0.4 * fx.dpr,
            vy: Math.sin(a) * v + Math.sin(a + Math.PI / 2) * 0.4 * fx.dpr,
            size: (10 + Math.random() * 16) * fx.dpr,
            life: 1,
            decay: 1 / (25 + Math.random() * 30),
          });
        }
      },
      frame(s) {
        const { cx, cy, dpr } = fx;
        const g = fx.g;
        if (fx.on) {
          const base = fx.R * (1 + fx.pulse * 0.3);
          const N = 240;
          for (let i = 0; i < N; i++) {
            const a = (i / N) * TAU;
            const wob = Math.sin(a * 5 + fx.t * 2.1) * 0.06 + Math.sin(a * 9 - fx.t * 3.3) * 0.04 + Math.sin(a * 13 + fx.t * 5) * 0.025;
            const r = base * (1 + wob * (1 + fx.pulse));
            const size = (20 + 12 * Math.sin(a * 7 + fx.t * 4)) * dpr * (0.8 + fx.intensity * 0.2);
            dot(cx + Math.cos(a) * r, cy + Math.sin(a) * r, size, Math.min(0.8, 0.22 + fx.intensity * 0.1), i % 3 === 0 ? 1 : 0);
          }
          this.wisps(s, Math.round(2 + fx.intensity * 2), 0.8);
        }
        for (let i = s.wisps.length - 1; i >= 0; i--) {
          const p = s.wisps[i];
          p.x += p.vx;
          p.y += p.vy;
          p.vx *= 0.97;
          p.vy *= 0.97;
          p.life -= p.decay;
          if (p.life <= 0) {
            s.wisps.splice(i, 1);
            continue;
          }
          dot(p.x, p.y, p.size * (0.5 + p.life * 0.5), p.life * 0.5, 1);
        }
        for (let i = s.waves.length - 1; i >= 0; i--) {
          const wv = s.waves[i];
          wv.r += wv.v;
          wv.v *= 0.96;
          wv.life -= 0.035;
          if (wv.life <= 0) {
            s.waves.splice(i, 1);
            continue;
          }
          circle(wv.r);
          stroke(ACCENT, wv.life * 0.35, 10 * wv.life);
          stroke(mixWhite(ACCENT, 0.7), wv.life * 0.9, 2);
        }

        const w = s.wctx;
        const rect = ringEl.getBoundingClientRect();
        if (rect.width) {
          s.ox = (rect.left + rect.width / 2) * dpr;
          s.oy = (rect.top + rect.height / 2) * dpr;
        }
        const far = Math.hypot(s.warp.width, s.warp.height);
        w.globalCompositeOperation = 'source-over';
        w.clearRect(0, 0, s.warp.width, s.warp.height);
        w.globalCompositeOperation = 'lighter';
        w.lineCap = 'round';
        if (fx.on) this.streaks(s, Math.round(3 + fx.intensity * 4), 2);
        for (let i = s.streaks.length - 1; i >= 0; i--) {
          const st = s.streaks[i];
          st.v *= 1.045;
          st.d += st.v;
          st.len = Math.min(st.len + st.v * 0.6, 240 * dpr);
          st.life -= 0.008;
          if (st.d - st.len > far || st.life <= 0) {
            s.streaks.splice(i, 1);
            continue;
          }
          const cos = Math.cos(st.a);
          const sin = Math.sin(st.a);
          const from = Math.max(0, st.d - st.len);
          w.strokeStyle = rgba(st.col, Math.min(1, st.d / (220 * dpr)) * st.life * 0.85);
          w.lineWidth = st.w;
          w.beginPath();
          w.moveTo(s.ox + cos * from, s.oy + sin * from);
          w.lineTo(s.ox + cos * st.d, s.oy + sin * st.d);
          w.stroke();
        }
        return s.wisps.length > 0 || s.streaks.length > 0 || s.waves.length > 0;
      },
    },

    orbit: {
      intro: 'flip',
      frame() {
        if (!fx.on) return false;
        const { cx, cy, R, t, dpr } = fx;
        const g = fx.g;
        const grow = 1 + fx.pulse * 0.18;
        const speed = 1.4 + fx.intensity * 0.9;
        dot(cx, cy, R * 1.3 * (1 + fx.pulse * 0.3), 0.22, 0);
        for (let k = 0; k < 3; k++) {
          const rot = (k * TAU) / 3 + t * 0.2;
          const rx = R * 1.18 * grow;
          const ry = R * 0.42 * grow;
          g.beginPath();
          g.ellipse(cx, cy, rx, ry, rot, 0, TAU);
          stroke(ACCENT, 0.3, 1.2);
          const cr = Math.cos(rot);
          const sr = Math.sin(rot);
          for (let e = 0; e < 2; e++) {
            const base = t * speed * (1 + k * 0.25) + e * Math.PI;
            for (let j = 9; j >= 0; j--) {
              const a = base - j * 0.07;
              const ex = rx * Math.cos(a);
              const ey = ry * Math.sin(a);
              dot(cx + ex * cr - ey * sr, cy + ex * sr + ey * cr, (18 - j * 1.4) * dpr, (1 - j / 10) * 0.85, j === 0 ? 2 : 1);
            }
          }
        }
        return false;
      },
    },

    hud: {
      intro: 'slide',
      frame() {
        if (!fx.on) return false;
        const { R, t, dpr } = fx;
        const g = fx.g;
        for (let i = 0; i < 60; i++) {
          const a = (i / 60) * TAU - TAU / 4;
          const lit = i / 60 < fx.progress;
          const [x1, y1] = polar(a, R * 1.24);
          const [x2, y2] = polar(a, R * (i % 5 ? 1.3 : 1.36));
          g.beginPath();
          g.moveTo(x1, y1);
          g.lineTo(x2, y2);
          stroke(lit ? GLOW : ACCENT, lit ? 0.95 : 0.25, lit ? 2 : 1.2);
        }
        g.setLineDash([10 * dpr, 8 * dpr]);
        g.lineDashOffset = -t * 40 * dpr * (1 + fx.intensity);
        circle(R * 1.06);
        glowStroke(ACCENT, 0.7, 2);
        g.setLineDash([]);
        for (let k = 0; k < 3; k++) {
          const a0 = -t * (0.8 + fx.intensity * 0.5) + (k * TAU) / 3;
          g.beginPath();
          g.arc(fx.cx, fx.cy, R * 0.86, a0, a0 + TAU / 5);
          glowStroke(GLOW, 0.85, 3);
        }
        if (fx.pulse > 0.05) {
          circle(R * (1.06 + (1 - fx.pulse) * 0.6));
          stroke(ACCENT2, fx.pulse * 0.8, 2);
        }
        return false;
      },
    },

    vortex: {
      intro: 'spin',
      init(s) { s.p = []; },
      spawn(s, n, fast) {
        for (let i = 0; i < n; i++) {
          s.p.push({
            a: Math.random() * TAU,
            r: fx.R * (1.3 + Math.random() * 0.25),
            w: (0.012 + Math.random() * 0.012) * (fast ? 2 : 1),
          });
        }
      },
      beat(s) { this.spawn(s, 45, true); },
      liftoff(s) {
        s.p.forEach((p) => sparkAt(p.a, p.r, 8));
        s.p = [];
        sparks(80, 7);
        fx.on = false;
      },
      frame(s) {
        const R = fx.R;
        const g = fx.g;
        if (fx.on) {
          this.spawn(s, Math.round(2 + fx.intensity * 3));
          dot(fx.cx, fx.cy, R * 1.1 * (1 + fx.pulse * 0.4), 0.28, 0);
        }
        for (let i = s.p.length - 1; i >= 0; i--) {
          const p = s.p[i];
          const [px, py] = polar(p.a, p.r);
          p.a += p.w * ((R * 1.45) / p.r) * (1 + fx.intensity * 0.4);
          p.r *= 0.982 - fx.intensity * 0.003;
          if (p.r < R * 0.42) {
            s.p.splice(i, 1);
            continue;
          }
          const [x, y] = polar(p.a, p.r);
          const fade = Math.min(1, (p.r - R * 0.42) / (R * 0.3));
          g.beginPath();
          g.moveTo(px, py);
          g.lineTo(x, y);
          stroke(GLOW, 0.75 * fade, 2);
          dot(x, y, 7 * fx.dpr, fade, 1);
        }
        return s.p.length > 0;
      },
    },

    ripple: {
      intro: 'rise',
      init(s) {
        s.r = [];
        s.next = 0;
      },
      add(s, v, w) { s.r.push({ r: fx.R * 0.38, v: v * fx.dpr, w }); },
      beat(s) { this.add(s, 3.2, 4); },
      liftoff(s) {
        for (let k = 0; k < 5; k++) this.add(s, 2.5 + k * 1.2, 3);
        sparks(70, 6, fx.R * 0.5);
        fx.on = false;
      },
      frame(s) {
        const R = fx.R;
        if (fx.on && fx.t > s.next) {
          this.add(s, 1.1 + fx.intensity * 0.5, 1.6);
          s.next = fx.t + 0.42 - fx.intensity * 0.05;
        }
        if (fx.on) dot(fx.cx, fx.cy, R * 0.9 * (1 + fx.pulse * 0.5), 0.25, 0);
        for (let i = s.r.length - 1; i >= 0; i--) {
          const rr = s.r[i];
          rr.r += rr.v;
          const life = 1 - (rr.r - R * 0.38) / (R * 1.35);
          if (life <= 0) {
            s.r.splice(i, 1);
            continue;
          }
          circle(rr.r);
          glowStroke(rr.w > 2 ? GLOW : ACCENT, life * 0.85, rr.w);
        }
        return s.r.length > 0;
      },
    },

    lightning: {
      intro: 'flicker',
      init(s) {
        s.bolts = [];
        s.timer = 0;
      },
      zig(pts, x1, y1, x2, y2, d, depth) {
        if (!depth) {
          pts.push([x2, y2]);
          return;
        }
        const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * d;
        const my = (y1 + y2) / 2 + (Math.random() - 0.5) * d;
        this.zig(pts, x1, y1, mx, my, d / 2, depth - 1);
        this.zig(pts, mx, my, x2, y2, d / 2, depth - 1);
      },
      arcBolt(s) {
        const R = fx.R;
        const a1 = Math.random() * TAU;
        const span = 0.5 + Math.random() * 0.9;
        let [px, py] = polar(a1, R * (0.95 + Math.random() * 0.15));
        const pts = [[px, py]];
        for (let a = a1 + 0.25; a <= a1 + span; a += 0.25) {
          const [x, y] = polar(a, R * (0.92 + Math.random() * 0.22));
          this.zig(pts, px, py, x, y, R * 0.12, 3);
          px = x;
          py = y;
        }
        s.bolts.push({ pts, life: 1 });
      },
      outBolt(s) {
        const a = Math.random() * TAU;
        const [x1, y1] = polar(a, fx.R);
        const [x2, y2] = polar(a + (Math.random() - 0.5) * 0.4, fx.R * (1.5 + Math.random() * 0.4));
        const pts = [[x1, y1]];
        this.zig(pts, x1, y1, x2, y2, fx.R * 0.35, 5);
        s.bolts.push({ pts, life: 1 });
      },
      beat(s) { for (let i = 0; i < 4; i++) this.outBolt(s); },
      liftoff(s) {
        for (let i = 0; i < 14; i++) this.outBolt(s);
        sparks(90, 7);
        fx.on = false;
      },
      frame(s) {
        const g = fx.g;
        if (fx.on) {
          circle(fx.R);
          stroke(ACCENT, 0.18, 1.5);
          if (--s.timer <= 0) {
            this.arcBolt(s);
            s.timer = Math.max(2, 8 - fx.intensity * 1.5);
          }
        }
        if (fx.pulse > 0.1) dot(fx.cx, fx.cy, fx.R * 2.6, fx.pulse * 0.3, 0);
        for (let i = s.bolts.length - 1; i >= 0; i--) {
          const b = s.bolts[i];
          b.life -= 0.1;
          if (b.life <= 0) {
            s.bolts.splice(i, 1);
            continue;
          }
          g.beginPath();
          g.moveTo(b.pts[0][0], b.pts[0][1]);
          for (let k = 1; k < b.pts.length; k++) g.lineTo(b.pts[k][0], b.pts[k][1]);
          glowStroke(GLOW, b.life, 1.8);
        }
        return s.bolts.length > 0;
      },
    },

    sunburst: {
      intro: 'zoom',
      init(s) {
        s.rot = 0;
        s.kick = 0;
      },
      beat(s) { s.kick = 0.07; },
      star(x, y, size, alpha) {
        const g = fx.g;
        g.beginPath();
        g.moveTo(x - size, y);
        g.lineTo(x + size, y);
        g.moveTo(x, y - size);
        g.lineTo(x, y + size);
        stroke(mixWhite(ACCENT2, 0.4), alpha, 1);
        dot(x, y, size * 1.6, alpha * 0.8, 2);
      },
      frame(s) {
        if (!fx.on) return false;
        const { cx, cy, R, t, dpr } = fx;
        const g = fx.g;
        s.rot += 0.004 + fx.intensity * 0.002 + s.kick;
        s.kick *= 0.88;
        const rays = 18;
        const r0 = R * 0.5;
        const r1 = R * 1.75;
        const grad = g.createRadialGradient(cx, cy, r0, cx, cy, r1);
        grad.addColorStop(0, rgba(GLOW, 0.32 + fx.pulse * 0.25));
        grad.addColorStop(1, rgba(ACCENT, 0));
        g.globalAlpha = 1;
        g.fillStyle = grad;
        for (let i = 0; i < rays; i++) {
          const a0 = s.rot + (i * TAU) / rays;
          const a1 = a0 + TAU / rays / 2;
          g.beginPath();
          g.arc(cx, cy, r1, a0, a1);
          g.arc(cx, cy, r0, a1, a0, true);
          g.closePath();
          g.fill();
        }
        for (let k = 0; k < 26; k++) {
          const tw = (Math.sin(t * 3 + k * 1.7) + 1) / 2;
          const [x, y] = polar(k * 2.399 + s.rot * 0.5, R * (1.0 + (k % 5) * 0.14));
          this.star(x, y, (3 + 7 * tw) * dpr, 0.3 + 0.7 * tw);
        }
        return false;
      },
    },

    galaxy: {
      intro: 'rise',
      init(s) {
        s.stars = Array.from({ length: 280 }, (_, i) => {
          const d = Math.pow(Math.random(), 0.7);
          return { d, off: (i % 2) * Math.PI + d * 4.2 + (Math.random() - 0.5) * 0.7, size: 3 + Math.random() * 6, tw: Math.random() * TAU };
        });
      },
      angle(st) { return st.off + fx.t * (1 + fx.intensity * 0.5) * (0.5 / (st.d + 0.35)); },
      frame(s) {
        if (!fx.on) return false;
        const { cx, cy, R, t, dpr } = fx;
        dot(cx, cy, R * 1.5 * (1 + fx.pulse * 0.35), 0.35, 1);
        for (const st of s.stars) {
          const a = this.angle(st);
          const r = R * (0.3 + st.d * 1.25);
          const tw = 0.55 + 0.45 * Math.sin(t * 4 + st.tw);
          dot(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.55, st.size * dpr * (1 + fx.pulse * 0.5), tw * (0.35 + (1 - st.d) * 0.5), st.d < 0.25 ? 2 : st.d < 0.6 ? 1 : 0);
        }
        return false;
      },
      liftoff(s) {
        for (const st of s.stars) if (Math.random() < 0.6) sparkAt(this.angle(st), fx.R * (0.3 + st.d * 1.25), 6);
        fx.on = false;
      },
    },

    bubbles: {
      intro: 'bounce',
      init(s) { s.b = []; },
      spawn(s, n) {
        for (let i = 0; i < n; i++) {
          s.b.push({
            x: fx.cx + (Math.random() - 0.5) * fx.R * 2.4,
            y: fx.h * 0.82,
            vy: -(0.7 + Math.random() * 1.3) * fx.dpr,
            r: (5 + Math.random() * 13) * fx.dpr,
            wob: Math.random() * TAU,
          });
        }
      },
      pop(b) {
        for (let k = 0; k < 6; k++) {
          const a = Math.random() * TAU;
          const v = (1 + Math.random() * 2) * fx.dpr;
          fx.sparks.push({ x: b.x, y: b.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: 5 * fx.dpr, life: 1, decay: 0.06 });
        }
      },
      beat(s) { this.spawn(s, 14); },
      liftoff(s) {
        s.b.forEach((b) => this.pop(b));
        s.b = [];
        sparks(80, 6);
        fx.on = false;
      },
      frame(s) {
        const g = fx.g;
        if (fx.on && Math.random() < 0.3 + fx.intensity * 0.2) this.spawn(s, 1);
        for (let i = s.b.length - 1; i >= 0; i--) {
          const b = s.b[i];
          b.y += b.vy * (1 + fx.intensity * 0.3);
          b.x += Math.sin(fx.t * 2 + b.wob) * 0.5 * fx.dpr;
          if (b.y < fx.h * 0.06 || Math.random() < 0.003) {
            this.pop(b);
            s.b.splice(i, 1);
            continue;
          }
          dot(b.x, b.y, b.r * 2.2, 0.18, 0);
          g.beginPath();
          g.arc(b.x, b.y, b.r, 0, TAU);
          stroke(GLOW, 0.6, 1.2);
          dot(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.6, 0.8, 2);
        }
        return s.b.length > 0;
      },
    },

    neon: {
      intro: 'flicker',
      frame() {
        if (!fx.on) return false;
        const { cx, cy, R, t } = fx;
        const g = fx.g;
        circle(R * 1.05);
        stroke(ACCENT, 0.12, 3);
        const a0 = -TAU / 4;
        const a1 = a0 + Math.max(0.001, fx.progress) * TAU;
        g.beginPath();
        g.arc(cx, cy, R * 1.05, a0, a1);
        stroke(ACCENT, 0.14, 16);
        stroke(ACCENT, 0.35, 8);
        stroke(mixWhite(ACCENT, 0.8), 1, 2.6);
        const [hx, hy] = polar(a1, R * 1.05);
        dot(hx, hy, 26 * fx.dpr, 1, 1);
        circle(R * 0.84);
        stroke(GLOW, 0.22 + (Math.sin(t * 37) > 0.6 ? 0.18 : 0), 1.5);
        if (fx.pulse > 0.05) {
          circle(R * (1.05 + (1 - fx.pulse) * 0.55));
          stroke(GLOW, fx.pulse * 0.9, 2.5);
        }
        return false;
      },
    },

    heartbeat: {
      intro: 'pulse',
      SHAPE: [0, -0.06, 0.12, -0.12, 1, -0.55, 0.18, -0.08, 0.04, 0],
      init(s) {
        s.buf = new Array(140).fill(0);
        s.spike = -1;
        s.amp = 1;
      },
      beat(s) {
        s.spike = 0;
        s.amp = 1;
      },
      liftoff(s) {
        s.spike = 0;
        s.amp = 1.8;
        sparks(110, 7);
        setTimeout(() => { if (fx) fx.on = false; }, 400);
      },
      frame(s) {
        if (!fx.on) return false;
        const { cy, R, w } = fx;
        const g = fx.g;
        let v = (Math.random() - 0.5) * 0.02;
        if (s.spike >= 0) {
          const k = Math.floor(s.spike / 2);
          if (k < this.SHAPE.length) {
            v = this.SHAPE[k] * s.amp;
            s.spike++;
          } else {
            s.spike = -1;
          }
        }
        s.buf.push(v);
        s.buf.shift();
        const x0 = w * 0.08;
        const x1 = w * 0.92;
        const base = cy + R * 0.6;
        const amp = R * 0.55;
        g.beginPath();
        s.buf.forEach((val, i) => {
          const x = x0 + (x1 - x0) * (i / (s.buf.length - 1));
          if (i) g.lineTo(x, base - val * amp);
          else g.moveTo(x, base - val * amp);
        });
        glowStroke(ACCENT, 0.95, 2);
        dot(x1, base - s.buf[s.buf.length - 1] * amp, 16 * fx.dpr, 1, 1);
        circle(R * (1.05 + fx.pulse * 0.1));
        stroke(ACCENT, 0.25 + fx.pulse * 0.4, 2);
        return false;
      },
    },

    matrix: {
      intro: 'glitch',
      GLYPHS: '01アイウエオカキクケコサシスセソ0123456789',
      glyph() { return this.GLYPHS[Math.floor(Math.random() * this.GLYPHS.length)]; },
      init(s) {
        const cols = 16;
        const span = fx.R * 2.7;
        s.cols = Array.from({ length: cols }, (_, i) => ({
          x: fx.cx - span / 2 + (i + 0.5) * (span / cols),
          y: Math.random() * fx.h,
          v: (1.5 + Math.random() * 2.5) * fx.dpr,
          chars: Array.from({ length: 10 }, () => this.glyph()),
        }));
        s.glitch = 0;
      },
      beat(s) { s.glitch = 8; },
      frame(s) {
        if (!fx.on) return false;
        const { R, dpr } = fx;
        const g = fx.g;
        const size = 13 * dpr;
        const step = size * 1.15;
        g.save();
        circle(R * 1.4);
        g.clip();
        g.font = '600 ' + size + 'px ui-monospace, Menlo, Consolas, monospace';
        g.textAlign = 'center';
        g.globalAlpha = 1;
        for (const c of s.cols) {
          c.y += c.v * (1 + fx.intensity * 0.6);
          if (c.y - step * c.chars.length > fx.h) {
            c.y = 0;
            c.v = (1.5 + Math.random() * 2.5) * dpr;
          }
          if (Math.random() < 0.1) c.chars[Math.floor(Math.random() * c.chars.length)] = this.glyph();
          const jx = s.glitch > 0 ? (Math.random() - 0.5) * 14 * dpr : 0;
          c.chars.forEach((ch, k) => {
            g.fillStyle = k === 0 ? rgba(mixWhite(ACCENT, 0.8), 1) : rgba(GLOW, 0.8 * (1 - k / c.chars.length));
            g.fillText(ch, c.x + jx, c.y - k * step);
          });
        }
        g.restore();
        if (s.glitch > 0) s.glitch--;
        circle(R * 1.4);
        stroke(ACCENT, 0.35 + fx.pulse * 0.5, 1.5);
        return false;
      },
    },

    bloom: {
      intro: 'zoom',
      init(s) {
        s.layers = [];
        s.rot = 0;
        s.fly = 0;
      },
      beat(s, n) { s.layers.push({ k: COUNT_FROM - n, open: 0 }); },
      liftoff(s) {
        s.fly = 0.001;
        sparks(90, 6);
      },
      frame(s) {
        const { cx, cy, R } = fx;
        const g = fx.g;
        s.rot += 0.003 + fx.intensity * 0.001;
        if (s.fly) {
          s.fly += 0.03;
          if (s.fly > 1) {
            fx.on = false;
            return false;
          }
        }
        dot(cx, cy, R * (1 + fx.pulse * 0.3), 0.25, 0);
        const alpha = 1 - s.fly;
        for (const L of s.layers) {
          L.open = Math.min(1, L.open + 0.05);
          const ease = 1 - Math.pow(1 - L.open, 3);
          const len = R * (0.55 + L.k * 0.14) * ease;
          const r0 = R * 0.42 + s.fly * R * 1.2;
          const off = s.rot * (L.k % 2 ? -1 : 1) + L.k * (TAU / 16);
          for (let i = 0; i < 8; i++) {
            const a = off + (i * TAU) / 8;
            const [x, y] = polar(a, r0 + len / 2);
            g.beginPath();
            g.ellipse(x, y, Math.max(0.1, len / 2), Math.max(0.1, len * 0.17), a, 0, TAU);
            g.globalAlpha = 1;
            g.fillStyle = rgba(L.k % 2 ? GLOW : ACCENT, 0.13 * alpha);
            g.fill();
            stroke(GLOW, 0.55 * alpha, 1.1);
          }
        }
        return false;
      },
    },

    sparkle: {
      intro: 'rise',
      init(s) { s.list = []; },
      add(s, x, y, vx, vy, size) { s.list.push({ x, y, vx, vy, size, life: 0, dur: 50 + Math.random() * 40 }); },
      beat(s) {
        for (let i = 0; i < 24; i++) {
          const a = (i * TAU) / 24;
          const [x, y] = polar(a, fx.R);
          this.add(s, x, y, Math.cos(a) * 2 * fx.dpr, Math.sin(a) * 2 * fx.dpr, 14 * fx.dpr);
        }
      },
      liftoff(s) {
        for (let i = 0; i < 60; i++) {
          const a = Math.random() * TAU;
          const v = (2 + Math.random() * 5) * fx.dpr;
          const [x, y] = polar(a, fx.R * 0.6);
          this.add(s, x, y, Math.cos(a) * v, Math.sin(a) * v, (8 + Math.random() * 10) * fx.dpr);
        }
        fx.on = false;
      },
      star(x, y, size, alpha) {
        const g = fx.g;
        const q = size * 0.18;
        g.beginPath();
        g.moveTo(x, y - size);
        g.quadraticCurveTo(x + q, y - q, x + size, y);
        g.quadraticCurveTo(x + q, y + q, x, y + size);
        g.quadraticCurveTo(x - q, y + q, x - size, y);
        g.quadraticCurveTo(x - q, y - q, x, y - size);
        g.globalAlpha = 1;
        g.fillStyle = rgba(mixWhite(ACCENT2, 0.5), alpha);
        g.fill();
        dot(x, y, size * 1.4, alpha * 0.6, 1);
      },
      frame(s) {
        if (fx.on) {
          for (let i = 0; i < 1 + fx.intensity; i++) {
            const [x, y] = polar(Math.random() * TAU, fx.R * (0.9 + Math.random() * 0.75));
            this.add(s, x, y, 0, -0.2 * fx.dpr, (8 + Math.random() * 12) * fx.dpr);
          }
          dot(fx.cx, fx.cy, fx.R * 1.1 * (1 + fx.pulse * 0.3), 0.2, 0);
        }
        for (let i = s.list.length - 1; i >= 0; i--) {
          const p = s.list[i];
          p.life++;
          p.x += p.vx;
          p.y += p.vy;
          p.vx *= 0.97;
          p.vy *= 0.97;
          const u = p.life / p.dur;
          if (u >= 1) {
            s.list.splice(i, 1);
            continue;
          }
          const tw = Math.sin(u * Math.PI);
          this.star(p.x, p.y, p.size * tw, tw);
        }
        return s.list.length > 0;
      },
    },

    spinner: {
      intro: 'drop',
      init(s) { s.jump = 0; },
      beat(s) { s.jump = 1; },
      liftoff() {
        for (let i = 0; i < 12; i++) {
          for (let k = 0; k < 6; k++) sparkAt((i * TAU) / 12 - TAU / 4 + (Math.random() - 0.5) * 0.15, fx.R * 1.05, 6 + k);
        }
        fx.on = false;
      },
      frame(s) {
        if (!fx.on) return false;
        const { R, t, dpr } = fx;
        s.jump *= 0.88;
        const speed = 1.2 + fx.intensity * 0.8;
        const head = (t * speed * 12) % 12;
        for (let i = 0; i < 12; i++) {
          const b = Math.max(0, 1 - ((head - i + 12) % 12) / 6);
          const [x, y] = polar((i / 12) * TAU - TAU / 4, R * (1.05 + s.jump * 0.28));
          dot(x, y, (9 + 14 * b) * dpr, 0.25 + 0.75 * b, b > 0.8 ? 2 : 1);
        }
        const head2 = (t * speed * 8) % 8;
        for (let i = 0; i < 8; i++) {
          const b = Math.max(0, 1 - ((head2 - i + 8) % 8) / 4);
          const [x, y] = polar(-(i / 8) * TAU - TAU / 4, R * 0.8);
          dot(x, y, (5 + 8 * b) * dpr, 0.2 + 0.6 * b, 0);
        }
        return false;
      },
    },

    waves: {
      intro: 'rise',
      frame() {
        if (!fx.on) return false;
        const { cx, cy, R, t } = fx;
        const g = fx.g;
        const layers = [[ACCENT, 1, 1.0, 0], [GLOW, 0.7, 1.6, 1.3], [ACCENT2, 0.5, 2.3, 2.6]];
        const amp0 = R * 0.22 * (1 + fx.intensity * 0.35 + fx.pulse * 1.4);
        const x0 = cx - R * 1.55;
        const span = R * 3.1;
        layers.forEach(([col, a, f, ph]) => {
          g.beginPath();
          for (let i = 0; i <= 80; i++) {
            const u = i / 80;
            const y = cy + Math.sin(u * TAU * f + t * (3 + f) + ph) * amp0 * a * Math.sin(Math.PI * u);
            if (i) g.lineTo(x0 + u * span, y);
            else g.moveTo(x0 + u * span, y);
          }
          glowStroke(col, 0.85, 2);
        });
        circle(R * 1.15);
        stroke(ACCENT, 0.2 + fx.pulse * 0.4, 1.5);
        return false;
      },
    },

    equalizer: {
      intro: 'bounce',
      init(s) {
        s.v = new Array(48).fill(0.2);
        s.target = new Array(48).fill(0.2);
        s.rot = 0;
      },
      beat(s) { s.target = s.target.map(() => 0.7 + Math.random() * 0.3); },
      liftoff(s) {
        for (let i = 0; i < 48; i++) sparkAt(s.rot + (i * TAU) / 48, fx.R * 1.5, 7);
        fx.on = false;
      },
      frame(s) {
        if (!fx.on) return false;
        const R = fx.R;
        const g = fx.g;
        s.rot += 0.004;
        for (let i = 0; i < 48; i++) {
          if (Math.random() < 0.08) s.target[i] = 0.1 + Math.random() * (0.35 + fx.intensity * 0.2);
          s.v[i] += (s.target[i] - s.v[i]) * 0.25;
          s.target[i] *= 0.97;
          const a = s.rot + (i / 48) * TAU;
          const [x1, y1] = polar(a, R);
          const [x2, y2] = polar(a, R * (1.04 + s.v[i] * 0.55));
          g.beginPath();
          g.moveTo(x1, y1);
          g.lineTo(x2, y2);
          stroke(ACCENT, 0.25, 9);
          stroke(mixWhite(ACCENT, 0.3 + s.v[i] * 0.5), 0.95, 4);
        }
        circle(R * 0.95);
        stroke(GLOW, 0.3 + fx.pulse * 0.5, 1.5);
        return false;
      },
    },
  };

  const STYLE = STYLES[cfg.countdownStyle] || STYLES.shockwave;

  function startFx() {
    if (reducedMotion()) return;
    const dpr = devicePixelRatio;
    const c = panel.querySelector('.lp-fx');
    c.width = c.offsetWidth * dpr;
    c.height = c.offsetHeight * dpr;
    const g = c.getContext('2d');
    g.lineCap = 'round';
    g.lineJoin = 'round';
    fx = {
      c, g, dpr,
      w: c.width,
      h: c.height,
      cx: c.width / 2,
      cy: c.height / 2,
      R: Math.min(c.width, c.height) * 0.25,
      t: 0,
      start: performance.now(),
      progress: 0,
      intensity: 0.4,
      pulse: 0,
      on: true,
      sparks: [],
      s: {},
      sprites: [makeSprite(ACCENT), makeSprite(GLOW), makeSprite(ACCENT2)],
    };
    if (STYLE.init) STYLE.init(fx.s);
    requestAnimationFrame(drawFx);
  }

  function drawFx() {
    if (!fx) return;
    const g = fx.g;
    fx.t += 1 / 60;
    fx.pulse *= 0.9;
    fx.progress = Math.min(1, (performance.now() - fx.start) / (COUNT_FROM * 1000));
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, fx.w, fx.h);
    g.globalCompositeOperation = 'lighter';
    const busy = STYLE.frame(fx.s);
    const sparking = drawSparks();
    if (fx.on || busy || sparking) {
      requestAnimationFrame(drawFx);
    } else {
      if (STYLE.stop) STYLE.stop(fx.s);
      fx = null;
    }
  }

  function fxBeat(n) {
    if (!fx) return;
    fx.intensity = 0.4 + (COUNT_FROM - n) * 0.35;
    fx.pulse = 1;
    if (STYLE.beat) STYLE.beat(fx.s, n);
  }

  function fxLiftoff() {
    if (!fx) return;
    fx.pulse = 1.5;
    if (STYLE.liftoff) {
      STYLE.liftoff(fx.s);
    } else {
      sparks(140, 7);
      fx.on = false;
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
    fxBeat(n);
    if (n < COUNT_FROM && !reducedMotion()) retrigger(panel, 'jolt');
  }

  function liftoff() {
    numEl.textContent = 'LIFTOFF';
    retrigger(numEl, 'tick');
    panel.classList.add('liftoff');
    stepEl.textContent = visitUrl ? 'Opening the official website…' : 'We have liftoff';
    statusEl.textContent = 'Liftoff';
    fxLiftoff();
    burst(0.5, 0.45, 140);
    setTimeout(() => burst(0.2, 0.6, 70), 250);
    setTimeout(() => burst(0.8, 0.6, 70), 450);
    if (!reducedMotion()) retrigger(body, 'shake');
  }

  function finish() {
    if (visitUrl) {
      window.location.assign(visitUrl);
      return;
    }
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
