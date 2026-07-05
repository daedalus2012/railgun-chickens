// Procedural Web Audio: no asset files, everything synthesized.
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.intensity = 0; // 0..1, rises with waves
    this.musicTimer = null;
    this.step = 0;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.master);

    // shared noise buffer
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  _noise(dur, filterType, freq, q = 1) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    src.connect(f);
    src.start();
    src.stop(ctx.currentTime + dur);
    return f;
  }

  // -------- SFX --------
  railgunShot() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;

    // deep body thump
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(32, t + 0.32);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(og).connect(this.master);
    osc.start(t); osc.stop(t + 0.45);

    // electric crack
    const crack = this._noise(0.14, 'highpass', 2400, 0.7);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.5, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    crack.connect(cg).connect(this.master);

    // charged zap sweep
    const zap = ctx.createOscillator();
    zap.type = 'sawtooth';
    zap.frequency.setValueAtTime(1900, t);
    zap.frequency.exponentialRampToValueAtTime(120, t + 0.16);
    const zg = ctx.createGain();
    zg.gain.setValueAtTime(0.16, t);
    zg.gain.exponentialRampToValueAtTime(0.001, t + 0.17);
    zap.connect(zg).connect(this.master);
    zap.start(t); zap.stop(t + 0.2);

    // air tail
    const tail = this._noise(0.5, 'bandpass', 700, 0.6);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.001, t);
    tg.gain.linearRampToValueAtTime(0.16, t + 0.03);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    tail.connect(tg).connect(this.master);
  }

  hit(heavy = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(heavy ? 110 : 170, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(heavy ? 0.5 : 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 0.18);
  }

  cluck(pitch = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    const f0 = (380 + Math.random() * 180) * pitch;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 1.6, t + 0.04);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.055, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = f0 * 1.5; f.Q.value = 2;
    osc.connect(f).connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 0.14);
  }

  explosion(big = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const boom = this._noise(big ? 0.9 : 0.5, 'lowpass', big ? 300 : 500, 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(big ? 0.8 : 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (big ? 0.85 : 0.45));
    boom.connect(g).connect(this.master);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(70, t);
    sub.frequency.exponentialRampToValueAtTime(28, t + 0.4);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.55, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    sub.connect(sg).connect(this.master);
    sub.start(t); sub.stop(t + 0.55);
  }

  reload() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const click = this._noise(0.05, 'bandpass', 1800 + i * 600, 4);
      const g = ctx.createGain();
      const tt = t + i * 0.14;
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(0.12, tt + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, tt + 0.05);
      click.connect(g).connect(this.master);
    }
  }

  uiClick() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(900, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 0.08);
  }

  waveStart() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [220, 330, 440].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = ctx.createGain();
      const tt = t + i * 0.09;
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(0.14, tt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, tt + 0.3);
      osc.connect(g).connect(this.master);
      osc.start(tt); osc.stop(tt + 0.32);
    });
  }

  // -------- Music: looping step sequencer that escalates with intensity --------
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const BPM = 96;
    const stepDur = 60 / BPM / 2; // 8th notes
    this.step = 0;
    // minor pentatonic-ish bassline
    const bass = [55, 55, 65.4, 55, 73.4, 65.4, 55, 49];
    const arp = [220, 261.6, 329.6, 293.7];

    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const ctx = this.ctx, t = ctx.currentTime;
      const s = this.step++;
      const inten = this.intensity;

      // bass every step
      const bf = bass[s % bass.length];
      const b = ctx.createOscillator();
      b.type = 'triangle';
      b.frequency.value = bf;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.22 + inten * 0.1, t);
      bg.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 0.95);
      b.connect(bg).connect(this.musicGain);
      b.start(t); b.stop(t + stepDur);

      // kick on beats, denser with intensity
      if (s % 4 === 0 || (inten > 0.5 && s % 4 === 2)) {
        const k = ctx.createOscillator();
        k.type = 'sine';
        k.frequency.setValueAtTime(120, t);
        k.frequency.exponentialRampToValueAtTime(40, t + 0.1);
        const kg = ctx.createGain();
        kg.gain.setValueAtTime(0.5, t);
        kg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        k.connect(kg).connect(this.musicGain);
        k.start(t); k.stop(t + 0.14);
      }

      // hats when intensity ramps
      if (inten > 0.15 && s % 2 === 1) {
        const h = this._noise(0.04, 'highpass', 8000, 1);
        const hg = ctx.createGain();
        hg.gain.setValueAtTime(0.05 + inten * 0.06, t);
        hg.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
        h.connect(hg).connect(this.musicGain);
      }

      // arp melody at higher intensity
      if (inten > 0.35 && s % 2 === 0) {
        const a = ctx.createOscillator();
        a.type = 'sawtooth';
        a.frequency.value = arp[(s >> 1) % arp.length] * (inten > 0.7 ? 2 : 1);
        const ag = ctx.createGain();
        ag.gain.setValueAtTime(0.05 + inten * 0.05, t);
        ag.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 0.8);
        const af = ctx.createBiquadFilter();
        af.type = 'lowpass';
        af.frequency.value = 900 + inten * 2600;
        a.connect(af).connect(ag).connect(this.musicGain);
        a.start(t); a.stop(t + stepDur);
      }
    }, stepDur * 1000);
  }

  setIntensity(v) { this.intensity = Math.min(1, v); }
}
