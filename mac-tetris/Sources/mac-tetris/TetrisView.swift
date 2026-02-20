import AppKit
import SwiftUI

private enum TetrisLayout {
    static let columns: CGFloat = 10
    static let rows: CGFloat = 20

    static let statusBarHeight: CGFloat = 64
    static let horizontalPadding: CGFloat = 12
    static let verticalPadding: CGFloat = 12
    static let sidePanelWidth: CGFloat = 86
    static let sideSpacing: CGFloat = 10

    static func boardCellSize(for windowHeight: CGFloat) -> CGFloat {
        let boardAreaHeight = max(240, windowHeight - statusBarHeight - (verticalPadding * 3))
        return max(12, floor(boardAreaHeight / rows))
    }

    static func windowFrame(in visible: NSRect, side: WindowDockSide) -> NSRect {
        let cellSize = boardCellSize(for: visible.height)
        let boardWidth = floor(columns * cellSize)
        let windowWidth = boardWidth + sidePanelWidth + sideSpacing + (horizontalPadding * 2)

        return NSRect(
            x: side == .left ? visible.minX : visible.maxX - windowWidth,
            y: visible.minY,
            width: windowWidth,
            height: visible.height
        )
    }
}

struct TetrisView: View {
    @StateObject private var game = TetrisGame(columns: Int(TetrisLayout.columns), rows: Int(TetrisLayout.rows))
    @StateObject private var audio = AudioManager()
    @AppStorage("autoPauseWhenInactive") private var autoPauseWhenInactive = true

    @State private var clearFlashOpacity = 0.0
    @State private var lastKnownLines = 0

    var body: some View {
        GeometryReader { proxy in
            let cellSize = TetrisLayout.boardCellSize(for: proxy.size.height)
            let boardSize = CGSize(
                width: cellSize * CGFloat(game.columns),
                height: cellSize * CGFloat(game.rows)
            )

            ZStack {
                AnimatedBackdrop()

                VStack(spacing: TetrisLayout.verticalPadding) {
                    statusBar

                    HStack(alignment: .top, spacing: TetrisLayout.sideSpacing) {
                        BoardView(game: game, cellSize: cellSize, boardSize: boardSize)
                        nextPanel
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                }
                .padding(.horizontal, TetrisLayout.horizontalPadding)
                .padding(.vertical, TetrisLayout.verticalPadding)
            }
            .overlay {
                Color.white
                    .opacity(clearFlashOpacity)
                    .blendMode(.screen)
                    .allowsHitTesting(false)
            }
        }
        .background(WindowDockingView(side: game.dockSide))
        .onAppear {
            lastKnownLines = game.linesCleared
            syncTempo()
        }
        .onChange(of: game.linesCleared) { newValue in
            if newValue > lastKnownLines {
                audio.play(.lineClear)
                triggerLineClearFlash()
            }
            lastKnownLines = newValue
        }
        .onChange(of: game.stackHeight) { _ in
            syncTempo()
        }
        .onChange(of: game.level) { _ in
            syncTempo()
        }
        .onChange(of: game.isGameOver) { isGameOver in
            if isGameOver {
                audio.play(.gameOver)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didResignActiveNotification)) { _ in
            guard autoPauseWhenInactive else { return }
            if game.pause() {
                audio.play(.pause)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .tetrisMoveLeft)) { _ in
            if game.moveLeft() {
                audio.play(.move)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .tetrisMoveRight)) { _ in
            if game.moveRight() {
                audio.play(.move)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .tetrisSoftDrop)) { _ in
            if game.softDrop() {
                audio.play(.softDrop)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .tetrisHardDrop)) { _ in
            if game.hardDrop() > 0 {
                audio.play(.hardDrop)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .tetrisRotateClockwise)) { _ in
            if game.rotateClockwise() {
                audio.play(.rotate)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .tetrisRotateCounterClockwise)) { _ in
            if game.rotateCounterClockwise() {
                audio.play(.rotate)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .tetrisTogglePause)) { _ in
            if game.isPaused {
                if game.resume() {
                    audio.play(.resume)
                }
            } else if game.pause() {
                audio.play(.pause)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .tetrisRestart)) { _ in
            game.startNewGame()
            lastKnownLines = 0
            audio.play(.restart)
            syncTempo()
        }
        .onReceive(NotificationCenter.default.publisher(for: .tetrisToggleMusic)) { _ in
            audio.musicEnabled.toggle()
        }
        .onReceive(NotificationCenter.default.publisher(for: .tetrisToggleEffects)) { _ in
            audio.effectsEnabled.toggle()
        }
        .onReceive(NotificationCenter.default.publisher(for: .tetrisDockLeft)) { _ in
            game.dockSide = .left
        }
        .onReceive(NotificationCenter.default.publisher(for: .tetrisDockRight)) { _ in
            game.dockSide = .right
        }
        .onDisappear {
            audio.stopMusic()
        }
    }

    private var statusBar: some View {
        HStack(spacing: 8) {
            StatTile(title: "Score", value: "\(game.score)")
            StatTile(title: "Lines", value: "\(game.linesCleared)")
            StatTile(title: "Level", value: "\(game.level)")

            Spacer(minLength: 0)

            if game.isPaused {
                BadgeLabel(text: "Paused", tint: Color.orange)
            }
            if game.isGameOver {
                BadgeLabel(text: "Game Over", tint: Color.red)
            }
        }
        .frame(height: TetrisLayout.statusBarHeight)
        .padding(.horizontal, 10)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.white.opacity(0.26), lineWidth: 1)
        )
    }

    private var nextPanel: some View {
        VStack(spacing: 10) {
            Text("NEXT")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.white.opacity(0.85))

            ForEach(Array(game.nextQueue.prefix(2).enumerated()), id: \.offset) { index, kind in
                PiecePreview(kind: kind, cellSize: 10)
                    .scaleEffect(index == 0 ? 0.88 : 0.72)
                    .opacity(index == 0 ? 0.58 : 0.42)
            }

            Spacer(minLength: 0)

            VStack(spacing: 4) {
                Text(audio.musicEnabled ? "Music: On" : "Music: Off")
                Text(audio.effectsEnabled ? "SFX: On" : "SFX: Off")
            }
            .font(.caption2)
            .foregroundStyle(.white.opacity(0.74))
        }
        .padding(8)
        .frame(width: TetrisLayout.sidePanelWidth)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.white.opacity(0.18), lineWidth: 1)
        )
    }

    private func triggerLineClearFlash() {
        clearFlashOpacity = 0.44
        withAnimation(.easeOut(duration: 0.26)) {
            clearFlashOpacity = 0
        }
    }

    private func syncTempo() {
        audio.updateMusicTempo(
            stackHeight: game.stackHeight,
            boardHeight: game.rows,
            level: game.level
        )
    }
}

