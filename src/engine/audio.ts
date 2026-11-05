/**
 * Procedural audio (WebAudio). No sound files: every effect is synthesised on demand.
 * `sfx(name)` is fire-and-forget and throttled per name. `music.start(track)` runs a small
 * step sequencer (kick, hat, bass, lead) with a lookahead scheduler.
 */

type SfxName =
  | 'nail' | 'nailHit' | 'recall' | 'rip' | 'arcOn' | 'overload' | 'charge'
  | 'shotgun' | 'reload' | 'slug' | 'slash' | 'deflect' | 'iaido' | 'cut'
  | 'dash' | 'leap' | 'land' | 'blink' | 'slide' | 'punch' | 'shove' | 'grapple' | 'hack'
  | 'hurt' | 'shield' | 'perfect' | 'bossHit' | 'armor' | 'weak' | 'explosion' | 'telegraph'
  | 'rev' | 'crash' | 'stagger' | 'lever' | 'siren' | 'crush' | 'click' | 'ui' | 'uiConfirm'
  | 'phase' | 'bossDeath' | 'spray' | 'stomp' | 'fire' | 'hook' | 'zap' | 'laser' | 'pop' | 'heal'
  | 'emp' | 'beat';

const THROTTLE: Partial<Record<SfxName, number>> = {
  nail: 0.03, nailHit: 0.04, bossHit: 0.045, armor: 0.07, weak: 0.07, pop: 0.03, spray: 0.05,
  zap: 0.06, fire: 0.1, deflect: 0.04, explosion: 0.05, click: 0.05,
};

export interface MusicTrack {
  bpm: number;
  /** 16-step patterns per bar. Bass/lead: semitone offsets from root or null. */
  kick: string; // 'x...' per step
  hat: string;
  snare: string;
  bass: (number | null)[];
  lead?: (number | null)[];
  root: number; // MIDI note
  /** Bars per chord step; chords = root offsets cycling. */
  chords: number[];
  wave?: OscillatorType;
}

