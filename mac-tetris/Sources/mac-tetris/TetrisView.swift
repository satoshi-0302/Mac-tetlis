import AppKit
import SwiftUI

private enum TetrisLayout {
    static let columns: CGFloat = 10
    static let referenceRows: CGFloat = 20
    static let bottomVisibilitySafetyRows = 0

    static let minimumCellSize: CGFloat = 4
    static let pixelScale: CGFloat = 0.70
    static let outerPadding: CGFloat = 8
    static let minimumVisibleHeight: CGFloat = 480

    static func cellSize(for visibleHeight: CGFloat) -> CGFloat {
        let clampedHeight = max(minimumVisibleHeight, visibleHeight)
        let base = floor((clampedHeight - (outerPadding * 2)) / referenceRows)
        return max(minimumCellSize, floor(base * pixelScale))
    }

    static func rowCount(for visibleHeight: CGFloat) -> Int {
        let clampedHeight = max(minimumVisibleHeight, visibleHeight)
        let cell = cellSize(for: clampedHeight)
        let playableHeight = max(80, clampedHeight - (outerPadding * 2))
        let fullRows = max(Int(referenceRows), Int(floor(playableHeight / cell)))
        return max(1, fullRows - bottomVisibilitySafetyRows)
    }

    static func defaultRows() -> Int {
        let visibleHeight = NSScreen.main?.visibleFrame.height ?? minimumVisibleHeight
        return rowCount(for: visibleHeight)
    }

    static func windowFrame(in visible: NSRect, side: WindowDockSide, rows: Int) -> NSRect {
        let cell = cellSize(for: visible.height)
        let rowCount = CGFloat(max(1, rows))
        let width = floor((columns * cell) + (outerPadding * 2))
        let height = floor((rowCount * cell) + (outerPadding * 2))

        return NSRect(
            x: side == .left ? visible.minX : visible.maxX - width,
            y: visible.maxY - height,
            width: width,
            height: height
        )
    }

    static func minimumContentWidth() -> CGFloat {
        floor((columns * minimumCellSize) + (outerPadding * 2))
    }
}

private enum QueuedAction {
    case moveLeft
    case moveRight
    case softDrop
    case hardDrop
    case rotateClockwise
    case rotateCounterClockwise
    case hold
    case togglePause
    case restart
    case toggleMusic
    case toggleEffects
    case dockLeft
    case dockRight
}

private struct ClearFXStyle {
    let primary: Color
    let secondary: Color
    let accent: Color
    let banner: String?
    let duration: Double
}

struct TetrisView: View {
    @StateObject private var game: TetrisGame
    @StateObject private var audio = AudioManager()
    @AppStorage("autoPauseWhenInactive") private var autoPauseWhenInactive = true
    @AppStorage("controlScheme") private var controlSchemeRaw = ControlScheme.wasd.rawValue
    @AppStorage("dasMilliseconds") private var dasMilliseconds = 130.0
    @AppStorage("arrMilliseconds") private var arrMilliseconds = 33.0
    @AppStorage("softDropMilliseconds") private var softDropMilliseconds = 33.0
    @AppStorage("lockDelayMilliseconds") private var lockDelayMilliseconds = 500.0

    @State private var actionObserverTokens: [NSObjectProtocol] = []
    @State private var keyEventMonitor: Any?
    @State private var gameLoopTimer: Timer?
    @State private var loopLastTimestamp: TimeInterval = 0
    @State private var loopAccumulator: TimeInterval = 0
    @State private var queuedActions: [QueuedAction] = []
    @State private var leftHeld = false
    @State private var rightHeld = false
    @State private var downHeld = false
    @State private var preferredHorizontalDirection = 0
    @State private var repeatingHorizontalDirection = 0
    @State private var horizontalHeldElapsed: TimeInterval = 0
    @State private var horizontalRepeatElapsed: TimeInterval = 0
    @State private var softDropRepeatElapsed: TimeInterval = 0
    @State private var lineClearFxProgress: CGFloat = 1
    @State private var lineClearFxStrength: CGFloat = 0
    @State private var lineFlashRows: [Int] = []
    @State private var lineFlashPulseCount = 2
    @State private var lineClearFxSeed = 0
    @State private var lineClearShakeX: CGFloat = 0
    @State private var lineClearFxPrimary: Color = .white
    @State private var lineClearFxSecondary: Color = .cyan
    @State private var lineClearFxAccent: Color = .purple
    @State private var clearBannerText: String?
    @State private var clearBannerOpacity: Double = 0
    @State private var clearBannerScale: CGFloat = 0.88
    @State private var dangerPulse = false

    init() {
        _game = StateObject(
            wrappedValue: TetrisGame(
                columns: Int(TetrisLayout.columns),
                rows: TetrisLayout.defaultRows()
            )
        )
    }

