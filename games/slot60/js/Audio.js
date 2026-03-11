export class AudioController {
    constructor() {
        this.ctx = null;
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
        this.initialized = true;
    }

    playTone(type, frequency, duration, volume = 0.1) {
        if (!this.initialized) this.init();
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

    playSpinStart() {
        this.playTone('square', 150, 0.3, 0.1);
    }

    playReelStop() {
        this.playTone('triangle', 800, 0.1, 0.1);
    }

    playWin() {
        // Simple arpeggio
        const now = this.ctx.currentTime;
        [523.25, 659.25, 783.99].forEach((freq, i) => { // C Major
            setTimeout(() => this.playTone('sine', freq, 0.3, 0.1), i * 100);
        });
    }

    playJackpot() {
        // Fanfare
        const now = this.ctx.currentTime;
        [523.25, 523.25, 523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
            setTimeout(() => this.playTone('square', freq, 0.5, 0.1), i * 150);
        });
    }
}
