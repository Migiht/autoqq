# TypeScript CLI Tooling Research (2026)

Research for building `autoqq`, a Linux-only TypeScript CLI published to npm (and via `curl | sh`), with subcommands `init`, `install <tool>`, and a background scheduler service.

---

## 1. Argument/subcommand parsing library

### Recommendation: **Commander.js**

For an npm-published CLI expected to be installed by thousands of users, Commander.js remains the default 2026 recommendation:

- **Zero dependencies.** When you publish a CLI that depends on Commander, users install nothing extra transitively — smaller install footprint, fewer supply-chain risk surfaces. Yargs pulls in several sub-packages and has a larger total install size.
- **~35M weekly downloads**, the most widely used and battle-tested option, with excellent TypeScript typings (including type-level command argument inference in modern versions).
- **Minimal API surface** that doesn't fight you — you can bolt on exactly what you need (custom validators, coercion) instead of adopting a framework's opinions.
- Guidance from CLI-comparison writeups in 2026: *"Commander is the better choice when building a CLI that ships as part of an npm library or as a standalone installable tool. Yargs is the better choice when building an internal tool ... where built-in validation, shell completion, and detailed help text matter more than package weight."* The general advice is to start with Commander and only reach for a heavier framework (e.g. oclif) if you find yourself reimplementing plugin/validation infrastructure across many commands.

**Alternatives considered:**
- **yargs** (~30M downloads) — richer built-in middleware, type coercion, and validation, but heavier install size and more "magic." Better suited to internal tooling than a lean public CLI.
- **citty** (unjs) — a modern, zero-dependency, TypeScript-first CLI builder built on native Node.js arg parsing (`defineCommand`, lazy-loaded `subCommands`, auto-generated `--help`/`--version`). Attractive if you're already in the UnJS ecosystem (e.g. using `unbuild`), but smaller community/ecosystem and less proven at scale than Commander.
- **cac** — very lightweight ("Command And Conquer"), nice git-style subcommand API (`cli.command('install <tool>', 'Install a tool')`), good for small tools, but less mature TypeScript support and smaller community than Commander.

### Code example: `init` and `install <tool>` subcommands

```typescript
#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("autoqq")
  .description("Interactive setup and installer for AI coding CLIs")
  .version("1.0.0");

// `autoqq init` — no positional args, interactive wizard
program
  .command("init")
  .description("Run the interactive setup wizard")
  .action(async () => {
    const { runInitWizard } = await import("../commands/init.js");
    await runInitWizard();
  });

// `autoqq install <tool>` — single required positional argument
program
  .command("install <tool>")
  .description("Install and configure a target AI coding CLI")
  .option("-y, --yes", "skip confirmation prompts")
  .action(async (tool: string, options: { yes?: boolean }) => {
    const { runInstall } = await import("../commands/install.js");
    await runInstall(tool, options);
  });

program.parse();
```

The action handler receives one parameter per declared command-argument, followed by the parsed options object and the `Command` instance itself. Lazy-loading command modules via dynamic `import()` inside the action keeps CLI startup fast as more subcommands are added.

