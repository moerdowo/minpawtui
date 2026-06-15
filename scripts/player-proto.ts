#!/usr/bin/env bun
// Integration test for FfmpegTapPlayer: real position, pause/seek, live FFT bands.
import { FfmpegTapPlayer } from "../src/audio/ffmpeg-player.ts";
import type { Track } from "../src/types.ts";

const path = process.argv[2] ?? "/tmp/minpaw-audio/test30.wav";
const track: Track = {
  id: path, path, filename: "test30.wav",
  title: "Test 440+880", artist: "lavfi", album: "proto",
  durationSec: 30,
};

const p = new FfmpegTapPlayer();
let ended = false;
p.on("ended", () => { ended = true; console.log(">>> ended event"); });
p.on("started", () => console.log(">>> started event"));
p.on("paused", () => console.log(">>> paused event"));
p.on("resumed", () => console.log(">>> resumed event"));

const bars = (b: number[] | null) =>
  b ? b.map((v) => "▁▂▃▄▅▆▇█"[Math.min(7, Math.floor(v * 8))]).join("") : "----";

await p.load(track);
console.log("loaded, playing\n");

const log = setInterval(() => {
  const b = p.getBands(8);
  console.log(
    `pos=${p.getPosition().toFixed(2)}s  status=${p.isPlaying() ? "play" : p.isPaused() ? "pause" : "stop"}  bands=[${bars(b)}]`,
  );
}, 500);

// pause at 2s, resume at 4s, seek to 20s at 6s, then let it run.
setTimeout(() => { console.log("\n>>> pause()"); p.pause(); }, 2000);
setTimeout(() => { console.log("\n>>> play()"); p.play(); }, 4000);
setTimeout(() => { console.log("\n>>> seekAbs(20)"); p.seekAbs(20); }, 6000);
setTimeout(() => { console.log("\n>>> setVolume(30)"); p.setVolume(30); }, 8000);

setTimeout(async () => {
  clearInterval(log);
  console.log(`\nended=${ended}`);
  await p.destroy();
  process.exit(0);
}, 10000);
