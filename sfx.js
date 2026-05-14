'use strict';

// ============================================================
//  sfx.js — procedural WebAudio synth (no asset files).
// ============================================================

const SFX = {
  ctx: null,
  master: null,
  noiseBuf: null,
  lastPlay: {},
  muted: false,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.28;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  },
  _gate(id, minGap) {
    if (!this.ctx || this.muted) return false;
    const now = this.ctx.currentTime;
    const last = this.lastPlay[id] || 0;
    if (now - last < minGap) return false;
    this.lastPlay[id] = now;
    return true;
  },
  tone({ freq = 440, freq2 = null, dur = 0.1, type = 'square', vol = 0.3, attack = 0.005, release = null } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freq2 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq2), t + dur);
    const rel = release != null ? release : dur;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + rel + 0.001);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + rel + 0.05);
  },
  noise({ dur = 0.1, vol = 0.3, lp = 4000, hp = 100, rampLp = null } = {}) {
    if (!this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lpF = this.ctx.createBiquadFilter();
    lpF.type = 'lowpass';
    lpF.frequency.setValueAtTime(lp, t);
    if (rampLp != null) lpF.frequency.exponentialRampToValueAtTime(Math.max(50, rampLp), t + dur);
    const hpF = this.ctx.createBiquadFilter();
    hpF.type = 'highpass';
    hpF.frequency.value = hp;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.001);
    src.connect(hpF).connect(lpF).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  },
  arpeggio(freqs, step, { type = 'square', vol = 0.25, dur = 0.08 } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < freqs.length; i++) {
      const t = t0 + i * step;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freqs[i];
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
  },

  knife()      { if (!this._gate('knife', 0.04)) return; this.tone({ freq: 880, freq2: 480, dur: 0.06, type: 'square', vol: 0.08 }); },
  ice()        { if (!this._gate('ice', 0.05)) return; this.tone({ freq: 1400, freq2: 700, dur: 0.10, type: 'triangle', vol: 0.10 }); this.noise({ dur: 0.08, vol: 0.05, lp: 6000, hp: 2000 }); },
  lightning()  { if (!this._gate('lightning', 0.08)) return; this.noise({ dur: 0.18, vol: 0.16, lp: 9000, hp: 1500, rampLp: 1200 }); this.tone({ freq: 220, freq2: 60, dur: 0.18, type: 'sawtooth', vol: 0.06 }); },
  holy()       { if (!this._gate('holy', 0.06)) return; this.tone({ freq: 600, freq2: 1200, dur: 0.18, type: 'sine', vol: 0.09 }); },
  holySplash() { if (!this._gate('holySplash', 0.05)) return; this.noise({ dur: 0.16, vol: 0.10, lp: 5000, hp: 800, rampLp: 400 }); },
  aura()       { if (!this._gate('aura', 0.18)) return; this.tone({ freq: 180, freq2: 90, dur: 0.22, type: 'sawtooth', vol: 0.08 }); },
  bibleHit()   { if (!this._gate('bibleHit', 0.05)) return; this.tone({ freq: 1200, dur: 0.05, type: 'triangle', vol: 0.05 }); },
  enemyHit()   { if (!this._gate('enemyHit', 0.02)) return; this.noise({ dur: 0.05, vol: 0.06, lp: 1800, hp: 200 }); },
  enemyKill()  { if (!this._gate('enemyKill', 0.03)) return; this.tone({ freq: 240, freq2: 80, dur: 0.10, type: 'square', vol: 0.10 }); this.noise({ dur: 0.08, vol: 0.06, lp: 1200, hp: 100 }); },
  hurt()       { if (!this._gate('hurt', 0.15)) return; this.tone({ freq: 220, freq2: 90, dur: 0.22, type: 'sawtooth', vol: 0.22 }); },
  gem()        { if (!this._gate('gem', 0.012)) return; const f = 820 + Math.random() * 280; this.tone({ freq: f, freq2: f * 1.5, dur: 0.07, type: 'triangle', vol: 0.10 }); },
  heal()       { this.arpeggio([523, 659, 784], 0.05, { type: 'triangle', vol: 0.15, dur: 0.10 }); },
  magnet()     { this.tone({ freq: 500, freq2: 1500, dur: 0.25, type: 'square', vol: 0.10 }); },
  bomb()       { this.noise({ dur: 0.45, vol: 0.28, lp: 1200, hp: 60, rampLp: 80 }); this.tone({ freq: 120, freq2: 40, dur: 0.4, type: 'sawtooth', vol: 0.15 }); },
  chest()      { this.arpeggio([523, 659, 784, 1047, 1319], 0.05, { type: 'triangle', vol: 0.18, dur: 0.12 }); },
  levelUp()    { this.arpeggio([523, 659, 784, 1047], 0.06, { type: 'square', vol: 0.16, dur: 0.10 }); },
  superUnlock(){ this.arpeggio([392, 523, 659, 784, 988, 1319], 0.07, { type: 'sawtooth', vol: 0.18, dur: 0.14 }); },
  click()      { this.tone({ freq: 700, dur: 0.04, type: 'square', vol: 0.10 }); },
  pause()      { this.tone({ freq: 400, freq2: 250, dur: 0.10, type: 'square', vol: 0.10 }); },
  death()      { this.arpeggio([392, 311, 247, 196, 165], 0.10, { type: 'sawtooth', vol: 0.22, dur: 0.16 }); },
  revive()     { this.arpeggio([262, 392, 523, 784, 1047, 1568], 0.06, { type: 'triangle', vol: 0.22, dur: 0.14 }); },
  playerDown() { this.tone({ freq: 200, freq2: 60, dur: 0.5, type: 'sawtooth', vol: 0.24 }); },
  bossSpawn()  { this.arpeggio([110, 92, 73, 55], 0.10, { type: 'sawtooth', vol: 0.28, dur: 0.20 }); this.noise({ dur: 0.6, vol: 0.18, lp: 600, hp: 50, rampLp: 100 }); },
  bossTeleport(){ this.tone({ freq: 1200, freq2: 200, dur: 0.18, type: 'sawtooth', vol: 0.16 }); },
  bossSummon() { this.tone({ freq: 220, freq2: 660, dur: 0.22, type: 'square', vol: 0.18 }); },
  bossThorns() { this.noise({ dur: 0.20, vol: 0.20, lp: 4000, hp: 1500, rampLp: 800 }); this.tone({ freq: 660, freq2: 220, dur: 0.18, type: 'sawtooth', vol: 0.10 }); },
  bossSlam()   { this.noise({ dur: 0.5, vol: 0.30, lp: 800, hp: 40, rampLp: 60 }); this.tone({ freq: 90, freq2: 30, dur: 0.45, type: 'sawtooth', vol: 0.20 }); },
  bossDeath()  { this.arpeggio([220, 165, 110, 73], 0.14, { type: 'sawtooth', vol: 0.30, dur: 0.24 }); },
  victory()    { this.arpeggio([523, 659, 784, 1047, 1319, 1568, 2093], 0.10, { type: 'triangle', vol: 0.30, dur: 0.30 }); },
  // ---- new sounds ----
  shards()     { if (!this._gate('shards', 0.06)) return; this.tone({ freq: 1800, freq2: 900, dur: 0.10, type: 'triangle', vol: 0.08 }); this.noise({ dur: 0.06, vol: 0.05, lp: 8000, hp: 3000 }); },
  shardBreak() { if (!this._gate('shardBreak', 0.03)) return; this.tone({ freq: 2200, freq2: 1200, dur: 0.07, type: 'square', vol: 0.06 }); },
  hole()       { if (!this._gate('hole', 0.10)) return; this.tone({ freq: 90, freq2: 30, dur: 0.5, type: 'sine', vol: 0.10 }); this.noise({ dur: 0.4, vol: 0.05, lp: 600, hp: 60, rampLp: 80 }); },
  holePop()    { this.noise({ dur: 0.3, vol: 0.22, lp: 900, hp: 60, rampLp: 100 }); this.tone({ freq: 200, freq2: 60, dur: 0.3, type: 'sawtooth', vol: 0.14 }); },
  spit()       { if (!this._gate('spit', 0.10)) return; this.tone({ freq: 380, freq2: 180, dur: 0.16, type: 'triangle', vol: 0.10 }); },
  exploderTick(){ if (!this._gate('exploderTick', 0.08)) return; this.tone({ freq: 1000, dur: 0.04, type: 'square', vol: 0.07 }); },
  exploderBoom(){ this.noise({ dur: 0.35, vol: 0.26, lp: 1200, hp: 50, rampLp: 80 }); this.tone({ freq: 200, freq2: 60, dur: 0.3, type: 'sawtooth', vol: 0.16 }); },
  swarm()      { if (!this._gate('swarm', 0.08)) return; this.noise({ dur: 0.2, vol: 0.06, lp: 5000, hp: 500 }); this.tone({ freq: 900, freq2: 1400, dur: 0.18, type: 'triangle', vol: 0.05 }); },
  gas()        { if (!this._gate('gas', 0.10)) return; this.noise({ dur: 0.25, vol: 0.10, lp: 2200, hp: 200 }); },
  titanRoar()  { this.arpeggio([60, 50, 40], 0.15, { type: 'sawtooth', vol: 0.34, dur: 0.4 }); this.noise({ dur: 0.9, vol: 0.18, lp: 400, hp: 40, rampLp: 60 }); },
  titanBeam()  { this.noise({ dur: 0.55, vol: 0.20, lp: 5000, hp: 800, rampLp: 1200 }); this.tone({ freq: 600, freq2: 1800, dur: 0.5, type: 'sawtooth', vol: 0.12 }); },
};
