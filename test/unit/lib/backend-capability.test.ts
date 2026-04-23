import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import { checkBackendCapability } from "../../../src/lib/backend-capability.js";

describe("checkBackendCapability", () => {
  beforeEach(() => {
    vi.mocked(execa).mockReset();
  });

  it("fails with a bounded timeout when the backend probe hangs", async () => {
    vi.mocked(execa).mockRejectedValueOnce({ timedOut: true });

    const result = await checkBackendCapability("claude");

    expect(result).toEqual({
      name: "backend capability",
      status: "fail",
      message: 'backend "claude" is not responding: timed out after 5000ms',
    });
    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      "claude",
      ["auth", "status"],
      expect.objectContaining({
        reject: false,
        timeout: 5_000,
      }),
    );
  });

  it("fails with a timeout message when execa resolves a timed out probe", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      timedOut: true,
      exitCode: 1,
      stdout: "",
      stderr: "",
    } as never);

    const result = await checkBackendCapability("codex");

    expect(result).toEqual({
      name: "backend capability",
      status: "fail",
      message: 'backend "codex" is not responding: timed out after 5000ms',
    });
  });
});
