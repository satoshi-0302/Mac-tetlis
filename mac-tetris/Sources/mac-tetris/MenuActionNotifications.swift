import Foundation

extension Notification.Name {
    static let tetrisMoveLeft = Notification.Name("tetrisMoveLeft")
    static let tetrisMoveRight = Notification.Name("tetrisMoveRight")
    static let tetrisSoftDrop = Notification.Name("tetrisSoftDrop")
    static let tetrisHardDrop = Notification.Name("tetrisHardDrop")
    static let tetrisRotateClockwise = Notification.Name("tetrisRotateClockwise")
    static let tetrisRotateCounterClockwise = Notification.Name("tetrisRotateCounterClockwise")
    static let tetrisTogglePause = Notification.Name("tetrisTogglePause")
    static let tetrisRestart = Notification.Name("tetrisRestart")
    static let tetrisToggleMusic = Notification.Name("tetrisToggleMusic")
    static let tetrisToggleEffects = Notification.Name("tetrisToggleEffects")
    static let tetrisDockLeft = Notification.Name("tetrisDockLeft")
    static let tetrisDockRight = Notification.Name("tetrisDockRight")
}
