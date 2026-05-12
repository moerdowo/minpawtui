import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import { theme } from "../theme.ts";
import type { Track } from "../types.ts";
import { formatTime, padRight, truncate } from "./util.ts";

export interface ListPanelOptions {
  id: string;
  title: string;
  emptyMessage: string;
  showIndex?: boolean;
}

export interface ListRenderInput {
  tracks: Track[];
  cursor: number;
  nowPlayingIndex?: number;
  focused: boolean;
}

export class ListPanel {
  readonly root: BoxRenderable;
  private rowsBox: BoxRenderable;
  private rowTexts: TextRenderable[] = [];
  private emptyText: TextRenderable;
  private headerText: TextRenderable;
  private opts: ListPanelOptions;
  private renderer: CliRenderer;
  private maxRows = 1;
  private scrollOffset = 0;

  constructor(renderer: CliRenderer, opts: ListPanelOptions) {
    this.renderer = renderer;
    this.opts = opts;

    this.root = new BoxRenderable(renderer, {
      id: opts.id,
      width: "50%",
      height: "100%",
      border: true,
      borderStyle: "single",
      borderColor: theme.border,
      focusedBorderColor: theme.borderFocused,
      backgroundColor: theme.panelBg,
      title: ` ${opts.title} `,
      titleAlignment: "left",
      flexDirection: "column",
      paddingLeft: 1,
      paddingRight: 1,
      flexGrow: 1,
    });

    this.headerText = new TextRenderable(renderer, {
      id: `${opts.id}-header`,
      content: "",
      fg: theme.dim,
    });
    this.root.add(this.headerText);

    this.rowsBox = new BoxRenderable(renderer, {
      id: `${opts.id}-rows`,
      width: "100%",
      flexGrow: 1,
      flexDirection: "column",
      backgroundColor: theme.panelBg,
    });
    this.root.add(this.rowsBox);

    this.emptyText = new TextRenderable(renderer, {
      id: `${opts.id}-empty`,
      content: opts.emptyMessage,
      fg: theme.dim,
    });
    this.rowsBox.add(this.emptyText);
  }

  setTitle(title: string): void {
    this.root.title = ` ${title} `;
  }

  render(input: ListRenderInput): void {
    const { tracks, cursor, nowPlayingIndex, focused } = input;
    this.root.borderColor = focused ? theme.borderFocused : theme.border;

    // Header (column titles)
    const innerWidth = Math.max(20, (this.root.width || 40) - 4);
    const showIndex = this.opts.showIndex ?? false;
    const idxW = showIndex ? 4 : 0;
    const durW = 6;
    const titleW = Math.max(8, Math.floor((innerWidth - idxW - durW - 4) * 0.55));
    const artistW = Math.max(6, innerWidth - idxW - durW - titleW - 4);

    const header =
      (showIndex ? padRight("#", idxW) : "") +
      padRight("Title", titleW + 1) +
      padRight("Artist", artistW + 1) +
      padRight("Time", durW);
    this.headerText.content = header;
    this.headerText.fg = theme.dim;

    // Body
    if (tracks.length === 0) {
      this.emptyText.visible = true;
      this.emptyText.content = this.opts.emptyMessage;
      for (const t of this.rowTexts) t.visible = false;
      return;
    }
    this.emptyText.visible = false;

    const innerHeight = Math.max(1, (this.root.height || 20) - 4);
    this.maxRows = innerHeight;

    // Adjust scroll so cursor is visible
    if (cursor < this.scrollOffset) this.scrollOffset = cursor;
    if (cursor >= this.scrollOffset + this.maxRows) {
      this.scrollOffset = cursor - this.maxRows + 1;
    }
    if (this.scrollOffset > tracks.length - this.maxRows) {
      this.scrollOffset = Math.max(0, tracks.length - this.maxRows);
    }
    if (this.scrollOffset < 0) this.scrollOffset = 0;

    // Build/reuse row texts
    while (this.rowTexts.length < this.maxRows) {
      const t = new TextRenderable(this.renderer, {
        id: `${this.opts.id}-row-${this.rowTexts.length}`,
        content: "",
        fg: theme.white,
      });
      this.rowTexts.push(t);
      this.rowsBox.add(t);
    }
    while (this.rowTexts.length > this.maxRows) {
      const t = this.rowTexts.pop();
      if (t) {
        try {
          this.rowsBox.remove(t.id);
        } catch {
          /* ignore */
        }
      }
    }

    for (let i = 0; i < this.rowTexts.length; i++) {
      const trackIdx = this.scrollOffset + i;
      const text = this.rowTexts[i]!;
      if (trackIdx >= tracks.length) {
        text.visible = false;
        continue;
      }
      text.visible = true;
      const track = tracks[trackIdx]!;
      const isCursor = trackIdx === cursor;
      const isPlaying = trackIdx === nowPlayingIndex;

      const idxStr = showIndex ? padRight(`${trackIdx + 1}.`, idxW) : "";
      const titleStr = padRight(truncate(track.title, titleW), titleW + 1);
      const artistStr = padRight(truncate(track.artist, artistW), artistW + 1);
      const durStr = padRight(formatTime(track.durationSec), durW);

      const marker = isPlaying ? "♪ " : isCursor && focused ? "▸ " : "  ";
      const line = `${marker}${idxStr}${titleStr}${artistStr}${durStr}`;

      text.content = truncate(line, innerWidth);

      if (isCursor && focused) {
        text.fg = theme.selectionFg;
        text.bg = theme.selectionBg;
      } else if (isPlaying) {
        text.fg = theme.nowPlayingFg;
        text.bg = theme.nowPlayingBg;
      } else if (isCursor) {
        text.fg = theme.amber;
        text.bg = undefined as any;
      } else {
        text.fg = theme.white;
        text.bg = undefined as any;
      }
    }
  }

  getScrollOffset(): number {
    return this.scrollOffset;
  }

  pageSize(): number {
    return Math.max(1, this.maxRows - 1);
  }
}
