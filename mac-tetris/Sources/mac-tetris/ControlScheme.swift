import Foundation

enum ControlScheme: String, CaseIterable {
    case wasd
    case arrows

    var menuLabel: String {
        switch self {
        case .wasd:
            return "Controls: WASD"
        case .arrows:
            return "Controls: Arrows"
        }
    }
}
