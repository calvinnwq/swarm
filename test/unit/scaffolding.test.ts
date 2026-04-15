import { describe, expect, it } from "vitest";

describe("scaffolding", () => {
  it("loads each src module entry point without error", async () => {
    await expect(import("../../src/lib/index.js")).resolves.toBeDefined();
    await expect(import("../../src/schemas/index.js")).resolves.toBeDefined();
    await expect(import("../../src/backends/index.js")).resolves.toBeDefined();
    await expect(import("../../src/ui/index.js")).resolves.toBeDefined();
  });
});
