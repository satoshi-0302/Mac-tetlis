import AppKit
import SwiftUI

struct TetrisView: View {
    @StateObject private var game = TetrisGame()
    @StateObject private var audio = AudioManager()

    @State private var clearFlashOpacity = 0.0
    @State private var lastKnownLines = 0

    var body: some View {
        ZStack {
            AnimatedBackdrop()

            VStack(spacing: 12) {
                header

                HStack(alignment: .top, spacing: 10) {
                    BoardView(game: game)

                    VStack(spacing: 10) {
                        statsCard
                        nextCard
                        controlHint
                    }
                    .frame(width: 132)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                if game.isGameOver {
                    Text("Game Over - press R")
                        .font(.headline)
                        .foregroundStyle(Color.orange)
                        .padding(.vertical, 6)
                        .padding(.horizontal, 10)
                        .background(.ultraThinMaterial, in: Capsule())
                }
            }
            .padding(12)
        }
        .frame(minWidth: 280, minHeight: 520)
        .overlay {
            Color.white
                .opacity(clearFlashOpacity)
                .blendMode(.screen)
                .allowsHitTesting(false)
        }
        .background(WindowDockingView(side: game.dockSide))
        .overlay {
            KeyCaptureView(onKeyDown: handleKeyDown)
                .allowsHitTesting(false)
        }
        .onAppear {
            lastKnownLines = game.linesCleared
        }
        .onChange(of: game.linesCleared) { newValue in
            if newValue > lastKnownLines {
                audio.play(.lineClear)
                triggerLineClearFlash()
            }
            lastKnownLines = newValue
        }
        .onChange(of: game.isGameOver) { isGameOver in
            if isGameOver {
                audio.play(.gameOver)
            }
        }
        .onDisappear {
            audio.stopMusic()
        }
    }

    private var header: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Text("Mac Tetris")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(.white)

                Spacer()

                Picker("Dock", selection: $game.dockSide) {
                    ForEach(WindowDockSide.allCases) { side in
                        Text(side.title).tag(side)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 150)
            }

            HStack(spacing: 8) {
                Button(audio.musicEnabled ? "Music On" : "Music Off") {
                    audio.musicEnabled.toggle()
                }
                .buttonStyle(ChipButtonStyle(isEnabled: audio.musicEnabled, tint: Color.teal))

                Button(audio.effectsEnabled ? "SFX On" : "SFX Off") {
                    audio.effectsEnabled.toggle()
                }
                .buttonStyle(ChipButtonStyle(isEnabled: audio.effectsEnabled, tint: Color.indigo))

                Button(game.isPaused ? "Resume" : "Pause") {
                    if game.togglePause() {
                        audio.play(game.isPaused ? .pause : .resume)
                    }
                }
                .buttonStyle(ChipButtonStyle(isEnabled: true, tint: Color.orange))

                Button("Restart") {
                    game.startNewGame()
                    lastKnownLines = 0
                    audio.play(.restart)
                }
                .buttonStyle(ChipButtonStyle(isEnabled: true, tint: Color.green))
            }
        }
        .padding(10)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.white.opacity(0.25), lineWidth: 1)
        )
    }

    private var statsCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Score")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("\(game.score)")
                .font(.headline)

            Text("Lines")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("\(game.linesCleared)")
                .font(.headline)

            Text("Level")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("\(game.level)")
                .font(.headline)

            if game.isPaused {
                Text("Paused")
                    .font(.subheadline.bold())
                    .foregroundStyle(.orange)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.white.opacity(0.20), lineWidth: 1)
        )
    }

    private var nextCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Next")
                .font(.caption)
                .foregroundStyle(.secondary)

            ForEach(Array(game.nextQueue.prefix(3).enumerated()), id: \.offset) { _, kind in
                PiecePreview(kind: kind)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.white.opacity(0.20), lineWidth: 1)
        )
    }

    private var controlHint: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("Keys")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("← → Move")
            Text("↑ Rotate")
            Text("Z CCW")
            Text("↓ Soft")
            Text("Space Hard")
            Text("P Pause")
            Text("R Restart")
        }
        .font(.caption)
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.white.opacity(0.20), lineWidth: 1)
        )
    }

    private func handleKeyDown(_ event: NSEvent) {
        if event.modifierFlags.contains(.command) {
            return
        }

        switch event.keyCode {
        case 123:
            if game.moveLeft() {
                audio.play(.move)
            }
        case 124:
            if game.moveRight() {
                audio.play(.move)
            }
        case 125:
            if game.softDrop() {
                audio.play(.softDrop)
            }
        case 126:
            if game.rotateClockwise() {
                audio.play(.rotate)
            }
        case 6:
            if game.rotateCounterClockwise() {
                audio.play(.rotate)
            }
        case 49:
            let moved = game.hardDrop()
            if moved > 0 {
                audio.play(.hardDrop)
            }
        case 35:
            if game.togglePause() {
                audio.play(game.isPaused ? .pause : .resume)
            }
        case 15:
            game.startNewGame()
            lastKnownLines = 0
            audio.play(.restart)
        default:
            break
        }
    }

    private func triggerLineClearFlash() {
        clearFlashOpacity = 0.42
        withAnimation(.easeOut(duration: 0.24)) {
            clearFlashOpacity = 0
        }
    }
}

