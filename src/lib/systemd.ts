import { execa } from "execa";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import which from "which";
import type { AutoqqConfig } from "./config.js";
import { computeDailyPingTimes } from "./schedule.js";

const unitDir = join(homedir(), ".config", "systemd", "user");
const serviceUnitName = "autoqq-ping@.service";
const timerUnitName = "autoqq-ping@.timer";

async function resolveAutoqqBinary(): Promise<string> {
  const resolved = await which("autoqq", { nothrow: true });
  if (resolved) return resolved;
  // Dev fallback: re-invoke through the same node + entry script currently running.
  return `${process.execPath} ${process.argv[1]}`;
}

/** Writes/refreshes the shared templated unit pair and reloads systemd. */
export async function writeSystemdUnits(config: AutoqqConfig): Promise<void> {
  mkdirSync(unitDir, { recursive: true });
  const bin = await resolveAutoqqBinary();
  // autoqq's shebang is `#!/usr/bin/env node`, so systemd --user's own (minimal)
  // session PATH must be able to find node. Version managers like nvm only put
  // node's bin dir on PATH via shell rc files, which systemd never sources.
  // Same fix pm2 uses for its generated systemd unit's %NODE_PATH%:
  // https://github.com/unitech/pm2/blob/master/lib/API/Startup.js (search NODE_PATH)
  // https://github.com/unitech/pm2/blob/master/lib/templates/init-scripts/systemd.tpl
  const nodeDir = dirname(process.execPath);
  const currentPath = process.env.PATH ?? "";
  const unitPath = currentPath.split(":").includes(nodeDir)
    ? currentPath
    : `${currentPath}:${nodeDir}`;

  const service = `[Unit]
Description=autoqq keep-alive ping for %i

[Service]
Type=oneshot
Environment=PATH=${unitPath}
ExecStart=${bin} ping %i
StandardOutput=journal
StandardError=journal
`;
  writeFileSync(join(unitDir, serviceUnitName), service, "utf8");

  const times = computeDailyPingTimes({
    workStart: config.workStart,
    windowHours: config.windowHours,
    leaveHours: config.leaveHours,
  });
  const onCalendarLines = times
    .map((time) => `OnCalendar=*-*-* ${time} ${config.timezone}`)
    .join("\n");

  const timer = `[Unit]
Description=autoqq keep-alive schedule for %i

[Timer]
${onCalendarLines}
Persistent=true
RandomizedDelaySec=30

[Install]
WantedBy=timers.target
`;
  writeFileSync(join(unitDir, timerUnitName), timer, "utf8");

  await execa("systemctl", ["--user", "daemon-reload"]);
}

export async function enableToolTimer(toolId: string): Promise<void> {
  await execa("systemctl", ["--user", "enable", "--now", `autoqq-ping@${toolId}.timer`]);
}

export async function restartToolTimer(toolId: string): Promise<void> {
  await execa("systemctl", ["--user", "restart", `autoqq-ping@${toolId}.timer`]);
}

export async function disableToolTimer(toolId: string): Promise<void> {
  await execa("systemctl", ["--user", "disable", "--now", `autoqq-ping@${toolId}.timer`]);
}

/** Deletes the shared templated unit pair and reloads systemd. */
export async function removeSystemdUnits(): Promise<void> {
  const servicePath = join(unitDir, serviceUnitName);
  const timerPath = join(unitDir, timerUnitName);
  if (existsSync(servicePath)) rmSync(servicePath);
  if (existsSync(timerPath)) rmSync(timerPath);
  await execa("systemctl", ["--user", "daemon-reload"]);
}

/** Required so timers keep firing after the installing SSH session ends. */
export async function enableLinger(): Promise<void> {
  const user = process.env.USER ?? process.env.LOGNAME;
  if (!user) return;
  await execa("loginctl", ["enable-linger", user]);
}

export async function listTimers(): Promise<string> {
  const { stdout } = await execa("systemctl", [
    "--user",
    "list-timers",
    "autoqq-ping@*",
    "--no-pager",
  ]);
  return stdout;
}
