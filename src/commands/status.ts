import { execa } from "execa";
import { isInitialized, store } from "../lib/config.js";
import { computeDailyPingTimes } from "../lib/schedule.js";
import { getTool } from "../lib/tools/index.js";
import { intro, log, note, outro } from "../ui.js";

export async function runStatus(): Promise<void> {
  intro("autoqq status");

  if (!isInitialized()) {
    log.warn("Not configured yet. Run `autoqq init`.");
    return;
  }

  const cfg = store.store;
  note(
    [
      `Timezone: ${cfg.timezone}`,
      `Window: ${cfg.windowHours}h, leave ${cfg.leaveHours}h before work`,
      `Work start: ${cfg.workStart}`,
      `Greeting: "${cfg.greeting}"`,
    ].join("\n"),
    "Schedule"
  );

  const times = computeDailyPingTimes({
    workStart: cfg.workStart,
    windowHours: cfg.windowHours,
    leaveHours: cfg.leaveHours,
  });
  note(times.join("\n"), `Daily ping times (${cfg.timezone})`);

  if (cfg.installedTools.length === 0) {
    log.warn("No tools installed yet. Run `autoqq install <claude|codex|opencode>`.");
  } else {
    note(
      cfg.installedTools.map((id) => `- ${getTool(id)?.displayName ?? id}`).join("\n"),
      "Installed tools"
    );
    try {
      const { stdout } = await execa("systemctl", [
        "--user",
        "list-timers",
        "autoqq-ping@*",
        "--no-pager",
      ]);
      note(stdout, "systemd timers");
    } catch {
      log.warn("Could not read systemd timers (is systemd running?).");
    }
  }

  outro("Done.");
}
