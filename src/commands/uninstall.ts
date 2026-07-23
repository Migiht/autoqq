import { execa } from "execa";
import { store } from "../lib/config.js";
import { cliLogger } from "../lib/logger.js";
import { disableToolTimer, removeSystemdUnits } from "../lib/systemd.js";
import { getTool } from "../lib/tools/index.js";
import { askConfirm, intro, log, outro, spinner } from "../ui.js";

interface UninstallOptions {
  yes?: boolean;
}

async function uninstallOneTool(toolId: string, options: UninstallOptions): Promise<void> {
  const tool = getTool(toolId);
  if (!tool) {
    log.error(`Unknown tool "${toolId}".`);
    process.exitCode = 1;
    return;
  }

  const installedTools = store.get("installedTools");
  if (!installedTools.includes(toolId)) {
    log.warn(`${tool.displayName} isn't currently installed with autoqq.`);
    return;
  }

  if (!options.yes) {
    const confirmed = await askConfirm({
      message: `Stop pinging ${tool.displayName} and remove its scheduled timer?`,
      initialValue: true,
    });
    if (!confirmed) {
      log.warn("Cancelled.");
      return;
    }
  }

  const s = spinner();
  s.start(`Removing ${tool.displayName}'s scheduled timer...`);
  try {
    await disableToolTimer(toolId);
  } catch (err) {
    cliLogger.warn({ err: String(err), tool: toolId }, "disableToolTimer failed during uninstall");
  }
  store.set(
    "installedTools",
    installedTools.filter((id) => id !== toolId)
  );
  s.stop(`${tool.displayName} removed.`);
  cliLogger.info({ tool: toolId }, "tool uninstalled");

  outro("Done. Run `autoqq uninstall` with no arguments to remove autoqq completely.");
}

async function uninstallEverything(options: UninstallOptions): Promise<void> {
  if (!options.yes) {
    const confirmed = await askConfirm({
      message:
        "This stops every scheduled ping, removes the systemd units, and uninstalls the autoqq npm package. Continue?",
      initialValue: false,
    });
    if (!confirmed) {
      log.warn("Cancelled — nothing was removed.");
      return;
    }
  }

  const installedTools = store.get("installedTools");
  const timersSpinner = spinner();
  timersSpinner.start("Stopping scheduled pings...");
  for (const toolId of installedTools) {
    try {
      await disableToolTimer(toolId);
    } catch (err) {
      cliLogger.warn({ err: String(err), tool: toolId }, "disableToolTimer failed during full uninstall");
    }
  }
  try {
    await removeSystemdUnits();
    timersSpinner.stop("Scheduled pings stopped and systemd units removed.");
  } catch (err) {
    timersSpinner.stop("Stopped pings, but failed to remove systemd unit files.");
    cliLogger.error({ err: String(err) }, "removeSystemdUnits failed");
    log.error(String(err));
  }

  store.clear();

  const npmSpinner = spinner();
  npmSpinner.start("Uninstalling the autoqq npm package...");
  try {
    await execa("npm", ["uninstall", "-g", "@migiht/autoqq"], { stdio: "inherit" });
    npmSpinner.stop("autoqq uninstalled.");
  } catch (err) {
    npmSpinner.stop("Could not uninstall the npm package automatically.");
    log.warn("Run this yourself: npm uninstall -g @migiht/autoqq");
    cliLogger.error({ err: String(err) }, "npm uninstall failed");
  }

  outro(
    "autoqq removed. ~/.config/autoqq and ~/.local/state/autoqq/logs are left in place — delete them too for a fully clean slate."
  );
}

export async function runUninstall(
  toolArg: string | undefined,
  options: UninstallOptions
): Promise<void> {
  intro("autoqq uninstall");

  if (toolArg) {
    await uninstallOneTool(toolArg.toLowerCase(), options);
  } else {
    await uninstallEverything(options);
  }
}
