# XingYuan for DeepSeek Harness

[![npm version](https://img.shields.io/npm/v/@starwish-ai/xingyuan-dsh)](https://www.npmjs.com/package/@starwish-ai/xingyuan-dsh)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/starwish-ai/xingyuan-dsh/actions/workflows/ci.yml/badge.svg)](https://github.com/starwish-ai/xingyuan-dsh/actions/workflows/ci.yml)

[简体中文](./README.md) | English

XingYuan is a wish & habit-building companion, shipped as a DeepSeek Harness plugin bundle + agent preset.

## Features

- **Conversation-driven**: create wishes / tasks in natural language with duplicate detection
- **Opportunity-day check-ins**: check-in, make-up, cancel, and future pre-checks; progress always recomputed against today
- **Commitment-based progress**: only claimed tasks count; a wish achieves when everything committed is done and nothing is left to claim — full progress with unclaimed tasks leaves it "wrapping up" for your call (claim to continue, or delete to achieve), never nagging, never deciding for you
- **Micro-actions**: break an overwhelming goal into 3–7 tiny steps and walk through them guided
- **Growth system**: levels Lv.1–Lv.10, streak bonuses, stat cards, 30-day bar chart
- **Session view tabs**: Today / Wishes / Tasks / Calendar / Growth / Memory — buttons call action endpoints directly; shown only in XingYuan-preset sessions by default, switchable to always show/hide and per-tab in Settings
- **Memory**: important memories injected into context (limit configurable), full CRUD
- **Charts**: 15 chart types rendered as cards
- **Safe writes**: write confirmation is per-category (create / check-in / undo / claim / edit / save memory); deletion always confirms and cannot be turned off; defaults match previous versions
- **Theming**: light/dark follows the app theme

Tools are only mounted on sessions using the XingYuan preset; other sessions are unaffected.

## Install

> Requires DeepSeek Harness `0.1.7-rc.1` (peer dependencies — including the host's
> client-half packages — are pinned to that release; 0.1.7 rewrote the settings
> subsystem, so on older hosts this plugin's client half does not activate at all,
> and since rc.1 dsh refuses to load a bundle whose peer range does not match.
> Check the upgrade notes in [AGENTS.md](./AGENTS.md) before bumping dsh).

```sh
dsh plugin --profile web add @starwish-ai/xingyuan-dsh
```

After starting the Web GUI, installation succeeded when "星愿" (XingYuan) appears in the agent picker.

> Not in the picker? Upgrade to `0.6.5-alpha.2` or later — as of dsh 0.1.7 the host no longer
> scans `~/.dsh/.agent-presets/`; presets are registered by a declaration row in the plugin
> patch, so older releases of this bundle silently never show up.

## Data & Backup

Business data lives at `~/.dsh/xingyuan/xingyuan.sqlite` and survives uninstall / upgrade; backup is just copying that directory.
Your **preferences** moved with dsh 0.1.7 into the profile document
(`~/.dsh/profiles/<profile>/cordis.patch.yml`, this plugin's row), so they are *not* in
that directory — copy the profile file too if you want them on a new machine.

## Settings (Web GUI → Settings → XingYuan)

| Option | Description |
| --- | --- |
| Coach style | Gentle / humorous / strict |
| User profile | Nickname, occupation, interests |
| Write confirmation | Master switch + per-category toggles (create / check-in / undo / claim / edit / save memory); deletion always confirms and cannot be turned off |
| Memory injection limit | Max memories injected per turn |
| Tab visibility | Three modes (follow session / always show / always hide) plus per-tab toggles; defaults to follow session |
| Confirm card language | Language of the in-chat confirmation card (Chinese / English; the platform does not expose UI language to plugins, defaults to Chinese) |

## Development

```sh
pnpm install
pnpm build   # tsc + tsdown (integration tests depend on lib/)
pnpm test    # vitest
```

Architecture, domain semantics and client-side discipline live in [AGENTS.md](./AGENTS.md) (Chinese); contributing guide in [CONTRIBUTING](./CONTRIBUTING.md).

Releasing: push a `v*` tag to build and publish to npm automatically (prereleases get the `alpha` dist-tag).

## License

[MIT](./LICENSE)