    var body: some View {
        GeometryReader { proxy in
            let playableWidth = max(80, proxy.size.width - (TetrisLayout.outerPadding * 2))
            let playableHeight = max(80, proxy.size.height - (TetrisLayout.outerPadding * 2))
            let widthLimitedCell = floor(playableWidth / CGFloat(game.columns))
            let heightCappedCell = floor(playableHeight / TetrisLayout.referenceRows)
            let cell = max(TetrisLayout.minimumCellSize, min(widthLimitedCell, heightCappedCell))
            let targetRows = max(
                Int(TetrisLayout.referenceRows),
                Int(floor(playableHeight / cell)) - TetrisLayout.bottomVisibilitySafetyRows
            )
            let boardSize = CGSize(width: cell * CGFloat(game.columns), height: cell * CGFloat(game.rows))

            ZStack(alignment: .topLeading) {
                Color.black

                BoardView(game: game, cellSize: cell, boardSize: boardSize)
                    .overlay {
                        if lineClearFxStrength > 0 {
                            LineClearFXOverlay(
                                progress: lineClearFxProgress,
                                intensity: lineClearFxStrength,
                                seed: lineClearFxSeed,
                                clearedRows: lineFlashRows,
                                pulseCount: lineFlashPulseCount,
                                boardSize: boardSize,
                                cellSize: cell,
                                primary: lineClearFxPrimary,
                                secondary: lineClearFxSecondary,
                                accent: lineClearFxAccent
                            )
                            .allowsHitTesting(false)
                        }
                    }
                    .overlay(alignment: .top) {
                        if dangerIntensity > 0 {
                            Rectangle()
                                .fill(
                                    LinearGradient(
                                        colors: [
                                            Color.red.opacity(0.55 * dangerIntensity * (dangerPulse ? 1.0 : 0.62)),
                                            Color.orange.opacity(0.28 * dangerIntensity * (dangerPulse ? 1.0 : 0.62)),
                                            Color.clear
                                        ],
                                        startPoint: .top,
                                        endPoint: .bottom
                                    )
                                )
                                .frame(height: max(24, cell * 2.1))
                                .allowsHitTesting(false)
                        }
                    }
                    .offset(x: lineClearShakeX)
                    .overlay(alignment: .topLeading) {
                        scoreLine
                            .padding(.top, 3)
                            .padding(.leading, 4)
                    }
                    .overlay(alignment: .topLeading) {
                        HoldOverlay(kind: game.holdPiece, cellSize: max(4, floor(cell * 0.36)))
                            .padding(.top, max(18, floor(cell * 1.2)))
                            .padding(.leading, 4)
                            .opacity(0.46)
                    }
                    .overlay(alignment: .topTrailing) {
                        NextOverlay(queue: Array(game.nextQueue.prefix(3)), cellSize: max(4, floor(cell * 0.36)))
                            .padding(.top, max(18, floor(cell * 1.2)))
                            .padding(.trailing, 4)
                            .opacity(0.46)
                    }
                    .overlay(alignment: .center) {
                        if let clearBannerText {
                            Text(clearBannerText)
                                .font(.system(size: max(15, cell * 0.72), weight: .heavy, design: .rounded))
                                .foregroundStyle(.white)
                                .shadow(color: .black.opacity(0.82), radius: 6, x: 0, y: 3)
                                .scaleEffect(clearBannerScale)
                                .opacity(clearBannerOpacity)
                        }
                    }
            }
            .padding(TetrisLayout.outerPadding)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
            .onAppear {
                syncRowsIfNeeded(targetRows)
            }
            .onChange(of: targetRows, initial: false) { _, newValue in
                syncRowsIfNeeded(newValue)
            }
        }
        .background(WindowDockingView(side: game.dockSide, rows: TetrisLayout.defaultRows()))
        .onAppear {
            registerGameActionObservers()
            startGameLoop()
            audio.resumeMusicIfNeeded()
            game.setLockDelay(milliseconds: lockDelayMilliseconds)
            syncAudio()
        }
        .onChange(of: game.latestClearFeedback?.id, initial: false) { _, _ in
            guard let feedback = game.latestClearFeedback else { return }
            playLineClearSound(feedback.kind)
            triggerLineClearEffect(feedback: feedback)
        }
        .onChange(of: game.stackHeight, initial: false) { _, _ in
            syncAudio()
        }
        .onChange(of: game.level, initial: false) { _, _ in
            syncAudio()
        }
        .onChange(of: game.isGameOver, initial: false) { _, isGameOver in
            if isGameOver {
                audio.play(.gameOver)
            }
        }
        .onChange(of: lockDelayMilliseconds, initial: true) { _, newValue in
            game.setLockDelay(milliseconds: newValue)
        }
        .onChange(of: controlSchemeRaw, initial: false) { _, _ in
            releaseHeldMovementKeys()
        }
        .onChange(of: dangerIntensity > 0.01, initial: true) { _, isDangerActive in
            if isDangerActive {
                withAnimation(.easeInOut(duration: 0.42).repeatForever(autoreverses: true)) {
                    dangerPulse = true
                }
            } else {
                dangerPulse = false
            }
            syncAudio()
        }
        .onDisappear {
            stopGameLoop()
            clearGameActionObservers()
            audio.stopMusic()
        }
    }

