<p align="center">
  <img src="logo.jpg" alt="autoqq" width="720">
</p>

> **PSA:** Always say hi to your coding agent 👋 — it's polite, it's free, and it's
> literally the whole trick this tool automates for you, every few hours, forever.

<p align="center">
  <strong>server wake up first. you sleep more. rate limit same.</strong>
</p>

<p align="center">
  Linux CLI. Pre-warm your AI coding tool's rate-limit window before you sit down.<br>
  Same 9-hour workday. <strong>3 windows instead of 2.</strong> Free. Zero manual grunt.
</p>

<p align="center">
  <a href="https://github.com/Migiht/autoqq/stargazers"><img src="https://img.shields.io/github/stars/Migiht/autoqq?style=flat&color=yellow" alt="Stars"></a>
  <a href="https://github.com/Migiht/autoqq"><img src="https://img.shields.io/github/languages/top/Migiht/autoqq?style=flat&color=blue" alt="Top language"></a>
  <a href="https://github.com/Migiht/autoqq/actions/workflows/ci.yml"><img src="https://github.com/Migiht/autoqq/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@migiht/autoqq"><img src="https://img.shields.io/npm/v/@migiht/autoqq?style=flat&color=cb3837" alt="npm"></a>
  <a href="#supported-tools"><img src="https://img.shields.io/badge/works_with-claude_%7C_codex_%7C_opencode-orange?style=flat" alt="works with"></a>
  <a href="https://github.com/Migiht/autoqq/commits/main"><img src="https://img.shields.io/github/last-commit/Migiht/autoqq?style=flat" alt="Last commit"></a>
  <a href="#license"><img src="https://img.shields.io/github/license/Migiht/autoqq?style=flat" alt="License"></a>
</p>

<p align="center">
  <a href="#how-you-get-33">See it</a> ·
  <a href="#install">Install</a> ·
  <a href="#setup">Setup</a> ·
  <a href="#how-the-schedule-actually-runs">How it runs</a> ·
  <a href="#logs">Logs</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#supported-tools">Tools</a> ·
  <a href="#license">License</a>
</p>

---

`autoqq` sit on always-on Linux box. Ask few question once. Then quiet — sends one-token
"keep-alive" grunt to Claude Code, Codex CLI, or opencode on a `systemd` timer, before you
even open laptop. Clock already ticking when you arrive.

## How you get +33%

Tool meter usage in **rolling window** (5h default). Window start at first message,
run out 5h later, then reset. You only ever poke it when you sit down → you catch
maybe two windows in a 9h day, dead air in between.

**Normal day** — 9h workday (`08:00`–`17:00`), nobody wakes the tool early. Window
#1 fits clean, window #2 doesn't:

```
        08   09   10   11   12   13   14   15   16   17
        ├────┼────┼────┼────┼────┼────┼────┼────┼────┤
window#1│████████████████████│
        │  used all 5h, done  │
window#2│                     │    │████████████████████│
        │                     │dead│ only 3h of 5h fit — 2h wasted after 17:00
```

`08:00` window #1 starts, burns all 5h by `13:00`. Dead from `13:00`–`14:00`, clock
not ticking, nothing to show for it. `14:00` you poke the tool again, window #2
starts — but the workday ends at `17:00`, so only 3h of its 5h get used; the other 2h
burn on into the evening with nobody there to spend them.

→ **2 windows** inside the workday, 1h dead in the middle, 2h thrown away at the end.

**autoqq day** — same 9h workday, `autoqq` pings at `05:00`, `10:00`, `15:00`. Three
windows, and every workday hour sits inside a fresh one:

```
        08   09   10   11   12   13   14   15   16   17
        ├────┼────┼────┼────┼────┼────┼────┼────┼────┤
window#1│████████│
        │ tail of a window that started 05:00, asleep │
window#2         │████████████████████████████████│
                  │       full 5h, all yours         │
window#3                                             │████████│
                                                       │ tail, runs on past 17:00 │
```

`05:00` `autoqq` grunts `"qq"` while you sleep, window #1 starts — you only catch its
last 2h (`08:00`–`10:00`). `10:00` `autoqq` grunts again, window #2 starts completely
fresh and you get the full 5h (`10:00`–`15:00`). `15:00` `autoqq` grunts once more,
window #3 starts fresh — you catch its first 2h (`15:00`–`17:00`) before the workday
ends; the remaining 3h run on after you've logged off, unused but yours if you need
them.

## Requirements

- **Linux only**, user-level `systemd` (`systemctl --user` must work). This is what
  survives reboot, runs with zero resident process between pings.
