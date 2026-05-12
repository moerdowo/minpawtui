#!/usr/bin/env bun
// Verify the brick visualizer renders stacked bricks when playing
// and decays to all-spaces when stopped.
import { Spectrum } from "../src/ui/spectrum.ts";
import { writeFileSync } from "node:fs";

const BARS = 10;
const ROWS = 4;
const ROW_COLORS = ["#ff4444", "#ffcf3f", "#0bff5a", "#0a8a3a"];
const SPACER = "#021406";

const spec = new Spectrum(BARS);

// 1 second of playing-state ticks
for (let i = 0; i < 60; i++) spec.tick(1 / 60, true);
const playingRows = spec.renderBricks(BARS, ROWS, ROW_COLORS, SPACER);

// 1 second of stopped-state decay
for (let i = 0; i < 60; i++) spec.tick(1 / 60, false);
const stoppedRows = spec.renderBricks(BARS, ROWS, ROW_COLORS, SPACER);

const renderRow = (chunks: any[]): string =>
  chunks.map((c) => c.text ?? "").join("");

const lines: string[] = [];
lines.push(`bars=${BARS}  rows=${ROWS}`);
lines.push("");
lines.push("playing:");
for (const row of playingRows) lines.push(`  ${renderRow(row)}`);
lines.push("");
lines.push("stopped:");
for (const row of stoppedRows) lines.push(`  [${renderRow(row)}]`);
lines.push("");

const out = lines.join("\n");
writeFileSync("/tmp/viz-smoke.out", out);
process.stdout.write(out);
