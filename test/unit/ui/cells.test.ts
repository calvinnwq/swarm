import { describe, it, expect } from "vitest";
import {
  makeCell,
  textToCells,
  emptyCells,
  rowToString,
  diffFrames,
  emitDiff,
} from "../../../src/ui/cells.js";

describe("makeCell", () => {
  it("creates a cell with width 1 for ASCII", () => {
    const cell = makeCell("A", "bold");
    expect(cell).toEqual({ char: "A", style: "bold", width: 1 });
  });

  it("creates a cell with width 2 for CJK", () => {
    const cell = makeCell("漢", "normal");
    expect(cell).toEqual({ char: "漢", style: "normal", width: 2 });
  });

  it("creates a cell with width 2 for emoji", () => {
    const cell = makeCell("🚀", "dim");
    expect(cell).toEqual({ char: "🚀", style: "dim", width: 2 });
  });
});

describe("textToCells", () => {
  it("converts ASCII text to cells", () => {
    const cells = textToCells("ab", "normal");
    expect(cells).toHaveLength(2);
    expect(cells[0]).toEqual({ char: "a", style: "normal", width: 1 });
    expect(cells[1]).toEqual({ char: "b", style: "normal", width: 1 });
  });

  it("inserts continuation cells for wide characters", () => {
    const cells = textToCells("漢", "bold");
    expect(cells).toHaveLength(2);
    expect(cells[0]).toEqual({ char: "漢", style: "bold", width: 2 });
    expect(cells[1]).toEqual({ char: "", style: "normal", width: 0 });
  });

  it("handles empty string", () => {
    expect(textToCells("", "normal")).toEqual([]);
  });
});

describe("emptyCells", () => {
  it("creates n space cells", () => {
    const cells = emptyCells(3);
    expect(cells).toHaveLength(3);
    for (const cell of cells) {
      expect(cell).toEqual({ char: " ", style: "normal", width: 1 });
    }
  });

  it("cells are independent objects", () => {
    const cells = emptyCells(2);
    cells[0].char = "X";
    expect(cells[1].char).toBe(" ");
  });
});

describe("rowToString", () => {
  it("renders plain text with no ANSI codes", () => {
    const cells = textToCells("hello", "normal");
    expect(rowToString(cells)).toBe("hello");
  });

  it("renders bold text with ANSI codes", () => {
    const cells = textToCells("hi", "bold");
    expect(rowToString(cells)).toBe("\x1b[1mhi\x1b[0m");
  });

  it("renders dim text with ANSI codes", () => {
    const cells = textToCells("lo", "dim");
    expect(rowToString(cells)).toBe("\x1b[2mlo\x1b[0m");
  });

  it("handles style transitions", () => {
    const cells = [
      ...textToCells("A", "bold"),
      ...textToCells("B", "normal"),
      ...textToCells("C", "dim"),
    ];
    const result = rowToString(cells);
    expect(result).toBe("\x1b[1mA\x1b[0mB\x1b[2mC\x1b[0m");
  });

  it("skips continuation cells (width 0)", () => {
    const cells = textToCells("漢a", "normal");
    // 漢 → cell(漢,2) + continuation(0), then a(1)
    expect(rowToString(cells)).toBe("漢a");
  });
});

describe("diffFrames", () => {
  it("returns empty changes for identical frames", () => {
    const frame = [textToCells("abc", "normal")];
    expect(diffFrames(frame, frame)).toEqual([]);
  });

  it("detects character changes", () => {
    const prev = [textToCells("abc", "normal")];
    const next = [textToCells("aXc", "normal")];
    const changes = diffFrames(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      row: 0,
      col: 1,
      cell: { char: "X", style: "normal", width: 1 },
    });
  });

  it("detects style changes", () => {
    const prev = [textToCells("ab", "normal")];
    const next = [textToCells("ab", "bold")];
    const changes = diffFrames(prev, next);
    expect(changes).toHaveLength(2);
  });

  it("handles multiple rows", () => {
    const prev = [textToCells("ab", "normal"), textToCells("cd", "normal")];
    const next = [textToCells("ab", "normal"), textToCells("cX", "normal")];
    const changes = diffFrames(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0].row).toBe(1);
    expect(changes[0].col).toBe(1);
  });
});

describe("emitDiff", () => {
  it("returns empty string for no changes", () => {
    expect(emitDiff([])).toBe("");
  });

  it("emits cursor position and character", () => {
    const changes = [
      { row: 0, col: 0, cell: { char: "A", style: "normal" as const, width: 1 } },
    ];
    const result = emitDiff(changes);
    expect(result).toContain("\x1b[1;1H");
    expect(result).toContain("A");
  });

  it("emits style codes for bold", () => {
    const changes = [
      { row: 0, col: 0, cell: { char: "B", style: "bold" as const, width: 1 } },
    ];
    const result = emitDiff(changes);
    expect(result).toContain("\x1b[1m");
    expect(result).toContain("B");
  });

  it("skips cursor repositioning for consecutive cells", () => {
    const changes = [
      { row: 0, col: 0, cell: { char: "A", style: "normal" as const, width: 1 } },
      { row: 0, col: 1, cell: { char: "B", style: "normal" as const, width: 1 } },
    ];
    const result = emitDiff(changes);
    // Only one cursor position escape (for the first cell)
    const cursorMoves = result.match(/\x1b\[\d+;\d+H/g) ?? [];
    expect(cursorMoves).toHaveLength(1);
  });
});