private struct ChipButtonStyle: ButtonStyle {
    let isEnabled: Bool
    let tint: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.vertical, 6)
            .padding(.horizontal, 10)
            .background(
                Capsule()
                    .fill(tint.opacity(isEnabled ? 0.88 : 0.38))
            )
            .overlay(
                Capsule()
                    .stroke(Color.white.opacity(0.24), lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.75 : 1.0)
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
    }
}

private struct AnimatedBackdrop: View {
    @State private var drift: CGFloat = -90

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.06, blue: 0.10),
                    Color(red: 0.10, green: 0.14, blue: 0.24),
                    Color(red: 0.03, green: 0.07, blue: 0.12)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            RadialGradient(
                colors: [Color.teal.opacity(0.35), Color.clear],
                center: .center,
                startRadius: 40,
                endRadius: 300
            )
            .offset(x: drift, y: -drift * 0.35)
            .blur(radius: 10)

            RadialGradient(
                colors: [Color.pink.opacity(0.25), Color.clear],
                center: .center,
                startRadius: 20,
                endRadius: 260
            )
            .offset(x: -drift * 0.8, y: drift * 0.45)
            .blur(radius: 14)

            LinearGradient(
                colors: [Color.clear, Color.white.opacity(0.08), Color.clear],
                startPoint: .top,
                endPoint: .bottom
            )
            .rotationEffect(.degrees(20))
            .offset(x: drift * 0.55)
            .blendMode(.screen)
        }
        .ignoresSafeArea()
        .onAppear {
            withAnimation(.easeInOut(duration: 7.0).repeatForever(autoreverses: true)) {
                drift = 90
            }
        }
    }
}

private struct BoardView: View {
    @ObservedObject var game: TetrisGame

    var body: some View {
        GeometryReader { proxy in
            let cellSide = max(
                1,
                floor(min(proxy.size.width / CGFloat(game.columns), proxy.size.height / CGFloat(game.rows)))
            )
            let boardWidth = cellSide * CGFloat(game.columns)
            let boardHeight = cellSide * CGFloat(game.rows)
            let activeCells = Set(game.activePiece?.blocks ?? [])
            let ghostCells = Set(game.ghostBlocks())
            let activeColor = game.activePiece?.kind.color

            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.black.opacity(0.66))
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.white.opacity(0.30), lineWidth: 1)

