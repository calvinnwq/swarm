import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  materializeCarryForwardDocPackets,
  resolveCarryForwardDocs,
  SwarmCommandError,
} from "../../../src/lib/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeTempCwd(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "swarm-doc-inputs-"));
  tempDirs.push(dir);
  return dir;
}

describe("resolveCarryForwardDocs", () => {
  it("normalizes project-relative paths and dedupes by resolved path", async () => {
    const cwd = await makeTempCwd();
    await mkdir(path.join(cwd, "docs"), { recursive: true });
    await writeFile(path.join(cwd, "docs", "brief.md"), "hello", "utf-8");
    await writeFile(path.join(cwd, "docs", "decision.md"), "world", "utf-8");

    await expect(
      resolveCarryForwardDocs(
        [
          "./docs/brief.md",
          "docs/../docs/brief.md",
          path.join(cwd, "docs", "decision.md"),
        ],
        { cwd },
      ),
    ).resolves.toEqual(["docs/brief.md", "docs/decision.md"]);
  });

  it("throws a SwarmCommandError for missing docs", async () => {
    const cwd = await makeTempCwd();

    await expect(
      resolveCarryForwardDocs(["docs/missing.md"], { cwd }),
    ).rejects.toThrow(SwarmCommandError);
    await expect(
      resolveCarryForwardDocs(["docs/missing.md"], { cwd }),
    ).rejects.toThrow(/carry-forward doc not found: docs\/missing\.md/);
  });

  it("throws a SwarmCommandError when a doc path is not a file", async () => {
    const cwd = await makeTempCwd();
    await mkdir(path.join(cwd, "docs"), { recursive: true });

    await expect(resolveCarryForwardDocs(["docs"], { cwd })).rejects.toThrow(
      /carry-forward doc is not a file: docs/,
    );
  });
});

describe("materializeCarryForwardDocPackets", () => {
  it("reads resolved docs into bounded context packets", async () => {
    const cwd = await makeTempCwd();
    await mkdir(path.join(cwd, "docs"), { recursive: true });
    await writeFile(
      path.join(cwd, "docs", "brief.md"),
      "First line\nSecond line\nThird line",
      "utf-8",
    );

    await expect(
      materializeCarryForwardDocPackets(["docs/brief.md"], {
        cwd,
        maxCharsPerDoc: 17,
      }),
    ).resolves.toEqual([
      {
        path: "docs/brief.md",
        content: "First line\nSecond",
        originalCharCount: 33,
        includedCharCount: 17,
        truncated: true,
      },
    ]);
  });

  it("keeps one packet per doc without truncating content inside the limit", async () => {
    const cwd = await makeTempCwd();
    await mkdir(path.join(cwd, "docs"), { recursive: true });
    await writeFile(path.join(cwd, "docs", "a.md"), "alpha", "utf-8");
    await writeFile(path.join(cwd, "docs", "b.md"), "beta", "utf-8");

    await expect(
      materializeCarryForwardDocPackets(["docs/a.md", "docs/b.md"], {
        cwd,
        maxCharsPerDoc: 10,
      }),
    ).resolves.toEqual([
      {
        path: "docs/a.md",
        content: "alpha",
        originalCharCount: 5,
        includedCharCount: 5,
        truncated: false,
      },
      {
        path: "docs/b.md",
        content: "beta",
        originalCharCount: 4,
        includedCharCount: 4,
        truncated: false,
      },
    ]);
  });
});
