import * as THREE from 'three';
import { Game, Wanderer } from './game';

// Recorded clips for the big moments (public/audio), synthesized sound for the rest.
// Positional where it matters, because sound is a mechanic.
const CLIPS = ['ambience', 'roar', 'distant-screams', 'wail', 'jumpscare', 'scream-a', 'scream-b', 'breathing-1', 'breathing-2', 'music'] as const;
type Clip = (typeof CLIPS)[number];
// The roar file holds several separate roars: [start, length] in seconds.
// How loud the PA music is right under the speaker; it fades with distance from there.
const MUSIC_VOL = 0.32;
const ROARS = [[0, 2.1], [2.9, 2.2], [5.4, 1.6], [9.4, 2.2], [12.4, 1.6]];

export class Sound {
  listener = new THREE.AudioListener();
  ctx: AudioContext;
  private noiseBuf: AudioBuffer;
  private hums: { gain: GainNode; audio: THREE.PositionalAudio }[] = [];
  private master: GainNode;
  private clips = new Map<Clip, AudioBuffer>();
  private ambience: AudioBufferSourceNode | null = null;
  private music: AudioBufferSourceNode | null = null;
  private musicLevel: GainNode | null = null;
  private musicOut: PannerNode | null = null;
  private hiss: AudioBufferSourceNode | null = null;
  private nextDropout = 0;
  private nextDistant = 0;
  private nextBeat = 0;
  private oscillators: OscillatorNode[] = [];
  private breathUntil = new Map<number, number>();
  private camera: THREE.Camera;
  private pa: { x: number; z: number; y: number };

