import { getAssetUrl } from '../utils/url';

const SOUND_FILES = [
  getAssetUrl('sounds/lego_clack_1.mp3'),
  getAssetUrl('sounds/lego_clack_2.mp3'),
  getAssetUrl('sounds/lego_clack_3.mp3'),
  getAssetUrl('sounds/lego_clack_4.mp3')
];

const AAC_FALLBACKS = [
  getAssetUrl('sounds/lego_clack_1.aac'),
  getAssetUrl('sounds/lego_clack_2.aac'),
  getAssetUrl('sounds/lego_clack_3.aac'),
  getAssetUrl('sounds/lego_clack_4.aac')
];

export class BrickAudioManager {
  private audioCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private soundBuffers: AudioBuffer[] = [];
  private isLoaded: boolean = false;
  private muted: boolean = false;
  private volume: number = 0.85;
  private lastTriggerTime: number = 0;
  private isUnlocked: boolean = false;

  constructor() {
    this.muted = false;
    this.initUserGestureUnlock();
  }

  private initUserGestureUnlock(): void {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      this.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('click', unlock);
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    window.addEventListener('click', unlock, { passive: true });
  }

  public unlock(): void {
    if (!this.audioCtx) {
      this.ensureContext();
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    this.isUnlocked = true;
    if (!this.isLoaded) {
      this.preload();
    }
  }

  private ensureContext(): void {
    if (this.audioCtx) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.audioCtx = new AudioCtx();
        this.masterGain = this.audioCtx.createGain();
        this.masterGain.gain.value = this.volume;
        this.masterGain.connect(this.audioCtx.destination);
      }
    } catch (e) {
      console.warn('AudioContext creation error:', e);
    }
  }

  public setMuted(val: boolean): void {
    this.muted = val;
    if (!val) {
      this.unlock();
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public async preload(): Promise<void> {
    if (this.isLoaded) return;
    this.ensureContext();
    if (!this.audioCtx) return;

    try {
      const promises = SOUND_FILES.map(async (file, idx) => {
        try {
          const res = await fetch(file);
          if (!res.ok) throw new Error();
          const buf = await res.arrayBuffer();
          return await this.audioCtx!.decodeAudioData(buf);
        } catch {
          try {
            const res2 = await fetch(AAC_FALLBACKS[idx]);
            const buf2 = await res2.arrayBuffer();
            return await this.audioCtx!.decodeAudioData(buf2);
          } catch {
            return null;
          }
        }
      });

      const buffers = await Promise.all(promises);
      this.soundBuffers = buffers.filter((b): b is AudioBuffer => b !== null);
      this.isLoaded = true;
    } catch (e) {
      console.warn('Audio preload error:', e);
    }
  }

  /**
   * Synthesize a crisp LEGO plastic snap sound using WebAudio oscillators and noise.
   * Guarantees 0ms latency sound even before external sound files finish downloading.
   */
  private playSynthesizedSnap(layerY: number = 0): void {
    if (!this.audioCtx || !this.masterGain) return;
    const ctx = this.audioCtx;
    const now = ctx.currentTime;

    // 1. High transient plastic click (frequency drop 2400Hz -> 300Hz in 12ms)
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    const baseFreq = 1800 + Math.min(600, layerY * 15) + (Math.random() * 200 - 100);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.025);

    oscGain.gain.setValueAtTime(0.65, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.028);

    osc.connect(oscGain);
    oscGain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.03);

    // 2. Resonant body pop (380Hz pulse)
    const bodyOsc = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    bodyOsc.type = 'sine';
    bodyOsc.frequency.setValueAtTime(380 + (Math.random() * 60 - 30), now);
    bodyOsc.frequency.exponentialRampToValueAtTime(80, now + 0.035);

    bodyGain.gain.setValueAtTime(0.45, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.038);

    bodyOsc.connect(bodyGain);
    bodyGain.connect(this.masterGain);

    bodyOsc.start(now);
    bodyOsc.stop(now + 0.04);
  }

  public triggerBrickPlacement(layerY: number = 0): void {
    if (this.muted) return;
    const now = performance.now();
    if (now - this.lastTriggerTime < 30) return; // Limit ~33 triggers/sec
    this.lastTriggerTime = now;

    this.ensureContext();
    if (!this.audioCtx) return;

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }

    // If preloaded recorded samples are ready, play a random sample
    if (this.soundBuffers.length > 0 && this.masterGain) {
      try {
        const idx = Math.floor(Math.random() * this.soundBuffers.length);
        const source = this.audioCtx.createBufferSource();
        source.buffer = this.soundBuffers[idx];
        source.playbackRate.value = 0.95 + Math.min(0.25, layerY * 0.006) + (Math.random() * 0.1 - 0.05);

        const gain = this.audioCtx.createGain();
        gain.gain.value = 0.55 + Math.random() * 0.25;

        source.connect(gain);
        gain.connect(this.masterGain);
        source.start(0);
        return;
      } catch {}
    }

    // Fallback: immediate synthesized LEGO plastic snap
    this.playSynthesizedSnap(layerY);
  }
}

export const brickAudio = new BrickAudioManager();