class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private last = new Map<string, number>();
  private loops = new Map<string, { stop: () => void }>();
  volume = 0.7;
  musicVolume = 0.35;
  muted = false;

  /** Must be called from a user gesture (first click / key). Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(this.master);
    const len = ctx.sampleRate * 1.5;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setValueAtTime(m ? 0 : this.volume, this.ctx.currentTime);
  }

  get now(): number { return this.ctx?.currentTime ?? 0; }

  // ---------------------------------------------------------------- primitives
  private env(g: GainNode, t: number, a: number, peak: number, dec: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, at = 0, bus?: AudioNode): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.004, vol, dur);
    o.connect(g).connect(bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noiseHit(dur: number, vol: number, filter: BiquadFilterType, f0: number, f1 = f0, q = 1, at = 0, bus?: AudioNode): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const fl = ctx.createBiquadFilter();
    fl.type = filter;
    fl.Q.value = q;
    fl.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.003, vol, dur);
    src.connect(fl).connect(g).connect(bus ?? this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- effects
  sfx(name: SfxName, vol = 1, pitch = 1): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const th = THROTTLE[name];
    if (th !== undefined) {
      const l = this.last.get(name) ?? -1;
      if (now - l < th) return;
      this.last.set(name, now);
    }
    const v = vol, p = pitch;
    switch (name) {
      case 'nail': this.tone('square', 1100 * p, 500 * p, 0.05, 0.12 * v); this.noiseHit(0.03, 0.15 * v, 'highpass', 3000); break;
      case 'nailHit': this.noiseHit(0.04, 0.18 * v, 'bandpass', 2500 * p, 1500, 3); break;
      case 'recall': this.tone('sawtooth', 180, 1400, 0.28, 0.12 * v); this.noiseHit(0.25, 0.08 * v, 'bandpass', 800, 4000, 2); break;
      case 'rip': this.noiseHit(0.08, 0.3 * v, 'bandpass', 1800 * p, 600, 2); this.tone('triangle', 220 * p, 80, 0.08, 0.25 * v); break;
      case 'overload': this.tone('sine', 90, 30, 0.5, 0.5 * v); this.noiseHit(0.45, 0.35 * v, 'bandpass', 3000, 400, 1.5); this.tone('square', 1600, 200, 0.3, 0.08 * v); break;
      case 'charge': this.tone('sine', 400 * p, 1200 * p, 0.12, 0.1 * v); break;
      case 'shotgun': this.noiseHit(0.22, 0.6 * v, 'lowpass', 2600 * p, 300, 0.7); this.tone('sine', 140 * p, 40, 0.16, 0.6 * v); break;
      case 'reload': this.noiseHit(0.03, 0.2 * v, 'highpass', 2000); this.noiseHit(0.03, 0.22 * v, 'bandpass', 1400, 1400, 4, 0.12); break;
      case 'slug': this.noiseHit(0.35, 0.7 * v, 'lowpass', 1800, 150, 0.7); this.tone('sine', 90, 30, 0.3, 0.8 * v); this.tone('square', 600, 80, 0.12, 0.1 * v); break;
      case 'slash': this.noiseHit(0.09, 0.3 * v, 'highpass', 1800 * p, 5000, 1.2); break;
      case 'deflect': this.tone('sine', 1900 * p, 1700 * p, 0.28, 0.18 * v); this.tone('sine', 2850 * p, 2600 * p, 0.2, 0.1 * v); this.noiseHit(0.03, 0.2 * v, 'highpass', 4000); break;
      case 'iaido': this.noiseHit(0.16, 0.45 * v, 'bandpass', 600, 6000, 1); this.tone('sine', 2400, 2200, 0.4, 0.12 * v, 0.06); break;
      case 'cut': this.tone('square', 900, 120, 0.2, 0.15 * v); this.noiseHit(0.2, 0.3 * v, 'bandpass', 3000, 500, 2); break;
      case 'dash': this.noiseHit(0.12, 0.2 * v, 'bandpass', 900, 2600, 1.5); break;
      case 'leap': this.noiseHit(0.15, 0.2 * v, 'bandpass', 500, 1800, 1.5); this.tone('triangle', 200, 420, 0.15, 0.12 * v); break;
      case 'land': this.tone('sine', 120, 40, 0.18, 0.45 * v); this.noiseHit(0.15, 0.25 * v, 'lowpass', 900, 200); break;
      case 'blink': this.tone('sine', 500, 2400, 0.12, 0.15 * v); this.tone('square', 1200, 300, 0.08, 0.05 * v, 0.05); break;
      case 'slide': this.noiseHit(0.3, 0.2 * v, 'bandpass', 1500, 600, 1); break;
      case 'punch': this.tone('sine', 160 * p, 45, 0.2, 0.6 * v); this.noiseHit(0.1, 0.4 * v, 'lowpass', 2000, 300); break;
      case 'shove': this.noiseHit(0.18, 0.3 * v, 'bandpass', 400, 1500, 1); this.tone('sine', 110, 60, 0.15, 0.3 * v); break;
      case 'grapple': for (let i = 0; i < 4; i++) this.noiseHit(0.02, 0.15 * v, 'bandpass', 3000, 3000, 5, i * 0.035); break;
      case 'hack': for (let i = 0; i < 5; i++) this.tone('square', 600 + ((i * 37) % 5) * 300, 600 + ((i * 37) % 5) * 300, 0.04, 0.06 * v, i * 0.05); break;
      case 'hurt': this.tone('square', 420, 90, 0.22, 0.25 * v); this.noiseHit(0.2, 0.3 * v, 'lowpass', 1500, 200); break;
      case 'shield': this.tone('triangle', 1400, 500, 0.2, 0.2 * v); break;
      case 'perfect': this.tone('sine', 1320, 1320, 0.25, 0.14 * v); this.tone('sine', 1980, 1980, 0.3, 0.1 * v, 0.05); break;
      case 'bossHit': this.noiseHit(0.035, 0.12 * v, 'bandpass', 1400 * p, 900, 2); break;
      case 'armor': this.tone('square', 260 * p, 200 * p, 0.06, 0.07 * v); this.noiseHit(0.05, 0.12 * v, 'bandpass', 3500, 3000, 6); break;
      case 'weak': this.tone('triangle', 700 * p, 300, 0.07, 0.14 * v); break;
      case 'explosion': this.noiseHit(0.8, 0.8 * v, 'lowpass', 2400, 90, 0.8); this.tone('sine', 80, 25, 0.6, 0.9 * v); break;
      case 'telegraph': this.tone('square', 880 * p, 880 * p, 0.06, 0.06 * v); this.tone('square', 880 * p, 880 * p, 0.06, 0.06 * v, 0.1); break;
      case 'rev': this.tone('sawtooth', 50, 160, 0.75, 0.14 * v); this.noiseHit(0.75, 0.12 * v, 'lowpass', 300, 900, 1); break;
      case 'crash': this.noiseHit(0.6, 0.8 * v, 'lowpass', 1600, 100, 0.8); this.tone('sine', 70, 28, 0.5, 0.9 * v); this.tone('square', 300, 60, 0.3, 0.1 * v); break;
      case 'stagger': this.tone('sawtooth', 600, 150, 0.6, 0.15 * v); this.tone('sawtooth', 450, 110, 0.6, 0.12 * v); break;
      case 'lever': this.noiseHit(0.06, 0.3 * v, 'bandpass', 900, 900, 3); this.tone('square', 200, 120, 0.08, 0.15 * v, 0.04); break;
      case 'siren': for (let i = 0; i < 4; i++) this.tone('square', i % 2 ? 660 : 990, i % 2 ? 660 : 990, 0.16, 0.07 * v, i * 0.18); break;
      case 'crush': this.noiseHit(0.9, 0.9 * v, 'lowpass', 1200, 60, 0.7); this.tone('sine', 55, 22, 0.8, 1.0 * v); break;
      case 'click': this.noiseHit(0.02, 0.15 * v, 'highpass', 3000); break;
      case 'ui': this.tone('square', 660 * p, 660 * p, 0.04, 0.06 * v); break;
      case 'uiConfirm': this.tone('square', 660, 660, 0.05, 0.07 * v); this.tone('square', 990, 990, 0.08, 0.07 * v, 0.05); break;
      case 'phase': this.tone('sawtooth', 60, 30, 1.0, 0.3 * v); this.noiseHit(1.0, 0.5 * v, 'lowpass', 3000, 100, 0.7); this.tone('square', 220, 880, 0.8, 0.06 * v, 0.2); break;
      case 'bossDeath': for (let i = 0; i < 6; i++) this.noiseHit(0.5, 0.6 * v, 'lowpass', 2000, 80, 0.8, i * 0.25); this.tone('sawtooth', 300, 30, 2.0, 0.2 * v); break;
      case 'spray': this.noiseHit(0.1, 0.18 * v, 'bandpass', 700, 300, 1.5); break;
      case 'stomp': this.tone('sine', 70, 25, 0.5, 0.9 * v); this.noiseHit(0.4, 0.5 * v, 'lowpass', 800, 80); break;
      case 'fire': this.noiseHit(0.5, 0.3 * v, 'bandpass', 600, 1800, 0.6); break;
      case 'hook': this.noiseHit(0.15, 0.25 * v, 'bandpass', 1500, 500, 2); this.tone('square', 300, 150, 0.1, 0.08 * v); break;
      case 'zap': this.noiseHit(0.12, 0.25 * v, 'bandpass', 3500 * p, 1500, 3); this.tone('square', 1200 * p, 200, 0.08, 0.06 * v); break;
      case 'laser': this.tone('sawtooth', 220 * p, 200 * p, 0.6, 0.15 * v); this.tone('square', 880 * p, 860 * p, 0.6, 0.05 * v); break;
      case 'pop': this.tone('sine', 900 * p, 300 * p, 0.06, 0.12 * v); break;
      case 'heal': this.tone('triangle', 660, 1320, 0.3, 0.12 * v); break;
      case 'emp': this.tone('sine', 200, 1800, 0.25, 0.2 * v); this.noiseHit(0.4, 0.3 * v, 'highpass', 1000, 6000, 1); break;
      case 'beat': this.tone('sine', 1000, 1000, 0.03, 0.04 * v); break;
      case 'arcOn': break;
    }
  }

  /** Continuous sound on/off (arc beam crackle). */
  loop(name: 'arc', on: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const cur = this.loops.get(name);
    if (on && !cur && !this.muted) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2600;
      bp.Q.value = 2.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 17;
      const lg = ctx.createGain();
      lg.gain.value = 1400;
      lfo.connect(lg).connect(bp.frequency);
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.03);
      const buzz = ctx.createOscillator();
      buzz.type = 'sawtooth';
      buzz.frequency.value = 120;
      const bg = ctx.createGain();
      bg.gain.value = 0.03;
      buzz.connect(bg).connect(g);
      src.connect(bp).connect(g).connect(this.sfxBus);
      src.start(); lfo.start(); buzz.start();
      this.loops.set(name, {
        stop: () => {
          const t = ctx.currentTime;
          g.gain.cancelScheduledValues(t);
          g.gain.setValueAtTime(g.gain.value, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
          src.stop(t + 0.06); lfo.stop(t + 0.06); buzz.stop(t + 0.06);
        },
      });
    } else if (!on && cur) {
      cur.stop();
      this.loops.delete(name);
    }
  }

  stopLoops(): void {
    for (const l of this.loops.values()) l.stop();
    this.loops.clear();
  }

  // ---------------------------------------------------------------- music
  private seq: { track: MusicTrack; next: number; step: number; timer: number; start: number } | null = null;

  startMusic(track: MusicTrack): void {
    this.stopMusic();
    const ctx = this.ctx;
    if (!ctx) return;
    const s = { track, next: ctx.currentTime + 0.1, step: 0, timer: 0, start: ctx.currentTime + 0.1 };
    s.timer = window.setInterval(() => this.schedule(), 25);
    this.seq = s;
  }

  stopMusic(): void {
    if (this.seq) window.clearInterval(this.seq.timer);
    this.seq = null;
  }

  setMusicVolume(v: number): void {
    this.musicVolume = v;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2);
  }

  /** Current position in beats since the track started (null when no music). */
  beat(): number | null {
    if (!this.seq || !this.ctx) return null;
    return ((this.ctx.currentTime - this.seq.start) * this.seq.track.bpm) / 60;
  }

  private schedule(): void {
    const s = this.seq, ctx = this.ctx;
    if (!s || !ctx) return;
    const tr = s.track;
    const stepDur = 60 / tr.bpm / 4;
    while (s.next < ctx.currentTime + 0.12) {
      const i = s.step % 16;
      const bar = Math.floor(s.step / 16);
      const chord = tr.chords[Math.floor(bar / 2) % tr.chords.length];
      const at = s.next - ctx.currentTime;
      const bus = this.musicBus;
      if (tr.kick[i] === 'x') { this.tone('sine', 150, 40, 0.18, 0.9, at, bus); }
      if (tr.snare[i] === 'x') { this.noiseHit(0.14, 0.35, 'bandpass', 1800, 1200, 0.8, at, bus); this.tone('triangle', 220, 120, 0.08, 0.2, at, bus); }
      if (tr.hat[i] === 'x') this.noiseHit(0.03, 0.12, 'highpass', 7000, 7000, 1, at, bus);
      const b = tr.bass[i];
      if (b !== null && b !== undefined) {
        const f = 440 * Math.pow(2, (tr.root + chord + b - 69) / 12);
        this.tone(tr.wave ?? 'sawtooth', f, f, stepDur * 1.6, 0.22, at, bus);
      }
      const l = tr.lead?.[(s.step % 32) % (tr.lead?.length ?? 1)];
      if (l !== null && l !== undefined && tr.lead) {
        const f = 440 * Math.pow(2, (tr.root + 24 + chord + l - 69) / 12);
        this.tone('square', f, f, stepDur * 1.2, 0.05, at, bus);
      }
      s.next += stepDur;
      s.step++;
    }
  }
}

export const audio = new AudioEngine();
export type { SfxName };
