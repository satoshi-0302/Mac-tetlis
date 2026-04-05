function createNoiseBuffer(context, seconds = 1) {
  const sampleRate = context.sampleRate;
  const frameCount = Math.floor(sampleRate * seconds);
  const buffer = context.createBuffer(1, frameCount, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < frameCount; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }

  return buffer;
}

function buildMusicBuffer(context, durationSeconds = 8) {
  const sampleRate = context.sampleRate;
  const frameCount = Math.floor(sampleRate * durationSeconds);
  const buffer = context.createBuffer(1, frameCount, sampleRate);
  const data = buffer.getChannelData(0);

  const bpm = 142;
  const beatDuration = 60 / bpm;
  const melody = [0, 3, 7, 10, 12, 10, 7, 3, 5, 8, 12, 15, 12, 8, 5, 3];
  const bass = [0, 0, -5, -5, -2, -2, -7, -7];

  for (let i = 0; i < frameCount; i += 1) {
    const t = i / sampleRate;

    const melodyStep = Math.floor(t / (beatDuration * 0.5)) % melody.length;
    const melodyStart = melodyStep * beatDuration * 0.5;
    const melodyAge = t - melodyStart;
    const melodyFreq = 220 * Math.pow(2, melody[melodyStep] / 12);
    const melodyEnv = Math.exp(-melodyAge * 6);
    const melodySample = Math.sin(2 * Math.PI * melodyFreq * t) * melodyEnv * 0.2;

    const bassStep = Math.floor(t / beatDuration) % bass.length;
    const bassStart = bassStep * beatDuration;
    const bassAge = t - bassStart;
    const bassFreq = 110 * Math.pow(2, bass[bassStep] / 12);
    const bassEnv = Math.exp(-bassAge * 4.5);
    const bassSample = Math.sin(2 * Math.PI * bassFreq * t) * bassEnv * 0.25;

    const pulse = Math.sin(2 * Math.PI * (melodyFreq * 0.5) * t) > 0 ? 1 : -1;
    const pulseSample = pulse * melodyEnv * 0.04;

    data[i] = (melodySample + bassSample + pulseSample) * 0.7;
  }

  return buffer;
}

