import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
  it("records provenance for the excerpt that was included", async () => {
    const cwd = await makeTempCwd();
    await mkdir(path.join(cwd, "docs"), { recursive: true });
    const content = "First line\nSecond line\nThird line";
    await writeFile(path.join(cwd, "docs", "brief.md"), content, "utf-8");

    const [packet] = await materializeCarryForwardDocPackets(
      ["docs/brief.md"],
      {
        cwd,
        maxCharsPerDoc: 17,
      },
    );

    expect(packet.provenance).toEqual({
      absolutePath: path.join(cwd, "docs", "brief.md"),
      excerptStart: 0,
      excerptEnd: 17,
      sha256: createHash("sha256").update(content).digest("hex"),
      mtimeMs: expect.any(Number),
    });
  });

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
        provenance: {
          absolutePath: path.join(cwd, "docs", "brief.md"),
          excerptStart: 0,
          excerptEnd: 17,
          sha256: createHash("sha256")
            .update("First line\nSecond line\nThird line")
            .digest("hex"),
          mtimeMs: expect.any(Number),
        },
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
        provenance: {
          absolutePath: path.join(cwd, "docs", "a.md"),
          excerptStart: 0,
          excerptEnd: 5,
          sha256: createHash("sha256").update("alpha").digest("hex"),
          mtimeMs: expect.any(Number),
        },
      },
      {
        path: "docs/b.md",
        content: "beta",
        originalCharCount: 4,
        includedCharCount: 4,
        truncated: false,
        provenance: {
          absolutePath: path.join(cwd, "docs", "b.md"),
          excerptStart: 0,
          excerptEnd: 4,
          sha256: createHash("sha256").update("beta").digest("hex"),
          mtimeMs: expect.any(Number),
        },
      },
    ]);
  });
});
