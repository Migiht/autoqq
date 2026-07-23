import Conf from "conf";

export interface AutoqqConfig {
  timezone: string;
  windowHours: number;
  workStart: string; // "HH:MM", 24h, local to `timezone`
  leaveHours: number;
  greeting: string;
  installedTools: string[];
  initializedAt: string;
}

const defaults: AutoqqConfig = {
  timezone: "UTC",
  windowHours: 5,
  workStart: "08:00",
  leaveHours: 2,
  greeting: "qq",
  installedTools: [],
  initializedAt: "",
};

export const store = new Conf<AutoqqConfig>({
  projectName: "autoqq",
  defaults,
});

export function isInitialized(): boolean {
  return store.get("initializedAt") !== "";
}
