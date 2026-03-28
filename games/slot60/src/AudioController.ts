export class AudioController {
    private ctx: AudioContext | null = null;
    private initialized: boolean = false;

    constructor() {}

    public init() {
        if (this.initialized) return;
        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        this.ctx = new AudioContextClass();
        this.initialized = true;
    }

    public playTone(type: OscillatorType, frequency: number, duration: number, volume: number = 0.1) {
        if (!this.initialized) this.init();
        if (!this.ctx) return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(frequency, this.ctx.currentTime);

        gain.gain.setValueAtTime(volume, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    public playSpinStart() {
        this.playTone('square', 150, 0.3, 0.1);
    }

    public playReelStop() {
        this.playTone('triangle', 800, 0.1, 0.1);
    }

    public playWin() {
        [523.25, 659.25, 783.99].forEach((freq, i) => {
            setTimeout(() => this.playTone('sine', freq, 0.3, 0.1), i * 100);
        });
    }

    public playJackpot() {
        [523.25, 523.25, 523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
            setTimeout(() => this.playTone('square', freq, 0.5, 0.1), i * 150);
        });
    }
}
