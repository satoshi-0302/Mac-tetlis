import SwiftUI

@main
struct MacTetrisApp: App {
    @AppStorage("autoPauseWhenInactive") private var autoPauseWhenInactive = true

    var body: some Scene {
        WindowGroup("Mac Tetris") {
            TetrisView()
        }
        .commands {
            CommandMenu("Game") {
                Button("Move Left") {
                    post(.tetrisMoveLeft)
                }
                .keyboardShortcut("a", modifiers: [])

                Button("Move Right") {
                    post(.tetrisMoveRight)
                }
                .keyboardShortcut("d", modifiers: [])

                Button("Soft Drop") {
                    post(.tetrisSoftDrop)
                }
                .keyboardShortcut("s", modifiers: [])

                Button("Hard Drop") {
                    post(.tetrisHardDrop)
                }
                .keyboardShortcut(.space, modifiers: [])

                Button("Rotate Clockwise") {
                    post(.tetrisRotateClockwise)
                }
                .keyboardShortcut("w", modifiers: [])

                Button("Rotate Counterclockwise") {
                    post(.tetrisRotateCounterClockwise)
                }
                .keyboardShortcut("q", modifiers: [])

                Divider()

                Button("Pause / Resume") {
                    post(.tetrisTogglePause)
                }
                .keyboardShortcut("p", modifiers: [])

                Button("Restart") {
                    post(.tetrisRestart)
                }
                .keyboardShortcut("r", modifiers: [])
            }

            CommandMenu("Audio") {
                Button("Toggle Music") {
                    post(.tetrisToggleMusic)
                }
                .keyboardShortcut("m", modifiers: [])

                Button("Toggle Effects") {
                    post(.tetrisToggleEffects)
                }
                .keyboardShortcut("k", modifiers: [])
            }

            CommandMenu("Window") {
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