private struct StatTile: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title.uppercased())
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.headline.weight(.semibold))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(Color.black.opacity(0.34), in: RoundedRectangle(cornerRadius: 8))
    }
}

private struct BadgeLabel: View {
    let text: String
    let tint: Color

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.vertical, 5)
            .padding(.horizontal, 9)
            .background(tint.opacity(0.84), in: Capsule())
    }
}

private struct AnimatedBackdrop: View {
    @State private var drift: CGFloat = -100

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
                endRadius: 320
            )
            .offset(x: drift, y: -drift * 0.35)
            .blur(radius: 10)

            RadialGradient(
                colors: [Color.pink.opacity(0.25), Color.clear],
                center: .center,
                startRadius: 20,
                endRadius: 280
            )
            .offset(x: -drift * 0.8, y: drift * 0.45)
            .blur(radius: 14)
        }
        .ignoresSafeArea()
        .onAppear {
            withAnimation(.easeInOut(duration: 7.0).repeatForever(autoreverses: true)) {
                drift = 100
            }
        }
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
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.black.opacity(0.70))
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.white.opacity(0.26), lineWidth: 1)

            ForEach(0..<game.rows, id: \.self) { row in
                ForEach(0..<game.columns, id: \.self) { column in
                    let point = GridPoint(x: column, y: row)

                    cellView(
                        point: point,
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
        .shadow(color: Color.black.opacity(0.36), radius: 10, x: 0, y: 6)
    }

    @ViewBuilder
    private func cellView(
        point: GridPoint,
        activeCells: Set<GridPoint>,
        ghostCells: Set<GridPoint>,
        activeColor: Color?
    ) -> some View {
        if let activeColor, activeCells.contains(point) {
            block(color: activeColor, glowing: true)
        } else if let fixedColor = game.board[point.y][point.x]?.color {
            block(color: fixedColor, glowing: false)
        } else if ghostCells.contains(point) {
            let corner = max(2, cellSize * 0.16)
            RoundedRectangle(cornerRadius: corner)
                .stroke(
                    Color.white.opacity(0.45),
                    style: StrokeStyle(lineWidth: max(1, cellSize * 0.06), dash: [max(3, cellSize * 0.20)])
                )
                .background(
                    RoundedRectangle(cornerRadius: corner)
                        .fill(Color.white.opacity(0.08))
                )
        } else {
            let corner = max(2, cellSize * 0.16)
            RoundedRectangle(cornerRadius: corner)
                .fill(
                    LinearGradient(
                        colors: [Color.black.opacity(0.40), Color.black.opacity(0.20)],
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

    private func block(color: Color, glowing: Bool) -> some View {
        let corner = max(2, cellSize * 0.16)

        return RoundedRectangle(cornerRadius: corner)
            .fill(
                LinearGradient(
                    colors: [color.opacity(glowing ? 1.0 : 0.90), color.opacity(0.58)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: corner)
                    .stroke(Color.white.opacity(glowing ? 0.45 : 0.20), lineWidth: 1)
            )
            .shadow(
                color: color.opacity(glowing ? 0.56 : 0.24),
                radius: glowing ? cellSize * 0.24 : cellSize * 0.14,
                x: 0,
                y: 0
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

                        RoundedRectangle(cornerRadius: 2)
                            .fill(filled ? kind.color : Color.black.opacity(0.14))
                            .frame(width: cellSize, height: cellSize)
                    }
                }
            }
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

            let target = TetrisLayout.windowFrame(in: screen.visibleFrame, side: side)
            if abs(window.frame.minX - target.minX) > 0.5 ||
                abs(window.frame.minY - target.minY) > 0.5 ||
                abs(window.frame.width - target.width) > 0.5 ||
                abs(window.frame.height - target.height) > 0.5 {
                window.setFrame(target, display: true, animate: true)
            }

            window.minSize = NSSize(width: target.width, height: 360)
        }
    }
}
