import * as THREE from 'three';
import { Game } from './game';

// All sound is synthesized; placeholder, but positional, because sound is a mechanic.
export class Sound {
  listener = new THREE.AudioListener();
  ctx: AudioContext;
  private noiseBuf: AudioBuffer;
  private hums: { gain: GainNode; audio: THREE.PositionalAudio }[] = [];
  private master: GainNode;

  constructor(game: Game, camera: THREE.Camera, scene: THREE.Scene) {
    camera.add(this.listener);
    this.ctx = this.listener.context;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.listener.getInput());

    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // One hum source per light circuit: you always hear where the lights are.
    const L = game.level;
    for (let i = 0; i < L.circuitCount; i++) {
      const gain = this.ctx.createGain();
      gain.gain.value = 0.22;
      const o1 = this.ctx.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.value = 60 + (i % 3) * 0.4;
      const o2 = this.ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = 120.5 + (i % 4) * 0.3;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 380;
      const g2 = this.ctx.createGain();
      g2.gain.value = 0.5;
      o1.connect(lp);
      o2.connect(g2).connect(lp);
      lp.connect(gain);
      o1.start();
      o2.start();
      const audio = new THREE.PositionalAudio(this.listener);
      audio.setNodeSource(gain as unknown as AudioScheduledSourceNode);
      audio.setRefDistance(4);
      audio.setRolloffFactor(1.4);
      audio.setDistanceModel('inverse');
      const c = L.circuitCenter[i];
      audio.position.set(c.x, 2.5, c.z);
      scene.add(audio);
      this.hums.push({ gain, audio });
    }
  }

  resume() {
    if (this.ctx.state !== 'running') this.ctx.resume();
  }

  setCircuit(i: number, level: number) {
    const g = this.hums[i]?.gain;
    if (g) g.gain.setTargetAtTime(0.22 * level, this.ctx.currentTime, 0.03);
  }

  private panner(x: number, z: number, y = 1) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 2.5;
    p.rolloffFactor = 1.3;
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
    p.connect(this.master);
    return p;
  }

  private noise(dest: AudioNode, dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'bandpass') {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(dest: AudioNode, type: OscillatorType, f0: number, f1: number, dur: number, vol: number) {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(kind: string, x: number, z: number, loud: number) {
    if (this.ctx.state !== 'running') return;
    switch (kind) {
      case 'step':
        this.noise(this.panner(x, z, 0.1), 0.09, 300 + Math.random() * 200, 1.2, 0.25 * loud);
        break;
      case 'chalk':
        for (let i = 0; i < 3; i++) setTimeout(() => this.noise(this.panner(x, z, 0.3), 0.18, 3200, 3, 0.18), i * 220);
        break;
      case 'gasp':
        this.noise(this.panner(x, z, 1.6), 0.4, 1200, 0.8, 0.4);
        break;
      case 'scream': {
        const p = this.panner(x, z, 1.6);
        this.tone(p, 'sawtooth', 620, 380, 1.1 * loud + 0.3, 0.25);
        this.tone(p, 'square', 900, 500, 0.9 * loud + 0.3, 0.06);
        break;
      }
      case 'catch': {
        const p = this.panner(x, z, 1.6);
        this.tone(p, 'sawtooth', 700, 220, 1.4, 0.35);
        this.noise(this.master, 1.2, 90, 0.7, 0.8, 'lowpass');
        break;
      }
      case 'blackout':
        this.noise(this.panner(x, z, 2.6), 0.12, 2000, 2, 0.5);
        this.tone(this.panner(x, z, 2.6), 'square', 120, 40, 0.5, 0.1);
        break;
      case 'lightsOn':
        this.noise(this.panner(x, z, 2.6), 0.08, 2500, 2, 0.3);
        break;
      case 'shift':
        // Only the monster hears the building move.
        this.noise(this.panner(x, z, 1.3), 1.0, 70, 1, 0.6, 'lowpass');
        this.tone(this.master, 'sine', 55, 38, 1.0, 0.12);
        break;
    }
  }

  ui(kind: 'deny' | 'select') {
    if (this.ctx.state !== 'running') return;
    if (kind === 'deny') this.tone(this.master, 'square', 140, 110, 0.15, 0.05);
    else this.tone(this.master, 'sine', 330, 440, 0.08, 0.04);
  }

  /** Called each frame with per-circuit light levels so the hum follows the lights. */
  update(levels: (i: number) => number) {
    for (let i = 0; i < this.hums.length; i++) this.setCircuit(i, levels(i));
  }
}
