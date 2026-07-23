import { store } from "../lib/config.js";
import { cliLogger } from "../lib/logger.js";
import { enableLinger, restartToolTimer, writeSystemdUnits } from "../lib/systemd.js";
import { buildTimezoneOptions, systemTimezone } from "../lib/timezones.js";
import { ask, group, intro, log, orange, outro, pickOne, spinner } from "../ui.js";

function normalizeTime(value: string): string {
  const [h, m] = value.trim().split(":");
  return `${(h ?? "0").padStart(2, "0")}:${(m ?? "0").padStart(2, "0")}`;
}

export async function runInitWizard(): Promise<void> {
  intro("autoqq init");

  console.log(orange("Enter YOUR timezone below — not the server's."));

  const tzOptions = buildTimezoneOptions();
  const defaultTz = systemTimezone();
  const hasDefaultTz = tzOptions.some((option) => option.value === defaultTz);

  const answers = await group(
    {
      timezone: () =>
        pickOne({
          message: "Which timezone are you in?",
          options: tzOptions,
          initialValue: hasDefaultTz ? defaultTz : undefined,
          placeholder: `Type to filter (Enter = ${defaultTz})`,
        }),
      windowHours: () =>
        ask({
          message: "Rate-limit window size, in hours?",
          initialValue: "5",
          validate: (value) => (Number(value ?? "") > 0 ? undefined : "Enter a positive number"),
        }),
      workStart: () =>
        ask({
          message: "What time do you usually start work? (HH:MM, your timezone)",
          initialValue: "8:00",
          validate: (value) =>
            /^\d{1,2}:\d{2}$/.test((value ?? "").trim()) ? undefined : "Use HH:MM",
        }),
      leaveHours: ({ results }) =>
        ask({
          message: "How many hours of the window should still be left when you start work?",
          initialValue: "2",
          validate: (value) => {
            const n = Number(value ?? "");
            const window = Number(results.windowHours ?? 5);
            if (!(n >= 0)) return "Enter a non-negative number";
            if (n >= window) return `Must be less than the window size (${window}h)`;
            return undefined;
          },
        }),
      greeting: () =>
        ask({
          message: "Custom keep-alive message to send?",
          initialValue: "qq",
        }),
    },
    {
      onCancel: () => {
        log.warn("Setup cancelled — nothing was saved.");
        process.exit(0);
      },
    }
  );

  store.set({
    timezone: answers.timezone,
    windowHours: Number(answers.windowHours),
    workStart: normalizeTime(answers.workStart),
    leaveHours: Number(answers.leaveHours),
    greeting: answers.greeting,
    initializedAt: new Date().toISOString(),
  });

  const s = spinner();
  s.start("Installing schedule (systemd user timers)...");
  try {
    await writeSystemdUnits(store.store);
    await enableLinger();
    for (const toolId of store.get("installedTools")) {
      await restartToolTimer(toolId);
    }
    s.stop("Schedule installed.");
  } catch (err) {
    s.stop("Failed to install schedule.");
    cliLogger.error({ err: String(err) }, "systemd setup failed during init");
    log.error(String(err));
    process.exitCode = 1;
    return;
  }

  cliLogger.info({ config: store.store }, "init completed");

  outro(
    store.get("installedTools").length > 0
      ? "Schedule updated. Run `autoqq status` to see the next ping times."
      : "Next: run `autoqq install claude` (or codex / opencode) to connect a tool."
  );
}
