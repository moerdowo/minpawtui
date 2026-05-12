# minpawtui

A keyboard-driven, **Winamp-style classic MP3 player for your terminal.**
Point it at a folder, it indexes every audio file inside, and you build a
playlist with a couple of keystrokes. No mouse needed.

```
╔══════════════════════════════════════════════════════════════════════════════╗
║ ♪♫  M I N P A W   T U I  ♫♪              LIB:128  PL:4  DIR:~/Music          ║
╚══════════════════════════════════════════════════════════════════════════════╝
╭─ NOW PLAYING ────────────────────────────────────────────────────────────────╮
│ ♪  Aphex Twin — Avril 14th                                                   │
│ Drukqs · 23 - aphex_twin_-_avril_14th.mp3                       ▆            │
│ [▶]  01:23 / 02:05  ████████░░░░░░░░  VOL ▮▮▮▮▮▮▮▮▯▯  80%      ▆ ▆ ▆     ▆  │
│ [Space] pause  [S] stop  [[ / ] ] seek  [N]ext                  ▆ ▆ ▆ ▆ ▆ ▆ ▆│
│                                                                 ▆ ▆ ▆ ▆ ▆ ▆ ▆│
╰──────────────────────────────────────────────────────────────────────────────╯
┌─ LIBRARY  (128) ─────────────────────────┐┌─ PLAYLIST  (4) ──────────────────┐
│  Title              Artist        Time   ││ #   Title       Artist     Time  │
│  Avril 14th         Aphex Twin   02:05   ││ 1.  Strobe      Deadmau5  10:32  │
│  Strobe             Deadmau5     10:32   ││ 2.  Selected... Aphex Twin 04:42 │
│▸ Selected Ambient   Aphex Twin   04:42   ││ ♪ 3. Avril 14th Aphex Twin 02:05 │
│  Sandstorm          Darude       03:45   ││ 4.  Sandstorm   Darude     03:45 │
└──────────────────────────────────────────┘└──────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Space] Play/Pause  [N/P] Next/Prev  [↑↓] Move  [Enter] Play/Add  ... [?]    │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Install

`minpawtui` is built on [OpenTUI](https://opentui.com), which uses Bun's FFI.
You will need **Bun** to run it.

```bash
# Install Bun (once)
curl -fsSL https://bun.sh/install | bash      # macOS / Linux
# or:  brew install oven-sh/bun/bun

# Install minpawtui globally
bun install -g minpawtui
# or with npm (the launcher will still invoke bun under the hood):
npm install -g minpawtui
```

You also need at least one of these audio backends on your `PATH`:

| Backend  | Pause / Seek | Install                              |
|----------|--------------|--------------------------------------|
| **mpv**  | ✅ full       | `brew install mpv` · `apt install mpv` |
| ffplay   | ⚠️ restart    | `brew install ffmpeg`                |
| afplay   | ❌ basic      | built into macOS                     |

`minpawtui` auto-detects in this order. Install `mpv` for the best experience —
it controls playback over an IPC socket so pause/seek/volume are instant.

## Run

```bash
minpawtui              # scan the current folder
minpawtui ~/Music      # scan a specific folder
minpawtui --help
```

On startup it walks the folder recursively, reads ID3 / Vorbis / MP4 tags via
[`music-metadata`](https://github.com/Borewit/music-metadata), and shows
everything it found in the **Library** panel.

## Keys

The whole app is keyboard-driven. Press `?` at any time for the cheatsheet.

### Playback

| Key             | Action                                       |
|-----------------|----------------------------------------------|
| `Space`         | Play / Pause toggle                          |
| `S`             | Stop                                         |
| `N` / `→`       | Next track                                   |
| `P` / `←`       | Previous track                               |
| `[` / `]`       | Seek −5 s / +5 s                             |
| `{` / `}`       | Seek −30 s / +30 s                           |
| `+` / `=` / `-` | Volume up / down                             |
| `M`             | Mute toggle                                  |
| `R`             | Cycle repeat (off → all → one)               |
| `Z`             | Toggle shuffle                               |
| `V`             | Toggle spectrum visualizer                   |

### Library & Playlist

| Key                  | Action                                  |
|----------------------|-----------------------------------------|
| `Tab` · `1` · `2`    | Switch focus between Library / Playlist |
| `↑` / `↓` · `k` / `j`| Move cursor                             |
| `PgUp` / `PgDn`      | Move by page                            |
| `Home` / `End` · `g` | Jump to top / bottom                    |
| `Enter` (Library)    | Add track to playlist **and play**      |
| `A` (Library)        | Add highlighted track to playlist       |
| `Shift+A` (Library)  | Add **all** library tracks to playlist  |
| `Enter` (Playlist)   | Play highlighted track                  |
| `D` (Playlist)       | Remove track from playlist              |
| `C` (Playlist)       | Clear playlist                          |

### App

| Key            | Action                  |
|----------------|-------------------------|
| `?` / `F1`     | Toggle help overlay     |
| `Q` / `Ctrl+C` | Quit                    |

## Supported formats

`mp3`, `m4a`, `m4b`, `aac`, `flac`, `ogg`, `oga`, `opus`, `wav`, `wma`,
`aiff`, `aif`. Whatever your backend can decode plays; whatever
`music-metadata` recognises gets proper tags.

## Visualizer

Classic Winamp **stacking-brick** spectrum analyzer, tucked into the
right side of the `NOW PLAYING` panel next to the volume meter. Each
bar is a column of 4 stackable bricks (`▆`); the 3/4-height brick glyph
leaves a 1/4-cell strip of background between rows as natural mortar,
and the 1-char gap between bars gives the wall its vertical mortar
lines. Each row has its own color in the classic gradient — red on
top, amber, bright LCD green, dim green at the bottom. Floating peak
indicators (`▔`) decay slowly above each bar.

Playback runs in an external `mpv` / `ffplay` / `afplay` process, so we
don't have access to the audio output buffer for a real FFT. The bars
are driven by a synthetic signal — per-band oscillators with different
periods, envelope, noise, and occasional "beat" spikes biased toward
bass bands. Tied to the player state: when you pause or stop, bars
decay to silence.

Toggle with `V`. On narrow terminals (inner width under 60 columns) the
brick column auto-collapses so the volume meter has room to breathe.

## How it works

```
┌──────────────────┐
│  OpenTUI (Bun)   │   ← rendering, key input
└────────┬─────────┘
         │
┌────────▼─────────┐   ┌──────────────────┐
│  Store + State   │◀──│  scanner         │
└────────┬─────────┘   │  (music-metadata)│
         │             └──────────────────┘
┌────────▼─────────┐
│  Player          │   ── mpv  (JSON IPC over Unix socket)
│  abstraction     │   ── ffplay / afplay  (process restart on seek)
└──────────────────┘
```

- **State store** is a tiny `EventEmitter` — every change re-renders.
- **Player** is an interface with two implementations:
  - `MpvPlayer` spawns `mpv --idle --input-ipc-server=…` and talks JSON
    commands over the socket. It observes `time-pos`, `duration`, and
    `pause` so the UI follows playback in real time.
  - `SpawnPlayer` spawns `ffplay` / `afplay` per track and approximates
    pause/seek by killing and re-spawning with `-ss <offset>`. Position is
    tracked client-side from `Date.now()`.

## Development

```bash
bun install
bun run dev ~/Music     # auto-restart on save
bun run typecheck
```

The whole thing is TypeScript and shipped as TypeScript — Bun runs it
natively, no build step required.

## License

MIT