    private var scoreLine: some View {
        HStack(spacing: 10) {
            Text("S:\(game.score)")
            Text("L:\(game.linesCleared)")
            Text("LV:\(game.level)")
        }
        .font(.system(size: 11, weight: .semibold, design: .monospaced))
        .foregroundStyle(.white)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(Color.black.opacity(0.48), in: RoundedRectangle(cornerRadius: 5))
    }

    private var dangerIntensity: Double {
        guard game.rows > 0 else { return 0 }
        let ratio = Double(game.stackHeight) / Double(game.rows)
        let threshold = 0.70
        if ratio <= threshold { return 0 }
        return min(1, (ratio - threshold) / (1.0 - threshold))
    }

    private var fixedStep: TimeInterval {
        1.0 / 120.0
    }

    private func syncAudio() {
        audio.updateMusicDynamics(
            stackHeight: game.stackHeight,
            boardHeight: game.rows,
            level: game.level,
            dangerIntensity: dangerIntensity
        )
    }

    private func syncRowsIfNeeded(_ targetRows: Int) {
        guard targetRows != game.rows else { return }
        game.resizeRows(to: targetRows)
        syncAudio()
    }

    private func startGameLoop() {
        stopGameLoop()
        loopLastTimestamp = ProcessInfo.processInfo.systemUptime
        loopAccumulator = 0

        let timer = Timer(timeInterval: 1.0 / 120.0, repeats: true) { _ in
            Task { @MainActor in
                stepGameLoop()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        gameLoopTimer = timer
    }

    private func stopGameLoop() {
        gameLoopTimer?.invalidate()
        gameLoopTimer = nil
        loopAccumulator = 0
        releaseHeldMovementKeys()
        queuedActions.removeAll()
    }

    private func stepGameLoop() {
        let now = ProcessInfo.processInfo.systemUptime
        let elapsed = min(max(0, now - loopLastTimestamp), 0.05)
        loopLastTimestamp = now
        loopAccumulator += elapsed

        var steps = 0
        while loopAccumulator >= fixedStep, steps < 8 {
            loopAccumulator -= fixedStep
            stepSimulationFrame(deltaTime: fixedStep)
            steps += 1
        }

        if steps == 8 {
            loopAccumulator = 0
        }
    }

    private func stepSimulationFrame(deltaTime: TimeInterval) {
        applyHeldInputRepeats(deltaTime: deltaTime)
        processQueuedActions(limit: 14)
        game.advance(by: deltaTime)
    }

    private func applyHeldInputRepeats(deltaTime: TimeInterval) {
        let dasSeconds = max(0, dasMilliseconds) / 1000.0
        let arrSeconds = max(0, arrMilliseconds) / 1000.0
        let softDropSeconds = max(0.008, softDropMilliseconds / 1000.0)

        let activeHorizontalDirection: Int
        if leftHeld && rightHeld {
            activeHorizontalDirection = preferredHorizontalDirection
        } else if leftHeld {
            activeHorizontalDirection = -1
        } else if rightHeld {
            activeHorizontalDirection = 1
        } else {
            activeHorizontalDirection = 0
        }

        if activeHorizontalDirection == 0 {
            repeatingHorizontalDirection = 0
            horizontalHeldElapsed = 0
            horizontalRepeatElapsed = 0
        } else if repeatingHorizontalDirection != activeHorizontalDirection {
            repeatingHorizontalDirection = activeHorizontalDirection
            horizontalHeldElapsed = 0
            horizontalRepeatElapsed = 0
        } else {
            horizontalHeldElapsed += deltaTime
            if horizontalHeldElapsed >= dasSeconds {
                if arrSeconds <= 0.0005 {
                    enqueueAction(activeHorizontalDirection < 0 ? .moveLeft : .moveRight)
                } else {
                    horizontalRepeatElapsed += deltaTime
                    while horizontalRepeatElapsed >= arrSeconds {
                        horizontalRepeatElapsed -= arrSeconds
                        enqueueAction(activeHorizontalDirection < 0 ? .moveLeft : .moveRight)
                    }
                }
            }
        }

        if downHeld {
            softDropRepeatElapsed += deltaTime
            while softDropRepeatElapsed >= softDropSeconds {
                softDropRepeatElapsed -= softDropSeconds
                enqueueAction(.softDrop)
            }
        } else {
            softDropRepeatElapsed = 0
        }
    }

    private func enqueueAction(_ action: QueuedAction) {
        if queuedActions.count > 72 {
            queuedActions.removeFirst(queuedActions.count - 72)
        }
        queuedActions.append(action)
    }

    private func processQueuedActions(limit: Int) {
        let count = min(limit, queuedActions.count)
        guard count > 0 else { return }

        let actions = Array(queuedActions.prefix(count))
        queuedActions.removeFirst(count)

        for action in actions {
            switch action {
            case .moveLeft:
                if game.moveLeft() { audio.play(.move) }
            case .moveRight:
                if game.moveRight() { audio.play(.move) }
            case .softDrop:
                if game.softDrop() { audio.play(.softDrop) }
            case .hardDrop:
                if game.hardDrop() > 0 { audio.play(.hardDrop) }
            case .rotateClockwise:
                if game.rotateClockwise() { audio.play(.rotate) }
            case .rotateCounterClockwise:
                if game.rotateCounterClockwise() { audio.play(.rotate) }
            case .hold:
                if game.holdCurrentPiece() {
                    audio.play(.hold)
                    syncAudio()
                }
            case .togglePause:
                if game.isPaused {
                    if game.resume() { audio.play(.resume) }
                } else if game.pause() {
                    audio.play(.pause)
                }
            case .restart:
                game.startNewGame()
                game.setLockDelay(milliseconds: lockDelayMilliseconds)
                releaseHeldMovementKeys()
                audio.play(.restart)
                syncAudio()
            case .toggleMusic:
                audio.musicEnabled.toggle()
            case .toggleEffects:
                audio.effectsEnabled.toggle()
            case .dockLeft:
                game.dockSide = .left
            case .dockRight:
                game.dockSide = .right
            }
        }
    }

    private func playLineClearSound(_ kind: LineClearKind) {
        switch kind {
        case .allClear:
            audio.play(.allClear)
        case .tetris:
            audio.play(.tetrisClear)
        case .tSpinSingle, .tSpinDouble, .tSpinTriple:
            audio.play(.tSpin)
        default:
            audio.play(.lineClear)
        }
    }

    private func triggerLineClearEffect(feedback: ClearFeedback) {
        let style = clearFXStyle(for: feedback)
        lineClearFxPrimary = style.primary
        lineClearFxSecondary = style.secondary
        lineClearFxAccent = style.accent
        lineFlashRows = feedback.clearedRowIndices

        let clearedLines = max(1, feedback.clearedLines)
        let lineBoost = CGFloat(clearedLines - 1) * 0.80
        let styleBoost = max(0, feedback.kind.effectStrength - 1.0) * 0.45
        let allClearBoost: CGFloat = feedback.isAllClear ? 0.85 : 0
        let intensity = CGFloat(min(6.2, 1.0 + lineBoost + styleBoost + allClearBoost))

        lineClearFxStrength = intensity
        lineFlashPulseCount = min(
            10,
            2 + clearedLines + (feedback.isBackToBack ? 1 : 0) + (feedback.isAllClear ? 2 : 0)
        )
        lineClearFxSeed = Int.random(in: 0...100_000)
        lineClearFxProgress = 0
        lineClearShakeX = intensity * 2.9

        if let banner = style.banner {
            clearBannerText = banner
            clearBannerOpacity = 0
            clearBannerScale = 0.72
            withAnimation(.spring(response: 0.30, dampingFraction: 0.62)) {
                clearBannerOpacity = 1
                clearBannerScale = 1
            }
            withAnimation(.easeOut(duration: 0.45).delay(0.30)) {
                clearBannerOpacity = 0
                clearBannerScale = 1.16
            }

            let currentSeed = lineClearFxSeed
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.82) {
                guard lineClearFxSeed == currentSeed else { return }
                clearBannerText = nil
            }
        }

        withAnimation(.easeOut(duration: 0.06)) {
            lineClearShakeX = -(intensity * 1.9)
        }
        withAnimation(.spring(response: 0.24, dampingFraction: 0.56)) {
            lineClearShakeX = 0
        }
        let flashDuration = style.duration + (Double(clearedLines - 1) * 0.07)
        withAnimation(.easeOut(duration: flashDuration)) {
            lineClearFxProgress = 1
        }

        let activeSeed = lineClearFxSeed
        let clearDelay = flashDuration + 0.06
        DispatchQueue.main.asyncAfter(deadline: .now() + clearDelay) {
            guard lineClearFxSeed == activeSeed else { return }
            lineClearFxStrength = 0
            lineFlashRows = []
        }
    }

    private func clearFXStyle(for feedback: ClearFeedback) -> ClearFXStyle {
        switch feedback.kind {
        case .single:
            return ClearFXStyle(
                primary: .white,
                secondary: .cyan,
                accent: .blue,
                banner: feedback.combo >= 2 ? "COMBO x\(feedback.combo + 1)" : nil,
                duration: 0.38
            )
        case .double:
            return ClearFXStyle(
                primary: .mint,
                secondary: .cyan,
                accent: .blue,
                banner: feedback.combo >= 1 ? "COMBO x\(feedback.combo + 1)" : nil,
                duration: 0.42
            )
        case .triple:
            return ClearFXStyle(
                primary: .yellow,
                secondary: .orange,
                accent: .pink,
                banner: feedback.combo >= 1 ? "TRIPLE" : "TRIPLE",
                duration: 0.46
            )
        case .tetris:
            return ClearFXStyle(
                primary: .yellow,
                secondary: .cyan,
                accent: .white,
                banner: feedback.isBackToBack ? "B2B TETRIS" : "TETRIS",
                duration: 0.54
            )
        case .tSpinSingle:
            return ClearFXStyle(
                primary: .purple,
                secondary: .pink,
                accent: .white,
                banner: feedback.isBackToBack ? "B2B T-SPIN" : "T-SPIN",
                duration: 0.52
            )
        case .tSpinDouble:
            return ClearFXStyle(
                primary: .purple,
                secondary: .pink,
                accent: .orange,
                banner: feedback.isBackToBack ? "B2B T-SPIN DOUBLE" : "T-SPIN DOUBLE",
                duration: 0.58
            )
        case .tSpinTriple:
            return ClearFXStyle(
                primary: .purple,
                secondary: .red,
                accent: .white,
                banner: feedback.isBackToBack ? "B2B T-SPIN TRIPLE" : "T-SPIN TRIPLE",
                duration: 0.64
            )
        case .allClear:
            return ClearFXStyle(
                primary: .white,
                secondary: .yellow,
                accent: .cyan,
                banner: "ALL CLEAR",
                duration: 0.72
            )
        }
    }

    private func registerGameActionObservers() {
        guard actionObserverTokens.isEmpty else { return }
        registerKeyEventMonitorIfNeeded()

        let center = NotificationCenter.default
        actionObserverTokens = [
            center.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { _ in
                Task { @MainActor in
                    guard autoPauseWhenInactive else { return }
                    if game.pause() {
                        audio.play(.pause)
                    }
                    releaseHeldMovementKeys()
                }
            },
            center.addObserver(forName: .tetrisMoveLeft, object: nil, queue: .main) { _ in
                Task { @MainActor in enqueueAction(.moveLeft) }
            },
            center.addObserver(forName: .tetrisMoveRight, object: nil, queue: .main) { _ in
                Task { @MainActor in enqueueAction(.moveRight) }
            },
            center.addObserver(forName: .tetrisSoftDrop, object: nil, queue: .main) { _ in
                Task { @MainActor in enqueueAction(.softDrop) }
            },
            center.addObserver(forName: .tetrisHardDrop, object: nil, queue: .main) { _ in
                Task { @MainActor in enqueueAction(.hardDrop) }
            },
            center.addObserver(forName: .tetrisRotateClockwise, object: nil, queue: .main) { _ in
                Task { @MainActor in enqueueAction(.rotateClockwise) }
            },
            center.addObserver(forName: .tetrisRotateCounterClockwise, object: nil, queue: .main) { _ in
                Task { @MainActor in enqueueAction(.rotateCounterClockwise) }
            },
            center.addObserver(forName: .tetrisHold, object: nil, queue: .main) { _ in
                Task { @MainActor in enqueueAction(.hold) }
            },
            center.addObserver(forName: .tetrisTogglePause, object: nil, queue: .main) { _ in
                Task { @MainActor in enqueueAction(.togglePause) }
            },
            center.addObserver(forName: .tetrisRestart, object: nil, queue: .main) { _ in
                Task { @MainActor in enqueueAction(.restart) }
            },
            center.addObserver(forName: .tetrisToggleMusic, object: nil, queue: .main) { _ in
                Task { @MainActor in enqueueAction(.toggleMusic) }
            },
            center.addObserver(forName: .tetrisToggleEffects, object: nil, queue: .main) { _ in
                Task { @MainActor in enqueueAction(.toggleEffects) }
            },
            center.addObserver(forName: .tetrisDockLeft, object: nil, queue: .main) { _ in
                Task { @MainActor in enqueueAction(.dockLeft) }
            },
            center.addObserver(forName: .tetrisDockRight, object: nil, queue: .main) { _ in
                Task { @MainActor in enqueueAction(.dockRight) }
            }
        ]
    }

    private func clearGameActionObservers() {
        let center = NotificationCenter.default
        actionObserverTokens.forEach(center.removeObserver)
        actionObserverTokens.removeAll()
        if let keyEventMonitor {
            NSEvent.removeMonitor(keyEventMonitor)
            self.keyEventMonitor = nil
        }
        releaseHeldMovementKeys()
    }

    private func releaseHeldMovementKeys() {
        leftHeld = false
        rightHeld = false
        downHeld = false
        preferredHorizontalDirection = 0
        repeatingHorizontalDirection = 0
        horizontalHeldElapsed = 0
        horizontalRepeatElapsed = 0
        softDropRepeatElapsed = 0
    }

    private func registerKeyEventMonitorIfNeeded() {
        guard keyEventMonitor == nil else { return }

        keyEventMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp]) { event in
            switch event.type {
            case .keyDown:
                if handleKeyDown(event) {
                    return nil
                }
            case .keyUp:
                if handleKeyUp(event) {
                    return nil
                }
            default:
                break
            }
            return event
        }
    }

    private func handleKeyDown(_ event: NSEvent) -> Bool {
        let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if modifiers.contains(.command) || modifiers.contains(.control) || modifiers.contains(.option) {
            return false
        }

        let keyCode = Int(event.keyCode)
        let mapping = movementMapping(for: ControlScheme(rawValue: controlSchemeRaw) ?? .wasd)

        if keyCode == mapping.leftKey {
            if event.isARepeat { return true }
            leftHeld = true
            preferredHorizontalDirection = -1
            enqueueAction(.moveLeft)
            return true
        }
        if keyCode == mapping.rightKey {
            if event.isARepeat { return true }
            rightHeld = true
            preferredHorizontalDirection = 1
            enqueueAction(.moveRight)
            return true
        }
        if keyCode == mapping.downKey {
            if event.isARepeat { return true }
            downHeld = true
            softDropRepeatElapsed = 0
            enqueueAction(.softDrop)
            return true
        }
        if keyCode == mapping.rotateCWKey {
            if event.isARepeat { return true }
            enqueueAction(.rotateClockwise)
            return true
        }
        if keyCode == mapping.rotateCCWKey {
            if event.isARepeat { return true }
            enqueueAction(.rotateCounterClockwise)
            return true
        }

        switch keyCode {
        case 49:
            if event.isARepeat { return true }
            enqueueAction(.hardDrop)
            return true
        case 8:
            if event.isARepeat { return true }
            enqueueAction(.hold)
            return true
        case 35:
            if event.isARepeat { return true }
            enqueueAction(.togglePause)
            return true
        case 15:
            if event.isARepeat { return true }
            enqueueAction(.restart)
            return true
        default:
            return false
        }
    }

    private func handleKeyUp(_ event: NSEvent) -> Bool {
        let keyCode = Int(event.keyCode)
        let mapping = movementMapping(for: ControlScheme(rawValue: controlSchemeRaw) ?? .wasd)

        if keyCode == mapping.leftKey {
            leftHeld = false
            if preferredHorizontalDirection == -1, rightHeld {
                preferredHorizontalDirection = 1
            }
            return true
        }
        if keyCode == mapping.rightKey {
            rightHeld = false
            if preferredHorizontalDirection == 1, leftHeld {
                preferredHorizontalDirection = -1
            }
            return true
        }
        if keyCode == mapping.downKey {
            downHeld = false
            softDropRepeatElapsed = 0
            return true
        }

        return false
    }

    private func movementMapping(for scheme: ControlScheme) -> (leftKey: Int, rightKey: Int, downKey: Int, rotateCWKey: Int, rotateCCWKey: Int) {
        switch scheme {
        case .wasd:
            return (leftKey: 0, rightKey: 2, downKey: 1, rotateCWKey: 13, rotateCCWKey: 12)
        case .arrows:
            return (leftKey: 123, rightKey: 124, downKey: 125, rotateCWKey: 126, rotateCCWKey: 6)
        }
    }
}

