import SwiftUI

@main
struct MacTetrisApp: App {
    @AppStorage("autoPauseWhenInactive") private var autoPauseWhenInactive = true
    @AppStorage("controlScheme") private var controlScheme = ControlScheme.wasd.rawValue

    var body: some Scene {
        WindowGroup("Mac Tetris") {
            TetrisView()
        }
        .commands {
            CommandMenu("Settings") {
                Picker("Controls", selection: $controlScheme) {
                    Text(ControlScheme.wasd.menuLabel).tag(ControlScheme.wasd.rawValue)
                    Text(ControlScheme.arrows.menuLabel).tag(ControlScheme.arrows.rawValue)
                }

                Divider()

                Button("Dock Left") {
                    post(.tetrisDockLeft)
                }

                Button("Dock Right") {
                    post(.tetrisDockRight)
                }

                Divider()

                Toggle("Auto Pause When Inactive", isOn: $autoPauseWhenInactive)
            }
        }
    }

    private func post(_ name: Notification.Name) {
        NotificationCenter.default.post(name: name, object: nil)
    }
}
