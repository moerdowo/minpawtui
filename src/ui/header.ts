import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import { theme } from "../theme.ts";
import type { AppState } from "../types.ts";
import { truncate } from "./util.ts";

export class Header {
  readonly root: BoxRenderable;
  private titleText: TextRenderable;
  private rightText: TextRenderable;

  constructor(renderer: CliRenderer) {
    this.root = new BoxRenderable(renderer, {
      id: "header",
      width: "100%",
      height: 3,
      border: true,
      borderStyle: "double",
      borderColor: theme.amber,
      backgroundColor: theme.panelBg,
      flexDirection: "row",
      paddingLeft: 1,
      paddingRight: 1,
      alignItems: "center",
      justifyContent: "space-between",
    });

    this.titleText = new TextRenderable(renderer, {
      id: "header-title",
      content: "♪♫  M I N P A W   T U I  ♫♪",
      fg: theme.amber,
    });
    this.rightText = new TextRenderable(renderer, {
      id: "header-right",
      content: "[?] help   [Q] quit",
      fg: theme.lcdDim,
    });
    this.root.add(this.titleText);
    this.root.add(this.rightText);
  }

  update(state: AppState): void {
    const lib = state.library.length;
    const pl = state.playlist.length;
    const w = this.root.width || 80;
    const inner = Math.max(20, w - 4);
    const dir = state.rootDir;
    const dirMax = Math.max(8, inner - 50);
    const summary = `LIB:${lib}  PL:${pl}  DIR:${truncate(dir, dirMax)}    [?] help  [Q] quit`;
    this.rightText.content = summary;
  }
}
