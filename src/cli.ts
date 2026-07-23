#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";

if (process.platform !== "linux") {
  console.error("autoqq only supports Linux (it schedules pings via systemd user timers).");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const program = new Command();

program
  .name("autoqq")
  .description(
    "Pre-warms AI coding CLI rate-limit windows on a schedule, so your workday spans more rolling windows for free."
  )
  .version(pkg.version);

program
  .command("init")
  .description("Interactive setup wizard: timezone, schedule, and greeting message")
  .action(async () => {
    const { runInitWizard } = await import("./commands/init.js");
    await runInitWizard();
  });

program
  .command("install [tool]")
  .description("Install, authenticate, and schedule keep-alive pings for a tool (claude, codex, opencode)")
  .action(async (tool?: string) => {
    const { runInstall } = await import("./commands/install.js");
    await runInstall(tool);
  });

program
  .command("uninstall [tool]")
  .description(
    "Stop and remove a single tool's schedule, or (with no argument) fully remove autoqq"
  )
  .option("-y, --yes", "skip confirmation prompts")
  .action(async (tool: string | undefined, options: { yes?: boolean }) => {
    const { runUninstall } = await import("./commands/uninstall.js");
    await runUninstall(tool, options);
  });

program
  .command("ping <tool>")
  .description("Internal: send one keep-alive message to a tool (invoked by systemd)")
  .action(async (tool: string) => {
    const { runPing } = await import("./commands/ping.js");
    await runPing(tool);
  });

program
  .command("status")
  .description("Show the current schedule, installed tools, and next ping times")
  .action(async () => {
    const { runStatus } = await import("./commands/status.js");
    await runStatus();
  });

program.parseAsync();
