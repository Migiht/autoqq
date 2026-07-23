# autoqq

**Get an extra rate-limit window out of every workday, for free.**

`autoqq` is a Linux CLI that pre-warms the rolling usage window of your AI coding
assistant (Claude Code, Codex CLI, opencode) before you sit down to work. It installs
once on an always-on Linux box, asks a handful of questions in an interactive wizard,
and then quietly sends a one-token "keep-alive" message on a schedule — driven by
`systemd` user timers — so the clock is already ticking by the time you open your
editor.

## The idea

Tools like Claude Code meter usage in **rolling windows** (5 hours by default): the
window starts at your first message and everything you do counts against that one
allowance until it expires, at which point a fresh window begins. If you only ever
start working when you sit down at your desk, you get roughly two windows out of a
9-hour workday, with a dead stretch in between where you're waiting on a reset.

`autoqq` starts the window *before* you arrive, and renews it automatically for the
rest of the day. Example, with the defaults (5-hour window, 2 hours left at start of
work):

```
05:00  autoqq sends "qq" → window #1 starts (5h)
       ...you're asleep...
08:00  you sit down to work — window #1 already has 2h left
08:00–10:00  you work using the remaining 2h of window #1
10:00  autoqq sends "qq" → window #2 starts, fresh 5h
10:00–15:00  you work using all of window #2
15:00  autoqq sends "qq" → window #3 starts, fresh 5h
15:00–17:00  you work using 2h of window #3, workday ends
```

(`autoqq` keeps renewing every 5h all day, every day — e.g. also at `20:00` and
`01:00` here — so the window is always fresh whenever you actually start working,
even if that day runs long or starts early.)

**Result: 3 rate-limit windows instead of 2, covering the same 9-hour workday — a
~33% increase in available hours, at the cost of a few automated one-line prompts
that fire while you're not even looking at the screen.**

This works because `autoqq` computes a schedule that pings every `windowHours`,
anchored so exactly `leaveHours` remain in the window at your configured work-start
time — not because it does anything special to the provider's rate limiter itself.
It's a scheduling trick, not a bypass: every ping is a real, cheap prompt sent through
the tool's own official CLI and counts normally against your plan.

> Only **Claude Code** currently documents a rolling multi-hour window this way, which
> makes it the strongest case for `autoqq`. Codex CLI temporarily lost its 5-hour
> window in July 2026 (a weekly cap remains); `autoqq` still supports it since that can
> change back. `opencode` has no window of its own — pinging it pre-warms whichever
> upstream provider/API key it's configured to use.

## Requirements

- **Linux only**, with a user-level `systemd` (i.e. `systemctl --user` works). This is
  what makes the schedule survive reboots and run with zero resident processes between
  pings.
- Node.js **>= 20.12**.
- An always-on (or at least on-during-work-hours) machine — a home server, a personal
  VPS, a cloud dev box. Scheduling a wake-up ping doesn't help if the machine itself is
  off when it needs to fire.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/Migiht/autoqq/refs/heads/main/install.sh | sh
autoqq init
```

Or via npm directly:

```sh
npm install -g autoqq
autoqq init
```

## Setup

### 1. `autoqq init`

A one-time interactive wizard (built with `@clack/prompts`) asks:

| Step | Prompt | Default (just press Enter) |
|---|---|---|
| 1 | Your timezone — searchable list of every IANA zone, or type a fixed offset like `+3` | your system's current timezone |
| 2 | Rate-limit window size, in hours | `5` |
| 3 | What time you usually start work (`HH:MM`, your timezone) | `8:00` |
| 4 | How many hours of the window to still have left when you start | `2` |
| 5 | Custom keep-alive message | `qq` |

The timezone step is deliberately called out in orange — enter **your** timezone, not
the server's, since that's what the whole schedule is computed relative to. Navigate
the timezone/tool pickers with the arrow keys, or just type to filter (e.g. typing
`berlin` jumps to `Europe/Berlin`, typing `+3` jumps to the fixed `UTC+3` entry).

`init` writes your answers to `~/.config/autoqq/config.json`, generates a pair of
`systemd --user` unit files, and runs `loginctl enable-linger` so the schedule keeps
firing even with no active SSH session.

### 2. `autoqq install <tool>`

Connect one AI coding CLI at a time (`claude`, `codex`, or `opencode`):

```sh
autoqq install claude
```

This:
1. Checks whether the tool's binary is already on `PATH`; if not, offers to
   `npm install -g` it (press Enter to accept).
2. Runs that tool's own interactive login (a real browser/device auth flow — you sign
   in yourself, `autoqq` never touches your credentials).
3. Verifies the login succeeded by checking the tool's own credential file
   (e.g. `~/.claude/.credentials.json`).
4. Registers a `systemd --user` timer that runs `autoqq ping claude` at every computed
   time in your schedule.

Repeat for as many tools as you use:

```sh
autoqq install codex
autoqq install opencode
```

### 3. `autoqq status`

Shows your current schedule, the computed daily ping times, which tools are
installed, and the live `systemctl --user list-timers` output so you can see exactly
when the next ping fires.

## How the schedule actually runs

`autoqq init`/`install` generate two templated `systemd --user` units in
`~/.config/systemd/user/`:

- `autoqq-ping@.service` — a `Type=oneshot` unit that runs `autoqq ping %i` (`%i` is
  the tool id, e.g. `claude`).
- `autoqq-ping@.timer` — one `OnCalendar=` line per computed ping time, each with your
  configured IANA timezone attached directly (`OnCalendar=*-*-* 10:00:00
  Europe/Berlin`), so systemd's own calendar engine — not `autoqq` — handles daylight
  saving time correctly. `Persistent=true` means a ping that was missed because the
  machine was off gets caught up on next boot.

Installing a tool enables its own timer instance (`autoqq-ping@claude.timer`,
`autoqq-ping@codex.timer`, ...), all driven by the same shared schedule.

## Logs

`autoqq` keeps two separate, self-rotating log files (via `pino` + `pino-roll`, daily
rotation, 10 MB cap, 5 files retained) under
`~/.local/state/autoqq/logs/`:

- `cli.log` — everything you do interactively: `init`, `install`, `status`.
- `scheduler.log` — every scheduled ping: which tool, whether it succeeded, how long
  it took.

Scheduled runs also show up in the normal systemd journal:

```sh
journalctl --user -u autoqq-ping@claude.service -f
```

## Commands

```
autoqq init              interactive setup wizard (timezone, schedule, greeting)
autoqq install <tool>    install/authenticate/schedule a tool (claude | codex | opencode)
autoqq status             show schedule, installed tools, next ping times
autoqq ping <tool>        internal — sends one keep-alive message (called by systemd)
```

## Supported tools

| Tool | Binary | Ping command |
|---|---|---|
| Claude Code | `claude` | `claude --bare -p "<greeting>"` |
| Codex CLI | `codex` | `codex exec --skip-git-repo-check "<greeting>"` |
| opencode | `opencode` | `opencode run "<greeting>"` |

## Uninstalling

```sh
systemctl --user disable --now 'autoqq-ping@*.timer'
rm ~/.config/systemd/user/autoqq-ping@.{service,timer}
systemctl --user daemon-reload
npm uninstall -g autoqq
```

Your `~/.config/autoqq/` config and `~/.local/state/autoqq/logs/` are left in place —
remove them too if you want a completely clean slate.

## License

MIT