export class AudioEngine {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this.musicGain = null;
    this.musicSource = null;
    this.noiseBuffer = null;
    this.thrusterGain = null;
    this.thrusterSource = null;
  }

  async unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = 0.7;
      this.masterGain.connect(this.context.destination);

      this.noiseBuffer = createNoiseBuffer(this.context, 1);
      this.startMusicLoop();
      this.setupThrusterLoop();
    }

    if (this.context.state !== 'running') {
      await this.context.resume();
    }
  }

  startMusicLoop() {
    if (!this.context || this.musicSource) {
      return;
    }

    this.musicGain = this.context.createGain();
    this.musicGain.gain.value = 0.18;
    this.musicGain.connect(this.masterGain);

    this.musicSource = this.context.createBufferSource();
    this.musicSource.buffer = buildMusicBuffer(this.context, 8);
    this.musicSource.loop = true;

    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2200;

    this.musicSource.connect(filter);
    filter.connect(this.musicGain);
    this.musicSource.start();
  }

  setupThrusterLoop() {
    if (!this.context || !this.noiseBuffer || this.thrusterSource) {
      return;
    }

    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    const highpass = this.context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 200;

    const bandpass = this.context.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 780;
    bandpass.Q.value = 0.4;

    const gain = this.context.createGain();
    gain.gain.value = 0.0001;

    source.connect(highpass);
    highpass.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(this.masterGain);

    source.start();

    this.thrusterSource = source;
    this.thrusterGain = gain;
  }

  setThruster(active) {
    if (!this.context || !this.thrusterGain) {
      return;
    }

    const now = this.context.currentTime;
    this.thrusterGain.gain.cancelScheduledValues(now);
    this.thrusterGain.gain.linearRampToValueAtTime(active ? 0.13 : 0.0001, now + 0.04);
  }

  playShot() {
    if (!this.context || this.context.state !== 'running') {
      return;
    }

    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1250, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.09);

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  playExplosion(size) {
    if (!this.context || this.context.state !== 'running' || !this.noiseBuffer) {
      return;
    }

    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;

    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(size >= 4 ? 680 : size === 3 ? 900 : size === 2 ? 1200 : 1700, now);
    filter.frequency.exponentialRampToValueAtTime(size >= 4 ? 130 : 180, now + 0.3);

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(size >= 4 ? 0.42 : size === 3 ? 0.32 : 0.24, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (size >= 4 ? 0.42 : 0.32));

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    source.start(now);
    source.stop(now + (size >= 4 ? 0.44 : 0.34));
  }

  playShipDestroyed() {
    if (!this.context || this.context.state !== 'running' || !this.noiseBuffer) {
      return;
    }

    const now = this.context.currentTime;

    const noise = this.context.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const noiseFilter = this.context.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(640, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(110, now + 0.45);
    noiseFilter.Q.value = 0.7;

    const noiseGain = this.context.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.5, now + 0.018);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 0.58);

    const boom = this.context.createOscillator();
    boom.type = 'triangle';
    boom.frequency.setValueAtTime(180, now);
    boom.frequency.exponentialRampToValueAtTime(42, now + 0.46);

    const boomGain = this.context.createGain();
    boomGain.gain.setValueAtTime(0.0001, now);
    boomGain.gain.exponentialRampToValueAtTime(0.38, now + 0.02);
    boomGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

    boom.connect(boomGain);
    boomGain.connect(this.masterGain);
    boom.start(now);
    boom.stop(now + 0.52);
  }

  playBomb() {
    if (!this.context || this.context.state !== 'running' || !this.noiseBuffer) {
      return;
    }

    const now = this.context.currentTime;

    const pulseOsc = this.context.createOscillator();
    pulseOsc.type = 'square';
    pulseOsc.frequency.setValueAtTime(160, now);
    pulseOsc.frequency.exponentialRampToValueAtTime(36, now + 0.42);

    const pulseGain = this.context.createGain();
    pulseGain.gain.setValueAtTime(0.0001, now);
    pulseGain.gain.exponentialRampToValueAtTime(0.42, now + 0.018);
    pulseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.46);

    pulseOsc.connect(pulseGain);
    pulseGain.connect(this.masterGain);
    pulseOsc.start(now);
    pulseOsc.stop(now + 0.48);

    const noise = this.context.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(180, now + 0.44);
    filter.Q.value = 0.6;

    const noiseGain = this.context.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.6, now + 0.012);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 0.52);
  }

  playGameClearFanfare() {
    if (!this.context || this.context.state !== 'running') {
      return;
    }

    const now = this.context.currentTime;
    const notes = [
      { offset: 0, semitone: 0, duration: 0.2, gain: 0.16 },
      { offset: 0.12, semitone: 4, duration: 0.22, gain: 0.18 },
      { offset: 0.26, semitone: 7, duration: 0.24, gain: 0.2 },
      { offset: 0.44, semitone: 12, duration: 0.58, gain: 0.24 }
    ];

    for (const note of notes) {
      const startAt = now + note.offset;
      const osc = this.context.createOscillator();
      osc.type = note.semitone >= 7 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(392 * Math.pow(2, note.semitone / 12), startAt);

      const gain = this.context.createGain();
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(note.gain, startAt + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + note.duration);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(startAt);
      osc.stop(startAt + note.duration + 0.02);
    }

    const shimmer = this.context.createOscillator();
    shimmer.type = 'sawtooth';
    shimmer.frequency.setValueAtTime(784, now + 0.44);
    shimmer.frequency.exponentialRampToValueAtTime(1176, now + 0.92);

    const shimmerGain = this.context.createGain();
    shimmerGain.gain.setValueAtTime(0.0001, now + 0.44);
    shimmerGain.gain.exponentialRampToValueAtTime(0.08, now + 0.52);
    shimmerGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.02);

    shimmer.connect(shimmerGain);
    shimmerGain.connect(this.masterGain);
    shimmer.start(now + 0.44);
    shimmer.stop(now + 1.05);
  }

  playWarpAscend() {
    if (!this.context || this.context.state !== 'running' || !this.noiseBuffer) {
      return;
    }

    const now = this.context.currentTime;
    const lift = this.context.createOscillator();
    lift.type = 'sawtooth';
    lift.frequency.setValueAtTime(180, now);
    lift.frequency.exponentialRampToValueAtTime(1240, now + 0.72);

    const liftGain = this.context.createGain();
    liftGain.gain.setValueAtTime(0.0001, now);
    liftGain.gain.exponentialRampToValueAtTime(0.1, now + 0.05);
    liftGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.76);

    lift.connect(liftGain);
    liftGain.connect(this.masterGain);
    lift.start(now);
    lift.stop(now + 0.8);

    const noise = this.context.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(420, now);
    filter.frequency.exponentialRampToValueAtTime(2800, now + 0.78);
    filter.Q.value = 0.8;

    const noiseGain = this.context.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.06, now + 0.04);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.84);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 0.86);
  }
}
