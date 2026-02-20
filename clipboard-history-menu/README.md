# clipboard-history-menu

Minimal macOS clipboard history app for learning native APIs.

## Features

- Menu bar resident app (`NSStatusItem`)
- Polls `NSPasteboard.general` for new text
- Keeps last 20 unique text entries
- Click an entry to copy it back to clipboard
- Clear history and quit actions

## Run

```bash
cd /path/to/Codex/clipboard-history-menu
swift run
```

The app appears in the macOS menu bar as `CB`.

## Build release binary

```bash
swift build -c release
```

Binary path:

```text
/path/to/Codex/clipboard-history-menu/.build/release/clipboard-history-menu
```
