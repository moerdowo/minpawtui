import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import { theme } from "../theme.ts";

interface Hint {
  keys: string;
  label: string;
  priority: number; // lower = more important, shown in narrow terminals
}

const HINTS: Hint[] = [
  { keys: "Space", label: "Play/Pause", priority: 1 },
  { keys: "N/P", label: "Next/Prev", priority: 1 },
  { keys: "↑↓", label: "Move", priority: 1 },
  { keys: "Enter", label: "Play/Add", priority: 1 },
  { keys: "Tab", label: "Switch", priority: 1 },
  { keys: "?", label: "Help", priority: 1 },
  { keys: "Q", label: "Quit", priority: 1 },
  { keys: "+/-", label: "Vol", priority: 2 },
  { keys: "[/]", label: "Seek", priority: 2 },
  { keys: "A", label: "Add", priority: 2 },
  { keys: "D", label: "Del", priority: 2 },
  { keys: "S", label: "Stop", priority: 3 },
  { keys: "C", label: "Clear", priority: 3 },
  { keys: "R", label: "Repeat", priority: 3 },
  { keys: "Z", label: "Shuffle", priority: 3 },
  { keys: "V", label: "Viz", priority: 3 },
  { keys: "M", label: "Mute", priority: 3 },
];

export class Footer {
  readonly root: BoxRenderable;
  private text: TextRenderable;

  constructor(renderer: CliRenderer) {
    this.root = new BoxRenderable(renderer, {
      id: "footer",
      width: "100%",
      height: 3,
      border: true,
      borderStyle: "single",
      borderColor: theme.amberDim,
      backgroundColor: theme.panelBg,
      paddingLeft: 1,
      paddingRight: 1,
      flexDirection: "row",
      alignItems: "center",
    });

    this.text = new TextRenderable(renderer, {
      id: "footer-text",
      content: this.buildContent(80),
      fg: theme.lcdDim,
    });
    this.root.add(this.text);
  }

  private buildContent(width: number): string {
    const max = Math.max(20, width - 4);
    // Greedy: pack hints by priority, then by order, until we hit max width.
    const sorted = [...HINTS].sort((a, b) => a.priority - b.priority);
    const sep = "  ";
    let acc = "";
    const chosen: Hint[] = [];
    for (const h of sorted) {
      const segment = `[${h.keys}] ${h.label}`;
      const test = chosen.length === 0 ? segment : acc + sep + segment;
      if (test.length <= max) {
        acc = test;
        chosen.push(h);
      }
    }
    // Restore original order
    const order = new Map(HINTS.map((h, i) => [h, i] as const));
    chosen.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    return chosen.map((h) => `[${h.keys}] ${h.label}`).join(sep);
  }

  update(): void {
    const w = this.root.width || 80;
    this.text.content = this.buildContent(w);
  }
}
