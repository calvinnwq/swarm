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

  it("fails when codex login succeeds but exec support is missing", async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "Authenticated via API key\n",
        stderr: "",
      } as never)
      .mockResolvedValueOnce({
        exitCode: 64,
        stdout: "",
        stderr: "unknown option: --sandbox\n",
      } as never);

    const result = await checkBackendCapability("codex");

    expect(result).toMatchObject({
      name: "backend capability",
      status: "fail",
      message:
        'backend "codex" is not runnable: installed CLI is missing required `codex exec` support',
    });
    expect(result.detail).toContain("unknown option: --sandbox");
    expect(vi.mocked(execa)).toHaveBeenNthCalledWith(
      2,
      "codex",
      [
        "exec",
        "--ephemeral",
        "--ignore-rules",
        "--skip-git-repo-check",
        "-C",
        ".",
        "-c",
        'reasoning_effort="none"',
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "--output-schema",
        expect.stringContaining("swarm-codex-doctor-output.schema.json"),
        "-",
        "--help",
      ],
      expect.objectContaining({
        reject: false,
        timeout: 5_000,
      }),
    );
  });

  it("passes when codex login succeeds and exec advertises required flags", async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "Authenticated via API key\n",
        stderr: "",
      } as never)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "Usage: codex exec [options]\n",
        stderr: "",
      } as never);

    const result = await checkBackendCapability("codex");

    expect(result).toEqual({
      name: "backend capability",
      status: "ok",
      message: 'backend "codex" is installed and authenticated',
    });
  });

  it("does not misreport codex auth errors as a missing binary", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "credentials not found\n",
    } as never);

    const result = await checkBackendCapability("codex");

    expect(result).toEqual({
      name: "backend capability",
      status: "fail",
      message: 'backend "codex" is not authenticated: run `codex login` and retry',
      detail: "credentials not found",
    });
  });
});
