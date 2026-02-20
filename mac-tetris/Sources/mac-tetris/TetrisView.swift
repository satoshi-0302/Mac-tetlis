import AppKit
import SwiftUI

struct TetrisView: View {
    @StateObject private var game = TetrisGame()

    var body: some View {
        VStack(spacing: 12) {
            header

            HStack(alignment: .top, spacing: 10) {
                BoardView(game: game)

                VStack(spacing: 10) {
                    statsCard
                    nextCard
                    controlHint
                }
                .frame(width: 120)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            if game.isGameOver {
                Text("Game Over - press R")
                    .font(.headline)
                    .foregroundStyle(Color.red)
            }
        }
        .padding(12)
        .frame(minWidth: 280, minHeight: 520)
        .background(
            LinearGradient(
                colors: [
                    Color(red: 0.08, green: 0.09, blue: 0.12),
                    Color(red: 0.13, green: 0.16, blue: 0.22)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .background(WindowDockingView(side: game.dockSide))
        .overlay {
            KeyCaptureView(onKeyDown: handleKeyDown)
                .allowsHitTesting(false)
        }
    }

    private var header: some View {
        HStack {
            Text("Mac Tetris")
                .font(.title3.weight(.semibold))
                .foregroundStyle(.white)

            Spacer()

            Picker("Dock", selection: $game.dockSide) {
                ForEach(WindowDockSide.allCases) { side in
                    Text(side.title).tag(side)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 150)

            Button(game.isPaused ? "Resume" : "Pause") {
                game.togglePause()
            }

            Button("Restart") {
                game.startNewGame()
            }
        }
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
                    .foregroundStyle(.yellow)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.88), in: RoundedRectangle(cornerRadius: 10))
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
        .background(Color.white.opacity(0.88), in: RoundedRectangle(cornerRadius: 10))
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
        .background(Color.white.opacity(0.88), in: RoundedRectangle(cornerRadius: 10))
    }

    private func handleKeyDown(_ event: NSEvent) {
        if event.modifierFlags.contains(.command) {
            return
        }

        switch event.keyCode {
        case 123:
            game.moveLeft()
        case 124:
            game.moveRight()
        case 125:
            game.softDrop()
        case 126:
            game.rotateClockwise()
        case 6:
            game.rotateCounterClockwise()
        case 49:
            game.hardDrop()
        case 35:
            game.togglePause()
        case 15:
            game.startNewGame()
        default:
            break
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

            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.black.opacity(0.76))
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color.white.opacity(0.25), lineWidth: 1)

                ForEach(0..<game.rows, id: \.self) { row in
                    ForEach(0..<game.columns, id: \.self) { column in
                        let point = GridPoint(x: column, y: row)

                        Rectangle()
                            .fill(color(for: point, activeCells: activeCells, ghostCells: ghostCells))
                            .overlay(
                                Rectangle().stroke(Color.white.opacity(0.08), lineWidth: 1)
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
        }
    }

    private func color(for point: GridPoint, activeCells: Set<GridPoint>, ghostCells: Set<GridPoint>) -> Color {
        if let activePiece = game.activePiece, activeCells.contains(point) {
            return activePiece.kind.color
        }

        if let filled = game.board[point.y][point.x] {
            return filled.color
        }

        if ghostCells.contains(point) {
            return Color.white.opacity(0.16)
        }

        return Color(red: 0.12, green: 0.12, blue: 0.15)
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

                        Rectangle()
                            .fill(filled ? kind.color : Color.black.opacity(0.10))
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
