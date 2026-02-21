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

enum LineClearKind: Equatable {
    case single
    case double
    case triple
    case tetris
    case tSpinSingle
    case tSpinDouble
    case tSpinTriple
    case allClear

    var effectStrength: CGFloat {
        switch self {
        case .single:
            return 1.0
        case .double:
            return 1.4
        case .triple:
            return 1.8
        case .tetris:
            return 2.5
        case .tSpinSingle:
            return 2.6
        case .tSpinDouble:
            return 3.0
        case .tSpinTriple:
            return 3.4
        case .allClear:
            return 3.8
        }
    }
}

struct ClearFeedback: Equatable, Identifiable {
    let id: Int
    let kind: LineClearKind
    let clearedLines: Int
    let combo: Int
    let isBackToBack: Bool
    let isAllClear: Bool
}

@MainActor
final class TetrisGame: ObservableObject {
    let columns: Int
    @Published private(set) var rows: Int

    @Published private(set) var board: [[TetrominoKind?]]
    @Published private(set) var activePiece: ActivePiece?
    @Published private(set) var nextQueue: [TetrominoKind] = []
    @Published private(set) var holdPiece: TetrominoKind?

    @Published private(set) var score: Int = 0
    @Published private(set) var linesCleared: Int = 0
    @Published private(set) var level: Int = 1
    @Published private(set) var stackHeight: Int = 0
    @Published private(set) var combo: Int = 0
    @Published private(set) var isBackToBackChain: Bool = false
    @Published private(set) var latestClearFeedback: ClearFeedback?

    @Published private(set) var isGameOver: Bool = false
    @Published var isPaused: Bool = false
    @Published var dockSide: WindowDockSide = .right

    private var bag: [TetrominoKind] = []
    private var hasHeldThisTurn = false
    private var gravityAccumulator: TimeInterval = 0
    private var lockDelayAccumulator: TimeInterval = 0
    private var lockDelayDuration: TimeInterval = 0.50
    private var comboStreak = -1
    private var clearFeedbackSequence = 0
    private var lastActionWasRotation = false

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
        stackHeight = 0
        combo = 0
        isBackToBackChain = false
        latestClearFeedback = nil
        isGameOver = false
        isPaused = false
        bag = []
        nextQueue = []
        holdPiece = nil
        hasHeldThisTurn = false
        gravityAccumulator = 0
        lockDelayAccumulator = 0
        comboStreak = -1
        clearFeedbackSequence = 0
        lastActionWasRotation = false

