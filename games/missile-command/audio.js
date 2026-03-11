function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class AudioEngine {
  constructor() {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.context = null;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.musicFilter = null;
    this.noiseBuffer = null;
    this.musicActive = false;
    this.nextStepTime = 0;
    this.stepIndex = 0;
    this.supported = Boolean(AudioContextClass);
    this.audioContextClass = AudioContextClass ?? null;
    this.muted = false;
  }

  ensureContext() {
    if (this.context || !this.supported) {
      return this.context;
    }

    if (!this.audioContextClass) {
      this.supported = false;
      return null;
    }

    let context = null;

    try {
      context = new this.audioContextClass();
    } catch (error) {
      this.supported = false;
      return null;
    }
    const masterGain = context.createGain();
    const musicGain = context.createGain();
    const sfxGain = context.createGain();
    const musicFilter = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();

    masterGain.gain.value = 0.84;
    musicGain.gain.value = 0.0001;
    sfxGain.gain.value = 0.82;
    musicFilter.type = "lowpass";
    musicFilter.frequency.value = 1400;
    musicFilter.Q.value = 1.1;

    compressor.threshold.value = -18;
    compressor.knee.value = 20;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.18;

    musicGain.connect(musicFilter);
    musicFilter.connect(compressor);
    sfxGain.connect(compressor);
    compressor.connect(masterGain);
    masterGain.connect(context.destination);

    this.context = context;
    this.masterGain = masterGain;
    this.musicGain = musicGain;
    this.sfxGain = sfxGain;
    this.musicFilter = musicFilter;
    this.noiseBuffer = this.createNoiseBuffer(context);
    this.applyMuteState(false);
    return context;
  }

  createNoiseBuffer(context) {
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const channel = buffer.getChannelData(0);

    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = Math.random() * 2 - 1;
    }

    return buffer;
  }

  async unlock() {
    const context = this.ensureContext();
    if (!context) {
      return;
    }

    if (context.state === "suspended") {
      await context.resume();
    }
  }

  applyMuteState(withRamp = true) {
    if (!this.masterGain || !this.context) {
      return;
    }

    const now = this.context.currentTime;
    const target = this.muted ? 0.0001 : 0.84;
    this.masterGain.gain.cancelScheduledValues(now);
    if (withRamp) {
      this.masterGain.gain.setValueAtTime(Math.max(0.0001, this.masterGain.gain.value), now);
      this.masterGain.gain.exponentialRampToValueAtTime(target, now + 0.12);
    } else {
      this.masterGain.gain.setValueAtTime(target, now);
    }
  }

  setMuted(nextMuted) {
    this.muted = nextMuted;
    this.applyMuteState();
  }

  isMuted() {
    return this.muted;
  }

  getTempo(aliveCities) {
    const byCityCount = {
      4: 98,
      3: 112,
      2: 128,
      1: 148,
      0: 164,
    };

    return byCityCount[aliveCities] ?? 98;
  }

  getStepDuration(aliveCities) {
    return 60 / this.getTempo(aliveCities) / 4;
  }

  startMusic(aliveCities) {
    const context = this.ensureContext();
    if (!context) {
      return;
    }

    this.musicActive = true;
    this.stepIndex = 0;
    this.nextStepTime = context.currentTime + 0.04;
    this.musicGain.gain.cancelScheduledValues(context.currentTime);
    this.musicGain.gain.setValueAtTime(Math.max(0.0001, this.musicGain.gain.value), context.currentTime);
    this.musicGain.gain.exponentialRampToValueAtTime(0.22, context.currentTime + 0.35);
    this.musicFilter.frequency.setTargetAtTime(1000 + (4 - aliveCities) * 260, context.currentTime, 0.2);
  }

  stopMusic(fadeDuration = 0.45) {
    if (!this.context || !this.musicActive) {
      return;
    }

    const now = this.context.currentTime;
    this.musicActive = false;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(Math.max(0.0001, this.musicGain.gain.value), now);
    this.musicGain.gain.exponentialRampToValueAtTime(0.0001, now + fadeDuration);
  }

  update(state, aliveCities, timeLeft) {
    const context = this.context;
    if (!context || context.state !== "running") {
      return;
    }

    if (state !== "playing" && state !== "replay" && state !== "deploying") {
      this.stopMusic(0.28);
      return;
    }

    if (!this.musicActive) {
      this.startMusic(aliveCities);
    }

    const cutoff = 980 + (4 - aliveCities) * 320 + (60 - timeLeft) * 2.8;
    this.musicFilter.frequency.setTargetAtTime(clamp(cutoff, 920, 2400), context.currentTime, 0.14);

    while (this.nextStepTime < context.currentTime + 0.18) {
      this.scheduleMusicStep(this.nextStepTime, this.stepIndex, aliveCities);
      this.nextStepTime += this.getStepDuration(aliveCities);
      this.stepIndex = (this.stepIndex + 1) % 64;
    }
  }

  scheduleMusicStep(time, stepIndex, aliveCities) {
    const step = stepIndex % 16;
    const pulsePattern = [76, 79, 83, 86, 74, 79, 83, 86, 76, 79, 83, 88, 74, 79, 83, 86];
    const bassPattern = [40, 40, 43, 35];
    const pulseAccent = step % 4 === 0 ? 1 : 0.72;
    const pan = (step % 2 === 0 ? -0.2 : 0.2) * (aliveCities <= 2 ? 1.2 : 1);

    this.playTone({
      time,
      midi: pulsePattern[step],
      duration: 0.11,
      type: "sawtooth",
      volume: 0.038 * pulseAccent,
      attack: 0.004,
      release: 0.1,
      filterFrequency: 1800 + (4 - aliveCities) * 160,
      pan,
      destination: this.musicGain,
    });

    if (step % 2 === 0) {
      this.playNoise({
        time,
        duration: 0.03,
        volume: aliveCities <= 2 ? 0.012 : 0.008,
        filterType: "highpass",
        filterFrom: 4200,
        filterTo: 7800,
        destination: this.musicGain,
      });
    }

    if (step % 4 === 0) {
      this.playTone({
        time,
        midi: bassPattern[Math.floor(step / 4)],
        duration: 0.22,
        type: "triangle",
        volume: 0.08,
        attack: 0.01,
        release: 0.18,
        filterFrequency: 240,
        detune: -4,
        destination: this.musicGain,
      });

      this.playTone({
        time,
        midi: bassPattern[Math.floor(step / 4)] + 12,
        duration: 0.16,
        type: "sine",
        volume: 0.032,
        attack: 0.008,
        release: 0.12,
        filterFrequency: 320,
        destination: this.musicGain,
      });
    }

    if (aliveCities <= 2 && (step === 6 || step === 14)) {
      this.playTone({
        time,
        midi: aliveCities === 1 ? 88 : 84,
        duration: 0.14,
        type: "square",
        volume: 0.03,
        attack: 0.003,
        release: 0.12,
        filterFrequency: 2200,
        pan: 0.16,
        destination: this.musicGain,
      });
    }

    if (aliveCities === 1 && step % 4 === 2) {
      this.playTone({
        time,
        midi: pulsePattern[step] + 12,
        duration: 0.08,
        type: "triangle",
        volume: 0.024,
        attack: 0.002,
        release: 0.08,
        filterFrequency: 2400,
        pan: -0.18,
        destination: this.musicGain,
      });
    }
  }

  playLaunch() {
    const context = this.context;
    if (!context || context.state !== "running") {
      return;
    }

    const now = context.currentTime;
    this.playSweep({
      time: now,
      startMidi: 68,
      endMidi: 82,
      duration: 0.12,
      type: "triangle",
      volume: 0.06,
      filterFrequency: 1800,
    });
    this.playNoise({
      time: now,
      duration: 0.05,
      volume: 0.018,
      filterType: "bandpass",
      filterFrom: 1600,
      filterTo: 2400,
    });
  }

  playPlayerExplosion() {
    const context = this.context;
    if (!context || context.state !== "running") {
      return;
    }

    const now = context.currentTime;
    this.playNoise({
      time: now,
      duration: 0.45,
      volume: 0.11,
      filterType: "lowpass",
      filterFrom: 7400,
      filterTo: 520,
    });
    this.playSweep({
      time: now,
      startMidi: 46,
      endMidi: 25,
      duration: 0.42,
      type: "sawtooth",
      volume: 0.1,
      filterFrequency: 460,
      attack: 0.003,
    });
    this.playTone({
      time: now,
      midi: 88,
      duration: 0.07,
      type: "triangle",
      volume: 0.025,
      attack: 0.001,
      release: 0.06,
      filterFrequency: 3000,
    });
  }

  playEnemyDestroyed(type, chainCount = 1) {
    const context = this.context;
    if (!context || context.state !== "running") {
      return;
    }

    const notes = {
      normal: 84,
      split: 88,
      fast: 91,
      armored: 79,
    };
    const volume = 0.032 + Math.min(0.03, (chainCount - 1) * 0.006);
    const now = context.currentTime;

    this.playTone({
      time: now,
      midi: notes[type] ?? 84,
      duration: 0.09,
      type: "triangle",
      volume,
      attack: 0.002,
      release: 0.08,
      filterFrequency: 2600,
      pan: 0.1,
    });
    this.playNoise({
      time: now,
      duration: 0.08,
      volume: 0.016,
      filterType: "highpass",
      filterFrom: 4200,
      filterTo: 8600,
    });
  }

  playArmorHit() {
    const context = this.context;
    if (!context || context.state !== "running") {
      return;
    }

    const now = context.currentTime;
    this.playTone({
      time: now,
      midi: 67,
      duration: 0.07,
      type: "square",
      volume: 0.03,
      attack: 0.001,
      release: 0.06,
      filterFrequency: 1500,
    });
    this.playTone({
      time: now + 0.012,
      midi: 74,
      duration: 0.05,
      type: "square",
      volume: 0.02,
      attack: 0.001,
      release: 0.04,
      filterFrequency: 1800,
    });
  }

  playSplit() {
    const context = this.context;
    if (!context || context.state !== "running") {
      return;
    }

    const now = context.currentTime;
    this.playSweep({
      time: now,
      startMidi: 82,
      endMidi: 92,
      duration: 0.16,
      type: "triangle",
      volume: 0.04,
      filterFrequency: 2800,
      pan: -0.1,
    });
    this.playSweep({
      time: now + 0.02,
      startMidi: 86,
      endMidi: 96,
      duration: 0.16,
      type: "triangle",
      volume: 0.032,
      filterFrequency: 3200,
      pan: 0.12,
    });
  }

  playCityLost() {
    const context = this.context;
    if (!context || context.state !== "running") {
      return;
    }

    const now = context.currentTime;
    this.playNoise({
      time: now,
      duration: 0.5,
      volume: 0.08,
      filterType: "lowpass",
      filterFrom: 2800,
      filterTo: 220,
    });
    this.playSweep({
      time: now,
      startMidi: 40,
      endMidi: 20,
      duration: 0.55,
      type: "sawtooth",
      volume: 0.08,
      filterFrequency: 240,
      attack: 0.004,
    });
  }

  playBarrierDeploy() {
    const context = this.context;
    if (!context || context.state !== "running") {
      return;
    }

    const now = context.currentTime;
    this.playSweep({
      time: now,
      startMidi: 52,
      endMidi: 76,
      duration: 0.48,
      type: "triangle",
      volume: 0.045,
      filterFrequency: 1800,
      attack: 0.01,
    });
    this.playNoise({
      time: now + 0.02,
      duration: 0.34,
      volume: 0.018,
      filterType: "bandpass",
      filterFrom: 1800,
      filterTo: 5200,
    });
  }

  playBarrierIntercept(missileType = "normal") {
    const context = this.context;
    if (!context || context.state !== "running") {
      return;
    }

    const midiByType = {
      normal: 82,
      split: 86,
      fast: 90,
      armored: 76,
    };
    const now = context.currentTime;
    this.playTone({
      time: now,
      midi: midiByType[missileType] ?? 82,
      duration: 0.08,
      type: "triangle",
      volume: 0.028,
      attack: 0.002,
      release: 0.06,
      filterFrequency: 2600,
      pan: 0.08,
    });
    this.playNoise({
      time: now,
      duration: 0.05,
      volume: 0.012,
      filterType: "highpass",
      filterFrom: 3600,
      filterTo: 7200,
    });
  }

  playResult(result) {
    const context = this.context;
    if (!context || context.state !== "running") {
      return;
    }

    const now = context.currentTime;
    if (result === "clear") {
      this.playTone({
        time: now,
        midi: 76,
        duration: 0.22,
        type: "triangle",
        volume: 0.04,
        attack: 0.004,
        release: 0.18,
        filterFrequency: 2200,
      });
      this.playTone({
        time: now + 0.1,
        midi: 81,
        duration: 0.22,
        type: "triangle",
        volume: 0.038,
        attack: 0.004,
        release: 0.18,
        filterFrequency: 2200,
      });
      this.playTone({
        time: now + 0.2,
        midi: 83,
        duration: 0.3,
        type: "triangle",
        volume: 0.04,
        attack: 0.004,
        release: 0.26,
        filterFrequency: 2400,
      });
    } else {
      this.playSweep({
        time: now,
        startMidi: 52,
        endMidi: 28,
        duration: 0.6,
        type: "sawtooth",
        volume: 0.06,
        filterFrequency: 420,
        attack: 0.004,
      });
    }
  }

  playTone({
    time,
    midi,
    duration,
    type,
    volume,
    attack = 0.003,
    release = 0.12,
    filterFrequency = 1600,
    detune = 0,
    pan = 0,
    destination = this.sfxGain,
  }) {
    const context = this.context;
    if (!context) {
      return;
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const panner =
      typeof context.createStereoPanner === "function" ? context.createStereoPanner() : null;
    const endTime = time + duration;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(midiToFrequency(midi), time);
    oscillator.detune.setValueAtTime(detune, time);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(filterFrequency, time);
    filter.Q.value = 0.8;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime + release);

    if (panner) {
      panner.pan.setValueAtTime(pan, time);
      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(panner);
      panner.connect(destination);
    } else {
      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(destination);
    }

    oscillator.start(time);
    oscillator.stop(endTime + release + 0.02);
  }

  playSweep({
    time,
    startMidi,
    endMidi,
    duration,
    type,
    volume,
    attack = 0.002,
    filterFrequency = 1800,
    pan = 0,
  }) {
    const context = this.context;
    if (!context) {
      return;
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const panner =
      typeof context.createStereoPanner === "function" ? context.createStereoPanner() : null;
    const endTime = time + duration;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(midiToFrequency(startMidi), time);
    oscillator.frequency.exponentialRampToValueAtTime(midiToFrequency(endMidi), endTime);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(filterFrequency, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

    if (panner) {
      panner.pan.setValueAtTime(pan, time);
      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(panner);
      panner.connect(this.sfxGain);
    } else {
      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain);
    }

    oscillator.start(time);
    oscillator.stop(endTime + 0.02);
  }

  playNoise({
    time,
    duration,
    volume,
    filterType,
    filterFrom,
    filterTo,
    destination = this.sfxGain,
  }) {
    const context = this.context;
    if (!context || !this.noiseBuffer) {
      return;
    }

    const source = context.createBufferSource();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();

    source.buffer = this.noiseBuffer;
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFrom, time);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, filterTo), time + duration);
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    source.start(time);
    source.stop(time + duration + 0.02);
  }
}
