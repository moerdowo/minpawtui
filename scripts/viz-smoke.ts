#!/usr/bin/env bun
// Verify the Braille dot-matrix visualizer: feed real FFT bands (from white
// noise + a tone) and render. Confirms fine dots and a non-saturated picture.
import { Spectrum } from "../src/ui/spectrum.ts";
import { Analyzer } from "../src/audio/analyzer.ts";
import { writeFileSync } from "node:fs";

const CELL_W = 16;
const CELL_H = 4;
const BARS = CELL_W * 2; // one bar per dot-column
const ROW_COLORS = ["#ff4444", "#ffcf3f", "#0bff5a", "#0a8a3a"];
const EMPTY = "#021406";
const SR = 44100;

function render(spec: Spectrum): string[] {
  const rows = spec.renderBraille(CELL_W, CELL_H, ROW_COLORS, EMPTY);
  return rows.map((r) => r.map((c: any) => c.text ?? "").join(""));
}

// Real FFT of a 440Hz tone over band-shaped noise → feed into Spectrum.
const a = new Analyzer(SR, 2048);
const spec = new Spectrum(BARS);
const buf = new Float32Array(2048);
for (let i = 0; i < buf.length; i++) {
  buf[i] = Math.sin((2 * Math.PI * 440 * i) / SR) * 0.5 + (Math.random() * 2 - 1) * 0.08;
}
a.pushMono(buf);

const lines: string[] = [`Braille viz ${CELL_W}×${CELL_H} cells = ${BARS}×${CELL_H * 4} dots`, ""];
lines.push("playing (real FFT: 440Hz tone + light noise):");
for (let k = 0; k < 10; k++) spec.tick(1 / 20, true, a.computeBands(BARS));
for (const r of render(spec)) lines.push(`  |${r}|`);

lines.push("", "after stop (decays):");
for (let k = 0; k < 20; k++) spec.tick(1 / 20, false);
for (const r of render(spec)) lines.push(`  |${r}|`);
lines.push("");

const out = lines.join("\n");
writeFileSync("/tmp/viz-smoke.out", out);
process.stdout.write(out);
