import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import { theme } from "../theme.ts";
import type { AppState } from "../types.ts";
import { formatTime, progressBar, statusGlyph, truncate, volumeBar } from "./util.ts";

export class Transport {
  readonly root: BoxRenderable;
  private trackText: TextRenderable;
  private detailText: TextRenderable;
  private progressText: TextRenderable;
  private statusText: TextRenderable;
  private lastWidth = 80;

  constructor(renderer: CliRenderer) {
    this.root = new BoxRenderable(renderer, {
      id: "transport",
      width: "100%",
      height: 6,
      border: true,
      borderStyle: "rounded",
      borderColor: theme.lcd,
      backgroundColor: theme.lcdBg,
      title: " NOW PLAYING ",
      titleAlignment: "left",
      flexDirection: "column",
      paddingLeft: 1,
      paddingRight: 1,
      gap: 0,
    });

    this.trackText = new TextRenderable(renderer, {
      id: "transport-track",
      content: "♪  — nothing loaded —",
      fg: theme.lcd,
    });
    this.detailText = new TextRenderable(renderer, {
      id: "transport-detail",
      content: "",
      fg: theme.lcdDim,
    });
    this.progressText = new TextRenderable(renderer, {
      id: "transport-progress",
      content: "",
      fg: theme.lcd,
    });
    this.statusText = new TextRenderable(renderer, {
      id: "transport-status",
      content: "",
      fg: theme.amber,
    });

    this.root.add(this.trackText);
    this.root.add(this.detailText);
    this.root.add(this.progressText);
    this.root.add(this.statusText);

    this.root.onSizeChange = () => {
      this.lastWidth = this.root.width || this.lastWidth;
    };
  }

  update(state: AppState): void {
    const p = state.player;
    const track = p.currentTrack;
    const width = Math.max(20, (this.root.width || this.lastWidth) - 4);

    if (track) {
      const titleLine = `♪  ${track.artist} — ${track.title}`;
      this.trackText.content = truncate(titleLine, width);
      const detail = `${track.album}   ·   ${track.filename}`;
      this.detailText.content = truncate(detail, width);
    } else {
      this.trackText.content = "♪  — nothing loaded —";
      this.detailText.content = "press [Enter] in library or playlist to play";
    }

    const glyph = statusGlyph(p.status);
    const pos = formatTime(p.positionSec);
    const dur = formatTime(p.durationSec);
    const timeBlock = `[${glyph}]  ${pos} / ${dur}`;
    const volBlock = `VOL ${volumeBar(p.volume, 10)} ${p.volume.toString().padStart(3, " ")}%`;
    const modeBlock = `${p.shuffle ? "SHUF" : "----"} ${
      p.repeat === "off" ? "----" : p.repeat === "all" ? "RPT*" : "RPT1"
    }`;

    // Compute remaining space for progress bar
    const leftPart = `${timeBlock}  `;
    const rightPart = `  ${volBlock}  ${modeBlock}`;
    const barWidth = Math.max(8, width - leftPart.length - rightPart.length - 2);
    const bar = progressBar(p.positionSec, p.durationSec || 1, barWidth);

    this.progressText.content = `${leftPart}${bar}${rightPart}`;

    if (state.statusMessage) {
      this.statusText.content = truncate(`» ${state.statusMessage}`, width);
      this.statusText.fg = theme.amber;
    } else {
      const hint =
        track && p.status === "stopped"
          ? "[Enter] play  [Space] pause/resume  [N]ext  [P]rev"
          : p.status === "paused"
            ? "PAUSED — press [Space] to resume"
            : p.status === "playing"
              ? "[Space] pause  [S] stop  [[ / ] ] seek  [N]ext"
              : "[Tab] focus playlist  [A] add  [Enter] add+play";
      this.statusText.content = truncate(hint, width);
      this.statusText.fg = theme.lcdDim;
    }
  }
}