                ForEach(0..<game.rows, id: \.self) { row in
                    ForEach(0..<game.columns, id: \.self) { column in
                        let point = GridPoint(x: column, y: row)

                        cellView(
                            for: point,
                            activeCells: activeCells,
                            ghostCells: ghostCells,
                            activeColor: activeColor,
                            cellSide: cellSide
                        )
                        .frame(width: cellSide, height: cellSide)
                        .position(
                            x: (CGFloat(column) * cellSide) + (cellSide / 2),
                            y: (CGFloat(row) * cellSide) + (cellSide / 2)
                        )
                    }
                }
            }
            .frame(width: boardWidth, height: boardHeight)
            .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
            .shadow(color: Color.black.opacity(0.35), radius: 10, x: 0, y: 6)
        }
    }

    @ViewBuilder
    private func cellView(
        for point: GridPoint,
        activeCells: Set<GridPoint>,
        ghostCells: Set<GridPoint>,
        activeColor: Color?,
        cellSide: CGFloat
    ) -> some View {
        if let activeColor, activeCells.contains(point) {
            block(color: activeColor, cellSide: cellSide, glowing: true)
        } else if let fixedColor = game.board[point.y][point.x]?.color {
            block(color: fixedColor, cellSide: cellSide, glowing: false)
        } else if ghostCells.contains(point) {
            let corner = max(2, cellSide * 0.18)
            RoundedRectangle(cornerRadius: corner)
                .stroke(
                    Color.white.opacity(0.45),
                    style: StrokeStyle(lineWidth: max(1, cellSide * 0.06), dash: [max(3, cellSide * 0.20)])
                )
                .background(
                    RoundedRectangle(cornerRadius: corner)
                        .fill(Color.white.opacity(0.07))
                )
        } else {
            let corner = max(2, cellSide * 0.18)
            RoundedRectangle(cornerRadius: corner)
                .fill(
                    LinearGradient(
                        colors: [Color.black.opacity(0.36), Color.black.opacity(0.18)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: corner)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
        }
    }

    private func block(color: Color, cellSide: CGFloat, glowing: Bool) -> some View {
        let corner = max(2, cellSide * 0.18)

        return RoundedRectangle(cornerRadius: corner)
            .fill(
                LinearGradient(
                    colors: [color.opacity(glowing ? 1.0 : 0.90), color.opacity(0.60)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: corner)
                    .stroke(Color.white.opacity(glowing ? 0.45 : 0.22), lineWidth: 1)
            )
            .shadow(
                color: color.opacity(glowing ? 0.55 : 0.25),
                radius: glowing ? cellSide * 0.25 : cellSide * 0.15,
                x: 0,
                y: 0
            )
    }
}

private struct PiecePreview: View {
    let kind: TetrominoKind

    var body: some View {
        let points = Set(kind.rotations[0])

        VStack(spacing: 1) {
            ForEach(0..<4, id: \.self) { row in
                HStack(spacing: 1) {
                    ForEach(0..<4, id: \.self) { column in
                        let filled = points.contains(GridPoint(x: column, y: row))

                        RoundedRectangle(cornerRadius: 2)
                            .fill(filled ? kind.color : Color.black.opacity(0.15))
                            .frame(width: 12, height: 12)
                    }
                }
            }
        }
    }
}

private struct KeyCaptureView: NSViewRepresentable {
    let onKeyDown: (NSEvent) -> Void

    func makeNSView(context: Context) -> KeyCaptureNSView {
        let view = KeyCaptureNSView()
        view.onKeyDown = onKeyDown
        return view
    }

    func updateNSView(_ nsView: KeyCaptureNSView, context: Context) {
        nsView.onKeyDown = onKeyDown
        nsView.requestFocusIfNeeded()
    }
}

private final class KeyCaptureNSView: NSView {
    var onKeyDown: ((NSEvent) -> Void)?

    override var acceptsFirstResponder: Bool {
        true
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        requestFocusIfNeeded()
    }

    override func keyDown(with event: NSEvent) {
        onKeyDown?(event)
    }

    func requestFocusIfNeeded() {
        DispatchQueue.main.async { [weak self] in
            guard let self, let window = self.window, window.firstResponder !== self else { return }
            window.makeFirstResponder(self)
        }
    }
}

private struct WindowDockingView: NSViewRepresentable {
    let side: WindowDockSide

    func makeNSView(context: Context) -> DockingNSView {
        let view = DockingNSView()
        view.side = side
        return view
    }

    func updateNSView(_ nsView: DockingNSView, context: Context) {
        nsView.side = side
        nsView.applyDockingIfNeeded()
    }
}

private final class DockingNSView: NSView {
    var side: WindowDockSide = .right

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
            let width = max(280, floor(visible.width * 0.20))
            let target = NSRect(
                x: side == .left ? visible.minX : visible.maxX - width,
                y: visible.minY,
                width: width,
                height: visible.height
            )

            if abs(window.frame.minX - target.minX) > 0.5 ||
                abs(window.frame.minY - target.minY) > 0.5 ||
                abs(window.frame.width - target.width) > 0.5 ||
                abs(window.frame.height - target.height) > 0.5 {
                window.setFrame(target, display: true, animate: true)
            }

            window.minSize = NSSize(width: 280, height: 520)
        }
    }
}