private struct NextOverlay: View {
    let queue: [TetrominoKind]
    let cellSize: CGFloat

    var body: some View {
        VStack(spacing: 6) {
            ForEach(Array(queue.enumerated()), id: \.offset) { _, kind in
                PiecePreview(kind: kind, cellSize: cellSize)
            }
        }
    }
}

private struct HoldOverlay: View {
    let kind: TetrominoKind?
    let cellSize: CGFloat

    var body: some View {
        if let kind {
            PiecePreview(kind: kind, cellSize: cellSize)
        } else {
            Rectangle()
                .fill(Color.clear)
                .frame(width: cellSize * 4, height: cellSize * 4)
        }
    }
}

private struct LineClearFXOverlay: View {
    let progress: CGFloat
    let intensity: CGFloat
    let seed: Int
    let clearedRows: [Int]
    let pulseCount: Int
    let boardSize: CGSize
    let cellSize: CGFloat
    let primary: Color
    let secondary: Color
    let accent: Color

    private var clampedProgress: CGFloat {
        min(max(progress, 0), 1)
    }

    private var fadeOut: CGFloat {
        1 - clampedProgress
    }

    private var lineCount: CGFloat {
        CGFloat(max(1, clearedRows.count))
    }

    private var effectiveRows: [Int] {
        if clearedRows.isEmpty { return [0] }
        return clearedRows
    }

