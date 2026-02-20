# mac-tetris

Orthodox Tetris for macOS built with SwiftUI.

## Features

- Standard 10x20 playfield
- 7-bag piece randomizer
- Soft drop, hard drop, rotate (CW/CCW)
- Line clear scoring and level speed-up
- Ghost landing preview
- Animated neon-style board and background
- Built-in sound effects and looped background music
- Window auto-sizes from screen height and docks to left or right edge
- Top bar shows only score/lines/level, and the rest is the stacking field
- Next 2 tetromino previews are reduced and semi-transparent
- Background music speeds up as the stack gets higher
- Auto-pause on inactive window is enabled by default

## Run

```bash
cd /path/to/Codex/mac-tetris
swift run
```

## Menu Controls

Use the macOS menu bar:

- `Game > Move Left` (`A`)
- `Game > Move Right` (`D`)
- `Game > Soft Drop` (`S`)
- `Game > Hard Drop` (`Space`)
- `Game > Rotate Clockwise` (`W`)
- `Game > Rotate Counterclockwise` (`Q`)
- `Game > Pause / Resume` (`P`)
- `Game > Restart` (`R`)
- `Audio > Toggle Music` (`M`)
- `Audio > Toggle Effects` (`K`)
- `Window > Dock Left / Dock Right`
- `Window > Auto Pause When Inactive` (toggle)

## Notes

- Run from `swift run` or install to `.app` bundle and launch normally.
