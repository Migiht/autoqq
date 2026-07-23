import assert from "node:assert/strict";
import { test } from "node:test";
import { computeDailyPingTimes } from "./schedule.js";

test("default config (5h window, 2h leave, 08:00 start) produces 5 evenly spaced pings", () => {
  assert.deepEqual(
    computeDailyPingTimes({ workStart: "08:00", windowHours: 5, leaveHours: 2 }),
    ["01:00:00", "05:00:00", "10:00:00", "15:00:00", "20:00:00"]
  );
});

test("prewarm ping lands exactly (windowHours - leaveHours) before workStart", () => {
  const times = computeDailyPingTimes({ workStart: "08:00", windowHours: 5, leaveHours: 2 });
  assert.equal(times[1], "05:00:00");
});

test("does not produce a redundant near-duplicate entry when windowHours doesn't divide 24 evenly", () => {
  // Regression test: an earlier off-by-one (`+ 1` occurrence padding) produced
  // both 05:00:00 and 06:00:00 for a 5h window, which is never correct.
  const times = computeDailyPingTimes({ workStart: "08:00", windowHours: 5, leaveHours: 2 });
  assert.equal(times.length, 5);
  assert.equal(new Set(times).size, times.length);
});

test("windowHours that evenly divides 24h tiles with no overlap", () => {
  assert.deepEqual(
    computeDailyPingTimes({ workStart: "09:00", windowHours: 6, leaveHours: 1 }),
    ["04:00:00", "10:00:00", "16:00:00", "22:00:00"]
  );
});

test("a 24h window produces exactly one daily ping", () => {
  assert.deepEqual(
    computeDailyPingTimes({ workStart: "09:00", windowHours: 24, leaveHours: 2 }),
    ["11:00:00"]
  );
});

test("rejects a non-positive window", () => {
  assert.throws(() => computeDailyPingTimes({ workStart: "08:00", windowHours: 0, leaveHours: 0 }));
});

test("rejects leaveHours >= windowHours", () => {
  assert.throws(() => computeDailyPingTimes({ workStart: "08:00", windowHours: 5, leaveHours: 5 }));
});

test("rejects a malformed workStart", () => {
  assert.throws(() =>
    computeDailyPingTimes({ workStart: "not-a-time", windowHours: 5, leaveHours: 2 })
  );
});
