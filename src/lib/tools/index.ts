import { claudeCode } from "./claude-code.js";
import { codex } from "./codex.js";
import { opencode } from "./opencode.js";
import type { ToolDefinition } from "./types.js";

export const tools: Record<string, ToolDefinition> = {
  claude: claudeCode,
  codex,
  opencode,
};

export const toolIds = Object.keys(tools);

export function getTool(id: string): ToolDefinition | undefined {
  return tools[id.toLowerCase()];
}

export type { ToolDefinition } from "./types.js";
