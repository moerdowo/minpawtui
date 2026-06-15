#!/usr/bin/env bun
import { resolve, isAbsolute } from "node:path";
import { stat } from "node:fs/promises";
import { MinpawApp } from "./ui/app.ts";
import { detectBackend } from "./audio/player.ts";

interface ParsedArgs {
  dir: string;
  showHelp: boolean;
  showVersion: boolean;
}

const USAGE = `\
minpawtui — a keyboard-driven Winamp-style MP3 player for the terminal.

USAGE
  minpawtui [folder]
  minpawtui                # scans the current directory

OPTIONS
  -h, --help               Print this help and exit
  -v, --version            Print version and exit

KEYS
  Space        play / pause
  S            stop
  N / P        next / previous track
  ↑ ↓          move cursor                 Enter   play / add
  Tab          switch Library / Playlist   A       add to playlist
  [ ]          seek -5s / +5s              D       remove from playlist
  + -          volume up / down            C       clear playlist
  R            cycle repeat                Z       toggle shuffle
  ? F1         help                        Q       quit

BACKENDS
  Preferred: ffmpeg + ffplay — decodes in-process so the visualizer is a
  REAL FFT of the audio (plus precise pause/seek). Falls back to mpv, then
  ffplay, then afplay (those use a synthetic visualizer).
    brew install ffmpeg       # macOS
    sudo apt install ffmpeg   # Debian / Ubuntu  (provides ffmpeg + ffplay)
`;

function parseArgs(argv: string[]): ParsedArgs {
  let dir = ".";
  let showHelp = false;
  let showVersion = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") showHelp = true;
    else if (a === "-v" || a === "--version") showVersion = true;
    else if (!a.startsWith("-")) dir = a;
  }
  return { dir, showHelp, showVersion };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.showHelp) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  if (args.showVersion) {
    const pkg = await import("../package.json", {
      with: { type: "json" },
    }).catch(() => ({ default: { version: "0.0.0" } }));
    const v = (pkg as any).default?.version ?? "0.0.0";
    process.stdout.write(`minpawtui v${v}\n`);
    process.exit(0);
  }

  const absDir = isAbsolute(args.dir) ? args.dir : resolve(process.cwd(), args.dir);
  try {
    const s = await stat(absDir);
    if (!s.isDirectory()) {
      process.stderr.write(`error: ${absDir} is not a directory\n`);
      process.exit(1);
    }
  } catch {
    process.stderr.write(`error: cannot access ${absDir}\n`);
    process.exit(1);
  }

  const backend = detectBackend();
  if (backend === "none") {
    process.stderr.write(
      "error: no audio backend found on PATH.\n\n" +
        "Recommended (real FFT visualizer + precise pause/seek):\n" +
        "  ffmpeg + ffplay\n" +
        "             brew install ffmpeg  |  sudo apt install ffmpeg\n\n" +
        "Fallbacks (synthetic visualizer):\n" +
        "  mpv        brew install mpv  |  sudo apt install mpv\n" +
        "  afplay     built into macOS\n",
    );
    process.exit(1);
  }

  const app = new MinpawApp({ rootDir: absDir });
  await app.start();
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err?.message ?? err}\n`);
  process.exit(1);
});
