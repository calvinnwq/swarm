import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));
import { execa } from "execa";
import { checkHarnessCapability } from "../../../src/lib/harness-capability.js";

describe("checkHarnessCapability", () => {
  beforeEach(() => {
    vi.mocked(execa).mockReset();
  });

  it("fails with a bounded timeout when claude probe hangs", async () => {
    vi.mocked(execa).mockRejectedValueOnce({ timedOut: true });

    const result = await checkHarnessCapability("claude");

    expect(result).toEqual({
      name: "harness capability",
      status: "fail",
      message: 'harness "claude" is not responding: timed out after 5000ms',
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

  it("fails when the claude binary is missing", async () => {
    vi.mocked(execa).mockRejectedValueOnce({ code: "ENOENT" });

    const result = await checkHarnessCapability("claude");

    expect(result).toEqual({
      name: "harness capability",
      status: "fail",
      message:
        'harness "claude" is not runnable: install Claude Code and ensure `claude` is available on PATH',
    });
  });

  it("passes when claude reports loggedIn=true", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stdout: '{"loggedIn":true}',
      stderr: "",
    } as never);

    const result = await checkHarnessCapability("claude");

    expect(result).toEqual({
      name: "harness capability",
      status: "ok",
      message: 'harness "claude" is installed and authenticated',
    });
  });

  it("fails when claude reports loggedIn=false", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stdout: '{"loggedIn":false}',
      stderr: "",
    } as never);

    const result = await checkHarnessCapability("claude");

    expect(result).toMatchObject({
      name: "harness capability",
      status: "fail",
      message:
        'harness "claude" is not authenticated: run `claude auth login` and retry',
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

    const result = await checkHarnessCapability("codex");

    expect(result).toMatchObject({
      name: "harness capability",
      status: "fail",
      message:
        'harness "codex" is not runnable: installed CLI is missing required `codex exec` support',
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

    const result = await checkHarnessCapability("codex");

    expect(result).toEqual({
      name: "harness capability",
      status: "ok",
      message: 'harness "codex" is installed and authenticated',
    });
  });

  it("does not misreport codex auth errors as a missing binary", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "credentials not found\n",
    } as never);

    const result = await checkHarnessCapability("codex");

    expect(result).toEqual({
      name: "harness capability",
      status: "fail",
      message:
        'harness "codex" is not authenticated: run `codex login` and retry',
      detail: "credentials not found",
    });
  });

  it("passes opencode when auth list and run --help both succeed", async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "providers configured\n",
        stderr: "",
      } as never)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "Usage: opencode run [options]\n",
        stderr: "",
      } as never);

    const result = await checkHarnessCapability("opencode");

    expect(result).toEqual({
      name: "harness capability",
      status: "ok",
      message: 'harness "opencode" is installed and authenticated',
    });
    expect(vi.mocked(execa)).toHaveBeenNthCalledWith(
      1,
      "opencode",
      ["auth", "list"],
      expect.objectContaining({ reject: false, timeout: 5_000 }),
    );
    expect(vi.mocked(execa)).toHaveBeenNthCalledWith(
      2,
      "opencode",
      ["run", "--help"],
      expect.objectContaining({ reject: false, timeout: 5_000 }),
    );
  });

  it("fails opencode when the binary is missing", async () => {
    vi.mocked(execa).mockRejectedValueOnce({ code: "ENOENT" });

    const result = await checkHarnessCapability("opencode");

    expect(result).toEqual({
      name: "harness capability",
      status: "fail",
      message:
        'harness "opencode" is not runnable: install OpenCode and ensure `opencode` is available on PATH',
    });
  });

  it("fails opencode when auth list exits non-zero", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "no providers configured\n",
    } as never);

    const result = await checkHarnessCapability("opencode");

    expect(result).toEqual({
      name: "harness capability",
      status: "fail",
      message:
        'harness "opencode" is not authenticated: run `opencode auth login` and retry',
      detail: "no providers configured",
    });
  });

  it("fails opencode when the runtime probe rejects run --help", async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "providers configured\n",
        stderr: "",
      } as never)
      .mockResolvedValueOnce({
        exitCode: 64,
        stdout: "",
        stderr: "unknown command: run\n",
      } as never);

    const result = await checkHarnessCapability("opencode");

    expect(result).toMatchObject({
      name: "harness capability",
      status: "fail",
      message:
        'harness "opencode" is not runnable: installed CLI rejected the runtime probe',
    });
    expect(result.detail).toContain("unknown command: run");
  });

  it("passes rovo when rovodev --help and rovodev run --help both succeed", async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "rovodev plugin\n",
        stderr: "",
      } as never)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "Usage: acli rovodev run [options]\n",
        stderr: "",
      } as never);

    const result = await checkHarnessCapability("rovo");

    expect(result).toEqual({
      name: "harness capability",
      status: "ok",
      message: 'harness "rovo" is installed and runnable',
    });
    expect(vi.mocked(execa)).toHaveBeenNthCalledWith(
      1,
      "acli",
      ["rovodev", "--help"],
      expect.objectContaining({ reject: false, timeout: 5_000 }),
    );
    expect(vi.mocked(execa)).toHaveBeenNthCalledWith(
      2,
      "acli",
      ["rovodev", "run", "--help"],
      expect.objectContaining({ reject: false, timeout: 5_000 }),
    );
  });

  it("fails rovo when acli is missing", async () => {
    vi.mocked(execa).mockRejectedValueOnce({ code: "ENOENT" });

    const result = await checkHarnessCapability("rovo");

    expect(result).toEqual({
      name: "harness capability",
      status: "fail",
      message:
        'harness "rovo" is not runnable: install Atlassian acli with the rovodev plugin and ensure `acli` is available on PATH',
    });
  });

  it("fails rovo when rovodev plugin is unavailable", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "plugin not installed\n",
    } as never);

    const result = await checkHarnessCapability("rovo");

    expect(result).toEqual({
      name: "harness capability",
      status: "fail",
      message:
        'harness "rovo" is not runnable: installed CLI rejected the capability probe',
      detail: "plugin not installed",
    });
  });
});