  constructor(game: Game, camera: THREE.Camera, scene: THREE.Scene) {
    camera.add(this.listener);
    this.camera = camera;
    this.pa = game.level.pa;
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
      this.oscillators.push(o1, o2);
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

    for (const name of CLIPS) {
      fetch(`audio/${name}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then((b) => this.ctx.decodeAudioData(b))
        .then((buf) => {
          this.clips.set(name, buf);
          if (name === 'ambience') this.startAmbience();
          if (name === 'music') this.startMusic();
        })
        .catch(() => { /* fall back to synthesized sound */ });
    }
  }

  /** Play a clip, optionally just a section of it, fading out at the end of the section. */
  private clip(name: Clip, dest: AudioNode, vol: number, rate = 1, offset = 0, length?: number): boolean {
    const buf = this.clips.get(name);
    if (!buf) return false;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    src.connect(g).connect(dest);
    if (length) {
      const end = t + length / rate;
      g.gain.setValueAtTime(vol, end - 0.3);
      g.gain.linearRampToValueAtTime(0, end);
      src.start(t, offset, length);
    } else {
      src.start(t, offset);
    }
    return true;
  }

  /** The room tone under everything, looping for the whole night. */
  private startAmbience() {
    const buf = this.clips.get('ambience');
    if (!buf || this.ambience || this.ctx.state !== 'running') return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopEnd = buf.duration - 0.5; // the file dips to silence at the very end
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, this.ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.45, this.ctx.currentTime + 4);
    src.connect(g).connect(this.master);
    src.start();
    this.ambience = src;
  }

  /**
   * Background music, as if from a tired old PA speaker over the middle of the map: mono,
   * band-limited, overdriven, played slow and wavering, smeared by the room and
   * echoed by a speaker further off. Now and then the signal drops out.
   */
  private startMusic() {
    const buf = this.clips.get('music');
    if (!buf || this.music || this.ctx.state !== 'running') return;
    const ctx = this.ctx, now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = 2;
    src.loopEnd = buf.duration - 15; // skip the fade-out at the end
    src.playbackRate.value = 0.93; // a little slow, and so a little flat

    // Tape-like wow and flutter, plus a slow drift, so it never sits in tune.
    for (const [hz, cents] of [[0.031, 28], [0.23, 16], [5.7, 5]]) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = hz;
      const depth = ctx.createGain();
      depth.gain.value = cents;
      lfo.connect(depth).connect(src.detune);
      lfo.start(now);
      this.oscillators.push(lfo);
    }

    // One speaker: mono.
    const mono = ctx.createGain();
    mono.channelCount = 1;
    mono.channelCountMode = 'explicit';
    mono.channelInterpretation = 'speakers';

    // A cheap horn: no lows, no highs, a honk in the middle.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 380;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3000;
    const honk = ctx.createBiquadFilter();
    honk.type = 'peaking';
    honk.frequency.value = 1400;
    honk.Q.value = 1.2;
    honk.gain.value = 7;

    // An amplifier pushed past what it can take.
    const drive = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / 511.5 - 1) * 3.5) / Math.tanh(3.5);
    drive.curve = curve;
    drive.oversample = '2x';

    // The room: a long, hard reverb tail.
    const room = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = Math.floor(ctx.sampleRate * 0.03); i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    room.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;

    // Another speaker down the hall, a beat behind.
    const echo = ctx.createDelay(1);
    echo.delayTime.value = 0.17;
    const echoBack = ctx.createGain();
    echoBack.gain.value = 0.3;
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.35;

    const level = ctx.createGain();
    level.gain.setValueAtTime(0, now);
    level.gain.linearRampToValueAtTime(MUSIC_VOL, now + 8);

    src.connect(mono).connect(hp).connect(lp).connect(honk).connect(drive);
    drive.connect(level);
    drive.connect(room).connect(wet).connect(level);
    drive.connect(echo).connect(echoOut).connect(level);
    echo.connect(echoBack).connect(echo);
    // All of it comes from the one speaker over the middle of the map: loud under it,
    // faint by the outer walls.
    const speaker = ctx.createPanner();
    speaker.panningModel = 'HRTF';
    // About -13 dB at 10 m, -22 dB at 20 m and -31 dB out by the walls.
    speaker.distanceModel = 'exponential';
    speaker.refDistance = 4;
    speaker.rolloffFactor = 1.6;
    speaker.positionX.value = this.pa.x;
    speaker.positionY.value = this.pa.y - 0.5;
    speaker.positionZ.value = this.pa.z;
    level.connect(speaker).connect(this.master);
    src.start(now, 2);

    // Line hiss under it.
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noiseBuf;
    hiss.loop = true;
    const hissF = ctx.createBiquadFilter();
    hissF.type = 'bandpass';
    hissF.frequency.value = 3500;
    hissF.Q.value = 0.6;
    const hissG = ctx.createGain();
    hissG.gain.value = 0.05;
    hiss.connect(hissF).connect(hissG).connect(level);
    hiss.start(now);

    this.music = src;
    this.musicLevel = level;
    this.musicOut = speaker;
    this.hiss = hiss;
    this.nextDropout = now + 25 + Math.random() * 30;
  }

  /** The PA cuts out for a moment, crackles, and comes back. */
  private musicDropout() {
    const g = this.musicLevel;
    if (!g) return;
    const t = this.ctx.currentTime;
    const gone = 0.25 + Math.random() * 1.2;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(MUSIC_VOL, t);
    g.gain.linearRampToValueAtTime(0.02, t + 0.04);
    g.gain.setValueAtTime(0.02, t + gone);
    g.gain.linearRampToValueAtTime(MUSIC_VOL, t + gone + 0.08);
    // The crackles come from the speaker too.
    const out = this.musicOut ?? this.master;
    this.noise(out, 0.03, 2500, 1, 0.35);
    setTimeout(() => this.noise(out, 0.03, 1800, 1, 0.3), gone * 1000);
  }

  resume() {
    const start = () => {
      this.startAmbience();
      this.startMusic();
    };
    if (this.ctx.state !== 'running') this.ctx.resume().then(start);
    else start();
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

  play(kind: string, x: number, z: number, loud: number, who?: Wanderer) {
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
        if (who && this.clip(who.voice ? 'scream-b' : 'scream-a', this.panner(x, z, 1.6), 0.6 + 0.4 * loud, 0.95 + Math.random() * 0.1)) break;
        const p = this.panner(x, z, 1.6);
        this.tone(p, 'sawtooth', 620, 380, 1.1 * loud + 0.3, 0.25);
        this.tone(p, 'square', 900, 500, 0.9 * loud + 0.3, 0.06);
        break;
      }
      case 'catch': {
        // Starts on the hit, so it lands with the cut to black.
        if (this.clip('jumpscare', this.master, 0.9, 1, 0.9, 4)) break;
        const p = this.panner(x, z, 1.6);
        this.tone(p, 'sawtooth', 700, 220, 1.4, 0.35);
        this.noise(this.master, 1.2, 90, 0.7, 0.8, 'lowpass');
        break;
      }
      case 'breath': {
        // Recorded quietly, so boosted; positional, so only audible up close.
        if (!who || this.ctx.currentTime < (this.breathUntil.get(who.id) ?? 0)) break;
        const p = this.panner(x, z, 1.5);
        p.refDistance = 1.2;
        p.rolloffFactor = 2;
        if (Math.random() < 0.5) {
          this.clip('breathing-1', p, 6 * loud);
          this.breathUntil.set(who.id, this.ctx.currentTime + 3.6);
        } else {
          this.clip('breathing-2', p, 6 * loud, 1, Math.random() * 5.5, 3.5);
          this.breathUntil.set(who.id, this.ctx.currentTime + 3.5);
        }
        break;
      }
      case 'roar': {
        // Your own voice, when someone sees you up close.
        const [at, len] = ROARS[Math.floor(Math.random() * ROARS.length)];
        this.clip('roar', this.master, 0.55, 0.95 + Math.random() * 0.1, at, len);
        break;
      }
      case 'escape':
        // Prey slipping out: the building wails for what it lost.
        this.clip('wail', this.master, 0.6);
        break;
      case 'blackout':
        this.noise(this.panner(x, z, 2.6), 0.12, 2000, 2, 0.5);
        this.tone(this.panner(x, z, 2.6), 'square', 120, 40, 0.5, 0.1);
        break;
      case 'door': {
        // A slow hinge creak.
        const p = this.panner(x, z, 1.2);
        const t = this.ctx.currentTime;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = 14;
        f.frequency.setValueAtTime(380 + Math.random() * 200, t);
        f.frequency.linearRampToValueAtTime(900 + Math.random() * 500, t + 0.45);
        f.frequency.linearRampToValueAtTime(600, t + 0.8);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.9, t + 0.08);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
        src.connect(f).connect(g).connect(p);
        src.start(t, Math.random() * 0.4);
        src.stop(t + 0.9);
        break;
      }
      case 'doorShut': {
        const p = this.panner(x, z, 1.2);
        this.noise(p, 0.35, 110, 0.8, 1.2, 'lowpass');
        this.noise(p, 0.06, 2400, 2, 0.4);
        break;
      }
      case 'phone': {
        // An old bell phone: three rings, somewhere out there.
        const p = this.panner(x, z, 0.3);
        p.refDistance = 4;
        const t0 = this.ctx.currentTime;
        for (let r = 0; r < 3; r++) {
          const t = t0 + r * 3;
          const g = this.ctx.createGain();
          g.gain.value = 0;
          const bell = this.ctx.createGain();
          bell.gain.value = 0.14;
          for (const hz of [440, 480]) {
            const o = this.ctx.createOscillator();
            o.frequency.value = hz;
            o.connect(g);
            o.start(t);
            o.stop(t + 1.6);
          }
          // The clapper: amplitude chopped at 20 Hz.
          const lfo = this.ctx.createOscillator();
          lfo.type = 'square';
          lfo.frequency.value = 20;
          lfo.connect(g.gain);
          lfo.start(t);
          lfo.stop(t + 1.6);
          g.connect(bell).connect(p);
        }
        break;
      }
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

  /** A faint electronic whine as the eyes adjust, and a drop as they relax. */
  nightVision(on: boolean) {
    if (this.ctx.state !== 'running') return;
    if (on) {
      this.tone(this.master, 'sine', 900, 5200, 0.7, 0.025);
      this.noise(this.master, 0.25, 4000, 1, 0.08);
    } else {
      this.tone(this.master, 'sine', 3000, 600, 0.35, 0.015);
    }
  }

  ui(kind: 'deny' | 'select') {
    if (this.ctx.state !== 'running') return;
    if (kind === 'deny') this.tone(this.master, 'square', 140, 110, 0.15, 0.05);
    else this.tone(this.master, 'sine', 330, 440, 0.08, 0.04);
  }

  /** A human's own heartbeat, faster and louder as fear climbs. fear is 0..1. */
  heartbeat(fear: number) {
    if (this.ctx.state !== 'running' || fear < 0.3) return;
    const now = this.ctx.currentTime;
    if (now < this.nextBeat) return;
    const bpm = 70 + fear * 90;
    this.nextBeat = now + 60 / bpm;
    const vol = 0.15 + fear * 0.35;
    this.tone(this.master, 'sine', 62, 38, 0.16, vol);
    setTimeout(() => this.tone(this.master, 'sine', 55, 34, 0.14, vol * 0.7), 140);
  }

  /** Stop everything this night started. */
  dispose() {
    for (const o of this.oscillators) { try { o.stop(); } catch { /* already stopped */ } }
    try { this.ambience?.stop(); } catch { /* already stopped */ }
    try { this.music?.stop(); } catch { /* already stopped */ }
    try { this.hiss?.stop(); } catch { /* already stopped */ }
    this.master.disconnect();
    this.listener.gain.disconnect();
    this.listener.removeFromParent();
  }

  /** Called each frame with per-circuit light levels so the hum follows the lights. */
  update(levels: (i: number) => number) {
    for (let i = 0; i < this.hums.length; i++) this.setCircuit(i, levels(i));

    const now = this.ctx.currentTime;
    if (this.music && now >= this.nextDropout) {
      this.nextDropout = now + 25 + Math.random() * 45;
      this.musicDropout();
    }

    // Now and then, something else screams far off in the Backrooms.
    if (this.ctx.state === 'running' && this.clips.has('distant-screams')) {
      if (this.nextDistant === 0) this.nextDistant = now + 40 + Math.random() * 40;
      else if (now >= this.nextDistant) {
        this.nextDistant = now + 60 + Math.random() * 70;
        const p = new THREE.Vector3();
        this.camera.getWorldPosition(p);
        const a = Math.random() * Math.PI * 2, d = 25 + Math.random() * 15;
        const pan = this.panner(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, 1.5);
        pan.refDistance = 12;
        this.clip('distant-screams', pan, 0.9, 0.85 + Math.random() * 0.25);
      }
    }
  }
}
