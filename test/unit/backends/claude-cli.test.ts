import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import {
  ClaudeCliAdapter,
  extractJson,
  parseAgentOutput,
} from "../../../src/backends/claude-cli.js";
import type { AgentDefinition } from "../../../src/schemas/index.js";

const fixturePath = fileURLToPath(
  new URL("../fixtures/agent-output-sample.json", import.meta.url),
);
const sampleJson = readFileSync(fixturePath, "utf-8");
const sampleObj = JSON.parse(sampleJson);

describe("extractJson", () => {
  it("parses pure JSON", () => {
    expect(extractJson(sampleJson)).toEqual(sampleObj);
  });

  it("parses JSON inside ```json fences", () => {
    const wrapped = `Here is the output:\n\n\`\`\`json\n${sampleJson}\n\`\`\`\n\nHope that helps!`;
    expect(extractJson(wrapped)).toEqual(sampleObj);
  });

  it("parses JSON inside bare ``` fences", () => {
    const wrapped = `\`\`\`\n${sampleJson}\n\`\`\``;
    expect(extractJson(wrapped)).toEqual(sampleObj);
  });

  it("extracts JSON with leading prose", () => {
    const wrapped = `Here is my analysis as the alpha agent:\n\n${sampleJson}`;
    expect(extractJson(wrapped)).toEqual(sampleObj);
  });

  it("extracts JSON with trailing junk", () => {
    const wrapped = `${sampleJson}\n\nLet me know if you need anything else.`;
    expect(extractJson(wrapped)).toEqual(sampleObj);
  });

  it("extracts JSON with both leading and trailing prose", () => {
    const wrapped = `Sure! Here is the output:\n${sampleJson}\nDone.`;
    expect(extractJson(wrapped)).toEqual(sampleObj);
  });

  it("returns undefined for non-JSON text", () => {
    expect(
      extractJson("This is just plain text with no JSON."),
    ).toBeUndefined();
  });

  it("returns undefined for malformed JSON", () => {
    expect(extractJson('{ "broken": ')).toBeUndefined();
  });

  it("handles whitespace-padded JSON", () => {
    const padded = `\n\n  ${sampleJson}  \n\n`;
    expect(extractJson(padded)).toEqual(sampleObj);
  });
});