**Sources:**
- [Commander.js Readme](https://github.com/tj/commander.js/blob/master/Readme.md)
- [Commander vs Yargs in 2026 — PkgPulse Guides](https://www.pkgpulse.com/guides/commander-vs-yargs-2026)
- [CLI Framework Comparison: Commander vs Yargs vs Oclif](https://www.grizzlypeaksoftware.com/library/cli-framework-comparison-commander-vs-yargs-utxlf9v9)
- [unjs/citty — Elegant CLI Builder](https://github.com/unjs/citty)
- [cacjs/cac Readme](https://github.com/cacjs/cac/blob/main/README.md)

---

## 2. Build/bundling setup

### Recommendation: **tsdown** (successor to tsup)

- **tsup is no longer actively maintained**; its own maintainers and the wider ecosystem now point users to **tsdown**. Migration is close to a drop-in rename (`tsup.config.ts` → `tsdown.config.ts`, swap the import).
- tsdown is built on **Rolldown** (Vite's Rust-based bundler successor to Rollup) — it's ESM-first and is the tool Evan You has signaled as the long-term path as the Vite ecosystem migrates off Rollup/esbuild.
- tsup/older tools are CJS-first with ESM support bolted on; tsdown does ESM correctly out of the box, which matters since **Node 22 LTS treats ESM as the stable default** (native `require(esm)` interop also landed).
- Zero/low config: generates the bundled JS output (and `.d.ts` if you're also shipping a library surface) from a single `entry` array.

### Minimal `tsdown.config.ts` for a CLI

```typescript
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: "esm",
  platform: "node",
  target: "node20",
  clean: true,
  // Keeps the shebang line from src/cli.ts intact in dist output
  shims: false,
});
```

`src/cli.ts` should start with:

```typescript
#!/usr/bin/env node
```

tsdown/esbuild-family bundlers preserve a leading shebang comment in the emitted file automatically — no extra plugin needed for a plain "bundle to one JS file with shebang" setup.

### `package.json` `bin` field

```json
{
  "name": "autoqq",
  "type": "module",
  "bin": {
    "autoqq": "./dist/cli.js"
  },
  "files": ["dist"],
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsdown"
  }
}
```

After `npm install -g autoqq` (or local `npm link`), npm makes `dist/cli.js` executable and symlinks it onto `PATH` as `autoqq`, using the shebang to invoke `node`.

### ESM vs CJS in 2026

- Node 20/22 LTS: ship `"type": "module"` + native ESM (`format: "esm"`). This is now the mainstream default for new CLIs — avoids the historical CJS/ESM interop pitfalls, and Commander, most `unjs` libraries, and the modern npm ecosystem are ESM-first or dual-published.
- Only fall back to CJS output if a dependency you must use is CJS-only and doesn't interop cleanly (rare in 2026, since `require(esm)` is now supported and most popular packages ship ESM).

### Alternative: Node Single Executable Applications (SEA) via `tsdown --exe`

Since `autoqq` is also installed via `curl | sh`, it's worth knowing tsdown has an experimental **`exe`** option that uses Node's Single Executable Applications feature to produce a genuine standalone native binary (no Node.js runtime required on the target machine):

```typescript
export default defineConfig({
  entry: ["src/cli.ts"],
  exe: { fileName: "autoqq" },
});
```

This requires Node.js ≥ 25.7.0 at *build* time and disables `dts`/code-splitting/multi-entry. For a curl-install script it's tempting, but given the tool is also npm-published (where you want a normal `bin` script, not a multi-hundred-MB binary), the practical recommendation is: **bundle to plain JS with tsdown for the npm package**, and have the `curl | sh` installer simply do `npm install -g autoqq` (or download the npm tarball) rather than shipping a separate SEA binary — one build artifact, one code path, less to maintain.

**Sources:**
- [tsdown — The Elegant Bundler for Libraries](https://tsdown.dev/guide/)
- [tsdown exe option docs](https://tsdown.dev/options/exe)
- [Switching from tsup to tsdown — Alan Norbauer](https://alan.norbauer.com/articles/tsdown-bundler/)
- [tsup vs tsdown vs unbuild 2026 — PkgPulse Guides](https://www.pkgpulse.com/guides/tsup-vs-tsdown-vs-unbuild-typescript-library-bundling-2026)
- [ESM vs CommonJS in 2026 — Webcoderspeed](https://webcoderspeed.com/blog/scaling/esm-to-cjs-interop-2026)

---

## 3. Recommended project structure

A conventional, scalable layout for a multi-command TS CLI:

```
autoqq/
├── src/
│   ├── cli.ts                 # entry point: builds Commander program, registers commands
│   ├── commands/
│   │   ├── init.ts            # `autoqq init` wizard (uses @clack/prompts)
│   │   ├── install.ts         # `autoqq install <tool>`
│   │   └── scheduler.ts       # background scheduler subcommand(s)
│   ├── lib/
│   │   ├── config.ts          # XDG config read/write (wraps `conf`/`env-paths`)
│   │   ├── tools/              # per-target-CLI installer definitions
│   │   │   ├── claude-code.ts
│   │   │   └── vercel-cli.ts
│   │   ├── process.ts         # spawn helpers, PATH detection
│   │   └── logger.ts
│   ├── utils/
│   │   └── strings.ts         # small stateless helpers shared across commands/lib
│   └── types.ts
├── dist/                       # tsdown build output (gitignored)
├── scripts/
│   └── install.sh              # the `curl | sh` installer script
├── package.json
├── tsdown.config.ts
├── tsconfig.json
└── docs/
```

Guidelines:
- **`src/commands/`** — one file per CLI subcommand; each file exports a single async function the entry point wires into Commander via lazy `import()`. Keeps the entry file from becoming a giant switch statement as commands grow.
- **`src/lib/`** — core domain logic (config persistence, installer logic per target tool, process/PATH utilities). This is what commands call into, and what unit tests target directly (independent of Commander/CLI parsing).
- **`src/utils/`** — small, stateless, cross-cutting helpers (string/formatting/date helpers) with no domain knowledge.
- Keep `src/cli.ts` thin: construct the Commander program, register commands, `program.parse()`. No business logic here.

**Sources:**
- [nodejs-cli-apps-best-practices (lirantal)](https://github.com/lirantal/nodejs-cli-apps-best-practices)
- [Building a CLI with Node.js — Evgeni Gomziakov](https://gomzkov.medium.com/building-a-cli-with-node-js-in-2024-c278802a3ef5)

---

## 4. Detecting a binary on PATH + installing global npm packages programmatically

### Detecting a binary on PATH: use `which` (npm package)

Rolling your own by shelling out to `command -v foo` or `which foo` works but is Unix-only and fragile to quote/parse. Since `autoqq` is Linux-only this is viable, but the npm package **`which`** (the same resolution logic npm itself uses) is the standard, well-maintained cross-platform-safe choice and avoids spawning a subprocess just to check existence:

```typescript
import { which } from "which"; // or: import which from "which"

// Returns the resolved path, or null instead of throwing when not found
export async function findOnPath(bin: string): Promise<string | null> {
  return which(bin, { nothrow: true });
}

// Sync variant, same nothrow semantics
export function findOnPathSync(bin: string): string | null {
  return which.sync(bin, { nothrow: true });
}
```

By default `which()`/`which.sync()` **throw** `ENOENT` if the executable isn't found; pass `{ nothrow: true }` to get `null` back instead. This is preferable to invoking the target binary with `--version` to "probe" it — that fails for binaries with no version flag and is slower (spawns a real process).

### Installing global npm packages from Node

Spawn `npm install -g <pkg>` as a child process rather than trying to call npm's internal API (unsupported/unstable across npm versions). Use Node's `child_process` (or the `execa` package for a nicer async/streaming API) and stream output so the user sees progress:

```typescript
import { execa } from "execa";

export async function installGlobalPackage(pkg: string): Promise<void> {
  await execa("npm", ["install", "-g", pkg], {
    stdio: "inherit", // stream npm's own progress/output to the user
  });
}
```

Notes for an "enterprise-grade" installer:
- Always resolve/verify `npm` itself is on PATH first via the `which` helper above, and fail with a clear error message pointing at Node/npm install instructions if missing.
- Prefer `stdio: "inherit"` (or capture + relay) so users get npm's native progress bars/errors rather than a silent hang.
- Consider detecting and respecting an existing global package manager the user already uses for global installs (npm vs pnpm vs corepack-shimmed installs) — at minimum, document that `autoqq install <tool>` uses `npm i -g` under the hood.
- Wrap the spawn in try/catch and surface `execa`'s `exitCode`/`stderr` to the user instead of a raw stack trace.

**Sources:**
- [which — npm package](https://www.npmjs.com/package/which) / [npm/node-which](https://github.com/npm/node-which)
- [Checking if an executable exists in PATH using Node.js — abdus.dev](https://abdus.dev/posts/checking-executable-exists-in-path-using-node/)
- [springernature/hasbin](https://github.com/springernature/hasbin) (alternative, less actively maintained)

---

## 5. Config/state file storage: XDG Base Directory spec

### Recommendation: **`conf`** (built on `env-paths`) for config; XDG paths directly for state/logs

Since `autoqq` is explicitly Linux-only, following the **XDG Base Directory specification** is the correct target:

| Purpose | XDG variable | Default | 
|---|---|---|
| Config | `$XDG_CONFIG_HOME` | `~/.config` |
| State (logs, scheduler run history) | `$XDG_STATE_HOME` | `~/.local/state` |
| Cache | `$XDG_CACHE_HOME` | `~/.cache` |
| Data | `$XDG_DATA_HOME` | `~/.local/share` |

Library choice:
- **[`conf`](https://github.com/sindresorhus/conf)** (by sindresorhus) — a complete config management solution: atomic JSON read/write, schema validation, migrations, defaults. It uses **`env-paths`** internally to pick the OS-appropriate config directory, and on Linux that resolves to `$XDG_CONFIG_HOME` (defaulting to `~/.config/<app-name>`), i.e. exactly `~/.config/autoqq/config.json` for this project. This is the pragmatic choice: don't hand-roll JSON read/write/atomic-save logic.
- **[`env-paths`](https://github.com/sindresorhus/env-paths)** — the lower-level primitive `conf` is built on. Use it directly (without `conf`) for the **state/log directory**, since `conf` itself is scoped to config only:

  ```typescript
  import envPaths from "env-paths";

  const paths = envPaths("autoqq", { suffix: "" }); // suffix:"" avoids the default "-nodejs" suffix
  // paths.config -> ~/.config/autoqq
  // paths.data   -> ~/.local/share/autoqq
  // paths.cache  -> ~/.cache/autoqq
  // paths.log    -> ~/.local/state/autoqq (env-paths maps "log" to XDG state dir)
  ```

- There's also **`xdg-basedir`** (sindresorhus) and **`@folder/xdg`** if you want *raw* XDG path resolution without any macOS/Windows fallback behavior — appropriate here since the project is explicitly Linux-only, but `env-paths`/`conf` already resolve correctly on Linux and give you a migration path for free if `autoqq` ever needs to run on macOS/WSL later, so there's little reason to hand-code XDG parsing.

### Example wiring

```typescript
// src/lib/config.ts
import Conf from "conf";
import envPaths from "env-paths";
import path from "node:path";

export interface AutoqqConfig {
  installedTools: string[];
  scheduler: { enabled: boolean; intervalMinutes: number };
}

export const config = new Conf<AutoqqConfig>({
  projectName: "autoqq", // -> ~/.config/autoqq/config.json
  defaults: {
    installedTools: [],
    scheduler: { enabled: false, intervalMinutes: 60 },
  },
});

const paths = envPaths("autoqq", { suffix: "" });
export const stateDir = paths.log;               // ~/.local/state/autoqq
export const logFile = path.join(stateDir, "autoqq.log");
```

**Sources:**
- [conf — npm](https://www.npmjs.com/package/conf) / [sindresorhus/conf](https://github.com/sindresorhus/conf)
- [env-paths — npm](https://www.npmjs.com/package/env-paths)
- [xdg-basedir — sindresorhus](https://github.com/sindresorhus/xdg-basedir)
- [nodejs/node XDG discussion #59334](https://github.com/nodejs/node/issues/59334)

---

## Summary of recommendations

| Concern | Choice |
|---|---|
| Arg/subcommand parsing | **Commander.js** |
| Bundler | **tsdown** (ESM output, `format: "esm"`, `platform: "node"`) |
| Package format | ESM, `"type": "module"`, `bin` pointing at bundled `dist/cli.js` with shebang |
| Project structure | `src/{cli.ts, commands/, lib/, utils/}` |
| PATH detection | `which` npm package (`nothrow: true`) |
| Programmatic global installs | spawn `npm install -g <pkg>` via `execa`, `stdio: "inherit"` |
| Config storage | `conf` → `~/.config/autoqq/config.json` |
| State/log storage | `env-paths` → `~/.local/state/autoqq` |
