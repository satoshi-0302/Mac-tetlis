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

struct TetrisView: View {
    @StateObject private var game: TetrisGame
    @StateObject private var audio = AudioManager()
    @AppStorage("autoPauseWhenInactive") private var autoPauseWhenInactive = true
    @AppStorage("controlScheme") private var controlSchemeRaw = ControlScheme.wasd.rawValue

    @State private var lastKnownLines = 0
    @State private var actionObserverTokens: [NSObjectProtocol] = []
    @State private var keyEventMonitor: Any?
    @State private var lineClearFxProgress: CGFloat = 1
    @State private var lineClearFxStrength: CGFloat = 0
    @State private var lineClearFxSeed = 0
    @State private var lineClearShakeX: CGFloat = 0

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
                                boardSize: boardSize,
                                cellSize: cell
                            )
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
            audio.resumeMusicIfNeeded()
            lastKnownLines = game.linesCleared
            syncTempo()
        }
        .onChange(of: game.linesCleared, initial: false) { _, newValue in
            let clearedNow = max(0, newValue - lastKnownLines)
            if clearedNow > 0 {
                audio.play(.lineClear)
                triggerLineClearEffect(clearedLines: clearedNow)
            }
            lastKnownLines = newValue
        }
        .onChange(of: game.stackHeight, initial: false) { _, _ in
            syncTempo()
        }
        .onChange(of: game.level, initial: false) { _, _ in
            syncTempo()
        }
        .onChange(of: game.isGameOver, initial: false) { _, isGameOver in
            if isGameOver {
                audio.play(.gameOver)
            }
        }
        .onDisappear {
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

    private func syncTempo() {
        audio.updateMusicTempo(
            stackHeight: game.stackHeight,
            boardHeight: game.rows,
            level: game.level
        )
    }

    private func syncRowsIfNeeded(_ targetRows: Int) {
        guard targetRows != game.rows else { return }
        game.resizeRows(to: targetRows)
        syncTempo()
    }

    private func triggerLineClearEffect(clearedLines: Int) {
        let intensity = CGFloat(min(4, max(1, clearedLines)))
        lineClearFxStrength = intensity
        lineClearFxSeed = Int.random(in: 0...100_000)
        lineClearFxProgress = 0
        lineClearShakeX = intensity * 2.6

        withAnimation(.easeOut(duration: 0.06)) {
            lineClearShakeX = -(intensity * 1.8)
        }
        withAnimation(.spring(response: 0.22, dampingFraction: 0.55)) {
            lineClearShakeX = 0
        }
        withAnimation(.easeOut(duration: 0.42)) {
            lineClearFxProgress = 1
        }

        let activeSeed = lineClearFxSeed
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.46) {
            guard lineClearFxSeed == activeSeed else { return }
            lineClearFxStrength = 0
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
                }
            },
            center.addObserver(forName: .tetrisMoveLeft, object: nil, queue: .main) { _ in
                Task { @MainActor in
                    if game.moveLeft() {
                        audio.play(.move)
                    }
                }
            },
            center.addObserver(forName: .tetrisMoveRight, object: nil, queue: .main) { _ in
                Task { @MainActor in
                    if game.moveRight() {
                        audio.play(.move)
                    }
                }
            },
            center.addObserver(forName: .tetrisSoftDrop, object: nil, queue: .main) { _ in
                Task { @MainActor in
                    if game.softDrop() {
                        audio.play(.softDrop)
                    }
                }
            },
            center.addObserver(forName: .tetrisHardDrop, object: nil, queue: .main) { _ in
                Task { @MainActor in
                    if game.hardDrop() > 0 {
                        audio.play(.hardDrop)
                    }
                }
            },
            center.addObserver(forName: .tetrisRotateClockwise, object: nil, queue: .main) { _ in
                Task { @MainActor in
                    if game.rotateClockwise() {
                        audio.play(.rotate)
                    }
                }
            },
            center.addObserver(forName: .tetrisRotateCounterClockwise, object: nil, queue: .main) { _ in
                Task { @MainActor in
                    if game.rotateCounterClockwise() {
                        audio.play(.rotate)
                    }
                }
            },
            center.addObserver(forName: .tetrisHold, object: nil, queue: .main) { _ in
                Task { @MainActor in
                    if game.holdCurrentPiece() {
                        audio.play(.hold)
                        syncTempo()
                    }
                }
            },
            center.addObserver(forName: .tetrisTogglePause, object: nil, queue: .main) { _ in
                Task { @MainActor in
                    if game.isPaused {
                        if game.resume() {
                            audio.play(.resume)
                        }
                    } else if game.pause() {
                        audio.play(.pause)
                    }
                }
            },
            center.addObserver(forName: .tetrisRestart, object: nil, queue: .main) { _ in
                Task { @MainActor in
                    game.startNewGame()
                    lastKnownLines = 0
                    audio.play(.restart)
                    syncTempo()
                }
            },
            center.addObserver(forName: .tetrisToggleMusic, object: nil, queue: .main) { _ in
                Task { @MainActor in
                    audio.musicEnabled.toggle()
                }
            },
            center.addObserver(forName: .tetrisToggleEffects, object: nil, queue: .main) { _ in
                Task { @MainActor in
                    audio.effectsEnabled.toggle()
                }
            },
            center.addObserver(forName: .tetrisDockLeft, object: nil, queue: .main) { _ in
                Task { @MainActor in
                    game.dockSide = .left
                }
            },
            center.addObserver(forName: .tetrisDockRight, object: nil, queue: .main) { _ in
                Task { @MainActor in
                    game.dockSide = .right
                }
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
    }

    private func registerKeyEventMonitorIfNeeded() {
        guard keyEventMonitor == nil else { return }

        keyEventMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown]) { event in
            if handleKeyEvent(event) {
                return nil
            }
            return event
        }
    }

    private func handleKeyEvent(_ event: NSEvent) -> Bool {
        let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if modifiers.contains(.command) || modifiers.contains(.control) || modifiers.contains(.option) {
            return false
        }

        guard let name = keyEventToAction(event) else { return false }
        NotificationCenter.default.post(name: name, object: nil)
        return true
    }

    private func keyEventToAction(_ event: NSEvent) -> Notification.Name? {
        switch event.keyCode {
        case 49:
            return .tetrisHardDrop
        case 8:
            return .tetrisHold
        case 35:
            return .tetrisTogglePause
        case 15:
            return .tetrisRestart
        default:
            break
        }

        let scheme = ControlScheme(rawValue: controlSchemeRaw) ?? .wasd
        switch scheme {
        case .wasd:
            guard let chars = event.charactersIgnoringModifiers?.lowercased() else { return nil }
            switch chars {
            case "a":
                return .tetrisMoveLeft
            case "d":
                return .tetrisMoveRight
            case "s":
                return .tetrisSoftDrop
            case "w":
                return .tetrisRotateClockwise
            case "q":
                return .tetrisRotateCounterClockwise
            default:
                return nil
            }
        case .arrows:
            switch event.keyCode {
            case 123:
                return .tetrisMoveLeft
            case 124:
                return .tetrisMoveRight
            case 125:
                return .tetrisSoftDrop
            case 126:
                return .tetrisRotateClockwise
            default:
                guard let chars = event.charactersIgnoringModifiers?.lowercased() else { return nil }
                return chars == "z" ? .tetrisRotateCounterClockwise : nil
            }
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
    let boardSize: CGSize
    let cellSize: CGFloat

    private var clampedProgress: CGFloat {
        min(max(progress, 0), 1)
    }

    private var fadeOut: CGFloat {
        1 - clampedProgress
    }

    var body: some View {
        let beamCount = Int(4 + (intensity * 2))
        let sparkCount = Int(14 + (intensity * 10))
        let maxRadius = min(boardSize.width, boardSize.height) * (0.20 + (0.75 * clampedProgress))

        ZStack {
            Rectangle()
                .fill(Color.white.opacity(Double((0.10 + intensity * 0.08) * fadeOut)))
                .blendMode(.screen)

            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color.white.opacity(Double(0.55 * fadeOut)),
                            Color.cyan.opacity(Double(0.42 * fadeOut)),
                            Color.purple.opacity(Double(0.24 * fadeOut)),
                            Color.clear
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: max(boardSize.width, boardSize.height) * 0.56
                    )
                )
                .scaleEffect(0.55 + (clampedProgress * 0.95))
                .blur(radius: 2 + (8 * clampedProgress))
                .blendMode(.screen)

            ForEach(0..<beamCount, id: \.self) { index in
                let thickness = max(2, cellSize * (0.16 + (CGFloat(index % 3) * 0.06)))
                let ySpacing = boardSize.height / CGFloat(max(beamCount - 1, 1))
                let sweepOffset = (clampedProgress * boardSize.height * 0.40) - (boardSize.height * 0.20)
                let yPos = (-boardSize.height / 2) + (CGFloat(index) * ySpacing) + sweepOffset

                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.clear,
                                Color.cyan.opacity(Double(0.45 * fadeOut)),
                                Color.white.opacity(Double(0.92 * fadeOut)),
                                Color.pink.opacity(Double(0.35 * fadeOut)),
                                Color.clear
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(height: thickness)
                    .offset(y: yPos)
                    .blendMode(.screen)
            }

            ForEach(0..<sparkCount, id: \.self) { index in
                let angle = pseudo(index, 1) * .pi * 2
                let radius = maxRadius * (0.15 + (0.85 * pseudo(index, 2)))
                let sparkleSize = max(2, cellSize * (0.12 + (0.26 * pseudo(index, 3))))
                let x = cos(angle) * radius
                let y = sin(angle) * radius
                let sparkleOpacity = Double(max(0, fadeOut - (pseudo(index, 4) * 0.35)))

                Circle()
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(sparkleOpacity),
                                Color.cyan.opacity(sparkleOpacity * 0.72),
                                Color.purple.opacity(sparkleOpacity * 0.42)
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
