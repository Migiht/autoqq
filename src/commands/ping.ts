import { execa } from "execa";
import { store } from "../lib/config.js";
import { schedulerLogger } from "../lib/logger.js";
import { getTool } from "../lib/tools/index.js";

/** Invoked by the systemd-scheduled service (`autoqq ping <tool>`). */
export async function runPing(toolIdArg: string): Promise<void> {
  const toolId = toolIdArg.toLowerCase();
  const tool = getTool(toolId);
  if (!tool) {
    schedulerLogger.error({ tool: toolId }, "unknown tool");
    console.error(`Unknown tool "${toolId}"`);
    process.exitCode = 1;
    return;
  }

  const authed = await tool.verifyAuth();
  if (!authed) {
    schedulerLogger.error({ tool: toolId }, "not authenticated, skipping ping");
    console.error(`${tool.displayName} is not authenticated — run \`autoqq install ${toolId}\` again.`);
    process.exitCode = 1;
    return;
  }

  const greeting = store.get("greeting");
  const start = Date.now();
  try {
    const { stdout } = await execa(tool.binary, tool.pingArgs(greeting), { timeout: 120_000 });
    const durationMs = Date.now() - start;
    schedulerLogger.info({ tool: toolId, ok: true, durationMs }, "ping sent");
    console.log(`[autoqq] ${tool.displayName} pinged OK in ${durationMs}ms`);
    if (stdout) console.log(stdout.slice(0, 500));
  } catch (err) {
    const durationMs = Date.now() - start;
    schedulerLogger.error(
      { tool: toolId, ok: false, durationMs, err: String(err) },
      "ping failed"
    );
    console.error(`[autoqq] ${tool.displayName} ping failed after ${durationMs}ms`);
    process.exitCode = 1;
  }
}
