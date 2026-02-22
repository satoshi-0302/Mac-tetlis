// Lightweight WebAudio synth for BGM and gameplay SFX (no external assets).

export type SfxId =
  | 'playerAttack'
  | 'magicAttack'
  | 'enemyAttack'
  | 'hit'
  | 'kill'
  | 'death'
  | 'heal'
  | 'chest'
  | 'stairs'
  | 'victory';

type MaybeAudioContext = AudioContext | null;

interface WebkitAudioWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

export class AudioSystem {
  private context: MaybeAudioContext = null;

  private masterGain: GainNode | null = null;

  private bgmGain: GainNode | null = null;

  private sfxGain: GainNode | null = null;

  private bgmTimerId: number | null = null;

  private bgmStep = 0;

  private nextBgmTime = 0;

  ensureStarted(): void {
    if (!this.context) {
      const audioCtor = window.AudioContext ?? (window as WebkitAudioWindow).webkitAudioContext;
      if (!audioCtor) {
        return;
      }

      this.context = new audioCtor();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = 0.7;
      this.masterGain.connect(this.context.destination);

      this.bgmGain = this.context.createGain();
      this.bgmGain.gain.value = 0.4;
      this.bgmGain.connect(this.masterGain);

      this.sfxGain = this.context.createGain();
      this.sfxGain.gain.value = 0.75;
      this.sfxGain.connect(this.masterGain);

      this.startBgmScheduler();
      return;
    }

    if (this.context.state === 'suspended') {
      void this.context.resume();
    }
  }

  playSfx(id: SfxId): void {
    if (!this.context || !this.sfxGain) {
      return;
    }

    const start = this.context.currentTime + 0.01;
    switch (id) {
      case 'playerAttack':
        this.playTone(680, 0.06, 0.2, 'square', start, this.sfxGain);
        this.playTone(460, 0.08, 0.16, 'triangle', start + 0.025, this.sfxGain);
        break;
      case 'magicAttack':
        this.playTone(760, 0.09, 0.2, 'triangle', start, this.sfxGain);
        this.playTone(1040, 0.08, 0.17, 'sine', start + 0.03, this.sfxGain);
        break;
      case 'enemyAttack':
        this.playTone(220, 0.09, 0.18, 'sawtooth', start, this.sfxGain);
        break;
      case 'hit':
        this.playTone(130, 0.07, 0.2, 'square', start, this.sfxGain);
        this.playTone(95, 0.09, 0.13, 'sawtooth', start + 0.01, this.sfxGain);
        break;
      case 'kill':
        this.playTone(900, 0.06, 0.22, 'square', start, this.sfxGain);
        this.playTone(620, 0.12, 0.18, 'triangle', start + 0.05, this.sfxGain);
        break;
      case 'death':
        this.playTone(260, 0.14, 0.24, 'sawtooth', start, this.sfxGain);
        this.playTone(150, 0.2, 0.22, 'square', start + 0.1, this.sfxGain);
        break;
      case 'heal':
        this.playTone(620, 0.08, 0.18, 'sine', start, this.sfxGain);
        this.playTone(860, 0.12, 0.16, 'sine', start + 0.06, this.sfxGain);
        break;
      case 'chest':
        this.playTone(720, 0.09, 0.2, 'triangle', start, this.sfxGain);
        this.playTone(1080, 0.13, 0.17, 'triangle', start + 0.08, this.sfxGain);
        break;
      case 'stairs':
        this.playTone(540, 0.08, 0.18, 'triangle', start, this.sfxGain);
        this.playTone(760, 0.08, 0.16, 'triangle', start + 0.08, this.sfxGain);
        this.playTone(980, 0.1, 0.14, 'sine', start + 0.16, this.sfxGain);
        break;
      case 'victory': {
        this.duckBgm(start, 2.6, 0.08);
        const melody: Array<{ hz: number; dur: number; gain: number; wave: OscillatorType }> = [
          { hz: 523.25, dur: 0.18, gain: 0.2, wave: 'triangle' },
          { hz: 659.26, dur: 0.18, gain: 0.2, wave: 'triangle' },
          { hz: 783.99, dur: 0.22, gain: 0.21, wave: 'triangle' },
          { hz: 1046.5, dur: 0.34, gain: 0.24, wave: 'square' },
          { hz: 783.99, dur: 0.18, gain: 0.18, wave: 'triangle' },
          { hz: 1046.5, dur: 0.24, gain: 0.2, wave: 'triangle' },
          { hz: 1318.5, dur: 0.58, gain: 0.24, wave: 'square' }
        ];
        let cursor = start;
        for (const note of melody) {
          this.playTone(note.hz, note.dur, note.gain, note.wave, cursor, this.sfxGain);
          this.playTone(note.hz / 2, note.dur + 0.08, note.gain * 0.42, 'sine', cursor, this.sfxGain);
          cursor += note.dur * 0.86;
        }
        break;
      }
      default:
        break;
    }
  }

  private startBgmScheduler(): void {
    if (!this.context || !this.bgmGain || this.bgmTimerId !== null) {
      return;
    }

    this.bgmStep = 0;
    this.nextBgmTime = this.context.currentTime + 0.08;
    this.bgmTimerId = window.setInterval(() => {
      this.scheduleBgmNotes();
    }, 120);
  }

  private scheduleBgmNotes(): void {
    if (!this.context || !this.bgmGain) {
      return;
    }

    const pattern = [0, 3, 7, 10, 7, 3, 5, 8];
    const baseHz = 220;

    while (this.nextBgmTime < this.context.currentTime + 0.6) {
      const semitone = pattern[this.bgmStep % pattern.length];
      const frequency = baseHz * 2 ** (semitone / 12);
      this.playTone(frequency, 0.22, 0.08, 'triangle', this.nextBgmTime, this.bgmGain);

      if (this.bgmStep % 2 === 0) {
        this.playTone(frequency / 2, 0.32, 0.06, 'sine', this.nextBgmTime, this.bgmGain);
      }

      this.nextBgmTime += 0.28;
      this.bgmStep += 1;
    }
  }

  private playTone(
    frequency: number,
    duration: number,
    peakGain: number,
    waveform: OscillatorType,
    startTime: number,
    destination: GainNode
  ): void {
    if (!this.context) {
      return;
    }

    const oscillator = this.context.createOscillator();
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, startTime);

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.02);
  }

  private duckBgm(startTime: number, duration: number, duckedGain: number): void {
    if (!this.context || !this.bgmGain) {
      return;
    }

    const current = this.bgmGain.gain.value;
    const minGain = Math.max(0.04, duckedGain);
    this.bgmGain.gain.cancelScheduledValues(startTime);
    this.bgmGain.gain.setValueAtTime(current, startTime);
    this.bgmGain.gain.linearRampToValueAtTime(minGain, startTime + 0.08);
    this.bgmGain.gain.setValueAtTime(minGain, startTime + duration);
    this.bgmGain.gain.linearRampToValueAtTime(0.4, startTime + duration + 0.36);
  }
}