describe("parseAgentOutput", () => {
  it("parses valid agent output from pure JSON", () => {
    const output = parseAgentOutput(sampleJson);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("parses valid agent output from fenced JSON", () => {
    const wrapped = `\`\`\`json\n${sampleJson}\n\`\`\``;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
  });

  it("throws on text with no extractable JSON", () => {
    expect(() => parseAgentOutput("no json here")).toThrow(
      /Failed to extract JSON/,
    );
  });

  it("throws on valid JSON that fails schema validation", () => {
    const invalid = JSON.stringify({ agent: "a", round: 1 });
    expect(() => parseAgentOutput(invalid)).toThrow();
  });

  it("includes raw stdout in the error for non-extractable output", () => {
    const garbage = "total garbage output";
    try {
      parseAgentOutput(garbage);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain(garbage);
    }
  });
});

describe("ClaudeCliAdapter.dispatch", () => {
  const execaMock = vi.mocked(execa);

  function makeAgent(
    overrides: Partial<AgentDefinition> = {},
  ): AgentDefinition {
    return {
      name: "alpha",
      description: "alpha agent",
      persona: "You are the alpha agent focused on rigorous analysis.",
      prompt: "Analyze the brief as alpha.",
      backend: "claude",
      ...overrides,
    };
  }

  function mockOkResponse(stdout = '{"ok":true}"') {
    execaMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout,
      stderr: "",
      timedOut: false,
    } as never);
  }

  function getCallArgs() {
    expect(execaMock).toHaveBeenCalledTimes(1);
    const call = execaMock.mock.calls[0];
    const [cmd, args, opts] = call as unknown as [
      string,
      string[],
      { input: string; timeout: number; reject: boolean },
    ];
    return { cmd, args, opts };
  }

  it("invokes `claude --print` with --system-prompt composed from persona + prompt", async () => {
    execaMock.mockReset();
    mockOkResponse();

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch("round brief", makeAgent(), { timeoutMs: 5000 });

    const { cmd, args } = getCallArgs();
    expect(cmd).toBe("claude");
    expect(args).toContain("--print");
    expect(args).toContain("--system-prompt");

    const systemPromptIdx = args.indexOf("--system-prompt");
    const systemPromptValue = args[systemPromptIdx + 1];
    expect(systemPromptValue).toContain(
      "You are the alpha agent focused on rigorous analysis.",
    );
    expect(systemPromptValue).toContain("Analyze the brief as alpha.");
  });

  it("produces distinct system prompts per agent so agents are differentiated", async () => {
    execaMock.mockReset();
    mockOkResponse();
    mockOkResponse();

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch(
      "brief",
      makeAgent({
        name: "product-manager",
        persona: "You are a rigorous product manager.",
        prompt: "Focus on user value and sequencing.",
      }),
      { timeoutMs: 5000 },
    );
    await adapter.dispatch(
      "brief",
      makeAgent({
        name: "principal-engineer",
        persona: "You are a principal engineer.",
        prompt: "Focus on system design and failure modes.",
      }),
      { timeoutMs: 5000 },
    );

    const calls = execaMock.mock.calls as unknown as [string, string[]][];
    expect(calls).toHaveLength(2);
    const [, firstArgs] = calls[0];
    const [, secondArgs] = calls[1];
    const firstSystem = firstArgs[firstArgs.indexOf("--system-prompt") + 1];
    const secondSystem = secondArgs[secondArgs.indexOf("--system-prompt") + 1];
    expect(firstSystem).toContain("product manager");
    expect(secondSystem).toContain("principal engineer");
    expect(firstSystem).not.toEqual(secondSystem);
  });

  it("pipes the round brief via stdin and forwards the timeout", async () => {
    execaMock.mockReset();
    mockOkResponse();

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch("the full round brief", makeAgent(), {
      timeoutMs: 12345,
    });

    const { opts } = getCallArgs();
    expect(opts.input).toBe("the full round brief");
    expect(opts.timeout).toBe(12345);
    expect(opts.reject).toBe(false);
  });

  it("resolves file-based prompt refs before composing the system prompt", async () => {
    execaMock.mockReset();
    mockOkResponse();

    const fixtureFile = fileURLToPath(
      new URL("../fixtures/agent-prompt.md", import.meta.url),
    );

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch(
      "brief",
      makeAgent({
        persona: "You are the file-backed agent.",
        prompt: { file: fixtureFile },
      }),
      { timeoutMs: 5000 },
    );

    const { args } = getCallArgs();
    const systemPromptValue = args[args.indexOf("--system-prompt") + 1];
    expect(systemPromptValue).toContain("You are the file-backed agent.");
    expect(systemPromptValue).toContain(
      "Prompt body loaded from disk for testing.",
    );
  });

  it("omits --system-prompt when persona and prompt trim to empty content", async () => {
    execaMock.mockReset();
    mockOkResponse();

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch(
      "brief",
      makeAgent({
        persona: "   ",
        prompt: "\n  \t  ",
      }),
      { timeoutMs: 5000 },
    );

    const { args } = getCallArgs();
    expect(args).not.toContain("--system-prompt");
  });

  it("keeps a trimmed prompt-only system prompt when persona is blank", async () => {
    execaMock.mockReset();
    mockOkResponse();

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch(
      "brief",
      makeAgent({
        persona: "  \n\t  ",
        prompt: "\n  Focus only on implementation details.  \n",
      }),
      { timeoutMs: 5000 },
    );

    const { args } = getCallArgs();
    const systemPromptValue = args[args.indexOf("--system-prompt") + 1];
    expect(systemPromptValue).toBe("Focus only on implementation details.");
  });

  it("keeps a trimmed persona-only system prompt when prompt content is blank", async () => {
    execaMock.mockReset();
    mockOkResponse();

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch(
      "brief",
      makeAgent({
        persona: "\n  You are the escalation-only reviewer.  \t",
        prompt: "  \n\t  ",
      }),
      { timeoutMs: 5000 },
    );

    const { args } = getCallArgs();
    const systemPromptValue = args[args.indexOf("--system-prompt") + 1];
    expect(systemPromptValue).toBe("You are the escalation-only reviewer.");
  });

  it("trims away blank file-backed prompt content and keeps the persona-only system prompt", async () => {
    execaMock.mockReset();
    mockOkResponse();

    const blankPromptFile = fileURLToPath(
      new URL("../fixtures/blank-agent-prompt.md", import.meta.url),
    );

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch(
      "brief",
      makeAgent({
        persona: "  You are the file-backed escalation reviewer.\n",
        prompt: { file: blankPromptFile },
      }),
      { timeoutMs: 5000 },
    );

    const { args } = getCallArgs();
    const systemPromptValue = args[args.indexOf("--system-prompt") + 1];
    expect(systemPromptValue).toBe("You are the file-backed escalation reviewer.");
  });

  it("keeps a trimmed file-backed prompt-only system prompt when persona is blank", async () => {
    execaMock.mockReset();
    mockOkResponse();

    const fixtureFile = fileURLToPath(
      new URL("../fixtures/agent-prompt.md", import.meta.url),
    );

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch(
      "brief",
      makeAgent({
        persona: "  \n\t  ",
        prompt: { file: fixtureFile },
      }),
      { timeoutMs: 5000 },
    );

    const { args } = getCallArgs();
    const systemPromptValue = args[args.indexOf("--system-prompt") + 1];
    expect(systemPromptValue).toBe("Prompt body loaded from disk for testing.");
  });

  it("omits --system-prompt when a file-backed prompt also trims to empty", async () => {
    execaMock.mockReset();
    mockOkResponse();

    const blankPromptFile = fileURLToPath(
      new URL("../fixtures/blank-agent-prompt.md", import.meta.url),
    );

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch(
      "brief",
      makeAgent({
        persona: " \n\t  ",
        prompt: { file: blankPromptFile },
      }),
      { timeoutMs: 5000 },
    );

    const { args } = getCallArgs();
    expect(args).not.toContain("--system-prompt");
  });

  it("fails before invoking claude when a file-based prompt ref is missing", async () => {
    execaMock.mockReset();

    const adapter = new ClaudeCliAdapter();
    const missingPromptFile = fileURLToPath(
      new URL("../fixtures/does-not-exist.md", import.meta.url),
    );

    await expect(
      adapter.dispatch(
        "brief",
        makeAgent({
          prompt: { file: missingPromptFile },
        }),
        { timeoutMs: 5000 },
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
      path: missingPromptFile,
    });
    expect(execaMock).not.toHaveBeenCalled();
  });

  it("returns failed subprocess metadata when claude exits non-zero", async () => {
    execaMock.mockReset();
    execaMock.mockResolvedValueOnce({
      exitCode: 2,
      stdout: "partial output",
      stderr: "backend failed",
      timedOut: true,
    } as never);

    const adapter = new ClaudeCliAdapter();
    const response = await adapter.dispatch("brief", makeAgent(), {
      timeoutMs: 5000,
    });

    expect(response.ok).toBe(false);
    expect(response.exitCode).toBe(2);
    expect(response.stdout).toBe("partial output");
    expect(response.stderr).toBe("backend failed");
    expect(response.timedOut).toBe(true);
    expect(response.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("normalizes missing subprocess exit codes to 1", async () => {
    execaMock.mockReset();
    execaMock.mockResolvedValueOnce({
      exitCode: undefined,
      stdout: "",
      stderr: "terminated by signal",
      timedOut: false,
    } as never);

    const adapter = new ClaudeCliAdapter();
    const response = await adapter.dispatch("brief", makeAgent(), {
      timeoutMs: 5000,
    });

    expect(response.ok).toBe(false);
    expect(response.exitCode).toBe(1);
    expect(response.stderr).toBe("terminated by signal");
    expect(response.timedOut).toBe(false);
  });

  it("propagates subprocess spawn failures when claude cannot be started", async () => {
    execaMock.mockReset();
    const spawnError = Object.assign(new Error("spawn claude ENOENT"), {
      code: "ENOENT",
      syscall: "spawn claude",
    });
    execaMock.mockRejectedValueOnce(spawnError as never);

    const adapter = new ClaudeCliAdapter();

    await expect(
      adapter.dispatch("brief", makeAgent(), {
        timeoutMs: 5000,
      }),
    ).rejects.toMatchObject({
      message: "spawn claude ENOENT",
      code: "ENOENT",
      syscall: "spawn claude",
    });
  });
});