- Always-on machine (or at least on during work hours) — home server, VPS, cloud dev
  box. Scheduled ping no help if machine itself off when it should fire.

## Install

One line. Installer checks Node itself, offers to install/upgrade it for you.

```sh
curl -fsSL https://raw.githubusercontent.com/Migiht/autoqq/refs/heads/main/install.sh | sh
autoqq init
```

Or straight from npm:

```sh
npm install -g @migiht/autoqq
autoqq init
```

## Setup

### 1. `autoqq init`

One-time interactive wizard (built on `@clack/prompts`). Five question, Enter takes
default every time:

| Step | Prompt | Default (just press Enter) |
|---|---|---|
| 1 | Your timezone — searchable list of every IANA zone, or type fixed offset like `+3` | your system's current timezone |
| 2 | Rate-limit window size, in hours | `5` |
| 3 | What time you usually start work (`HH:MM`, your timezone) | `8:00` |
| 4 | How many hours of window to still have left when you start | `2` |
| 5 | Custom keep-alive message | `qq` |

Timezone step called out in orange on purpose — enter **your** timezone, not server's,
since whole schedule computed relative to it. Arrow keys navigate the picker, or just
type to filter (`berlin` jumps to `Europe/Berlin`, `+3` jumps to fixed `UTC+3` entry).

`init` writes answer to `~/.config/autoqq/config.json`, generates pair of
`systemd --user` unit files, runs `loginctl enable-linger` so schedule keeps firing
even with no active SSH session.

### 2. `autoqq install <tool>`

Connect one AI coding CLI at a time (`claude`, `codex`, or `opencode`):

```sh
autoqq install claude
```

This:
1. Check if tool's binary already on `PATH`; if not, offer `npm install -g` it (Enter
   to accept).
2. Run tool's own interactive login — real browser/device auth flow, you sign in
   yourself, `autoqq` never touch your credentials.
3. Verify login succeeded by checking tool's own credential file (e.g.
   `~/.claude/.credentials.json`).
4. Register `systemd --user` timer that runs `autoqq ping claude` at every computed
   time in your schedule.

Repeat for as many tool as you use:

```sh
autoqq install codex
autoqq install opencode
```

### 3. `autoqq status`

Show current schedule, computed daily ping time, which tools installed, live
`systemctl --user list-timers` output — see exactly when next ping fire.

## How the schedule actually runs

`autoqq init`/`install` generate two templated `systemd --user` unit in
`~/.config/systemd/user/`:

- `autoqq-ping@.service` — `Type=oneshot` unit, runs `autoqq ping %i` (`%i` = tool id,
  e.g. `claude`).
- `autoqq-ping@.timer` — one `OnCalendar=` line per computed ping time, each with your
  configured IANA timezone attached directly (`OnCalendar=*-*-* 10:00:00
  Europe/Berlin`), so systemd's own calendar engine — not `autoqq` — handle daylight
  saving correctly. `Persistent=true` means missed ping (machine was off) gets caught
  up on next boot.

Installing a tool enable its own timer instance (`autoqq-ping@claude.timer`,
`autoqq-ping@codex.timer`, ...), all driven by same shared schedule.

## Logs

`autoqq` keep two separate, self-rotating log file (via `pino` + `pino-roll`, daily
rotation, 10 MB cap, 5 file retained) under `~/.local/state/autoqq/logs/`:

- `cli.log` — everything you do interactive: `init`, `install`, `status`.
- `scheduler.log` — every scheduled ping: which tool, succeeded or not, how long took.

Scheduled run also show up in normal systemd journal:

```sh
journalctl --user -u autoqq-ping@claude.service -f
```

## Commands

```
autoqq init              interactive setup wizard (timezone, schedule, greeting)
autoqq install <tool>    install/authenticate/schedule a tool (claude | codex | opencode)
autoqq status             show schedule, installed tools, next ping times
autoqq uninstall [tool]   remove one tool's schedule, or (no argument) remove autoqq entirely
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
autoqq uninstall
```

Stops every scheduled ping, removes the systemd units, and uninstalls the `autoqq` npm
package — no manual `systemctl`/`rm` needed. Add `-y` to skip the confirmation prompt.

To drop just one tool and keep the rest running:

```sh
autoqq uninstall claude
```

Either way, `~/.config/autoqq/` and `~/.local/state/autoqq/logs/` are left in place on
purpose — remove those too if you want a completely clean slate.

## License

MIT

---

<sub>Autoqq no phone home. No telemetry beyond the ping the tool itself already logs.
Rock stays sharp. Clock stays yours.</sub>
