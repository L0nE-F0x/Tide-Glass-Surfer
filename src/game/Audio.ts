import { clamp01 } from "../util/math.ts";
import type { Surfer } from "./physics.ts";

/**
 * Procedural audio — no asset files. A filtered-noise "water rush" whose volume
 * and brightness track speed and foam, plus short synthesised SFX for pumps,
 * barrels and wipeouts. Everything is guarded so a missing/locked AudioContext
 * never throws.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windSrc: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  private musicNext = 0;
  private chordIdx = 0;
  private muted = false;
  private started = false;

  /** A slow, chill chord progression (Hz) for the ambient bed. */
  private static readonly CHORDS = [
    [146.83, 220.0, 277.18], // D  F# C#
    [110.0, 164.81, 220.0], //  A  E  A
    [123.47, 185.0, 246.94], // B  F# B
    [164.81, 246.94, 329.63], // E  B  E
  ];
  /** A pentatonic palette for the sparse bell arpeggio. */
  private static readonly ARP = [293.66, 329.63, 440.0, 493.88, 587.33, 659.25];

  private ensure(): boolean {
    if (this.ctx) return true;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
      return false;
    }
    return true;
  }

  private noiseBuffer(): AudioBuffer {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Resume the context (must be from a user gesture) and start the water bed. */
  start(): void {
    if (!this.ensure()) return;
    const ctx = this.ctx!;
    if (ctx.state === "suspended") void ctx.resume();
    if (this.started) return;
    this.started = true;

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windFilter.frequency.value = 500;

    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.0;

    this.windSrc = ctx.createBufferSource();
    this.windSrc.buffer = this.noiseBuffer();
    this.windSrc.loop = true;
    this.windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master!);
    this.windSrc.start();

    // ambient music bed (gentle, low in the mix)
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.0;
    this.musicGain.gain.setTargetAtTime(0.5, ctx.currentTime, 2.0);
    this.musicGain.connect(this.master!);
    this.musicNext = ctx.currentTime + 0.4;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
  }

  update(_dt: number, surfer: Surfer | null): void {
    if (!this.ctx || !this.windGain || !this.windFilter) return;
    this.tickMusic();
    const t = this.ctx.currentTime;
    if (surfer && surfer.alive) {
      const sf = clamp01(surfer.speed / 34);
      const targetGain = 0.05 + sf * 0.35 + surfer.foam * 0.25;
      const targetFreq = 350 + sf * 2600 + surfer.foam * 1500;
      this.windGain.gain.setTargetAtTime(targetGain, t, 0.12);
      this.windFilter.frequency.setTargetAtTime(targetFreq, t, 0.12);
    } else {
      this.windGain.gain.setTargetAtTime(0.04, t, 0.3);
      this.windFilter.frequency.setTargetAtTime(300, t, 0.3);
    }
  }

  private blip(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  private burst(dur: number, gain: number, freq: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start();
    src.stop(ctx.currentTime + dur + 0.02);
  }

  // ---- ambient music bed --------------------------------------------------
  private tickMusic(): void {
    if (!this.ctx || !this.musicGain) return;
    const ctx = this.ctx;
    // if the tab was backgrounded the clock jumped — don't dump a backlog of chords
    if (this.musicNext < ctx.currentTime) this.musicNext = ctx.currentTime + 0.1;
    const chordDur = 6.0;
    while (this.musicNext < ctx.currentTime + 0.2) {
      const at = this.musicNext;
      const chord = Audio.CHORDS[this.chordIdx % Audio.CHORDS.length];
      this.playPad(chord, at, chordDur);
      const notes = 2 + ((Math.random() * 2) | 0);
      for (let i = 0; i < notes; i++) {
        const nt = at + chordDur * (0.1 + Math.random() * 0.8);
        this.arpNote(Audio.ARP[(Math.random() * Audio.ARP.length) | 0], nt);
      }
      this.chordIdx++;
      this.musicNext += chordDur;
    }
  }

  private playPad(freqs: number[], at: number, dur: number): void {
    if (!this.ctx || !this.musicGain) return;
    const ctx = this.ctx;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.setValueAtTime(700, at);
    filt.frequency.linearRampToValueAtTime(1300, at + dur * 0.5);
    filt.frequency.linearRampToValueAtTime(600, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.05, at + 1.6); // slow swell
    g.gain.setValueAtTime(0.05, at + dur - 1.8);
    g.gain.linearRampToValueAtTime(0.0001, at + dur); // release
    filt.connect(g);
    g.connect(this.musicGain);
    for (const f of freqs) {
      for (const det of [-3, 3]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(filt);
        o.start(at);
        o.stop(at + dur + 0.1);
      }
    }
  }

  private arpNote(freq: number, at: number): void {
    if (!this.ctx || !this.musicGain) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.06, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 1.4);
    o.connect(g);
    g.connect(this.musicGain);
    o.start(at);
    o.stop(at + 1.5);
  }

  pump(quality: number): void {
    this.blip(220 + quality * 260, 0.18, "triangle", 0.18, 520 + quality * 300);
  }
  scrub(): void {
    this.burst(0.18, 0.12, 900);
  }
  barrel(): void {
    this.blip(90, 0.6, "sine", 0.22, 140);
  }
  /** A bright rising chime when a trick lands — brighter for bigger scores. */
  trick(intensity: number): void {
    const base = 470 + clamp01(intensity) * 380;
    this.blip(base, 0.16, "triangle", 0.16, base * 1.5);
  }
  wipeout(): void {
    this.burst(0.7, 0.35, 400);
  }
}
