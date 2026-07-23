export interface TimezoneOption {
  value: string;
  label: string;
  hint: string;
}

export function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function offsetHint(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/**
 * IANA zones plus synthetic fixed-offset entries (UTC+3, UTC-5, ...) so a
 * manually typed offset like "+3" resolves through the same picker instead
 * of needing a separate free-text fallback.
 */
export function buildTimezoneOptions(): TimezoneOption[] {
  const zones = [...Intl.supportedValuesOf("timeZone")].sort((a, b) => a.localeCompare(b));
  const ianaOptions: TimezoneOption[] = zones.map((zone) => ({
    value: zone,
    label: zone,
    hint: offsetHint(zone),
  }));

  const fixedOffsets: TimezoneOption[] = [];
  for (let hours = -12; hours <= 14; hours++) {
    // Despite what you'd expect, Intl.supportedValuesOf("timeZone") does not
    // actually include "UTC" (or "Etc/UTC"/"Etc/GMT") in its output, even
    // though all three are accepted by the Intl.DateTimeFormat constructor.
    // Without this branch there would be no way to select plain UTC at all.
    if (hours === 0) {
      fixedOffsets.push({ value: "UTC", label: "UTC", hint: "fixed offset, no DST" });
      continue;
    }
    const sign = hours > 0 ? "+" : "-";
    const abs = Math.abs(hours);
    // Etc/GMT signs are POSIX-inverted relative to common UTC notation.
    const etcName = hours > 0 ? `Etc/GMT-${abs}` : `Etc/GMT+${abs}`;
    fixedOffsets.push({
      value: etcName,
      label: `UTC${sign}${abs}`,
      hint: "fixed offset, no DST",
    });
  }

  return [...ianaOptions, ...fixedOffsets];
}
