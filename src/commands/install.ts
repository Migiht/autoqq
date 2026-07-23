import { execa } from "execa";
import which from "which";
import { isInitialized, store } from "../lib/config.js";
import { cliLogger } from "../lib/logger.js";
import { enableLinger, enableToolTimer, writeSystemdUnits } from "../lib/systemd.js";
import { getTool, toolIds } from "../lib/tools/index.js";
import { askConfirm, intro, log, note, outro, pickOne, spinner } from "../ui.js";

export async function runInstall(toolArg: string | undefined): Promise<void> {
  intro("autoqq install");

  if (!isInitialized()) {
    log.error("Run `autoqq init` first — autoqq needs your schedule before it can install a tool.");
    process.exitCode = 1;
    return;
  }

  let toolId = toolArg?.toLowerCase();
  if (!toolId) {
    toolId = await pickOne({
      message: "Which tool do you want autoqq to keep warm?",
      options: toolIds.map((id) => ({ value: id, label: getTool(id)?.displayName ?? id })),
    });
  }

  const tool = getTool(toolId);
  if (!tool) {
    log.error(`Unknown tool "${toolId}". Supported: ${toolIds.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const existingBinary = await which(tool.binary, { nothrow: true });
  if (!existingBinary) {
    const shouldInstall = await askConfirm({
      message: `${tool.displayName} isn't installed. Install now?`,
      initialValue: true,
    });
    if (!shouldInstall) {
      log.warn("Install cancelled.");
      return;
    }
    const s = spinner();
    s.start(`Installing ${tool.displayName} (npm install -g ${tool.installPackage})`);
    try {
      await execa("npm", ["install", "-g", tool.installPackage], { stdio: "inherit" });
      s.stop(`${tool.displayName} installed.`);
    } catch (err) {
      s.stop("Install failed.");
      cliLogger.error({ err: String(err), tool: toolId }, "npm install failed");
      log.error(String(err));
      process.exitCode = 1;
      return;
    }
  }

  note(
    `A browser window or code prompt may open for ${tool.displayName} — finish signing in there.`,
    "Login"
  );
  try {
    await execa(tool.binary, tool.loginArgs, { stdio: "inherit" });
  } catch (err) {
    // Non-zero exit here doesn't always mean failure (some tools exit oddly
    // after a browser-based flow); verifyAuth below is the real signal.
    cliLogger.warn({ err: String(err), tool: toolId }, "login command exited non-zero");
  }

  const verifySpinner = spinner();
  verifySpinner.start("Verifying login...");
  const authOk = await tool.verifyAuth();
  if (!authOk) {
    verifySpinner.stop("Could not confirm login.");
    log.warn(
      `autoqq couldn't find valid credentials for ${tool.displayName}. Sign in and run \`autoqq install ${toolId}\` again.`
    );
    process.exitCode = 1;
    return;
  }
  verifySpinner.stop("Login verified.");

  const scheduleSpinner = spinner();
  scheduleSpinner.start("Scheduling keep-alive pings...");
  try {
    await writeSystemdUnits(store.store);
    await enableToolTimer(toolId);
    await enableLinger();
    scheduleSpinner.stop("Scheduled.");
  } catch (err) {
    scheduleSpinner.stop("Failed to schedule.");
    cliLogger.error({ err: String(err), tool: toolId }, "scheduling failed");
    log.error(String(err));
    process.exitCode = 1;
    return;
  }

  const installedTools = new Set(store.get("installedTools"));
  installedTools.add(toolId);
  store.set("installedTools", [...installedTools]);
  cliLogger.info({ tool: toolId }, "tool installed and scheduled");

  outro(
    `${tool.displayName} is now kept warm on your schedule. Add another with \`autoqq install <tool>\`, or check \`autoqq status\`.`
  );
}
