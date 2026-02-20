import Foundation
import SwiftUI

struct GridPoint: Hashable {
    let x: Int
    let y: Int
}

enum WindowDockSide: String, CaseIterable, Identifiable {
    case left
    case right

    var id: String { rawValue }

    var title: String {
        switch self {
        case .left:
            return "Left"
        case .right:
            return "Right"
        }
    }
}

enum TetrominoKind: CaseIterable {
    case i
    case o
    case t
    case s
    case z
    case j
    case l

    var color: Color {
        switch self {
        case .i:
            return Color(red: 0.22, green: 0.82, blue: 0.92)
        case .o:
            return Color(red: 0.95, green: 0.84, blue: 0.28)
        case .t:
            return Color(red: 0.72, green: 0.46, blue: 0.95)
        case .s:
            return Color(red: 0.40, green: 0.85, blue: 0.45)
        case .z:
            return Color(red: 0.93, green: 0.34, blue: 0.36)
        case .j:
            return Color(red: 0.34, green: 0.50, blue: 0.94)
        case .l:
            return Color(red: 0.94, green: 0.58, blue: 0.30)
        }
    }

    var rotations: [[GridPoint]] {
        switch self {
        case .i:
            return [
                [GridPoint(x: 0, y: 1), GridPoint(x: 1, y: 1), GridPoint(x: 2, y: 1), GridPoint(x: 3, y: 1)],
                [GridPoint(x: 2, y: 0), GridPoint(x: 2, y: 1), GridPoint(x: 2, y: 2), GridPoint(x: 2, y: 3)],
                [GridPoint(x: 0, y: 2), GridPoint(x: 1, y: 2), GridPoint(x: 2, y: 2), GridPoint(x: 3, y: 2)],
                [GridPoint(x: 1, y: 0), GridPoint(x: 1, y: 1), GridPoint(x: 1, y: 2), GridPoint(x: 1, y: 3)]
            ]
        case .o:
            let shape = [GridPoint(x: 1, y: 0), GridPoint(x: 2, y: 0), GridPoint(x: 1, y: 1), GridPoint(x: 2, y: 1)]
            return [shape, shape, shape, shape]
        case .t:
            return [
                [GridPoint(x: 1, y: 0), GridPoint(x: 0, y: 1), GridPoint(x: 1, y: 1), GridPoint(x: 2, y: 1)],
                [GridPoint(x: 1, y: 0), GridPoint(x: 1, y: 1), GridPoint(x: 2, y: 1), GridPoint(x: 1, y: 2)],
                [GridPoint(x: 0, y: 1), GridPoint(x: 1, y: 1), GridPoint(x: 2, y: 1), GridPoint(x: 1, y: 2)],
                [GridPoint(x: 1, y: 0), GridPoint(x: 0, y: 1), GridPoint(x: 1, y: 1), GridPoint(x: 1, y: 2)]
            ]
        case .s:
            return [
                [GridPoint(x: 1, y: 0), GridPoint(x: 2, y: 0), GridPoint(x: 0, y: 1), GridPoint(x: 1, y: 1)],
                [GridPoint(x: 1, y: 0), GridPoint(x: 1, y: 1), GridPoint(x: 2, y: 1), GridPoint(x: 2, y: 2)],
                [GridPoint(x: 1, y: 1), GridPoint(x: 2, y: 1), GridPoint(x: 0, y: 2), GridPoint(x: 1, y: 2)],
                [GridPoint(x: 0, y: 0), GridPoint(x: 0, y: 1), GridPoint(x: 1, y: 1), GridPoint(x: 1, y: 2)]
            ]
        case .z:
            return [
                [GridPoint(x: 0, y: 0), GridPoint(x: 1, y: 0), GridPoint(x: 1, y: 1), GridPoint(x: 2, y: 1)],
                [GridPoint(x: 2, y: 0), GridPoint(x: 1, y: 1), GridPoint(x: 2, y: 1), GridPoint(x: 1, y: 2)],
                [GridPoint(x: 0, y: 1), GridPoint(x: 1, y: 1), GridPoint(x: 1, y: 2), GridPoint(x: 2, y: 2)],
                [GridPoint(x: 1, y: 0), GridPoint(x: 0, y: 1), GridPoint(x: 1, y: 1), GridPoint(x: 0, y: 2)]
            ]
        case .j:
            return [
                [GridPoint(x: 0, y: 0), GridPoint(x: 0, y: 1), GridPoint(x: 1, y: 1), GridPoint(x: 2, y: 1)],
                [GridPoint(x: 1, y: 0), GridPoint(x: 2, y: 0), GridPoint(x: 1, y: 1), GridPoint(x: 1, y: 2)],
                [GridPoint(x: 0, y: 1), GridPoint(x: 1, y: 1), GridPoint(x: 2, y: 1), GridPoint(x: 2, y: 2)],
                [GridPoint(x: 1, y: 0), GridPoint(x: 1, y: 1), GridPoint(x: 0, y: 2), GridPoint(x: 1, y: 2)]
            ]
        case .l:
            return [
                [GridPoint(x: 2, y: 0), GridPoint(x: 0, y: 1), GridPoint(x: 1, y: 1), GridPoint(x: 2, y: 1)],
                [GridPoint(x: 1, y: 0), GridPoint(x: 1, y: 1), GridPoint(x: 1, y: 2), GridPoint(x: 2, y: 2)],
                [GridPoint(x: 0, y: 1), GridPoint(x: 1, y: 1), GridPoint(x: 2, y: 1), GridPoint(x: 0, y: 2)],
                [GridPoint(x: 0, y: 0), GridPoint(x: 1, y: 0), GridPoint(x: 1, y: 1), GridPoint(x: 1, y: 2)]
            ]
        }
    }
}

