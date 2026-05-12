import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import { theme } from "../theme.ts";

const SECTIONS: Array<{ heading: string; items: Array<[string, string]> }> = [
  {
    heading: "Playback",
    items: [
      ["Space", "Play / Pause (toggle)"],
      ["S", "Stop"],
      ["N  or  →", "Next track"],
      ["P  or  ←", "Previous track"],
      ["[", "Seek backward 5s"],
      ["]", "Seek forward 5s"],
      ["{ }", "Seek backward / forward 30s"],
      ["+ / =", "Volume up"],
      ["-", "Volume down"],
      ["M", "Toggle mute"],
      ["R", "Cycle repeat (off → all → one)"],
      ["Z", "Toggle shuffle"],
      ["V", "Toggle inline spectrum (right of volume)"],
    ],
  },
  {
    heading: "Library & Playlist",
    items: [
      ["Tab", "Switch focus between Library and Playlist"],
      ["↑ / ↓  or  k / j", "Move cursor"],
      ["PgUp / PgDn", "Move by page"],
      ["Home / End", "Jump to top / bottom"],
      ["Enter (Library)", "Add track to playlist and play it"],
      ["A (Library)", "Add highlighted track to playlist"],
      ["Shift+A (Library)", "Add ALL tracks to playlist"],
      ["Enter (Playlist)", "Play highlighted track"],
      ["D (Playlist)", "Remove highlighted track from playlist"],
      ["C (Playlist)", "Clear playlist"],
    ],
  },
  {
    heading: "App",
    items: [
      ["?  or  F1", "Toggle this help"],
      ["Q  or  Ctrl+C", "Quit"],
    ],
  },
];

export class Help {
  readonly root: BoxRenderable;
  private titleText: TextRenderable;
  private bodyText: TextRenderable;

  constructor(renderer: CliRenderer) {
    this.root = new BoxRenderable(renderer, {
      id: "help-overlay",
      position: "absolute",
      top: 2,
      left: 4,
      right: 4,
      bottom: 2,
      border: true,
      borderStyle: "double",
      borderColor: theme.amber,
      backgroundColor: theme.panelBg,
      title: " KEYBOARD CHEATSHEET ",
      titleAlignment: "center",
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 1,
      paddingBottom: 1,
      flexDirection: "column",
      gap: 0,
      zIndex: 100,
      visible: false,
    });

    this.titleText = new TextRenderable(renderer, {
      id: "help-title",
      content: "Press [?] again to close",
      fg: theme.lcdDim,
    });
    this.root.add(this.titleText);

    this.bodyText = new TextRenderable(renderer, {
      id: "help-body",
      content: this.buildBody(),
      fg: theme.white,
    });
    this.root.add(this.bodyText);
  }

  private buildBody(): string {
    const lines: string[] = [""];
    for (const sec of SECTIONS) {
      lines.push(`── ${sec.heading} ──`);
      for (const [key, label] of sec.items) {
        lines.push(`  ${key.padEnd(20)}  ${label}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }
}
