// Audio System using Web Audio API
class SynthSystem {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.3; // Overall volume
        this.masterGain.connect(this.ctx.destination);
        
        this.bgmOsc = null;
        this.bgmGain = null;
        this.isPlayingBGM = false;
        
        // Synthwave arpeggio notes (Pentatonic minor scale)
        this.notes = [220, 261.63, 293.66, 329.63, 392.00, 440, 523.25]; // A3, C4, D4, E4, G4, A4, C5
        this.noteIndex = 0;
        this.bgmInterval = null;
    }

    init() {
        // Must be called on user interaction to unlock audio context
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    playMoveSound() {
        this._playTone(150, 'triangle', 0.05, 0.1);
    }

    playEatSound() {
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.connect(gain);
        gain.connect(this.masterGain);

        // Quick frequency envelope for an "upward" chime
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
        
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.5, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

        osc.start(now);
        osc.stop(now + 0.3);
    }

    playGameOverSound() {
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.connect(gain);
        gain.connect(this.masterGain);

        // Downward glitchy sound
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(20, now + 0.5);
        
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

        osc.start(now);
        osc.stop(now + 0.5);
    }

    startBGM() {
        if (this.isPlayingBGM) return;
        this.isPlayingBGM = true;
        
        const playNote = () => {
            if (!this.isPlayingBGM) return;
            const note = this.notes[this.noteIndex];
            this._playTone(note, 'square', 0.1, 0.1, 0.05);
            
            this.noteIndex = (this.noteIndex + 1) % this.notes.length;
            // Randomize sometimes for glitchy arpeggio feel
            if(Math.random() > 0.8) this.noteIndex = Math.floor(Math.random() * this.notes.length);
        };

        this.bgmInterval = setInterval(playNote, 150); // 150ms per 16th note
    }

    stopBGM() {
        this.isPlayingBGM = false;
        clearInterval(this.bgmInterval);
    }

    _playTone(freq, type, duration, vol, attack = 0.01) {
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

// Global instance to be used by game.js
const synth = new SynthSystem();
