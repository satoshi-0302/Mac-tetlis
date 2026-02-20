# mac-tetris

Orthodox Tetris for macOS built with SwiftUI.

## Features

- Standard 10x20 playfield
- 7-bag piece randomizer
- Soft drop, hard drop, rotate (CW/CCW)
- Line clear scoring and level speed-up
- Ghost landing preview
- Window docks to left or right 1/5 of the active screen

## Run

```bash
cd /path/to/Codex/mac-tetris
swift run
```

## Controls

- Left arrow: move left
- Right arrow: move right
- Down arrow: soft drop
- Up arrow: rotate clockwise
- `Z`: rotate counterclockwise
- Space: hard drop
- `P`: pause/resume
- `R`: restart

## Notes

- Use the `Left` / `Right` segmented control in the header to switch docking side.
- The window auto-resizes to about 20% width of the current screen.
