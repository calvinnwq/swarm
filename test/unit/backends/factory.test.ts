import { describe, expect, it } from "vitest";
import { ClaudeCliAdapter } from "../../../src/backends/claude-cli.js";
import { CodexCliAdapter } from "../../../src/backends/codex-cli.js";
import { SwarmCommandError } from "../../../src/lib/parse-command.js";

describe("createBackendAdapter", () => {
  it("creates the Claude adapter from the backend registry", async () => {
    const backends = await import("../../../src/backends/index.js");

    expect(typeof backends.createBackendAdapter).toBe("function");
    const adapter = backends.createBackendAdapter?.("claude");

    expect(adapter).toBeInstanceOf(ClaudeCliAdapter);
  });

  it("creates the Codex adapter from the backend registry", async () => {
    const backends = await import("../../../src/backends/index.js");

    expect(typeof backends.createBackendAdapter).toBe("function");
    const adapter = backends.createBackendAdapter?.("codex");

    expect(adapter).toBeInstanceOf(CodexCliAdapter);
  });

  it("throws for unsupported backends", async () => {
    const backends = await import("../../../src/backends/index.js");

    expect(() => backends.createBackendAdapter?.("openai" as never)).toThrow(
      SwarmCommandError,
    );
  });
});
