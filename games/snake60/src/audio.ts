class SynthSystem {
  public ctx: AudioContext;
  private masterGain: GainNode;
  private isPlayingBGM = false;
  private notes = [220, 261.63, 293.66, 329.63, 392.0, 440, 523.25];
  private noteIndex = 0;
  private bgmInterval: number | null = null;

  constructor() {
    this.ctx = new (window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.3;
    this.masterGain.connect(this.ctx.destination);
  }

  public init() {
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  public playMoveSound() {
    this.playTone(150, 'triangle', 0.05, 0.1);
  }

  public playEatSound() {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.5, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  public playGameOverSound() {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(20, now + 0.5);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  public startBGM() {
    if (this.isPlayingBGM) return;
    this.isPlayingBGM = true;
    const playNote = () => {
      if (!this.isPlayingBGM) return;
      const note = this.notes[this.noteIndex];
      this.playTone(note, 'square', 0.1, 0.1, 0.05);
      this.noteIndex = (this.noteIndex + 1) % this.notes.length;
      if (Math.random() > 0.8) {
        this.noteIndex = Math.floor(Math.random() * this.notes.length);
      }
    };
    this.bgmInterval = window.setInterval(playNote, 150);
  }

  public stopBGM() {
    this.isPlayingBGM = false;
    if (this.bgmInterval !== null) {
      window.clearInterval(this.bgmInterval);
      this.bgmInterval = null;
    }
  }

  private playTone(freq: number, type: OscillatorType, duration: number, vol: number, attack = 0.01) {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(this.masterGain);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.start(now);
    osc.stop(now + duration);
  }
}

export const synth = new SynthSystem();
