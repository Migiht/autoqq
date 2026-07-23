import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition } from "./types.js";

export const codex: ToolDefinition = {
  id: "codex",
  displayName: "Codex CLI",
  binary: "codex",
  installPackage: "@openai/codex",
  loginArgs: ["login"],
  pingArgs: (greeting) => ["exec", "--skip-git-repo-check", greeting],
  async verifyAuth() {
    const authPath = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "auth.json");
    if (!existsSync(authPath)) return false;
    try {
      const data = JSON.parse(readFileSync(authPath, "utf8"));
      return Object.keys(data ?? {}).length > 0;
    } catch {
      return false;
    }
  },
};
