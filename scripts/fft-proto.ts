#!/usr/bin/env bun
// Validate the Analyzer FFT: feed pure sine tones, confirm the energy lands in
// the correct log-spaced band. A correct FFT puts a 440Hz tone in a low-mid
// band and a 5kHz tone in a high band.
import { Analyzer } from "../src/audio/analyzer.ts";

const SR = 44100;
const a = new Analyzer(SR, 2048);
const BANDS = 10;

function feedSine(freq: number): number[] {
  a.reset();
  const buf = new Float32Array(2048);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.sin((2 * Math.PI * freq * i) / SR) * 0.8;
  a.pushMono(buf);
  // run a few frames so smoothing settles
  let bands: number[] = [];
  for (let k = 0; k < 8; k++) bands = a.computeBands(BANDS);
  return bands;
}

function bandEdges(bandCount: number, minHz = 40, maxHz = 16000): string[] {
  const out: string[] = [];
  const lo = Math.log(minHz), hi = Math.log(maxHz);
  for (let b = 0; b < bandCount; b++) {
    const f0 = Math.exp(lo + ((hi - lo) * b) / bandCount);
    const f1 = Math.exp(lo + ((hi - lo) * (b + 1)) / bandCount);
    out.push(`${Math.round(f0)}-${Math.round(f1)}Hz`);
  }
  return out;
}

function peakBand(bands: number[]): number {
  let mi = 0;
  for (let i = 1; i < bands.length; i++) if (bands[i]! > bands[mi]!) mi = i;
  return mi;
}

const edges = bandEdges(BANDS);
console.log("band edges:", edges.join("  "));
console.log("");

for (const freq of [120, 440, 1000, 5000, 10000]) {
  const bands = feedSine(freq);
  const pk = peakBand(bands);
  const bar = bands.map((v) => "█▇▆▅▄▃▂▁ "[Math.max(0, 8 - Math.round(v * 8))]).join("");
  console.log(`${String(freq).padStart(5)}Hz → peak band ${pk} (${edges[pk]})   [${bar}]`);
}

// Silence decays to ~0
a.reset();
a.pushMono(new Float32Array(2048));
let s: number[] = [];
for (let k = 0; k < 8; k++) s = a.computeBands(BANDS);
console.log("");
console.log("silence → max band:", Math.max(...s).toFixed(4), "(should be ~0)");
