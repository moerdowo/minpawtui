#!/usr/bin/env bun
// Verify the visualizer renders non-empty bars when playing.
import { createCliRenderer } from "@opentui/core";
import { Visualizer } from "../src/ui/visualizer.ts";
import type { PlayerState } from "../src/types.ts";

const renderer = await createCliRenderer({
  testing: true,
  targetFps: 30,
  exitOnCtrlC: false,
});

const viz = new Visualizer(renderer);
renderer.root.add(viz.root);

const playing: PlayerState = {
  status: "playing",
  currentTrack: null,
  positionSec: 0,
  durationSec: 100,
  volume: 80,
  muted: false,
  repeat: "off",
  shuffle: false,
};

// Tick the visualizer many times to let bars build up.
for (let i = 0; i < 60; i++) {
  viz.tick(playing);
  await new Promise((r) => setTimeout(r, 16));
}

const rows = (viz.root as any).getChildren().map((c: any) => {
  // TextRenderable.content is a StyledText (chunks array).
  const ch = c.chunks ?? [];
  return ch.map((k: any) => k.text ?? "").join("");
});
const out = rows.map((r: string, i: number) => `row ${i}: [${r}]`).join("\n");
require("fs").writeFileSync("/tmp/viz-smoke.out", out + "\n");

renderer.destroy?.();
process.exit(0);
