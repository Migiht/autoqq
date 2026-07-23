#!/usr/bin/env node
import { Command } from "commander";

if (process.platform !== "linux") {
  console.error("autoqq only supports Linux (it schedules pings via systemd user timers).");
  process.exit(1);
}

const program = new Command();

program
  .name("autoqq")
  .description(
    "Pre-warms AI coding CLI rate-limit windows on a schedule, so your workday spans more rolling windows for free."
  )
  .version("0.1.0");

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