    private var pulseWave: CGFloat {
        let wave = sin(clampedProgress * .pi * CGFloat(max(2, pulseCount)))
        return max(0, wave)
    }

    private var flashEnvelope: CGFloat {
        max(0, fadeOut * (0.38 + (pulseWave * 0.95)))
    }

    var body: some View {
        let sparkCount = Int((8 + (intensity * 4.4)) * (0.72 + (lineCount * 0.32)))
        let maxRadius = min(boardSize.width, boardSize.height) * (0.20 + (0.68 * clampedProgress))

        ZStack {
            Rectangle()
                .fill(primary.opacity(Double((0.05 + (0.04 * lineCount)) * flashEnvelope)))
                .blendMode(.screen)

            ForEach(effectiveRows, id: \.self) { row in
                let yPosition = (CGFloat(row) * cellSize) + (cellSize / 2) - (boardSize.height / 2)
                let barHeight = max(2, cellSize * (0.72 + (lineCount * 0.06)))
                let coreHeight = max(1, cellSize * 0.24)
                let sideBurst = max(8, cellSize * (1.15 + (intensity * 0.20)))

                ZStack {
                    Rectangle()
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color.clear,
                                    primary.opacity(Double(0.36 * flashEnvelope)),
                                    secondary.opacity(Double(0.88 * flashEnvelope)),
                                    accent.opacity(Double(0.46 * flashEnvelope)),
                                    Color.clear
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(height: barHeight)
                        .blur(radius: max(1, cellSize * 0.15))
                        .blendMode(.screen)

                    Rectangle()
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color.white.opacity(Double(0.22 * flashEnvelope)),
                                    secondary.opacity(Double(1.05 * flashEnvelope)),
                                    Color.white.opacity(Double(0.22 * flashEnvelope))
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(height: coreHeight)
                        .blendMode(.plusLighter)

                    Circle()
                        .fill(primary.opacity(Double(0.24 * flashEnvelope)))
                        .frame(width: sideBurst, height: sideBurst)
                        .blur(radius: max(1, cellSize * 0.20))
                        .offset(x: -boardSize.width * 0.48)

                    Circle()
                        .fill(accent.opacity(Double(0.24 * flashEnvelope)))
                        .frame(width: sideBurst, height: sideBurst)
                        .blur(radius: max(1, cellSize * 0.20))
                        .offset(x: boardSize.width * 0.48)
                }
                .offset(y: yPosition)
            }

            if lineCount >= 2 {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                secondary.opacity(Double(0.42 * flashEnvelope)),
                                primary.opacity(Double(0.26 * flashEnvelope)),
                                accent.opacity(Double(0.16 * flashEnvelope)),
                                Color.clear
                            ],
                            center: .center,
                            startRadius: 0,
                            endRadius: max(boardSize.width, boardSize.height) * 0.55
                        )
                    )
                    .frame(width: maxRadius * 2, height: maxRadius * 2)
                    .scaleEffect(0.45 + (clampedProgress * 0.95))
                    .blur(radius: 2 + (6 * clampedProgress))
                    .blendMode(.screen)
            }

            ForEach(0..<sparkCount, id: \.self) { index in
                let angle = pseudo(index, 1) * .pi * 2
                let radius = maxRadius * (0.16 + (0.84 * pseudo(index, 2)))
                let sparkleSize = max(2, cellSize * (0.12 + (0.26 * pseudo(index, 3))))
                let rowAnchor = effectiveRows[index % effectiveRows.count]
                let anchorY = (CGFloat(rowAnchor) * cellSize) + (cellSize / 2) - (boardSize.height / 2)
                let spreadY = (pseudo(index, 5) - 0.5) * (cellSize * (2.2 + lineCount))
                let x = cos(angle) * radius
                let y = anchorY + sin(angle) * (radius * 0.30) + spreadY
                let sparkleOpacity = Double(max(0, flashEnvelope - (pseudo(index, 4) * 0.28)))

                Circle()
                    .fill(
                        LinearGradient(
                            colors: [
                                primary.opacity(sparkleOpacity),
                                secondary.opacity(sparkleOpacity * 0.78),
                                accent.opacity(sparkleOpacity * 0.52)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: sparkleSize, height: sparkleSize)
                    .offset(x: x, y: y)
                    .blur(radius: sparkleSize * 0.16)
                    .blendMode(.screen)
            }
        }
        .compositingGroup()
        .clipped()
    }

    private func pseudo(_ index: Int, _ salt: Int) -> CGFloat {
        let value = sin(CGFloat(seed + (index * 37) + (salt * 101)) * 12.9898) * 43_758.5453
        return value - floor(value)
    }
}

