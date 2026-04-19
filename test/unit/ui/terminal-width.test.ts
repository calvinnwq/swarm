import { describe, it, expect } from "vitest";
import {
  splitGraphemes,
  graphemeWidth,
  stringWidth,
} from "../../../src/ui/terminal-width.js";

describe("splitGraphemes", () => {
  it("splits ASCII text into individual characters", () => {
    expect(splitGraphemes("abc")).toEqual(["a", "b", "c"]);
  });

  it("keeps emoji sequences as single graphemes", () => {
    const result = splitGraphemes("👨‍👩‍👧‍👦");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("👨‍👩‍👧‍👦");
  });

  it("keeps flag emoji as single graphemes", () => {
    const result = splitGraphemes("🇺🇸");
    expect(result).toHaveLength(1);
  });

  it("returns empty array for empty string", () => {
    expect(splitGraphemes("")).toEqual([]);
  });
});

describe("graphemeWidth", () => {
  it("returns 1 for ASCII characters", () => {
    expect(graphemeWidth("a")).toBe(1);
    expect(graphemeWidth("Z")).toBe(1);
    expect(graphemeWidth("!")).toBe(1);
  });

  it("returns 2 for CJK characters", () => {
    expect(graphemeWidth("漢")).toBe(2);
    expect(graphemeWidth("字")).toBe(2);
  });

  it("returns 2 for emoji", () => {
    expect(graphemeWidth("🚀")).toBe(2);
    expect(graphemeWidth("👨‍👩‍👧‍👦")).toBe(2);
  });

  it("returns 2 for flag emoji", () => {
    expect(graphemeWidth("🇺🇸")).toBe(2);
  });

  it("returns 0 for empty string", () => {
    expect(graphemeWidth("")).toBe(0);
  });
});

describe("stringWidth", () => {
  it("returns correct width for ASCII", () => {
    expect(stringWidth("hello")).toBe(5);
  });

  it("returns correct width for mixed ASCII and CJK", () => {
    expect(stringWidth("a漢b")).toBe(4);
  });

  it("returns correct width for emoji in text", () => {
    expect(stringWidth("hi🚀")).toBe(4);
  });

  it("returns 0 for empty string", () => {
    expect(stringWidth("")).toBe(0);
  });
});
