import { HarnessIdSchema, type HarnessId } from "../schemas/harness-id.js";
import { SwarmCommandError } from "./parse-command.js";

export interface HarnessCommandMapping {
  readonly bin: string;
  readonly runArgs: readonly string[];
}

export interface HarnessCapabilityProbe {
  readonly authProbeArgs: readonly string[];
  readonly runtimeProbeArgs?: readonly string[];
  readonly missingBinHint: string;
  readonly missingAuthHint: string;
}

export type HarnessImplementationStatus = "implemented" | "planned";

export interface HarnessDescriptor {
  readonly id: HarnessId;
  readonly displayName: string;
  readonly wrapperName: string;
  readonly command: HarnessCommandMapping;
  readonly capability: HarnessCapabilityProbe;
  readonly status: HarnessImplementationStatus;
  readonly defaultModel?: string;
}

const HARNESS_DESCRIPTORS: Readonly<Record<HarnessId, HarnessDescriptor>> = {
  claude: {
    id: "claude",
    displayName: "Claude Code",
    wrapperName: "claude-cli",
    command: {
      bin: "claude",
      runArgs: ["--print"],
    },
    capability: {
      authProbeArgs: ["auth", "status"],
      missingBinHint:
        "install Claude Code and ensure `claude` is available on PATH",
      missingAuthHint: "run `claude auth login` and retry",
    },
    status: "implemented",
  },
  codex: {
    id: "codex",
    displayName: "OpenAI Codex",
    wrapperName: "codex-cli",
    command: {
      bin: "codex",
      runArgs: [
        "exec",
        "--ephemeral",
        "--ignore-rules",
        "--skip-git-repo-check",
      ],
    },
    capability: {
      authProbeArgs: ["login", "status"],
      runtimeProbeArgs: [
        "exec",
        "--ephemeral",
        "--ignore-rules",
        "--skip-git-repo-check",
        "--help",
      ],
      missingBinHint:
        "install the Codex CLI and ensure `codex` is available on PATH",
      missingAuthHint: "run `codex login` and retry",
    },
    status: "implemented",
  },
  opencode: {
    id: "opencode",
    displayName: "OpenCode",
    wrapperName: "opencode-cli",
    command: {
      bin: "opencode",
      runArgs: ["run"],
    },
    capability: {
      authProbeArgs: ["auth", "list"],
      runtimeProbeArgs: ["run", "--help"],
      missingBinHint:
        "install OpenCode and ensure `opencode` is available on PATH",
      missingAuthHint: "run `opencode auth login` and retry",
    },
    status: "implemented",
  },
  rovo: {
    id: "rovo",
    displayName: "Rovo Dev",
    wrapperName: "rovo-acli",
    command: {
      bin: "acli",
      runArgs: ["rovodev", "run", "--shadow", "-y"],
    },
    capability: {
      authProbeArgs: ["rovodev", "--help"],
      runtimeProbeArgs: ["rovodev", "run", "--help"],
      missingBinHint:
        "install Atlassian acli with the rovodev plugin and ensure `acli` is available on PATH",
      missingAuthHint: "run `acli rovodev auth login` and retry",
    },
    status: "implemented",
  },
};

export function getHarnessDescriptor(id: HarnessId): HarnessDescriptor {
  const parsed = HarnessIdSchema.safeParse(id);
  if (!parsed.success) {
    throw new SwarmCommandError(`unsupported harness: "${id}"`);
  }
  return HARNESS_DESCRIPTORS[parsed.data];
}

export function listHarnessDescriptors(): readonly HarnessDescriptor[] {
  return HarnessIdSchema.options.map((id) => HARNESS_DESCRIPTORS[id]);
}

export function listImplementedHarnessIds(): readonly HarnessId[] {
  return HarnessIdSchema.options.filter(
    (id) => HARNESS_DESCRIPTORS[id].status === "implemented",
  );
}
