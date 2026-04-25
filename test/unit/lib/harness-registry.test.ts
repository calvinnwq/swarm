import { describe, expect, it } from "vitest";
import {
  getHarnessDescriptor,
  listHarnessDescriptors,
  listImplementedHarnessIds,
} from "../../../src/lib/harness-registry.js";
import { HarnessIdSchema } from "../../../src/schemas/index.js";
import { SwarmCommandError } from "../../../src/lib/parse-command.js";

describe("harness-registry", () => {
  it("provides a descriptor for every HarnessId", () => {
    const descriptors = listHarnessDescriptors();
    const ids = descriptors.map((d) => d.id);
    expect(ids).toEqual([...HarnessIdSchema.options]);
  });

  it("descriptors carry command mapping with a non-empty bin", () => {
    for (const descriptor of listHarnessDescriptors()) {
      expect(descriptor.command.bin.length).toBeGreaterThan(0);
      expect(descriptor.wrapperName.length).toBeGreaterThan(0);
      expect(descriptor.displayName.length).toBeGreaterThan(0);
    }
  });

  it("captures capability probe metadata for each harness", () => {
    for (const descriptor of listHarnessDescriptors()) {
      expect(Array.isArray(descriptor.capability.authProbeArgs)).toBe(true);
      expect(descriptor.capability.missingBinHint.length).toBeGreaterThan(0);
      expect(descriptor.capability.missingAuthHint.length).toBeGreaterThan(0);
    }
  });

  it("matches existing claude-cli wrapper name and command", () => {
    const claude = getHarnessDescriptor("claude");
    expect(claude.wrapperName).toBe("claude-cli");
    expect(claude.command.bin).toBe("claude");
    expect(claude.capability.authProbeArgs).toEqual(["auth", "status"]);
    expect(claude.status).toBe("implemented");
  });

  it("matches existing codex-cli wrapper name and probe args", () => {
    const codex = getHarnessDescriptor("codex");
    expect(codex.wrapperName).toBe("codex-cli");
    expect(codex.command.bin).toBe("codex");
    expect(codex.capability.authProbeArgs).toEqual(["login", "status"]);
    expect(codex.capability.runtimeProbeArgs).toBeDefined();
    expect(codex.status).toBe("implemented");
  });

  it("matches existing opencode-cli wrapper name and probe args", () => {
    const opencode = getHarnessDescriptor("opencode");
    expect(opencode.wrapperName).toBe("opencode-cli");
    expect(opencode.command.bin).toBe("opencode");
    expect(opencode.command.runArgs).toEqual(["run"]);
    expect(opencode.status).toBe("implemented");
  });

  it("marks rovo as planned but discoverable", () => {
    const rovo = getHarnessDescriptor("rovo");
    expect(rovo.status).toBe("planned");
    expect(rovo.command.bin).toBe("acli");
    expect(rovo.command.runArgs).toContain("rovodev");
  });

  it("listImplementedHarnessIds returns only implemented harnesses", () => {
    const implemented = listImplementedHarnessIds();
    expect(implemented).toEqual(["claude", "codex", "opencode"]);
  });

  it("rejects unknown harness ids with SwarmCommandError", () => {
    expect(() => getHarnessDescriptor("gemini" as never)).toThrow(
      SwarmCommandError,
    );
  });
});
