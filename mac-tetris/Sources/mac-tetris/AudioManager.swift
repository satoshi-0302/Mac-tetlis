import AVFoundation
import Foundation

@MainActor
final class AudioManager: ObservableObject {
    enum Effect {
        case move
        case rotate
        case softDrop
        case hardDrop
        case lineClear
        case gameOver
        case pause
        case resume
        case restart
    }

    @Published var effectsEnabled = true
    @Published var musicEnabled = true {
        didSet {
            updateMusicState()
        }
    }

    private enum Waveform {
        case sine
        case square
        case triangle
    }

    private let engine = AVAudioEngine()
    private let effectNode = AVAudioPlayerNode()
    private let musicNode = AVAudioPlayerNode()
    private let format: AVAudioFormat
    private let sampleRate: Double
    private var effectBuffers: [Effect: AVAudioPCMBuffer] = [:]
    private var musicBuffer: AVAudioPCMBuffer?

    init() {
        sampleRate = 44_100
        format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2)!
        configureEngine()
        prepareBuffers()
        startEngine()
        updateMusicState()
    }

    func play(_ effect: Effect) {
        guard effectsEnabled, let buffer = effectBuffers[effect] else { return }
        startEngine()

        if !effectNode.isPlaying {
            effectNode.play()
        }
        effectNode.scheduleBuffer(buffer, completionHandler: nil)
    }

    func stopMusic() {
        musicNode.stop()
    }

    private func configureEngine() {
        engine.attach(effectNode)
        engine.attach(musicNode)
        engine.connect(effectNode, to: engine.mainMixerNode, format: format)
        engine.connect(musicNode, to: engine.mainMixerNode, format: format)
        engine.mainMixerNode.outputVolume = 0.92
        effectNode.volume = 0.95
        musicNode.volume = 0.35
    }

    private func prepareBuffers() {
        effectBuffers[.move] = makeToneBuffer(
            frequency: 260,
            duration: 0.05,
            volume: 0.16,
            waveform: .square
        )
        effectBuffers[.rotate] = makeSweepBuffer(
            from: 430,
            to: 760,
            duration: 0.08,
            volume: 0.18,
            waveform: .triangle
        )
        effectBuffers[.softDrop] = makeToneBuffer(
            frequency: 180,
            duration: 0.05,
            volume: 0.14,
            waveform: .sine
        )
        effectBuffers[.hardDrop] = makeSweepBuffer(
            from: 350,
            to: 120,
            duration: 0.12,
            volume: 0.20,
            waveform: .square
        )
        effectBuffers[.lineClear] = makeMelodyBuffer(
            notes: [523.25, 659.25, 783.99],
            noteDuration: 0.10,
            volume: 0.18,
            waveform: .triangle
        )
        effectBuffers[.gameOver] = makeMelodyBuffer(
            notes: [392.0, 370.0, 349.2, 329.6, 293.7, 261.6],
            noteDuration: 0.12,
            volume: 0.16,
            waveform: .sine
        )
        effectBuffers[.pause] = makeToneBuffer(
            frequency: 320,
            duration: 0.07,
            volume: 0.16,
            waveform: .triangle
        )
        effectBuffers[.resume] = makeToneBuffer(
            frequency: 520,
            duration: 0.07,
            volume: 0.16,
            waveform: .triangle
        )
        effectBuffers[.restart] = makeMelodyBuffer(
            notes: [392.0, 523.25, 659.25],
            noteDuration: 0.08,
            volume: 0.16,
            waveform: .square
        )

        musicBuffer = makeMusicLoopBuffer()
    }

    private func startEngine() {
        guard !engine.isRunning else { return }
        do {
            try engine.start()
        } catch {
            return
        }
    }

    private func updateMusicState() {
        guard musicEnabled else {
            musicNode.stop()
            return
        }
        startMusicLoop()
    }

    private func startMusicLoop() {
        guard let musicBuffer else { return }
        startEngine()

        guard !musicNode.isPlaying else { return }
        musicNode.scheduleBuffer(musicBuffer, at: nil, options: [.loops], completionHandler: nil)
        musicNode.play()
    }

    private func makeToneBuffer(
        frequency: Double,
        duration: Double,
        volume: Double,
        waveform: Waveform
    ) -> AVAudioPCMBuffer {
        let frameCount = AVAudioFrameCount(duration * sampleRate)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount)!
        buffer.frameLength = frameCount

        guard let channels = buffer.floatChannelData else { return buffer }
        let left = channels[0]
        let right = channels[1]

        for frame in 0..<Int(frameCount) {
            let time = Double(frame) / sampleRate
            let progress = Double(frame) / Double(max(1, Int(frameCount) - 1))
            let env = envelope(progress: progress, attack: 0.06, release: 0.22)
            let sample = waveSample(cycle: frequency * time, waveform: waveform) * volume * env
            let value = Float(sample)
            left[frame] = value
            right[frame] = value
        }

        return buffer
    }

    private func makeSweepBuffer(
        from startFrequency: Double,
        to endFrequency: Double,
        duration: Double,
        volume: Double,
        waveform: Waveform
    ) -> AVAudioPCMBuffer {
        let frameCount = AVAudioFrameCount(duration * sampleRate)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount)!
        buffer.frameLength = frameCount

        guard let channels = buffer.floatChannelData else { return buffer }
        let left = channels[0]
        let right = channels[1]

        var phase = 0.0
        for frame in 0..<Int(frameCount) {
            let progress = Double(frame) / Double(max(1, Int(frameCount) - 1))
            let frequency = startFrequency + ((endFrequency - startFrequency) * progress)
            phase += frequency / sampleRate
            let env = envelope(progress: progress, attack: 0.03, release: 0.30)
            let sample = waveSample(cycle: phase, waveform: waveform) * volume * env
            let value = Float(sample)
            left[frame] = value
            right[frame] = value
        }

        return buffer
    }

    private func makeMelodyBuffer(
        notes: [Double?],
        noteDuration: Double,
        volume: Double,
        waveform: Waveform
    ) -> AVAudioPCMBuffer {
        let totalDuration = noteDuration * Double(notes.count)
        let totalFrames = AVAudioFrameCount(totalDuration * sampleRate)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: totalFrames)!
        buffer.frameLength = totalFrames

        guard let channels = buffer.floatChannelData else { return buffer }
        let left = channels[0]
        let right = channels[1]

        for frame in 0..<Int(totalFrames) {
            let time = Double(frame) / sampleRate
            let noteIndex = min(notes.count - 1, Int(time / noteDuration))
            let noteProgress = (time - (Double(noteIndex) * noteDuration)) / noteDuration
            let env = envelope(progress: noteProgress, attack: 0.08, release: 0.35)

            var sample = 0.0
            if let frequency = notes[noteIndex] {
                sample = waveSample(cycle: frequency * time, waveform: waveform) * volume * env
            }

            let value = Float(sample)
            left[frame] = value
            right[frame] = value
        }

        return buffer
    }

    private func makeMusicLoopBuffer() -> AVAudioPCMBuffer {
        let stepDuration = 0.20
        let steps = 32
        let totalFrames = AVAudioFrameCount(stepDuration * Double(steps) * sampleRate)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: totalFrames)!
        buffer.frameLength = totalFrames

        guard let channels = buffer.floatChannelData else { return buffer }
        let left = channels[0]
        let right = channels[1]

        let bassPattern: [Double?] = [
            130.81, nil, 130.81, nil, 146.83, nil, 146.83, nil,
            164.81, nil, 164.81, nil, 146.83, nil, 130.81, nil,
            130.81, nil, 130.81, nil, 174.61, nil, 174.61, nil,
            164.81, nil, 146.83, nil, 130.81, nil, 130.81, nil
        ]
        let leadPattern: [Double?] = [
            523.25, nil, 659.25, nil, 783.99, nil, 659.25, nil,
            587.33, nil, 659.25, nil, 698.46, nil, 659.25, nil,
            523.25, nil, 659.25, nil, 783.99, nil, 659.25, nil,
            587.33, nil, 523.25, nil, 493.88, nil, 440.00, nil
        ]
        let kickPattern: [Bool] = [
            true, false, false, false, true, false, false, false,
            true, false, false, false, true, false, false, false,
            true, false, false, false, true, false, false, false,
            true, false, false, false, true, false, false, false
        ]

        for frame in 0..<Int(totalFrames) {
            let time = Double(frame) / sampleRate
            let stepIndex = min(steps - 1, Int(time / stepDuration))
            let stepTime = time - (Double(stepIndex) * stepDuration)
            let stepProgress = stepTime / stepDuration

            var sample = 0.0
            if let bassFreq = bassPattern[stepIndex] {
                let bass = waveSample(cycle: bassFreq * time, waveform: .sine)
                sample += bass * 0.12 * envelope(progress: stepProgress, attack: 0.03, release: 0.45)
            }
            if let leadFreq = leadPattern[stepIndex] {
                let lead = waveSample(cycle: leadFreq * time, waveform: .triangle)
                sample += lead * 0.08 * envelope(progress: stepProgress, attack: 0.02, release: 0.38)
            }
            if kickPattern[stepIndex] {
                let kick = sin(2.0 * Double.pi * 52.0 * time)
                sample += kick * 0.10 * exp(-stepProgress * 18.0)
            }

            let clamped = Float(max(-0.90, min(0.90, sample)))
            left[frame] = clamped
            right[frame] = clamped
        }

        return buffer
    }

    private func waveSample(cycle: Double, waveform: Waveform) -> Double {
        let normalized = cycle - floor(cycle)

        switch waveform {
        case .sine:
            return sin(2.0 * Double.pi * normalized)
        case .square:
            return normalized < 0.5 ? 1.0 : -1.0
        case .triangle:
            return 1.0 - (4.0 * abs(normalized - 0.5))
        }
    }

    private func envelope(progress: Double, attack: Double, release: Double) -> Double {
        let attackCurve = min(1.0, max(0.0, progress / max(0.0001, attack)))
        let releaseStart = 1.0 - release
        let releaseCurve = progress > releaseStart
            ? max(0.0, (1.0 - progress) / max(0.0001, release))
            : 1.0
        return attackCurve * releaseCurve
    }
}
