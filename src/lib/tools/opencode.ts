import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition } from "./types.js";

export const opencode: ToolDefinition = {
  id: "opencode",
  displayName: "opencode",
  binary: "opencode",
  installPackage: "opencode-ai@latest",
  loginArgs: ["auth", "login"],
  pingArgs: (greeting) => ["run", greeting],
  async verifyAuth() {
    const authPath = join(homedir(), ".local", "share", "opencode", "auth.json");
    if (!existsSync(authPath)) return false;
    try {
      const data = JSON.parse(readFileSync(authPath, "utf8"));
      return Object.keys(data ?? {}).length > 0;
    } catch {
      return false;
    }
  },
};
