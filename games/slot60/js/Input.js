export class Input {
    constructor() {
        this.keys = {};
        this.touchActive = false;
        this.onInput = null; // Callback function

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                this.triggerInput();
            }
        });

        window.addEventListener('touchstart', (e) => {
            e.preventDefault(); // Prevent scrolling
            this.triggerInput();
        }, { passive: false });

        window.addEventListener('mousedown', (e) => {
            this.triggerInput();
        });
    }

    triggerInput() {
        if (this.onInput) {
            this.onInput();
        }
    }

    setHandler(callback) {
        this.onInput = callback;
    }
}
