import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTimezoneOptions, isValidTimezone, systemTimezone } from "./timezones.js";

test("systemTimezone returns a non-empty IANA-ish string", () => {
  assert.ok(systemTimezone().length > 0);
});

test("isValidTimezone accepts a real IANA zone", () => {
  assert.equal(isValidTimezone("Europe/Berlin"), true);
});

test("isValidTimezone rejects garbage", () => {
  assert.equal(isValidTimezone("Not/A_Real_Zone"), false);
});

test("buildTimezoneOptions includes real IANA zones and synthetic fixed offsets", () => {
  const options = buildTimezoneOptions();
  assert.ok(options.some((o) => o.value === "Europe/Berlin"));
  assert.ok(options.some((o) => o.value === "Etc/GMT-3" && o.label === "UTC+3"));
  assert.ok(options.some((o) => o.value === "UTC"));
});

test("buildTimezoneOptions has no duplicate values", () => {
  const options = buildTimezoneOptions();
  const values = options.map((o) => o.value);
  assert.equal(new Set(values).size, values.length);
});
