#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

// Lightweight launcher: ensures `bun` is available, then runs src/cli.ts.
// We ship TypeScript source and let Bun run it natively (OpenTUI requires Bun).

const { spawn, spawnSync } = require("node:child_process");
const { resolve, join } = require("node:path");
const { existsSync } = require("node:fs");

function findBun() {
  // 1) ambient on PATH
  const probe = spawnSync(process.platform === "win32" ? "where" : "command", [
    process.platform === "win32" ? "bun" : "-v",
    "bun",
  ], { stdio: ["ignore", "pipe", "ignore"] });
  if (probe.status === 0 && probe.stdout && probe.stdout.toString().trim()) {
    return process.platform === "win32"
      ? probe.stdout.toString().split(/\r?\n/)[0].trim()
      : "bun";
  }
  // 2) common install locations
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const candidates = [
    home && join(home, ".bun", "bin", "bun"),
    "/usr/local/bin/bun",
    "/opt/homebrew/bin/bun",
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

const bun = findBun();
if (!bun) {
  console.error(
    [
      "minpawtui requires the Bun runtime (OpenTUI uses bun:ffi).",
      "",
      "Install Bun and try again:",
      "  curl -fsSL https://bun.sh/install | bash",
      "  # or: brew install oven-sh/bun/bun",
    ].join("\n"),
  );
  process.exit(127);
}

const here = __dirname;
const entry = resolve(here, "..", "src", "cli.ts");

const child = spawn(bun, ["run", entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
