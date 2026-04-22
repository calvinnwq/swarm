import { SwarmCommandError } from "../lib/parse-command.js";
import type { BackendId } from "../schemas/backend-id.js";
import { ClaudeCliAdapter } from "./claude-cli.js";
import { CodexCliAdapter } from "./codex-cli.js";
import type { BackendAdapter } from "./index.js";

export function createBackendAdapter(backend: BackendId): BackendAdapter {
  switch (backend) {
    case "claude":
      return new ClaudeCliAdapter();
    case "codex":
      return new CodexCliAdapter();
    default:
      throw new SwarmCommandError(`unsupported backend: "${backend}"`);
  }
}
