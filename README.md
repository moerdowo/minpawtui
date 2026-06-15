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
│ Drukqs · 23 - aphex_twin_-_avril_14th.mp3                       ▄ ▄ ▄        │
│ [▶]  01:23 / 02:05  ████████░░░░░░░░  VOL ▮▮▮▮▮▮▮▮▯▯  80%      ▀ ▀ ▀ ▀ ▄ ▄ ▄│
│ [Space] pause  [S] stop  [[ / ] ] seek  [N]ext                               │
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

You also need an audio backend on your `PATH`:

| Backend          | Visualizer        | Pause / Seek | Install                              |
|------------------|-------------------|--------------|--------------------------------------|
| **ffmpeg + ffplay** | 🟢 **real FFT** | ✅ precise     | `brew install ffmpeg` · `apt install ffmpeg` |
| mpv              | synthetic         | ✅ full        | `brew install mpv` · `apt install mpv` |
| ffplay only      | synthetic         | ⚠️ restart    | `brew install ffmpeg`                |
| afplay           | synthetic         | ❌ basic      | built into macOS                     |

`minpawtui` auto-detects in this order. **Install `ffmpeg` for the full
experience** — it decodes audio *through* minpawtui, so the spectrum
visualizer is a real-time FFT of what you're hearing (not a simulation),
and pause/seek/volume are sample-accurate. The other backends still play
fine but drive the visualizer with a synthetic model.

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
bar is a stack of 4 square brick pieces, packed two-per-terminal-cell
via half-block glyphs (`▀` / `▄` / `█`) and per-half fg/bg colors. A
terminal cell is roughly 1:2 (W:H), so a half-cell-tall block is
approximately **1:1** — each brick reads as a square. The 1-char gap
between bars gives the wall its vertical mortar; the brick-level color
gradient (red on top, amber, bright LCD green, dim green at the
bottom) is preserved across both halves of every cell.

### Real FFT, not eye-candy

With the **ffmpeg backend** the bricks are a genuine real-time spectrum.
ffmpeg decodes the track to raw PCM, minpawtui meters that PCM to the
ffplay "DAC" at exactly real-time rate, and **taps every sample on the
way through** into a ring buffer. The UI runs a 2048-point Hann-windowed
[radix-2 FFT](src/audio/analyzer.ts) over that buffer ~20×/sec, buckets
the power spectrum into log-spaced frequency bands (40 Hz–16 kHz), and
feeds those magnitudes straight to the bricks. Low notes light the left
bars, highs light the right — because it's measuring the actual signal.

The tap sits *before* the volume scaling, so turning the volume down
doesn't shrink the visualizer — exactly like a hardware analyzer.

On the fallback backends (mpv / ffplay-only / afplay) the audio never
passes through our process, so there's nothing to analyze; the bars use
a synthetic model instead (per-band oscillators + envelope + noise +
bass-biased beat spikes). Either way, pause/stop decays them to silence.

Toggle with `V`. On narrow terminals (inner width under 55 columns) the
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
│  Player          │   ── ffmpeg-tap : ffmpeg ─PCM→ [tap → FFT] ─→ ffplay
│  abstraction     │   ── mpv        : JSON IPC over Unix socket
│                  │   ── ffplay/afplay : process restart on seek
└──────────────────┘
```

- **State store** is a tiny `EventEmitter` — every change re-renders.
- **Player** is an interface with three implementations:
  - `FfmpegTapPlayer` (preferred) spawns `ffmpeg` to decode the track to
    raw f32 PCM and meters it to `ffplay` at real-time rate. Because *we*
    are the clock, position is `bytesOut / byteRate`, pause is `SIGSTOP`
    on both processes, and seek re-spawns ffmpeg with `-ss`. Every metered
    chunk is tapped into the [`Analyzer`](src/audio/analyzer.ts) for the
    real-time FFT spectrum.
  - `MpvPlayer` spawns `mpv --idle --input-ipc-server=…` and talks JSON
    commands over the socket, observing `time-pos` / `duration` / `pause`.
  - `SpawnPlayer` spawns `ffplay` / `afplay` per track and approximates
    pause/seek by killing and re-spawning with `-ss <offset>`.

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
