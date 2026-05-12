import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import { theme } from "../theme.ts";
import type { PlayerState } from "../types.ts";

/**
 * Classic Winamp-style spectrum analyzer.
 *
 * We don't have access to the audio output buffer (playback runs in an
 * external mpv/ffplay/afplay process), so the bars are driven by a
 * synthetic signal model — per-band oscillators with different periods
 * plus envelope, noise, and occasional "beat" spikes on the bass bands.
 * Looks alive in a way that matches a song's general feel without
 * pretending to be a real FFT.
 *
 * Bars use 1/8 sub-cell block characters for vertical resolution, so a
 * N-row visualizer renders N*8 vertical levels per column.
 */

const SUB_BLOCKS: readonly string[] = [
  " ",
  "▁",
  "▂",
  "▃",
  "▄",
  "▅",
  "▆",
  "▇",
  "█",
];
const PEAK_CAP = "▔";

interface FakeSpectrum {
  bands: number;
  levels: number[];
  peaks: number[];
  time: number;
  beatTimer: number;
}

function createSpectrum(bands: number): FakeSpectrum {
  return {
    bands,
    levels: new Array(bands).fill(0),
    peaks: new Array(bands).fill(0),
    time: 0,
    beatTimer: 0,
  };
}

function tickSpectrum(spec: FakeSpectrum, dt: number, playing: boolean): void {
  if (!playing) {
    for (let i = 0; i < spec.bands; i++) {
      spec.levels[i]! *= 0.82;
      spec.peaks[i] = Math.max(spec.levels[i]!, spec.peaks[i]! - dt * 0.6);
      if (spec.levels[i]! < 0.001) spec.levels[i] = 0;
      if (spec.peaks[i]! < 0.001) spec.peaks[i] = 0;
    }
    return;
  }

  spec.time += dt;
  spec.beatTimer -= dt;
  const isBeat = spec.beatTimer <= 0;
  if (isBeat) spec.beatTimer = 0.22 + Math.random() * 0.45;

  for (let i = 0; i < spec.bands; i++) {
    // Bass-biased envelope: lower bands get more average energy.
    const norm = i / Math.max(1, spec.bands - 1);
    const bandBias = 1.0 - norm * 0.55;

    const phase = i * 0.37;
    const oscFast = Math.sin(spec.time * 6.0 + phase) * 0.22;
    const oscMid = Math.sin(spec.time * 2.3 + phase * 1.7) * 0.32;
    const oscSlow = Math.sin(spec.time * 0.9 + phase * 0.6 + 1.3) * 0.28;
    const envelope = (oscFast + oscMid + oscSlow) * 0.5 + 0.5; // 0..1

    const beatSpike = isBeat && norm < 0.45 ? Math.random() * 0.4 : 0;
    const noise = (Math.random() - 0.5) * 0.12;

    const target = clamp01(envelope * bandBias + beatSpike + noise);

    const cur = spec.levels[i]!;
    const dir = target - cur;
    const speed = dir > 0 ? 0.55 : 0.18; // fast attack, slow release
    spec.levels[i] = cur + dir * speed;

    // Peak indicator: tracks current level, then falls slowly.
    const pk = spec.peaks[i]!;
    if (spec.levels[i]! > pk) spec.peaks[i] = spec.levels[i]!;
    else spec.peaks[i] = Math.max(spec.levels[i]!, pk - dt * 0.35);
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export class Visualizer {
  readonly root: BoxRenderable;
  private rows: TextRenderable[] = [];
  private spectrum: FakeSpectrum;
  private rowCount = 4;
  private lastTick = Date.now();

  constructor(renderer: CliRenderer) {
    this.spectrum = createSpectrum(40);

    this.root = new BoxRenderable(renderer, {
      id: "visualizer",
      width: "100%",
      height: this.rowCount + 2,
      border: true,
      borderStyle: "single",
      borderColor: theme.lcdDim,
      backgroundColor: theme.lcdBg,
      title: " SPECTRUM ",
      titleAlignment: "left",
      paddingLeft: 1,
      paddingRight: 1,
      flexDirection: "column",
    });

    // Build rows top → bottom, each with its own color.
    const colors = this.rowColors(this.rowCount);
    for (let r = 0; r < this.rowCount; r++) {
      const t = new TextRenderable(renderer, {
        id: `viz-row-${r}`,
        content: "",
        fg: colors[r]!,
      });
      this.rows.push(t);
      this.root.add(t);
    }
  }

  private rowColors(n: number): string[] {
    // Top row is red, bottom row is dim-green. Smooth between.
    const stops: Array<[number, string]> = [
      [0, theme.red], // top
      [0.4, theme.amber],
      [0.75, theme.lcd],
      [1, theme.lcdDim], // bottom
    ];
    const out: string[] = [];
    for (let r = 0; r < n; r++) {
      const t = r / Math.max(1, n - 1);
      out.push(interpolateStops(stops, t));
    }
    return out;
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  isVisible(): boolean {
    return this.root.visible;
  }

  /**
   * Advance the simulation and re-render the bars. Call frequently
   * (~15–25 fps) for smooth motion.
   */
  tick(player: PlayerState): void {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;

    const playing = player.status === "playing";
    tickSpectrum(this.spectrum, dt, playing);

    const innerWidth = Math.max(8, (this.root.width || 80) - 4);
    // Each bar uses 2 columns (1 bar + 1 space) so it looks chunky.
    const barCount = Math.max(8, Math.floor((innerWidth + 1) / 2));

    if (barCount !== this.spectrum.bands) {
      this.spectrum = resizeSpectrum(this.spectrum, barCount);
    }

    // Build each row by iterating bars.
    const maxLevels = this.rowCount * 8;
    for (let r = 0; r < this.rowCount; r++) {
      const rowFromBottom = this.rowCount - 1 - r;
      let line = "";
      for (let b = 0; b < barCount; b++) {
        const level = this.spectrum.levels[b]!;
        const peak = this.spectrum.peaks[b]!;
        const subFill = clamp(
          Math.round(level * maxLevels) - rowFromBottom * 8,
          0,
          8,
        );
        let ch = SUB_BLOCKS[subFill]!;

        // Peak indicator: draw a flat top half-block above current bar
        // when the peak sits in this cell and above the live level.
        const peakLevel = Math.round(peak * maxLevels);
        const cellBase = rowFromBottom * 8;
        if (
          peak > level + 0.02 &&
          peakLevel > cellBase &&
          peakLevel <= cellBase + 8 &&
          subFill < 8
        ) {
          // Show a thin cap if the cell is otherwise empty/partial.
          if (subFill === 0) ch = PEAK_CAP;
        }

        line += ch;
        if (b < barCount - 1) line += " ";
      }
      this.rows[r]!.content = line;
    }
  }
}

function resizeSpectrum(prev: FakeSpectrum, bands: number): FakeSpectrum {
  const next = createSpectrum(bands);
  next.time = prev.time;
  next.beatTimer = prev.beatTimer;
  for (let i = 0; i < bands; i++) {
    const srcIdx = Math.min(
      prev.bands - 1,
      Math.floor((i / bands) * prev.bands),
    );
    next.levels[i] = prev.levels[srcIdx] ?? 0;
    next.peaks[i] = prev.peaks[srcIdx] ?? 0;
  }
  return next;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ------------------------------------------------------------------ */
/* Color interpolation                                                */
/* ------------------------------------------------------------------ */

function interpolateStops(stops: Array<[number, string]>, t: number): string {
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]!;
    const [t1, c1] = stops[i + 1]!;
    if (t >= t0 && t <= t1) {
      const range = t1 - t0;
      const local = range === 0 ? 0 : (t - t0) / range;
      return lerpHex(c0, c1, local);
    }
  }
  return stops[stops.length - 1]![1];
}

function lerpHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl
    .toString(16)
    .padStart(2, "0")}`;
}