private struct BoardView: View {
    @ObservedObject var game: TetrisGame
    let cellSize: CGFloat
    let boardSize: CGSize

    var body: some View {
        let activeCells = Set(game.activePiece?.blocks ?? [])
        let ghostCells = Set(game.ghostBlocks())
        let activeColor = game.activePiece?.kind.color

        ZStack(alignment: .topLeading) {
            Rectangle()
                .fill(Color.black)
            Rectangle()
                .stroke(Color.white.opacity(0.18), lineWidth: 1)

            ForEach(0..<game.rows, id: \.self) { row in
                ForEach(0..<game.columns, id: \.self) { column in
                    cellView(
                        point: GridPoint(x: column, y: row),
                        activeCells: activeCells,
                        ghostCells: ghostCells,
                        activeColor: activeColor
                    )
                    .frame(width: cellSize, height: cellSize)
                    .position(
                        x: (CGFloat(column) * cellSize) + (cellSize / 2),
                        y: (CGFloat(row) * cellSize) + (cellSize / 2)
                    )
                }
            }
        }
        .frame(width: boardSize.width, height: boardSize.height)
    }

    @ViewBuilder
    private func cellView(
        point: GridPoint,
        activeCells: Set<GridPoint>,
        ghostCells: Set<GridPoint>,
        activeColor: Color?
    ) -> some View {
        if let activeColor, activeCells.contains(point) {
            block(color: activeColor, isGhost: false)
        } else if let fixedColor = game.board[point.y][point.x]?.color {
            block(color: fixedColor, isGhost: false)
        } else if ghostCells.contains(point) {
            block(color: Color.white.opacity(0.30), isGhost: true)
        } else {
            Rectangle()
                .fill(Color.black)
                .overlay(
                    Rectangle()
                        .stroke(Color.white.opacity(0.05), lineWidth: 1)
                )
        }
    }

