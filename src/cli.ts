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
  Playback uses mpv (preferred), ffplay, or afplay — whichever is on PATH.
  Install mpv (recommended) for full pause/seek/volume support:
    brew install mpv       # macOS
    sudo apt install mpv   # Debian / Ubuntu
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
        "Install one of:\n" +
        "  mpv      — recommended (full pause/seek control)\n" +
        "             brew install mpv  |  sudo apt install mpv\n" +
        "  ffplay   — basic playback (part of ffmpeg)\n" +
        "             brew install ffmpeg  |  sudo apt install ffmpeg\n" +
        "  afplay   — built into macOS (basic playback)\n",
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
