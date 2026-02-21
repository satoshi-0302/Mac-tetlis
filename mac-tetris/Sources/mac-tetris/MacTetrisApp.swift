import SwiftUI

@main
struct MacTetrisApp: App {
    @AppStorage("autoPauseWhenInactive") private var autoPauseWhenInactive = true
    @AppStorage("controlScheme") private var controlScheme = ControlScheme.wasd.rawValue
    @AppStorage("dasMilliseconds") private var dasMilliseconds = 130.0
    @AppStorage("arrMilliseconds") private var arrMilliseconds = 33.0
    @AppStorage("softDropMilliseconds") private var softDropMilliseconds = 33.0
    @AppStorage("lockDelayMilliseconds") private var lockDelayMilliseconds = 500.0

    var body: some Scene {
        WindowGroup("Mac Tetris") {
            TetrisView()
        }
        .commands {
            CommandGroup(replacing: .appInfo) { }
            CommandGroup(replacing: .newItem) { }
            CommandGroup(replacing: .pasteboard) { }
            CommandGroup(replacing: .undoRedo) { }
            CommandGroup(replacing: .windowSize) { }
            CommandGroup(replacing: .windowList) { }
            CommandGroup(replacing: .help) { }

            CommandMenu("Settings") {
                Picker("Controls", selection: $controlScheme) {
                    Text(ControlScheme.wasd.menuLabel).tag(ControlScheme.wasd.rawValue)
                    Text(ControlScheme.arrows.menuLabel).tag(ControlScheme.arrows.rawValue)
                }

                Divider()

                Picker("DAS", selection: $dasMilliseconds) {
                    Text("DAS: 80ms").tag(80.0)
                    Text("DAS: 110ms").tag(110.0)
                    Text("DAS: 130ms").tag(130.0)
                    Text("DAS: 160ms").tag(160.0)
                    Text("DAS: 200ms").tag(200.0)
                }

                Picker("ARR", selection: $arrMilliseconds) {
                    Text("ARR: 0ms").tag(0.0)
                    Text("ARR: 16ms").tag(16.0)
                    Text("ARR: 33ms").tag(33.0)
                    Text("ARR: 50ms").tag(50.0)
                    Text("ARR: 75ms").tag(75.0)
                }

                Picker("Soft Drop", selection: $softDropMilliseconds) {
                    Text("Soft Drop: 16ms").tag(16.0)
                    Text("Soft Drop: 25ms").tag(25.0)
                    Text("Soft Drop: 33ms").tag(33.0)
                    Text("Soft Drop: 50ms").tag(50.0)
                    Text("Soft Drop: 80ms").tag(80.0)
                }

                Picker("Lock Delay", selection: $lockDelayMilliseconds) {
                    Text("Lock Delay: 250ms").tag(250.0)
                    Text("Lock Delay: 350ms").tag(350.0)
                    Text("Lock Delay: 500ms").tag(500.0)
                    Text("Lock Delay: 700ms").tag(700.0)
                    Text("Lock Delay: 1000ms").tag(1000.0)
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