struct ActivePiece {
    let kind: TetrominoKind
    let rotation: Int
    let origin: GridPoint

    var blocks: [GridPoint] {
        kind.rotations[rotation].map { GridPoint(x: origin.x + $0.x, y: origin.y + $0.y) }
    }
}

@MainActor
final class TetrisGame: ObservableObject {
    let columns: Int
    let rows: Int

    @Published private(set) var board: [[TetrominoKind?]]
    @Published private(set) var activePiece: ActivePiece?
    @Published private(set) var nextQueue: [TetrominoKind] = []

    @Published private(set) var score: Int = 0
    @Published private(set) var linesCleared: Int = 0
    @Published private(set) var level: Int = 1

    @Published private(set) var isGameOver: Bool = false
    @Published var isPaused: Bool = false
    @Published var dockSide: WindowDockSide = .right

    private var bag: [TetrominoKind] = []
    private var gravityTimer: Timer?

    init(columns: Int = 10, rows: Int = 20) {
        self.columns = columns
        self.rows = rows
        self.board = Array(repeating: Array(repeating: nil, count: columns), count: rows)
        startNewGame()
    }

    func startNewGame() {
        board = Array(repeating: Array(repeating: nil, count: columns), count: rows)
        score = 0
        linesCleared = 0
        level = 1
        isGameOver = false
        isPaused = false
        bag = []
        nextQueue = []

        ensureQueue(minimum: 5)
        spawnPiece()
        startGravityTimer()
    }

    func togglePause() {
        guard !isGameOver else { return }
        isPaused.toggle()
    }

    func moveLeft() {
        _ = attemptMove(dx: -1, dy: 0)
    }

    func moveRight() {
        _ = attemptMove(dx: 1, dy: 0)
    }

    func softDrop() {
        guard canControlPiece else { return }
        if attemptMove(dx: 0, dy: 1) {
            score += 1
        }
    }

    func hardDrop() {
        guard canControlPiece else { return }
        var distance = 0
        while attemptMove(dx: 0, dy: 1) {
            distance += 1
        }
        score += distance * 2
        lockPiece()
    }

    func rotateClockwise() {
        attemptRotation(direction: 1)
    }

    func rotateCounterClockwise() {
        attemptRotation(direction: -1)
    }

    func tick() {
        guard canControlPiece else { return }
        if !attemptMove(dx: 0, dy: 1) {
            lockPiece()
        }
    }

