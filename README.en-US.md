# XingYuan for DeepSeek Harness

[![npm version](https://img.shields.io/npm/v/@starwish-ai/dsh)](https://www.npmjs.com/package/@starwish-ai/dsh)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/starwish-ai/XingYuan-Dsh/actions/workflows/ci.yml/badge.svg)](https://github.com/starwish-ai/XingYuan-Dsh/actions/workflows/ci.yml)

[简体中文](./README.md) | English

XingYuan is a wish & habit-building companion, shipped as a DeepSeek Harness plugin bundle + agent preset.

## Features

- **Conversation-driven**: create wishes / tasks in natural language with duplicate detection
- **Opportunity-day check-ins**: check-in, make-up, cancel, and future pre-checks; progress always recomputed against today
- **Growth system**: levels Lv.1–Lv.10, streak bonuses, stat cards, 30-day bar chart
- **Session view tabs**: Today / Wishes / Tasks / Calendar / Growth / Memory — buttons call action endpoints directly
- **Memory**: important memories injected into context (limit configurable), full CRUD
- **Charts**: 15 chart types rendered as cards
- **Safe writes**: write operations confirmed by default (configurable); deletion always confirmed
- **Theming**: light/dark follows the app theme

Tools are only mounted on sessions using the XingYuan preset; other sessions are unaffected.

## Install

```sh
dsh plugin --profile <name> add @starwish-ai/dsh
```

`<name>` is a dsh profile name (each profile keeps an independent set of plugins and sessions). For first-time setup just use `default`:

```sh
dsh plugin --profile default add @starwish-ai/dsh
```

After starting the Web GUI, installation succeeded when「星愿」appears in the agent picker.

## Data & Backup

Business data lives at `~/.dsh/xingyuan/xingyuan.sqlite` and survives uninstall / upgrade; backup is just copying that directory.

## Settings (Web GUI → Settings → XingYuan)

| Option | Description |
| --- | --- |
| Coach style | Gentle / humorous / strict |
| User profile | Nickname, occupation, interests |
| Write confirmation | Whether create / check-in writes need confirmation (deletion always does) |
| Memory injection limit | Max memories injected per turn |

## Development

```sh
pnpm install
pnpm build   # tsc + tsdown (integration tests depend on lib/)
pnpm test    # vitest
```

Releasing: push a `v*` tag to build and publish to npm automatically (prereleases get the `alpha` dist-tag).

## License

[MIT](./LICENSE)
