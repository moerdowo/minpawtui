import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import { EventEmitter } from "node:events";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { Track } from "../types.ts";

import { FfmpegTapPlayer } from "./ffmpeg-player.ts";

export type PlayerBackend = "ffmpeg-tap" | "mpv" | "ffplay" | "afplay" | "none";

export interface PlayerEvents {
  ended: () => void;
  positionChange: (positionSec: number) => void;
  error: (error: Error) => void;
  started: (track: Track) => void;
  paused: () => void;
  resumed: () => void;
  stopped: () => void;
  volumeChange: (volume: number) => void;
}

export interface Player {
  readonly backend: PlayerBackend;
  load(track: Track): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  togglePause(): Promise<void>;
  stop(): Promise<void>;
  seek(deltaSec: number): Promise<void>;
  seekAbs(positionSec: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  getPosition(): number;
  getDuration(): number;
  isPlaying(): boolean;
  isPaused(): boolean;
  destroy(): Promise<void>;
  on<E extends keyof PlayerEvents>(event: E, listener: PlayerEvents[E]): void;
  off<E extends keyof PlayerEvents>(event: E, listener: PlayerEvents[E]): void;
  /**
   * Real spectrum magnitudes in [0,1] from an in-process FFT of the audio
   * being played, or null if this backend cannot tap the signal (in which
   * case the UI falls back to a synthetic visualizer).
   */
  getBands?(count: number): number[] | null;
}

function which(cmd: string): string | null {
  try {
    const out = execSync(`command -v ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

export function detectBackend(): PlayerBackend {
  // Prefer the in-process ffmpeg tap: it decodes through our process so the
  // visualizer is a real FFT of the audio, and it gives precise pause/seek.
  if (which("ffmpeg") && which("ffplay")) return "ffmpeg-tap";
  if (which("mpv")) return "mpv";
  if (which("ffplay")) return "ffplay";
  if (which("afplay")) return "afplay";
  return "none";
}

export function createPlayer(preferred?: PlayerBackend): Player {
  const backend = preferred && preferred !== "none" ? preferred : detectBackend();
  switch (backend) {
    case "ffmpeg-tap":
      return new FfmpegTapPlayer();
    case "mpv":
      return new MpvPlayer();
    case "ffplay":
      return new SpawnPlayer("ffplay");
    case "afplay":
      return new SpawnPlayer("afplay");
    default:
      throw new Error(
        "No audio backend found. Install one of: ffmpeg + ffplay (recommended — real spectrum visualizer), mpv, or run on macOS (afplay built-in).",
      );
  }
}

abstract class BasePlayer extends EventEmitter implements Player {
  abstract readonly backend: PlayerBackend;
  protected currentTrack: Track | null = null;
  protected positionSec = 0;
  protected durationSec = 0;
  protected status: "stopped" | "playing" | "paused" = "stopped";
  protected volume = 80;

  abstract load(track: Track): Promise<void>;
  abstract play(): Promise<void>;
  abstract pause(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract seek(deltaSec: number): Promise<void>;
  abstract seekAbs(positionSec: number): Promise<void>;
  abstract setVolume(volume: number): Promise<void>;
  abstract destroy(): Promise<void>;

  async togglePause(): Promise<void> {
    if (this.status === "playing") await this.pause();
    else if (this.status === "paused") await this.play();
  }

  getPosition() {
    return this.positionSec;
  }
  getDuration() {
    return this.durationSec;
  }
  isPlaying() {
    return this.status === "playing";
  }
  isPaused() {
    return this.status === "paused";
  }

  override on<E extends keyof PlayerEvents>(event: E, listener: PlayerEvents[E]): this {
    return super.on(event, listener as (...args: any[]) => void);
  }
  override off<E extends keyof PlayerEvents>(event: E, listener: PlayerEvents[E]): this {
    return super.off(event, listener as (...args: any[]) => void);
  }
}

/* ------------------------------------------------------------------ */
/* MpvPlayer — uses mpv with IPC for full control                     */
/* ------------------------------------------------------------------ */

class MpvPlayer extends BasePlayer {
  readonly backend = "mpv" as const;
  private proc: ChildProcess | null = null;
  private socket: Socket | null = null;
  private socketPath: string;
  private requestId = 0;
  private pending = new Map<
    number,
    { resolve: (data: unknown) => void; reject: (err: Error) => void }
  >();
  private socketBuffer = "";
  private positionTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    const dir = mkdtempSync(join(tmpdir(), "minpawtui-"));
    this.socketPath = join(dir, "mpv.sock");
  }

  async load(track: Track): Promise<void> {
    this.currentTrack = track;
    if (!this.proc) {
      await this.spawnMpv();
    }
    await this.sendCommand(["loadfile", track.path, "replace"]);
    await this.sendCommand(["set_property", "pause", false]);
    this.status = "playing";
    this.positionSec = 0;
    this.durationSec = track.durationSec;
    this.emit("started", track);
  }

  private async spawnMpv(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        "mpv",
        [
          "--idle=yes",
          "--no-video",
          "--no-terminal",
          "--really-quiet",
          `--input-ipc-server=${this.socketPath}`,
          `--volume=${this.volume}`,
        ],
        { stdio: ["ignore", "ignore", "ignore"] },
      );
      proc.on("error", (err) => reject(err));
      proc.on("exit", () => {
        this.proc = null;
        this.cleanupSocket();
      });
      this.proc = proc;

      const tryConnect = (attemptsLeft: number) => {
        if (!existsSync(this.socketPath)) {
          if (attemptsLeft <= 0) {
            reject(new Error("mpv IPC socket never appeared"));
            return;
          }
          setTimeout(() => tryConnect(attemptsLeft - 1), 50);
          return;
        }
        const sock = createConnection(this.socketPath);
        sock.on("connect", () => {
          this.socket = sock;
          this.attachSocketHandlers();
          this.startObservers().then(() => resolve()).catch(reject);
        });
        sock.on("error", () => {
          if (attemptsLeft <= 0) {
            reject(new Error("Could not connect to mpv IPC"));
            return;
          }
          setTimeout(() => tryConnect(attemptsLeft - 1), 50);
        });
      };
      tryConnect(40);
    });
  }

  private attachSocketHandlers(): void {
    if (!this.socket) return;
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk: string) => this.handleSocketData(chunk));
    this.socket.on("error", (err) => this.emit("error", err));
    this.socket.on("close", () => {
      this.socket = null;
    });
  }

  private handleSocketData(chunk: string): void {
    this.socketBuffer += chunk;
    let newlineIdx;
    while ((newlineIdx = this.socketBuffer.indexOf("\n")) !== -1) {
      const line = this.socketBuffer.slice(0, newlineIdx).trim();
      this.socketBuffer = this.socketBuffer.slice(newlineIdx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        this.handleMessage(msg);
      } catch {
        // ignore malformed lines
      }
    }
  }

  private handleMessage(msg: any): void {
    if (typeof msg.request_id === "number") {
      const pending = this.pending.get(msg.request_id);
      if (pending) {
        this.pending.delete(msg.request_id);
        if (msg.error && msg.error !== "success") {
          pending.reject(new Error(msg.error));
        } else {
          pending.resolve(msg.data);
        }
      }
      return;
    }
    if (msg.event === "property-change") {
      if (msg.name === "time-pos" && typeof msg.data === "number") {
        this.positionSec = msg.data;
        this.emit("positionChange", this.positionSec);
      } else if (msg.name === "duration" && typeof msg.data === "number") {
        this.durationSec = msg.data;
      } else if (msg.name === "pause") {
        if (msg.data === true && this.status === "playing") {
          this.status = "paused";
          this.emit("paused");
        } else if (msg.data === false && this.status === "paused") {
          this.status = "playing";
          this.emit("resumed");
        }
      }
    } else if (msg.event === "end-file") {
      if (msg.reason === "eof") {
        this.status = "stopped";
        this.emit("ended");
      }
    }
  }

  private async startObservers(): Promise<void> {
    await this.sendCommand(["observe_property", 1, "time-pos"]);
    await this.sendCommand(["observe_property", 2, "duration"]);
    await this.sendCommand(["observe_property", 3, "pause"]);
  }

  private sendCommand(command: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("mpv socket not connected"));
        return;
      }
      const request_id = ++this.requestId;
      this.pending.set(request_id, { resolve, reject });
      const payload = JSON.stringify({ command, request_id }) + "\n";
      this.socket.write(payload, (err) => {
        if (err) {
          this.pending.delete(request_id);
          reject(err);
        }
      });
      setTimeout(() => {
        if (this.pending.has(request_id)) {
          this.pending.delete(request_id);
          reject(new Error("mpv command timed out"));
        }
      }, 3000);
    });
  }

  async play(): Promise<void> {
    if (!this.proc) return;
    await this.sendCommand(["set_property", "pause", false]);
  }

  async pause(): Promise<void> {
    if (!this.proc) return;
    await this.sendCommand(["set_property", "pause", true]);
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    try {
      await this.sendCommand(["stop"]);
    } catch {
      /* ignore */
    }
    this.status = "stopped";
    this.positionSec = 0;
    this.emit("stopped");
  }

  async seek(deltaSec: number): Promise<void> {
    if (!this.proc) return;
    try {
      await this.sendCommand(["seek", deltaSec, "relative"]);
    } catch {
      /* ignore */
    }
  }

  async seekAbs(positionSec: number): Promise<void> {
    if (!this.proc) return;
    try {
      await this.sendCommand(["seek", positionSec, "absolute"]);
    } catch {
      /* ignore */
    }
  }

  async setVolume(volume: number): Promise<void> {
    this.volume = Math.max(0, Math.min(100, Math.round(volume)));
    if (this.proc) {
      try {
        await this.sendCommand(["set_property", "volume", this.volume]);
      } catch {
        /* ignore */
      }
    }
    this.emit("volumeChange", this.volume);
  }

  async destroy(): Promise<void> {
    if (this.positionTimer) {
      clearInterval(this.positionTimer);
      this.positionTimer = null;
    }
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    this.cleanupSocket();
  }

  private cleanupSocket(): void {
    try {
      const fs = require("node:fs");
      if (existsSync(this.socketPath)) fs.unlinkSync(this.socketPath);
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------------ */
/* SpawnPlayer — basic playback via ffplay/afplay (restart for seek)  */
/* ------------------------------------------------------------------ */

class SpawnPlayer extends BasePlayer {
  readonly backend: "ffplay" | "afplay";
  private proc: ChildProcess | null = null;
  private startedAt = 0;
  private offsetSec = 0;
  private positionTimer: ReturnType<typeof setInterval> | null = null;
  private endedManually = false;

  constructor(backend: "ffplay" | "afplay") {
    super();
    this.backend = backend;
  }

  async load(track: Track): Promise<void> {
    this.currentTrack = track;
    this.durationSec = track.durationSec;
    this.offsetSec = 0;
    this.positionSec = 0;
    await this.spawnFromOffset(0);
    this.emit("started", track);
  }

  private async spawnFromOffset(offset: number): Promise<void> {
    if (!this.currentTrack) return;
    await this.killProc();
    this.offsetSec = Math.max(0, offset);
    this.positionSec = this.offsetSec;
    this.startedAt = Date.now();
    this.endedManually = false;

    const args = this.buildArgs(this.currentTrack.path, this.offsetSec);
    const proc = spawn(this.backend, args, {
      stdio: ["ignore", "ignore", "ignore"],
    });
    proc.on("exit", () => {
      if (this.endedManually) return;
      if (this.proc !== proc) return;
      this.proc = null;
      this.stopPositionTimer();
      if (this.status === "playing") {
        this.status = "stopped";
        this.emit("ended");
      }
    });
    proc.on("error", (err) => this.emit("error", err));
    this.proc = proc;
    this.status = "playing";
    this.startPositionTimer();
  }

  private buildArgs(path: string, offset: number): string[] {
    if (this.backend === "ffplay") {
      const args = [
        "-nodisp",
        "-autoexit",
        "-loglevel",
        "quiet",
        "-volume",
        String(this.volume),
      ];
      if (offset > 0) args.push("-ss", offset.toFixed(2));
      args.push(path);
      return args;
    }
    // afplay has no built-in seek; offset is approximated via -t and short fade
    // We accept that seeking under afplay restarts from the beginning if offset is 0,
    // otherwise we can't honour the offset. Volume is 0..1 for afplay.
    return [path, "-v", (this.volume / 100).toFixed(2)];
  }

  private startPositionTimer(): void {
    this.stopPositionTimer();
    this.positionTimer = setInterval(() => {
      if (this.status !== "playing") return;
      const elapsed = (Date.now() - this.startedAt) / 1000;
      this.positionSec = this.offsetSec + elapsed;
      if (this.durationSec > 0 && this.positionSec >= this.durationSec + 1) {
        // Position exceeded duration — treat as ended even if process is slow to exit
        this.positionSec = this.durationSec;
      }
      this.emit("positionChange", this.positionSec);
    }, 250);
  }

  private stopPositionTimer(): void {
    if (this.positionTimer) {
      clearInterval(this.positionTimer);
      this.positionTimer = null;
    }
  }

  private async killProc(): Promise<void> {
    if (!this.proc) return;
    this.endedManually = true;
    const p = this.proc;
    this.proc = null;
    return new Promise((resolve) => {
      const done = () => resolve();
      p.once("exit", done);
      try {
        p.kill();
      } catch {
        done();
      }
      setTimeout(done, 200);
    });
  }

  async play(): Promise<void> {
    if (this.status === "playing") return;
    if (this.status === "paused" && this.currentTrack) {
      await this.spawnFromOffset(this.positionSec);
      this.emit("resumed");
      return;
    }
    if (this.currentTrack && this.status === "stopped") {
      await this.spawnFromOffset(0);
    }
  }

  async pause(): Promise<void> {
    if (this.status !== "playing") return;
    const elapsed = (Date.now() - this.startedAt) / 1000;
    const pos = this.offsetSec + elapsed;
    await this.killProc();
    this.offsetSec = pos;
    this.positionSec = pos;
    this.status = "paused";
    this.stopPositionTimer();
    this.emit("paused");
  }

  async stop(): Promise<void> {
    await this.killProc();
    this.status = "stopped";
    this.positionSec = 0;
    this.offsetSec = 0;
    this.stopPositionTimer();
    this.emit("stopped");
  }

  async seek(deltaSec: number): Promise<void> {
    if (!this.currentTrack) return;
    const wasPaused = this.status === "paused";
    const now =
      this.status === "playing"
        ? this.offsetSec + (Date.now() - this.startedAt) / 1000
        : this.positionSec;
    const target = Math.max(0, Math.min(this.durationSec || now + deltaSec, now + deltaSec));
    await this.spawnFromOffset(target);
    if (wasPaused) {
      // immediately pause again at new offset
      await this.pause();
    }
  }

  async seekAbs(positionSec: number): Promise<void> {
    if (!this.currentTrack) return;
    const wasPaused = this.status === "paused";
    const target = Math.max(0, Math.min(this.durationSec || positionSec, positionSec));
    await this.spawnFromOffset(target);
    if (wasPaused) await this.pause();
  }

  async setVolume(volume: number): Promise<void> {
    this.volume = Math.max(0, Math.min(100, Math.round(volume)));
    // To apply volume to a running ffplay/afplay process, we need to restart it.
    if (this.status === "playing") {
      const elapsed = (Date.now() - this.startedAt) / 1000;
      const pos = this.offsetSec + elapsed;
      await this.spawnFromOffset(pos);
    }
    this.emit("volumeChange", this.volume);
  }

  async destroy(): Promise<void> {
    await this.killProc();
    this.stopPositionTimer();
  }
}
