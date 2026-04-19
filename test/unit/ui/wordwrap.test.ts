import { describe, it, expect } from "vitest";
import { wordWrap } from "../../../src/ui/wordwrap.js";

describe("wordWrap", () => {
  it("returns empty array for empty string", () => {
    expect(wordWrap("", 40)).toEqual([]);
  });

  it("wraps at word boundaries", () => {
    const result = wordWrap("hello world foo bar", 11);
    expect(result).toEqual(["hello world", "foo bar"]);
  });

  it("does not wrap short text", () => {
    expect(wordWrap("hello", 40)).toEqual(["hello"]);
  });

  it("preserves paragraph breaks", () => {
    const result = wordWrap("line one\n\nline three", 40);
    expect(result).toEqual(["line one", "", "line three"]);
  });

  it("splits oversized words by width", () => {
    const result = wordWrap("abcdefghij", 5);
    expect(result).toEqual(["abcde", "fghij"]);
  });

  it("handles CJK characters with double width", () => {
    // Each CJK char = width 2, so 3 chars = width 6
    const result = wordWrap("漢字漢字漢字", 6);
    expect(result).toEqual(["漢字漢", "字漢字"]);
  });

  it("caps output with maxLines and appends ellipsis", () => {
    const result = wordWrap("a b c d e f g h", 3, 2);
    expect(result).toHaveLength(2);
    expect(result[1]).toContain("…");
  });

  it("handles single newline as paragraph break", () => {
    const result = wordWrap("a\nb", 40);
    expect(result).toEqual(["a", "b"]);
  });
});