    private func block(color: Color, isGhost: Bool) -> some View {
        let fillOpacity = isGhost ? 0.28 : 0.96
        let highlightOpacity = isGhost ? 0.10 : 0.44
        let edgeShadowOpacity = isGhost ? 0.12 : 0.42
        let glowOpacity = isGhost ? 0.10 : 0.24

        return Rectangle()
            .fill(
                LinearGradient(
                    colors: [
                        color.opacity(fillOpacity),
                        color.opacity(fillOpacity * 0.86),
                        color.opacity(fillOpacity * 0.64)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(Color.white.opacity(highlightOpacity))
                    .frame(height: max(1, cellSize * 0.12))
            }
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(Color.white.opacity(highlightOpacity * 0.74))
                    .frame(width: max(1, cellSize * 0.12))
            }
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(Color.black.opacity(edgeShadowOpacity))
                    .frame(height: max(1, cellSize * 0.14))
            }
            .overlay(alignment: .trailing) {
                Rectangle()
                    .fill(Color.black.opacity(edgeShadowOpacity * 0.82))
                    .frame(width: max(1, cellSize * 0.14))
            }
            .overlay(
                Rectangle()
                    .stroke(Color.white.opacity(isGhost ? 0.22 : 0.12), lineWidth: 1)
            )
            .shadow(
                color: color.opacity(glowOpacity),
                radius: isGhost ? 0 : max(1, cellSize * 0.16),
                x: 0,
                y: max(0.5, cellSize * 0.05)
            )
    }
}

