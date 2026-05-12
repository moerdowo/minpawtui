#!/usr/bin/env bun
// Verify the half-cell brick visualizer renders stacked square bricks
// when playing and decays to all-spaces when stopped.
import { Spectrum } from "../src/ui/spectrum.ts";
import { writeFileSync } from "node:fs";

const BARS = 8;
const TERMINAL_ROWS = 2;
const LEVEL_COLORS = ["#ff4444", "#ffcf3f", "#0bff5a", "#0a8a3a"];
const EMPTY = "#021406";

const spec = new Spectrum(BARS);

for (let i = 0; i < 60; i++) spec.tick(1 / 60, true);
const playing = spec.renderBricks(BARS, TERMINAL_ROWS, LEVEL_COLORS, EMPTY);

for (let i = 0; i < 60; i++) spec.tick(1 / 60, false);
const stopped = spec.renderBricks(BARS, TERMINAL_ROWS, LEVEL_COLORS, EMPTY);

const renderRow = (chunks: any[]) =>
  chunks.map((c) => c.text ?? "").join("");

const formatColor = (rgba: any): string => {
  if (!rgba) return "-";
  const buf = rgba.buffer ?? rgba;
  return `[${buf[0]},${buf[1]},${buf[2]}]`;
};

const colorsRow = (chunks: any[]) =>
  chunks
    .map((c) => `${c.text}/fg=${formatColor(c.fg)}/bg=${formatColor(c.bg)}`)
    .join("  ");

const lines: string[] = [
  `bars=${BARS}  terminal-rows=${TERMINAL_ROWS}  brick-levels=${TERMINAL_ROWS * 2}`,
  "",
  "playing:",
];
for (const row of playing) lines.push(`  [${renderRow(row)}]`);
lines.push("", "stopped:");
for (const row of stopped) lines.push(`  [${renderRow(row)}]`);
lines.push("", "playing colors (row 0):", `  ${colorsRow(playing[0]!)}`);
lines.push("", "playing colors (row 1):", `  ${colorsRow(playing[1]!)}`);
lines.push("");

const out = lines.join("\n");
writeFileSync("/tmp/viz-smoke.out", out);
process.stdout.write(out);
