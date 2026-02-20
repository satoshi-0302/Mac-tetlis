import AppKit

@main
@MainActor
struct ClipboardHistoryMenuMain {
    static func main() {
        let app = NSApplication.shared
        let appDelegate = AppDelegate()
        app.delegate = appDelegate
        app.run()
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let pasteboard = NSPasteboard.general
    private var lastChangeCount = NSPasteboard.general.changeCount
    private var statusItem: NSStatusItem?
    private var pollTimer: Timer?
    private var history: [String] = []

    private let maxHistoryCount = 20
    private let pollInterval: TimeInterval = 0.6

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        setupStatusItem()
        startMonitoringClipboard()
    }

    func applicationWillTerminate(_ notification: Notification) {
        pollTimer?.invalidate()
    }

    private func setupStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "CB"
        statusItem = item
        rebuildMenu()
    }

    private func startMonitoringClipboard() {
        let timer = Timer(
            timeInterval: pollInterval,
            target: self,
            selector: #selector(handlePollTimer),
            userInfo: nil,
            repeats: true
        )
        RunLoop.main.add(timer, forMode: .common)
        pollTimer = timer
    }

    @objc
    private func handlePollTimer() {
        captureClipboardIfNeeded()
    }

    private func captureClipboardIfNeeded() {
        let currentChangeCount = pasteboard.changeCount
        guard currentChangeCount != lastChangeCount else { return }
        lastChangeCount = currentChangeCount

        guard let value = pasteboard.string(forType: .string) else { return }

        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return }

        if history.first == normalized { return }

        history.removeAll { $0 == normalized }
        history.insert(normalized, at: 0)

        if history.count > maxHistoryCount {
            history.removeLast(history.count - maxHistoryCount)
        }

        rebuildMenu()
    }

    private func rebuildMenu() {
        let menu = NSMenu()

        if history.isEmpty {
            let emptyItem = NSMenuItem(title: "No history yet", action: nil, keyEquivalent: "")
            emptyItem.isEnabled = false
            menu.addItem(emptyItem)
        } else {
            for (index, entry) in history.enumerated() {
                let item = NSMenuItem(
                    title: "\(index + 1). \(displayTitle(for: entry))",
                    action: #selector(copyFromHistory(_:)),
                    keyEquivalent: ""
                )
                item.target = self
                item.tag = index
                menu.addItem(item)
            }
        }

        menu.addItem(.separator())

        let clearItem = NSMenuItem(title: "Clear History", action: #selector(clearHistory), keyEquivalent: "")
        clearItem.target = self
        menu.addItem(clearItem)

        let quitItem = NSMenuItem(title: "Quit", action: #selector(quitApp), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem?.menu = menu
    }

    @objc
    private func copyFromHistory(_ sender: NSMenuItem) {
        guard history.indices.contains(sender.tag) else { return }

        let value = history[sender.tag]
        pasteboard.clearContents()
        pasteboard.setString(value, forType: .string)

        history.remove(at: sender.tag)
        history.insert(value, at: 0)
        lastChangeCount = pasteboard.changeCount

        rebuildMenu()
    }

    @objc
    private func clearHistory() {
        history.removeAll()
        rebuildMenu()
    }

    @objc
    private func quitApp() {
        NSApp.terminate(nil)
    }

    private func displayTitle(for value: String) -> String {
        let singleLine = value.replacingOccurrences(of: "\n", with: " <nl> ")
        let maxLength = 60
        guard singleLine.count > maxLength else { return singleLine }

        let endIndex = singleLine.index(singleLine.startIndex, offsetBy: maxLength)
        return String(singleLine[..<endIndex]) + "..."
    }
}
