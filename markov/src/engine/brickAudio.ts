/**
 * Brick Audio Manager for Markov Growing Core Studio.
 *
 * Plays authentic LEGO piece clack/snap sound effects during constructive growth.
 */

const SOUND_FILES = [
  '/sounds/lego_clack_1.mp3',
  '/sounds/lego_clack_2.mp3',
  '/sounds/lego_clack_3.mp3',
  '/sounds/lego_clack_4.mp3'
];

const AAC_FALLBACKS = [
  '/sounds/lego_clack_1.aac',
  '/sounds/lego_clack_2.aac',
  '/sounds/lego_clack_3.aac',
  '/sounds/lego_clack_4.aac'
];

export class BrickAudioManager {
  private audioCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private soundBuffers: AudioBuffer[] = [];
  private htmlAudios: HTMLAudioElement[] = [];
  private isLoaded: boolean = false;
  private muted: boolean = false;
  private volume: number = 0.75;
  private lastTriggerTime: number = 0;

  constructor() {
    this.muted = false;
  }

  public async preload(): Promise<void> {
    if (this.isLoaded) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.audioCtx = new AudioCtx();
        this.masterGain = this.audioCtx.createGain();
        this.masterGain.gain.value = this.volume;
        this.masterGain.connect(this.audioCtx.destination);

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
      }

      if (this.soundBuffers.length === 0) {
        this.htmlAudios = SOUND_FILES.map(file => {
          const a = new Audio(file);
          a.volume = this.volume;
          return a;
        });
      }

      this.isLoaded = true;
    } catch (e) {
      console.warn('Audio preload error:', e);
    }
  }

  public triggerBrickPlacement(layerY: number = 0): void {
    if (this.muted) return;
    const now = performance.now();
    if (now - this.lastTriggerTime < 35) return; // Limit ~28 triggers/sec
    this.lastTriggerTime = now;

    if (!this.audioCtx) {
      this.preload();
      return;
    }

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    const count = this.soundBuffers.length > 0 ? this.soundBuffers.length : this.htmlAudios.length;
    if (count === 0) return;

    const idx = Math.floor(Math.random() * count);

    if (this.soundBuffers[idx] && this.audioCtx && this.masterGain) {
      try {
        const source = this.audioCtx.createBufferSource();
        source.buffer = this.soundBuffers[idx];
        source.playbackRate.value = 0.95 + Math.min(0.2, layerY * 0.005) + (Math.random() * 0.1 - 0.05);

        const gain = this.audioCtx.createGain();
        gain.gain.value = 0.4 + Math.random() * 0.3;

        source.connect(gain);
        gain.connect(this.masterGain);
        source.start(0);
      } catch {}
    } else if (this.htmlAudios[idx]) {
      try {
        const audio = this.htmlAudios[idx].cloneNode(true) as HTMLAudioElement;
        audio.volume = this.volume * 0.5;
        audio.play().catch(() => {});
      } catch {}
    }
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  public isMuted(): boolean {
    return this.muted;
  }
}

export const brickAudio = new BrickAudioManager();
