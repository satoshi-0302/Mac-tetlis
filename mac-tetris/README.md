# mac-tetris

Orthodox Tetris for macOS built with SwiftUI.

## Features

- Standard 10-column playfield with auto-filled vertical stack area
- 7-bag piece randomizer
- Soft drop, hard drop, rotate (CW/CCW)
- Single-slot hold (once per piece drop)
- Line clear scoring and level speed-up
- Ghost landing preview
- Built-in sound effects and looped background music
- 3D-style beveled block rendering
- Flashy line-clear burst effect (flash, beams, sparks)
- Pixel size is 70% of previous layout; window width fits that size tightly
- Window height is fixed; width is resizable with bottom-anchored blocks
- Score/Lines/Level are shown on the top line of the stacking area
- Next 3 tetromino previews are reduced, semi-transparent, and overlaid on the field
- Background music speeds up as the stack gets higher
- Auto-pause on inactive window is enabled by default

## Run

```bash
cd /path/to/Codex/mac-tetris
swift run
```

## Settings Menu

Use the macOS menu bar (`Settings`) for:

- `Controls` (`WASD` / `Arrows`)
- `Dock Left` / `Dock Right`
- `Auto Pause When Inactive` (toggle)

## Keyboard Controls

- Common: `Space` hard drop, `C` hold, `P` pause/resume, `R` restart
- `WASD` mode: `A` left, `D` right, `S` soft drop, `W` rotate CW, `Q` rotate CCW
- `Arrows` mode: `←` left, `→` right, `↓` soft drop, `↑` rotate CW, `Z` rotate CCW

## Notes

- Run from `swift run` or install to `.app` bundle and launch normally.
