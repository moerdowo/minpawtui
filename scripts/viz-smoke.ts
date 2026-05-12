#!/usr/bin/env bun
// Verify the inline Spectrum produces non-empty bars when playing,
// and decays to silence when stopped.
import { Spectrum } from "../src/ui/spectrum.ts";
import { writeFileSync } from "node:fs";

const WIDTH = 18;
const spec = new Spectrum(WIDTH);

// 1 second of playing-state ticks
for (let i = 0; i < 60; i++) spec.tick(1 / 60, true);
const playingChunks = spec.renderInline(WIDTH);
const playingText = playingChunks.map((c: any) => c.text ?? "").join("");
const playingColors = playingChunks.map((c: any) => c?.fg ?? c?.style?.fg ?? "?");

// 1 second of stopped-state decay
for (let i = 0; i < 60; i++) spec.tick(1 / 60, false);
const stoppedChunks = spec.renderInline(WIDTH);
const stoppedText = stoppedChunks.map((c: any) => c.text ?? "").join("");

const out = [
  `inline width: ${WIDTH}`,
  `playing bars : [${playingText}]`,
  `playing colors: ${JSON.stringify(playingColors)}`,
  `stopped bars : [${stoppedText}]`,
  ``,
].join("\n");

writeFileSync("/tmp/viz-smoke.out", out);
process.stdout.write(out);