    func ghostBlocks() -> [GridPoint] {
        guard var piece = activePiece else { return [] }

        while true {
            let candidate = ActivePiece(
                kind: piece.kind,
                rotation: piece.rotation,
                origin: GridPoint(x: piece.origin.x, y: piece.origin.y + 1)
            )
            if collides(candidate.blocks) {
                return piece.blocks
            }
            piece = candidate
        }
    }

    private var canControlPiece: Bool {
        !isGameOver && !isPaused && activePiece != nil
    }

    private func startGravityTimer() {
        gravityTimer?.invalidate()
        gravityTimer = Timer.scheduledTimer(withTimeInterval: dropInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.tick()
            }
        }
    }

    private var dropInterval: TimeInterval {
        max(0.08, 0.80 - (Double(level - 1) * 0.06))
    }

    private func spawnPiece() {
        ensureQueue(minimum: 1)
        let kind = nextQueue.removeFirst()
        ensureQueue(minimum: 5)

        let candidate = ActivePiece(kind: kind, rotation: 0, origin: GridPoint(x: 3, y: 0))
        if collides(candidate.blocks) {
            activePiece = nil
            isGameOver = true
            gravityTimer?.invalidate()
            return
        }

        activePiece = candidate
    }

    private func ensureQueue(minimum: Int) {
        while nextQueue.count < minimum {
            if bag.isEmpty {
                bag = TetrominoKind.allCases.shuffled()
            }
            nextQueue.append(bag.removeFirst())
        }
    }

    private func attemptMove(dx: Int, dy: Int) -> Bool {
        guard canControlPiece, let piece = activePiece else { return false }

        let candidate = ActivePiece(
            kind: piece.kind,
            rotation: piece.rotation,
            origin: GridPoint(x: piece.origin.x + dx, y: piece.origin.y + dy)
        )

        guard !collides(candidate.blocks) else { return false }

        activePiece = candidate
        return true
    }

    private func attemptRotation(direction: Int) {
        guard canControlPiece, let piece = activePiece else { return }

        let nextRotation = (piece.rotation + direction + 4) % 4
        let wallKickTests = [
            GridPoint(x: 0, y: 0),
            GridPoint(x: -1, y: 0),
            GridPoint(x: 1, y: 0),
            GridPoint(x: -2, y: 0),
            GridPoint(x: 2, y: 0),
            GridPoint(x: 0, y: -1),
            GridPoint(x: 0, y: 1)
        ]

        for kick in wallKickTests {
            let candidate = ActivePiece(
                kind: piece.kind,
                rotation: nextRotation,
                origin: GridPoint(x: piece.origin.x + kick.x, y: piece.origin.y + kick.y)
            )
            if !collides(candidate.blocks) {
                activePiece = candidate
                return
            }
        }
    }

    private func lockPiece() {
        guard let piece = activePiece else { return }

        for block in piece.blocks {
            guard block.y >= 0, block.y < rows, block.x >= 0, block.x < columns else { continue }
            board[block.y][block.x] = piece.kind
        }

        activePiece = nil

        let clearedNow = clearCompleteLines()
        if clearedNow > 0 {
            let baseScores = [0, 100, 300, 500, 800]
            score += baseScores[clearedNow] * level
            linesCleared += clearedNow
            level = (linesCleared / 10) + 1
            startGravityTimer()
        }

        spawnPiece()
    }

    private func clearCompleteLines() -> Int {
        var remainingRows = board.filter { row in
            !row.allSatisfy { $0 != nil }
        }

        let cleared = rows - remainingRows.count
        guard cleared > 0 else { return 0 }

        let emptyRows: [[TetrominoKind?]] = Array(
            repeating: Array<TetrominoKind?>(repeating: nil, count: columns),
            count: cleared
        )
        remainingRows = emptyRows + remainingRows
        board = remainingRows
        return cleared
    }

    private func collides(_ blocks: [GridPoint]) -> Bool {
        for block in blocks {
            if block.x < 0 || block.x >= columns || block.y < 0 || block.y >= rows {
                return true
            }
            if board[block.y][block.x] != nil {
                return true
            }
        }

        return false
    }
}