private struct PiecePreview: View {
    let kind: TetrominoKind
    let cellSize: CGFloat

    var body: some View {
        let points = Set(kind.rotations[0])

        VStack(spacing: 1) {
            ForEach(0..<4, id: \.self) { row in
                HStack(spacing: 1) {
                    ForEach(0..<4, id: \.self) { column in
                        let filled = points.contains(GridPoint(x: column, y: row))
                        Rectangle()
                            .fill(filled ? kind.color : Color.clear)
                            .frame(width: cellSize, height: cellSize)
                    }
                }
            }
        }
    }
}

private struct WindowDockingView: NSViewRepresentable {
    let side: WindowDockSide
    let rows: Int

    func makeNSView(context: Context) -> DockingNSView {
        let view = DockingNSView()
        view.side = side
        view.rows = rows
        return view
    }

    func updateNSView(_ nsView: DockingNSView, context: Context) {
        nsView.side = side
        nsView.rows = rows
        nsView.applyDockingIfNeeded()
    }
}

private final class DockingNSView: NSView {
    var side: WindowDockSide = .right
    var rows: Int = Int(TetrisLayout.referenceRows)
    private var hasAppliedInitialFrame = false
    private var lastAppliedSide: WindowDockSide = .right

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        applyDockingIfNeeded()
    }

    func applyDockingIfNeeded() {
        DispatchQueue.main.async { [weak self] in
            guard
                let self,
                let window = self.window,
                let screen = window.screen ?? NSScreen.main
            else {
                return
            }

            let visible = screen.visibleFrame
            let targetContent = TetrisLayout.windowFrame(in: visible, side: side, rows: rows)
            let sizingFrame = window.frameRect(forContentRect: NSRect(origin: .zero, size: targetContent.size))
            let fixedHeight = sizingFrame.height
            let minWidthFrame = window.frameRect(
                forContentRect: NSRect(
                    origin: .zero,
                    size: NSSize(width: TetrisLayout.minimumContentWidth(), height: targetContent.height)
                )
            ).width
            let maxWidthFrame = visible.width
            let preferredWidth = !hasAppliedInitialFrame || side != lastAppliedSide
                ? sizingFrame.width
                : window.frame.width
            let targetWidth = min(max(preferredWidth, minWidthFrame), maxWidthFrame)

            var targetFrame = window.frame
            targetFrame.size.width = targetWidth
            targetFrame.size.height = fixedHeight
            targetFrame.origin = CGPoint(
                x: side == .left ? visible.minX : visible.maxX - targetWidth,
                y: visible.maxY - fixedHeight
            )

            if abs(window.frame.minX - targetFrame.minX) > 0.5 ||
                abs(window.frame.minY - targetFrame.minY) > 0.5 ||
                abs(window.frame.width - targetFrame.width) > 0.5 ||
                abs(window.frame.height - targetFrame.height) > 0.5 {
                window.setFrame(targetFrame, display: true, animate: true)
            }

            window.minSize = NSSize(width: minWidthFrame, height: fixedHeight)
            window.maxSize = NSSize(width: maxWidthFrame, height: fixedHeight)
            hasAppliedInitialFrame = true
            lastAppliedSide = side
        }
    }
}