        ensureQueue(minimum: 5)
        spawnPiece()
    }

    func resizeRows(to requestedRows: Int) {
        let targetRows = max(1, requestedRows)
        guard targetRows != rows else { return }

        let delta = targetRows - rows

        if delta > 0 {
            let added = Array(
                repeating: Array<TetrominoKind?>(repeating: nil, count: columns),
                count: delta
            )
            board = added + board
        } else {
            let removeCount = min(rows - 1, -delta)
            board.removeFirst(removeCount)
        }

        rows = board.count

        if !isGameOver, let piece = activePiece {
            if let resolved = resolvedPieceForCurrentBoard(piece: piece, deltaRows: delta) {
                activePiece = resolved
            } else {
                activePiece = nil
                spawnPiece()
            }
        }

        lockDelayAccumulator = 0
        updateStackHeight()
    }

    private func resolvedPieceForCurrentBoard(piece: ActivePiece, deltaRows: Int) -> ActivePiece? {
        let offsets = piece.kind.rotations[piece.rotation]
        let minOffsetY = offsets.map(\.y).min() ?? 0
        let maxOffsetY = offsets.map(\.y).max() ?? 0

        let minOriginY = -minOffsetY
        let maxOriginY = rows - 1 - maxOffsetY
        guard maxOriginY >= minOriginY else { return nil }

        let preferredOriginY = piece.origin.y + deltaRows
        let clampedOriginY = min(max(preferredOriginY, minOriginY), maxOriginY)

        let maxSearchDistance = max(rows, 24)
        for distance in 0...maxSearchDistance {
            let candidates: [Int]
            if distance == 0 {
                candidates = [clampedOriginY]
            } else {
                candidates = [clampedOriginY - distance, clampedOriginY + distance]
            }

            for originY in candidates where originY >= minOriginY && originY <= maxOriginY {
                let candidate = ActivePiece(
                    kind: piece.kind,
                    rotation: piece.rotation,
                    origin: GridPoint(x: piece.origin.x, y: originY)
                )
                if !collides(candidate.blocks) {
                    return candidate
                }
            }
        }

        return nil
    }

    @discardableResult
    func togglePause() -> Bool {
        isPaused ? resume() : pause()
    }

    @discardableResult
    func pause() -> Bool {
        guard !isGameOver, !isPaused else { return false }
        isPaused = true
        return true
    }

    @discardableResult
    func resume() -> Bool {
        guard !isGameOver, isPaused else { return false }
        isPaused = false
        return true
    }

    func setLockDelay(milliseconds: Double) {
        let clamped = max(80, min(1200, milliseconds))
        lockDelayDuration = clamped / 1000.0
    }

    func advance(by deltaTime: TimeInterval) {
        guard canControlPiece else { return }

        let clamped = min(max(0, deltaTime), 0.05)
        gravityAccumulator += clamped
        let currentDropInterval = dropInterval

        while gravityAccumulator >= currentDropInterval {
            gravityAccumulator -= currentDropInterval
            if attemptMove(dx: 0, dy: 1) {
                lastActionWasRotation = false
                lockDelayAccumulator = 0
            } else {
                break
            }
        }

        guard activePiece != nil else { return }

        if isActivePieceGrounded {
            lockDelayAccumulator += clamped
            if lockDelayAccumulator >= lockDelayDuration {
                lockPiece()
            }
        } else {
            lockDelayAccumulator = 0
        }
    }

    @discardableResult
    func moveLeft() -> Bool {
        guard attemptMove(dx: -1, dy: 0) else { return false }
        lastActionWasRotation = false
        lockDelayAccumulator = 0
        return true
    }

    @discardableResult
    func moveRight() -> Bool {
        guard attemptMove(dx: 1, dy: 0) else { return false }
        lastActionWasRotation = false
        lockDelayAccumulator = 0
        return true
    }

    @discardableResult
    func softDrop() -> Bool {
        guard canControlPiece else { return false }
        guard attemptMove(dx: 0, dy: 1) else { return false }
        score += 1
        lastActionWasRotation = false
        lockDelayAccumulator = 0
        return true
    }

    @discardableResult
    func hardDrop() -> Int {
        guard canControlPiece else { return 0 }
        var distance = 0
        while attemptMove(dx: 0, dy: 1) {
            distance += 1
        }
        score += distance * 2
        lastActionWasRotation = false
        lockPiece()
        return distance
    }

    @discardableResult
    func rotateClockwise() -> Bool {
        guard attemptRotation(direction: 1) else { return false }
        lastActionWasRotation = true
        lockDelayAccumulator = 0
        return true
    }

    @discardableResult
    func rotateCounterClockwise() -> Bool {
        guard attemptRotation(direction: -1) else { return false }
        lastActionWasRotation = true
        lockDelayAccumulator = 0
        return true
    }

    @discardableResult
    func holdCurrentPiece() -> Bool {
        guard canControlPiece, !hasHeldThisTurn, let current = activePiece else { return false }

        let currentKind = current.kind
        hasHeldThisTurn = true
        lastActionWasRotation = false
        lockDelayAccumulator = 0
        gravityAccumulator = 0

        if let heldKind = holdPiece {
            holdPiece = currentKind
            return activatePiece(kind: heldKind)
        }

        holdPiece = currentKind
        activePiece = nil
        spawnPiece()
        return !isGameOver
    }

    func tick() {
        advance(by: dropInterval)
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

    private var dropInterval: TimeInterval {
        max(0.08, 0.80 - (Double(level - 1) * 0.06))
    }

    private func spawnPiece() {
        ensureQueue(minimum: 1)
        let kind = nextQueue.removeFirst()
        ensureQueue(minimum: 5)

        _ = activatePiece(kind: kind)
    }

    @discardableResult
    private func activatePiece(kind: TetrominoKind) -> Bool {
        let candidate = spawnCandidate(for: kind)
        if collides(candidate.blocks) {
            activePiece = nil
            isGameOver = true
            updateStackHeight()
            return false
        }

        activePiece = candidate
        lockDelayAccumulator = 0
        gravityAccumulator = 0
        lastActionWasRotation = false
        return true
    }

    private func spawnCandidate(for kind: TetrominoKind) -> ActivePiece {
        ActivePiece(kind: kind, rotation: 0, origin: GridPoint(x: spawnOriginX, y: 0))
    }

    private var spawnOriginX: Int {
        max(0, (columns / 2) - 2)
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

    private func attemptRotation(direction: Int) -> Bool {
        guard canControlPiece, let piece = activePiece else { return false }

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
                return true
            }
        }
        return false
    }

    private func lockPiece() {
        guard let piece = activePiece else { return }

        for block in piece.blocks {
            guard block.y >= 0, block.y < rows, block.x >= 0, block.x < columns else { continue }
            board[block.y][block.x] = piece.kind
        }

        let wasTSpin = detectTSpin(for: piece)
        activePiece = nil
        hasHeldThisTurn = false
        lockDelayAccumulator = 0
        gravityAccumulator = 0

        let clearedNow = clearCompleteLines()
        applyScoring(clearedLines: clearedNow, wasTSpin: wasTSpin)
        lastActionWasRotation = false

        updateStackHeight()
        spawnPiece()
    }

    private func detectTSpin(for piece: ActivePiece) -> Bool {
        guard piece.kind == .t, lastActionWasRotation else { return false }
        let pivot = GridPoint(x: piece.origin.x + 1, y: piece.origin.y + 1)
        let cornerOffsets = [
            GridPoint(x: -1, y: -1),
            GridPoint(x: 1, y: -1),
            GridPoint(x: -1, y: 1),
            GridPoint(x: 1, y: 1)
        ]

        var occupiedCorners = 0
        for offset in cornerOffsets {
            let x = pivot.x + offset.x
            let y = pivot.y + offset.y
            if x < 0 || x >= columns || y < 0 || y >= rows || board[y][x] != nil {
                occupiedCorners += 1
            }
        }
        return occupiedCorners >= 3
    }

    private func applyScoring(clearedLines: Int, wasTSpin: Bool) {
        guard clearedLines > 0 else {
            comboStreak = -1
            combo = 0
            latestClearFeedback = nil
            return
        }

        comboStreak += 1
        combo = max(0, comboStreak)

        let baseKind = lineClearKind(for: clearedLines, wasTSpin: wasTSpin)
        let difficultClear = wasTSpin || clearedLines == 4
        let hasBackToBackBonus = difficultClear && isBackToBackChain

        var baseScore = scoreValue(for: baseKind)
        if hasBackToBackBonus {
            baseScore = Int(Double(baseScore) * 1.5)
        }

        let comboBonus = comboStreak > 0 ? comboStreak * 50 : 0
        let isAllClear = board.allSatisfy { row in row.allSatisfy { $0 == nil } }
        let allClearBonus = isAllClear ? 1800 : 0

        score += (baseScore + comboBonus + allClearBonus) * level
        linesCleared += clearedLines
        level = (linesCleared / 10) + 1

        if difficultClear {
            isBackToBackChain = true
        } else {
            isBackToBackChain = false
        }

        let feedbackKind: LineClearKind = isAllClear ? .allClear : baseKind
        clearFeedbackSequence += 1
        latestClearFeedback = ClearFeedback(
            id: clearFeedbackSequence,
            kind: feedbackKind,
            clearedLines: clearedLines,
            combo: combo,
            isBackToBack: hasBackToBackBonus,
            isAllClear: isAllClear
        )
    }

    private func lineClearKind(for clearedLines: Int, wasTSpin: Bool) -> LineClearKind {
        if wasTSpin {
            switch clearedLines {
            case 1:
                return .tSpinSingle
            case 2:
                return .tSpinDouble
            default:
                return .tSpinTriple
            }
        }

        switch clearedLines {
        case 1:
            return .single
        case 2:
            return .double
        case 3:
            return .triple
        default:
            return .tetris
        }
    }

    private func scoreValue(for kind: LineClearKind) -> Int {
        switch kind {
        case .single:
            return 100
        case .double:
            return 300
        case .triple:
            return 500
        case .tetris:
            return 800
        case .tSpinSingle:
            return 800
        case .tSpinDouble:
            return 1200
        case .tSpinTriple:
            return 1600
        case .allClear:
            return 1800
        }
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

    private var isActivePieceGrounded: Bool {
        guard let piece = activePiece else { return false }
        let downShifted = piece.blocks.map { GridPoint(x: $0.x, y: $0.y + 1) }
        return collides(downShifted)
    }

    private func updateStackHeight() {
        guard let firstFilledRow = board.firstIndex(where: { row in row.contains(where: { $0 != nil }) }) else {
            stackHeight = 0
            return
        }

        stackHeight = rows - firstFilledRow
    }
}
