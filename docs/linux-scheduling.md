# Linux Scheduling & Service Architecture for autoqq

Research notes for implementing autoqq's daily-message and renewal-message scheduling on
"always-on" Linux servers, distributed as an npm-installed CLI plus a `curl | sh` installer.

Every claim below is sourced. Where a source uses a code/config example, the example is
reproduced verbatim (or lightly trimmed) so it can be adapted directly.

---

## 1. systemd user timers vs system timers vs cron vs an in-process Node scheduler

### Architectural difference: systemd timers vs cron

- systemd timers split "what to run" (a `.service` unit) from "when to run it" (a `.timer`
  unit), whereas cron mixes schedule and command in one crontab line.
  ([cronbuilder.dev](https://cronbuilder.dev/blog/cron-vs-systemd-timers.html))
- "Systemd timer and service units do not need to be installed at the system level; instead,
  they can be installed per user in `~/.config/systemd/user/` and run within the user service
  manager." ([cronbuilder.dev](https://cronbuilder.dev/blog/cron-vs-systemd-timers.html))

### Cron: pros / cons

**Pros**: extremely simple, preinstalled almost everywhere including non-systemd systems
(BSD, macOS, minimal containers), universally understood syntax.
([xtom.com](https://xtom.com/blog/systemd-vs-cron-linux-task-scheduling/),
[cronbuilder.dev](https://cronbuilder.dev/blog/cron-vs-systemd-timers.html))

**Cons**: weak logging (mail-based or silently swallowed output), no resource control, no
overlap protection (a slow job can double-fire), no built-in catch-up after downtime, and
only minute-level scheduling granularity.

### systemd timers: pros / cons

**Pros**, per [`systemd.timer(5)`](https://man7.org/linux/man-pages/man5/systemd.timer.5.html)
and comparative writeups:

- `RandomizedDelaySec=` spreads a fleet of installs' fire times to avoid a thundering herd.
- Monotonic timers (`OnUnitActiveSec=`) fire relative to when the unit last *finished*, not
  wall-clock time — useful for "N hours after the previous run" style jobs.
- Sub-second precision available via `AccuracySec=` (default is 1 minute, coalesced for power
  efficiency; can be tightened to `1us`).
- Every timer-triggered job is a normal systemd **service**, so it inherits cgroup-based
  resource limits (CPU/memory/IO) and centralized `journald` logging for free.
  ([trstringer.com](https://trstringer.com/systemd-timer-vs-cronjob/))
- "Systemd timers guarantee that only one instance of a task is in execution at any given
  moment, and if a task takes longer than expected, systemd ensures the subsequent scheduled
  instance waits patiently." ([trstringer.com](https://trstringer.com/systemd-timer-vs-cronjob/))
- `Persistent=true` — from the man page: "If true, the time when the service unit was last
  triggered is stored on disk... upon timer activation, the service triggers immediately if
  it would have fired during inactive periods" — i.e. it catches up a missed daily run if the
  server was down/rebooting at the scheduled time.
  ([man7.org](https://man7.org/linux/man-pages/man5/systemd.timer.5.html))
- Timer units automatically depend on `time-set.target` / `time-sync.target`, so a calendar
  timer won't fire using a wrong system clock before NTP sync.
  ([man7.org](https://man7.org/linux/man-pages/man5/systemd.timer.5.html))
- `OnTimezoneChange=` / `OnClockChange=` can re-trigger evaluation if the local timezone or
  clock is changed underneath a running timer.

**Cons**: more setup boilerplate — two unit files instead of one crontab line — and it is
Linux/systemd-specific (a non-issue since autoqq is explicitly Linux-only).
([cronbuilder.dev](https://cronbuilder.dev/blog/cron-vs-systemd-timers.html))

### In-process Node scheduler that daemonizes itself (node-cron / node-schedule)

Not recommended as the primary mechanism, because:

- The Node process itself must survive reboots and crashes — which means you still need a
  process supervisor (systemd, pm2, etc.) wrapping it, making the in-process scheduler an
  *addition* on top of systemd rather than a replacement for it.
- It must stay resident in memory 24/7 just to wait for the next tick, vs. a systemd
  `Type=oneshot` service that consumes zero resources between scheduled runs.
- Reboot-survival, log rotation, resource isolation, and crash-restart semantics (`Restart=`)
  all have to be hand-rolled in JavaScript instead of being free properties of the OS's init
  system.

### Recommendation

> "New production services on modern Linux should default to systemd timers, while for
> personal scripts and anything where you need portability or quick setup, cron is still
> perfectly fine." ([cronbuilder.dev](https://cronbuilder.dev/blog/cron-vs-systemd-timers.html))

For an enterprise, thousands-of-users, self-hosted CLI installed per-user on always-on Linux
servers: **systemd user timers** are the idiomatic modern approach — no root required to
install, native reboot survival (with lingering, see §2), native structured logging via
`journald`, automatic catch-up via `Persistent=true`, and no need to keep a Node process
resident between runs.

**Sources**: [cronbuilder.dev](https://cronbuilder.dev/blog/cron-vs-systemd-timers.html),
[trstringer.com](https://trstringer.com/systemd-timer-vs-cronjob/),
[xtom.com](https://xtom.com/blog/systemd-vs-cron-linux-task-scheduling/),
[man7.org — systemd.timer(5)](https://man7.org/linux/man-pages/man5/systemd.timer.5.html)

---

## 2. How other tools install systemd user units, and `loginctl enable-linger`

### Real-world unit file: Syncthing (user mode)

Syncthing ships a ready-to-use **user-mode** service unit at
`etc/linux-systemd/user/syncthing.service` in its repo
([github.com/syncthing/syncthing](https://github.com/syncthing/syncthing/blob/main/etc/linux-systemd/user/syncthing.service)):

```ini
[Unit]
Description=Syncthing - Open Source Continuous File Synchronization
Documentation=man:syncthing(1)
StartLimitIntervalSec=60
StartLimitBurst=4

[Service]
Environment="STLOGFORMATTIMESTAMP="
Environment="STLOGFORMATLEVELSTRING=false"
Environment="STLOGFORMATLEVELSYSLOG=true"
ExecStart=/usr/bin/syncthing serve --no-browser --no-restart
Restart=on-failure
RestartSec=1
SuccessExitStatus=3 4
RestartForceExitStatus=3 4
# Hardening
SystemCallArchitectures=native
MemoryDenyWriteExecute=true
NoNewPrivileges=true
#AmbientCapabilities=CAP_CHOWN CAP_FOWNER

[Install]
WantedBy=default.target
```

Note the `[Install] WantedBy=default.target` — this is the correct target for **user**-mode
units (system-mode units instead target `multi-user.target`).

Documented install steps
([docs.syncthing.net](https://docs.syncthing.net/v1.0.0/users/autostart.html)): copy the unit
to `~/.config/systemd/user/`, then:

```bash
systemctl --user enable syncthing.service
systemctl --user start syncthing.service
systemctl --user status syncthing.service
```

### npm package pattern: `add-to-systemd`

[`mafintosh/add-to-systemd`](https://github.com/mafintosh/add-to-systemd) (installable via
`npm install -g add-to-systemd`) demonstrates the **templated-unit-file** pattern commonly
used by Node tooling. Its bundled `template.service`:

```ini
[Unit]
After={after}
{unit-options}
[Service]
ExecStart={command}
Restart=always
{service-options}
[Install]
WantedBy=multi-user.target
```

The CLI parses flags (`--user`, `--cwd`, `--nice`, `--env`, custom `--option` pairs) with
`minimist`, defaults `After=` to `syslog.target network.target remote-fs.target
nss-lookup.target`, substitutes the template placeholders, writes the result to
`/etc/systemd/system/[name].service` (system-level in this tool's case), then calls
`systemctl enable` and reloads the daemon. An autoqq installer should mirror this
templated-unit + `systemctl` pattern but write to `~/.config/systemd/user/` and use
`systemctl --user` throughout, so no root is required.

### Backup-tool pattern: restic / litestream

Community `.service`/`.timer` pairs for restic
([larsks/restic-systemd-units](https://github.com/larsks/restic-systemd-units),
[cdroege/systemd-restic-simple](https://github.com/cdroege/systemd-restic-simple)) and
Litestream's official guide ([litestream.io/guides/systemd](https://litestream.io/guides/systemd/))
both install at the **system** level (`/etc/systemd/system/`, requiring `sudo`), driven by
`systemctl daemon-reload` / `systemctl restart`. This is a useful contrast: those tools assume
a dedicated system service account, whereas autoqq — installed per human user to act on their
behalf — fits the **user**-level model (Syncthing's pattern) much better.

### `loginctl enable-linger`

This is the load-bearing detail for "survives reboot / works on a headless always-on server":

> "The `loginctl enable-linger` command tells systemd to keep your user services running even
> when no login session exists. By default, systemd user services only run while a login
> session exists (`Linger=no`)."
> ([oneuptime.com](https://oneuptime.com/blog/post/2026-03-17-use-loginctl-enable-linger-rootless-podman/view))

> "On a headless Ubuntu server, created systemd user services will stop working when the SSH
> session ends unless `loginctl enable-linger` has been configured... [Lingering] tells
> systemd to start your user manager at boot and keep it running after logout."
> ([akmatori.com](https://akmatori.com/blog/systemd-user-units))

Without lingering, an autoqq user timer installed over SSH would stop firing the instant the
installing SSH session ends, and would only resume the next time that user logs in
interactively — unacceptable for a daily scheduled job on an unattended server. **The autoqq
installer must run `loginctl enable-linger` as part of setup.**

Exact commands:

```bash
loginctl enable-linger                 # enable for the current user
sudo loginctl enable-linger username   # enable for another user (requires root)
loginctl show-user "$USER" --property=Linger   # verify — should print "Linger=yes"
```

### Full install sequence for autoqq (composited pattern)

```bash
mkdir -p ~/.config/systemd/user
cp autoqq.service autoqq.timer ~/.config/systemd/user/
cp autoqq-renewal.service autoqq-renewal.timer ~/.config/systemd/user/

systemctl --user daemon-reload
systemctl --user enable --now autoqq.timer
systemctl --user enable --now autoqq-renewal.timer
systemctl --user list-timers

loginctl enable-linger "$USER"   # required for headless/server persistence
```

**Sources**:
[github.com/syncthing/syncthing/.../syncthing.service](https://github.com/syncthing/syncthing/blob/main/etc/linux-systemd/user/syncthing.service),
[docs.syncthing.net/v1.0.0/users/autostart.html](https://docs.syncthing.net/v1.0.0/users/autostart.html),
[github.com/mafintosh/add-to-systemd](https://github.com/mafintosh/add-to-systemd),
[github.com/larsks/restic-systemd-units](https://github.com/larsks/restic-systemd-units),
[litestream.io/guides/systemd](https://litestream.io/guides/systemd/),
[oneuptime.com](https://oneuptime.com/blog/post/2026-03-17-use-loginctl-enable-linger-rootless-podman/view),
[akmatori.com/blog/systemd-user-units](https://akmatori.com/blog/systemd-user-units)

---

## 3. Timezone handling in Node.js

### Enumerating IANA timezones: `Intl.supportedValuesOf('timeZone')`

`Intl.supportedValuesOf()` "returns an array containing the supported calendar, collation,
currency, numbering systems, or unit values supported by the implementation." It was added in
Node.js 18 (sourced from V8 v9.9), and works from Node 14.18+.
([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/supportedValuesOf))

```js
const zones = Intl.supportedValuesOf('timeZone');
// -> ["Africa/Abidjan", "Africa/Accra", ..., "UTC", ...]  (~428 IANA identifiers)
```

Known limitation: the list is not guaranteed exhaustive — a system's `TZ` env var can
validly reference a zone not present in this array's output. Tracked upstream at
[nodejs/node#43678](https://github.com/nodejs/node/issues/43678). For autoqq, use this API to
populate a timezone picker/autocomplete during setup, but don't hard-reject a manually-typed
value that fails to appear in the list — validate instead by constructing an
`Intl.DateTimeFormat` with the candidate zone and catching the thrown `RangeError`.

### Detecting the user's current timezone

```js
Intl.DateTimeFormat().resolvedOptions().timeZone; // e.g. "America/Sao_Paulo"
```
(standard `Intl` behavior, used as the sensible default to pre-fill during `autoqq init`.)

### Scheduling libraries and their timezone/DST behavior

**`cron-parser`** ([npmjs.com/package/cron-parser](https://www.npmjs.com/package/cron-parser)):
provides timezone support "using Luxon, handling DST transitions correctly," via a `tz` option:

```js
import { CronExpressionParser } from 'cron-parser';

const options = {
  currentDate: '2023-03-26T01:00:00',
  tz: 'Europe/London',
};

const interval = CronExpressionParser.parse('0 * * * *', options);
console.log(interval.next().toString());
console.log(interval.next().toString());
console.log(interval.next().toString());
```
This steps correctly through the UK's March 26 2023 spring-forward transition without manual
adjustment, because the underlying date math runs through Luxon's timezone-aware `DateTime`.

**`node-cron`** ([github.com/node-cron/node-cron](https://github.com/node-cron/node-cron)):
timezone is a scheduling option:

```js
const task = cron.schedule('0 3 * * *', doWork, {
  name: 'nightly-backup',
  timezone: 'America/Sao_Paulo',
});
```
"Schedules match wall-clock time in the task's timezone." Documented DST caveat: across a
fall-back transition, the repeated hour runs only once, so a sub-hourly schedule (e.g.
`*/15`) can pause for up to the length of the DST shift during that hour; the docs recommend
`timezone: 'UTC'` if a fixed interval must never pause.

**`node-schedule`** ([github.com/node-schedule/node-schedule](https://github.com/node-schedule/node-schedule)):
timezone set on a `RecurrenceRule`:

```js
const rule = new schedule.RecurrenceRule();
rule.hour = 0;
rule.minute = 0;
rule.tz = 'Etc/UTC';

const job = schedule.scheduleJob(rule, function () {
  console.log('A new day has begun in the UTC timezone!');
});
```
Valid `tz` values are standard [tz database](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)
identifiers. The README does not document explicit DST edge-case guarantees.

**Croner** ([croner.56k.guru](https://croner.56k.guru/),
[github.com/Hexagon/croner](https://github.com/hexagon/croner)):

```js
new Cron('2024-01-23T00:00:00', { timezone: 'Asia/Kolkata' }, () => {
  console.log('Yay!');
});
```
Zero runtime dependencies (resolves timezones via the native `Intl` API rather than an
external datetime library). Explicit, well-documented DST semantics:
- **Spring-forward (gap)**: "Jobs scheduled during DST gaps are skipped" — a wall-clock time
  that never occurs is simply not run.
- **Fall-back (overlap)**: "Jobs in DST overlaps run once at first occurrence" — a wall-clock
  time that occurs twice fires only once, preventing an accidental double-send.

### Comparison and recommendation for autoqq

| Library | TZ engine | DST gap (spring-fwd) | DST overlap (fall-back) |
|---|---|---|---|
| cron-parser | Luxon | handled via Luxon | handled via Luxon |
| node-cron | native `Intl`/JS `Date` | not explicitly documented | repeated hour runs once; can pause sub-hourly schedules |
| node-schedule | native `Intl`/JS `Date` | not documented | not documented |
| Croner | native `Intl`, zero deps | explicitly skipped | explicitly fires once |

Because autoqq's two jobs are **once-per-day, specific-wall-clock-time** triggers (not
sub-hourly), the DST-overlap "fires twice" failure mode is the one that actually matters — a
naive implementation could send the daily message twice on the one day per year that 1:00 AM
happens twice. **Croner's explicit "fire once on overlap" guarantee**, combined with zero
external dependencies, makes it the strongest fit if scheduling is computed in-process (e.g.
to render an `OnCalendar=` expression, or to compute one-shot fire times for a
`systemd-run --user --on-calendar` style transient timer). If autoqq instead generates a
systemd `OnCalendar=` timer directly (recommended primary path, see §1–2), systemd's own
calendar-time engine already resolves local-time-in-a-given-TZ correctly including DST,
since a `.timer` unit inherits the system/user timezone.

**Sources**:
[MDN — Intl.supportedValuesOf](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/supportedValuesOf),
[nodejs/node#43678](https://github.com/nodejs/node/issues/43678),
[npmjs.com/package/cron-parser](https://www.npmjs.com/package/cron-parser),
[github.com/node-cron/node-cron](https://github.com/node-cron/node-cron),
[github.com/node-schedule/node-schedule](https://github.com/node-schedule/node-schedule),
[croner.56k.guru](https://croner.56k.guru/)

---

## 4. Structured logging: CLI log vs service log

### pino vs winston

- Throughput: "On Node.js 22 LTS, Pino sustains roughly 650k–720k ops/sec for 1KB JSON
  messages, which is 7–8x faster than Winston in JSON mode... Pino is 5x faster with
  worker-thread I/O."
  ([betterstack.com](https://betterstack.com/community/guides/scaling-nodejs/pino-vs-winston/))
- "For most applications processing fewer than 1,000 requests/second, the difference is
  negligible — both loggers add sub-millisecond overhead per log call."
  ([betterstack.com](https://betterstack.com/community/guides/scaling-nodejs/pino-vs-winston/))
- Pino's design: "focusing on speed and efficiency through structured JSON output and minimal
  overhead... 5–10x faster than Winston by avoiding synchronous string formatting in the hot
  path and offloading I/O to worker threads."
  ([betterstack.com](https://betterstack.com/community/guides/logging/best-nodejs-logging-libraries/))
- Winston's design: "an extensive plugin architecture with 80+ community transports, custom
  formatters" and rich built-in configuration.
  ([dev.to/chintanshah35](https://dev.to/chintanshah35/winston-vs-pino-in-2026-a-production-tested-comparison-6o0))
- 2026 guidance: pino is the safer default for new projects; pick Winston only with an
  existing deep investment in custom Winston transports.

**For autoqq**: log volume is inherently low (two scheduled fires/day plus occasional CLI
invocations), so raw throughput is not the deciding factor — but pino's low per-call overhead
matters for the CLI path specifically (you don't want logging setup to add noticeable latency
to a `autoqq status` command a human is waiting on), and its JSON-structured-by-default output
is easy to grep/ship/parse later. Recommend **pino** for both logs, using two separate
`pino.destination()` file targets (or two logger instances) rather than two separate library
choices.

### Log rotation options

- `winston-daily-rotate-file` ([github.com/winstonjs/winston-daily-rotate-file](https://github.com/winstonjs/winston-daily-rotate-file)):
  "A transport for winston which logs to a rotating file each day. Logs can be rotated based
  on a date, size limit, and old logs can be removed based on count or elapsed days." Key
  options: `maxSize` (bytes, or `'k'`/`'m'`/`'g'` suffix), `maxFiles` (count, or day-count
  with a `'d'` suffix).
- Pino's own guidance: "Pino recommends using the logrotate tool for log rotation" — i.e.
  delegate rotation to the OS-level `logrotate` utility rather than doing it in-process.
  ([techinsights.manisuec.com](https://techinsights.manisuec.com/nodejs/pino-with-logrotate-utility/))
- For pure in-app rotation without an external OS dependency, **`pino-roll`** "handles daily
  rotation and size limits, and can create directories automatically."
  ([betterstack.com](https://betterstack.com/community/guides/logging/best-nodejs-logging-libraries/))
- `logrotate` itself "has been designed to ease the administration of systems that generate
  large numbers of log files," typically configured via `/etc/logrotate.d/<app>`, and
  triggered by the `logrotate.timer` that ships with systemd on most distros.

**For autoqq**: since a per-user systemd timer setup is already the chosen architecture (§1–2)
and per-user `logrotate` config is more fragile to install without root (a *system*
`/etc/logrotate.d/` entry needs `sudo`, and user-level logrotate cron jobs are non-standard),
prefer **`pino-roll`** for self-contained, no-root, no-external-dependency size/daily rotation
of both log files. This also keeps rotation working identically regardless of whether the host
distro even has `logrotate` installed.

### Where to store logs: XDG Base Directory Specification

Per the spec ([specifications.freedesktop.org/basedir-spec](http://specifications.freedesktop.org/basedir/latest/)):

- `XDG_DATA_HOME` (default `$HOME/.local/share`): "base directory relative to which
  user-specific data files should be stored."
- `XDG_CONFIG_HOME` (default `$HOME/.config`): "base directory relative to which user-specific
  configuration files should be stored." — this is where the systemd unit files themselves
  belong (`~/.config/systemd/user/`), consistent with §2.
- `XDG_STATE_HOME` (default `$HOME/.local/state`): "base directory relative to which
  user-specific state files should be stored" — holds "state data that should persist between
  (application) restarts, but that is not important or portable enough to the user that it
  should be stored in `$XDG_DATA_HOME`." The spec's own examples of what belongs here:
  **"actions history (logs, history, recently used files, …)"**.
- `XDG_CACHE_HOME` (default `$HOME/.cache`): non-essential, disposable data.
- "All paths must be absolute; relative paths should be considered invalid and ignored."

**Applied to autoqq**: both logs are exactly the spec's worked example ("logs" under state
data), so they belong under `XDG_STATE_HOME`, respecting the env var if set and falling back
to the documented default otherwise:

```
$XDG_STATE_HOME/autoqq/logs/cli.log        # -> ~/.local/state/autoqq/logs/cli.log
$XDG_STATE_HOME/autoqq/logs/scheduler.log  # -> ~/.local/state/autoqq/logs/scheduler.log
```

Config (including any generated systemd units before install, and user preferences like the
configured timezone/send time) belongs under `XDG_CONFIG_HOME` (`~/.config/autoqq/`).

**Sources**:
[betterstack.com — pino vs winston](https://betterstack.com/community/guides/scaling-nodejs/pino-vs-winston/),
[betterstack.com — best nodejs logging libraries](https://betterstack.com/community/guides/logging/best-nodejs-logging-libraries/),
[dev.to/chintanshah35](https://dev.to/chintanshah35/winston-vs-pino-in-2026-a-production-tested-comparison-6o0),
[github.com/winstonjs/winston-daily-rotate-file](https://github.com/winstonjs/winston-daily-rotate-file),
[techinsights.manisuec.com](https://techinsights.manisuec.com/nodejs/pino-with-logrotate-utility/),
[XDG Base Directory Specification](http://specifications.freedesktop.org/basedir/latest/)

---

## 5. `curl | sh` install script patterns (bun, deno, rustup)

### Bun (`bun.sh/install`)

Platform/arch detection via `uname -ms`:

```bash
platform=$(uname -ms)
case $platform in
'Darwin x86_64') target=darwin-x64 ;;
'Darwin arm64') target=darwin-aarch64 ;;
'Linux aarch64' | 'Linux arm64') target=linux-aarch64 ;;
'MINGW64'*) target=windows-x64 ;;
'Linux x86_64' | *) target=linux-x64 ;;
esac
```

CPU-feature and libc detection (AVX2 baseline build, musl for Alpine):

```bash
if [[ $(cat /proc/cpuinfo | grep avx2) = '' ]]; then
    target="$target-baseline"
fi
if [ -f /etc/alpine-release ]; then
    target="$target-musl"
fi
```

Downloads a prebuilt binary directly (no Node/npm dependency), extracts, and installs:

```bash
curl --fail --location --progress-bar --output "$exe.zip" "$bun_uri" || error "Failed to download bun from \"$bun_uri\""
unzip -oqd "$bin_dir" "$exe.zip" || error 'Failed to extract bun'
mv "$bin_dir/bun-$target/$exe_name" "$exe" || error 'Failed to move extracted bun to destination'
chmod +x "$exe" || error 'Failed to set permissions on bun executable'
```

Installs to `$HOME/.bun/bin/bun` by default (overridable via `$BUN_INSTALL`). PATH setup is
done by directly appending `export BUN_INSTALL=...` / `export PATH="$BUN_INSTALL/bin:$PATH"`
lines to detected shell rc files (`~/.bashrc`, `~/.zshrc`, `~/.config/fish/config.fish`).
Finishes with `command -v bun` verification, shell-completion install, and a
"Run 'bun --help' to get started" message. Requires `unzip`; uses `set -euo pipefail` and
TTY-conditional colorized errors; detects Rosetta 2 on macOS.

### Deno (`deno.land/install.sh`)

Similar `uname -sm` detection plus a `Windows_NT` branch:

```sh
if [ "$OS" = "Windows_NT" ]; then
    target="x86_64-pc-windows-msvc"
else
    case $(uname -sm) in
    "Darwin x86_64") target="x86_64-apple-darwin" ;;
    "Darwin arm64") target="aarch64-apple-darwin" ;;
    "Linux aarch64") target="aarch64-unknown-linux-gnu" ;;
    *) target="x86_64-unknown-linux-gnu" ;;
    esac
fi
```

Downloads a prebuilt zip (`curl --fail --location --progress-bar --output "$exe.zip"
"$deno_uri"`), extracts with `unzip` or falls back to `7z x`. Supports `--no-modify-path` to
skip PATH mutation. Runs a post-install version-gate check using the freshly downloaded binary
itself:

```sh
$exe eval 'const [major, minor] = Deno.version.deno.split("."); if (major < 2 && minor < 42) Deno.exit(1)'
```

### Rustup (`sh.rustup.rs`)

A minimal bootstrap shim — the real logic lives in a downloaded second-stage `rustup-init`
binary. The outer shell script:

- Detects OS/arch via `uname` plus ELF binary analysis (distinguishing musl vs glibc,
  32-/64-bit userlands), including Rosetta 2 special-casing on macOS.
- Builds a download URL (`"${RUSTUP_UPDATE_ROOT}/dist/${_arch}/rustup-init${_ext}"`), fetches
  with `curl`, falling back to `wget`, with retry logic.
- Handles `/tmp` mounted `noexec` by copying the binary somewhere executable first.
- Explicitly connects `/dev/tty` so interactive prompts still work even though the script
  itself arrived via a piped `curl ... | sh`.
- Parses top-level flags (`--quiet`, `--help`, `-y` to skip confirmation) and forwards
  platform overrides to the second-stage binary.
- Notably does **not** itself check for an existing install, does **not** modify `PATH`, and
  performs **no** signature verification — all deferred to the downloaded `rustup-init`, which
  historically writes `~/.cargo/env`, sourced by the shell rc.

### Common pattern across bun / deno / rustup

1. Detect OS + CPU arch (and sometimes libc/CPU-feature variant) via `uname`.
2. Download a prebuilt, platform-specific binary/archive over HTTPS with `curl` (`wget`/`7z`
   fallbacks where relevant) — none of these compile from source or require a package manager
   at install time.
3. Install into a per-user directory under `$HOME` (`~/.bun/bin`, `~/.deno/bin`,
   `~/.cargo/bin`) — no root/`sudo` needed.
4. Mutate the user's shell rc file(s) to add the install dir to `PATH` (bun/deno do this
   directly; rustup defers to a sourced `~/.cargo/env`).
5. Verify via `command -v <tool>` and/or a version check; print next-step guidance.
6. Defensive scripting throughout: `set -euo pipefail` (or equivalent), explicit error
   functions, checks for required external tools, TTY-aware colored output, and handling
   `noexec /tmp` / piped-stdin edge cases.

### Applying this to autoqq's `install.sh`

autoqq is an **npm package**, not a standalone compiled binary, so the script diverges from
the bun/deno "download a prebuilt binary" pattern at step 2 — but should keep steps 1, 3–6:

1. Detect distro/arch only as needed to pick a Node install method (not to pick an autoqq
   binary, since npm packages are OS/arch-agnostic at the package level).
2. **Check for Node.js and the minimum required version** (e.g. via `node --version`); if
   missing or too old, either instruct the user to install Node via their distro's package
   manager / nvm, or (mirroring bun/deno's self-sufficiency) offer to install a
   user-local Node via a method that needs no root (e.g. nvm, or fnm).
3. Run `npm install -g autoqq` (a global npm install already places the binary on `PATH` via
   npm's own global bin directory — so unlike bun/deno there is typically no manual `PATH`
   line-appending needed, *unless* npm's global prefix itself isn't on `PATH`, which the
   script should detect and offer to fix, following the same "append export PATH=... to rc
   file" pattern bun/deno use).
4. Run `autoqq init` (or equivalent) as a follow-up step to install the systemd user units and
   run `loginctl enable-linger` (§2) — this is the autoqq-specific analogue of bun's
   "shell completions + finishing message" step.
5. Verify with `command -v autoqq` and `autoqq --version`; print next-step guidance
   (e.g. "run `autoqq setup` to configure your schedule").
6. Use the same defensive-scripting posture: `set -euo pipefail`, explicit `error()` helper,
   required-tool checks (`node`, `npm`, `curl`), TTY-conditional colored output.

**Sources**: [bun.sh/install](https://bun.sh/install),
[deno.land/install.sh](https://deno.land/install.sh), [sh.rustup.rs](https://sh.rustup.rs)

---

## Summary recommendation for autoqq

1. **Scheduler**: generate and install per-user `systemd` `.service` + `.timer` unit pairs
   under `~/.config/systemd/user/` for both the daily-message job and the renewal job (two
   independent timer pairs, or one timer with `OnUnitActiveSec=` chaining — evaluate against
   the exact cool-down semantics), enabled via `systemctl --user enable --now`, with
   `Persistent=true` for catch-up-after-reboot and `RandomizedDelaySec=` for fleet-wide jitter.
   The installer must also run `loginctl enable-linger "$USER"` so timers keep firing on a
   headless server with no active login session — this is the single most important
   correctness requirement and the most commonly missed step in similar tools' docs.
2. **Timezone**: let `systemd`'s own calendar-time engine (`OnCalendar=`) resolve the
   user-configured IANA timezone and DST correctly (it inherits the system/user TZ and is
   DST-aware natively); use `Intl.supportedValuesOf('timeZone')` purely for the setup-time
   picker/validation UI, not as the runtime scheduling engine.
3. **Logging**: use `pino` for both logs, with `pino-roll` for self-contained rotation (no
   root-owned `/etc/logrotate.d/` dependency), writing to
   `~/.local/state/autoqq/logs/cli.log` and `~/.local/state/autoqq/logs/scheduler.log` per the
   XDG Base Directory Specification's own "logs belong in state" guidance.
