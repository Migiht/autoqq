import envPaths from "env-paths";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";

const paths = envPaths("autoqq", { suffix: "" });
export const logDir = join(paths.log, "logs");
mkdirSync(logDir, { recursive: true });

function fileLogger(fileBaseName: string): pino.Logger {
  const transport = pino.transport({
    target: "pino-roll",
    options: {
      file: join(logDir, fileBaseName),
      frequency: "daily",
      dateFormat: "yyyy-MM-dd",
      size: "10m",
      limit: { count: 5 },
      mkdir: true,
    },
  });
  return pino({ level: "info", timestamp: pino.stdTimeFunctions.isoTime }, transport);
}

/** CLI-invoked commands (init, install, status) log here. */
export const cliLogger = fileLogger("cli");

/** The scheduled `autoqq ping <tool>` service logs here. */
export const schedulerLogger = fileLogger("scheduler");
