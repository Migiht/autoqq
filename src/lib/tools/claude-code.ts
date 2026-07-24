import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition } from "./types.js";

export const claudeCode: ToolDefinition = {
  id: "claude",
  displayName: "Claude Code",
  binary: "claude",
  installPackage: "@anthropic-ai/claude-code",
  loginArgs: ["auth", "login"],
  // `--bare` only ever reads ANTHROPIC_API_KEY/apiKeyHelper — it never reads
  // OAuth tokens or the credential store (confirmed via `claude --help`:
  // "OAuth and keychain are never read"). Since `autoqq install` sets up
  // OAuth login (not an API key), `--bare` would report "Not logged in"
  // even with valid credentials. verifyAuth() below checks OAuth/keychain
  // credentials, so pingArgs has to use a mode that actually honors them.
  pingArgs: (greeting) => ["-p", greeting],
  async verifyAuth() {
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY) return true;
    const credPath = join(homedir(), ".claude", ".credentials.json");
    if (!existsSync(credPath)) return false;
    try {
      const data = JSON.parse(readFileSync(credPath, "utf8"));
      return Boolean(data?.claudeAiOauth?.accessToken);
    } catch {
      return false;
    }
  },
};
