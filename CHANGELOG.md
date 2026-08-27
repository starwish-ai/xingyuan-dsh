# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-08-27

Write-path unification and read-side freshness alignment between the chat tools,
the `/xingyuan` page actions, and the charts. No schema or configuration changes;
existing data stays compatible.

### Added
- Clearable update fields: `update_task` and `update_wish` accept an **empty string**
  to clear task hint / due date and wish description / color key / estimated
  completion date (`undefined` still means "not mentioned — keep current value").
- Wish creation and updates are unified store use cases shared by chat tools and
  page actions; validation failures carry stable error codes on both faces.
- Regression tests for plan-view freshness, clearing semantics, chart freshness,
  and the calendar one-year window.

### Changed
- Plan views refresh stale task state on read and offer check-in only for
  in-progress tasks: a past-day button can no longer be enabled while the write
  path would reject it with "task already closed".
- Status/progress charts (`taskStatus`, `wishProgress`, `wishAchievement`) use the
  same fresh reads as the pages; the check-in calendar heatmap now actually covers
  only the trailing year its subtitle promises.
- Deleting a task re-syncs its wish totals inside the delete cascade.

### Fixed
- Prompt drift: memory guide now states high *and* medium importance memories are
  auto-injected; the overflow note no longer calls cut-off memories "low value".
- SQLite backend creates its data directory synchronously at activation, removing
  a cold-start race on first install.
- Client error toasts fall back to the server message for unknown error codes
  instead of rendering `undefined`; `memoryInjectLimit` gains server-side bounds.

## [0.4.0] - 2026-08-27

First stable release of the 0.4.x line: memory search fix, calendar and task-detail
visual redesign, packaging hardening. Published to the `latest` dist-tag.

### Added
- Packaging integrity gate: every `exports` subpath and the `dsh.bundle.patch` target
  must exist in the built `lib/` output.
- Client URL construction regression test: the client-built search URL is fed through
  the real server handler and must return matching results.
- Visual verification loop for client styling (`debug/gen-mock.ts`): renders the real
  `STYLE_TEXT` into dark/light static pages (calendar, wish card, task card scenarios)
  for screenshot review, since client pages cannot run outside the dsh shell;
  client-side development discipline documented in AGENTS.md.

### Changed
- Calendar rebuilt around date badges: borderless continuous grid, day status carried
  by a circular badge (to-check = neutral, partial = amber, complete = green), today
  as an accent ring that never covers the status color, selection as a solid accent
  badge, adjacent-month days dimmed, month navigation centered with "back to today"
  pinned right (flows inline below 520 px).
- Task detail actions regrouped into one row ordered by importance (primary check-in /
  claim → conditional undo → AI summary → destructive delete). The destructive action
  no longer floats to the card edge (it read as the wish-level delete inside wish
  cards), the redundant cycle/progress meta line is dropped, sections follow a fixed
  label/content rhythm, and an 8 px floor keeps buttons clear of the next row's
  divider.
- Memory list URLs (first page and "load more") are built by one shared
  `URLSearchParams`-based helper.

### Fixed
- Memory search returned nothing for any query: the URL was concatenated as
  `?q=词?offset=0` (a second `?` instead of `&`), so the server matched the paging
  params as part of the keyword.
- `./routes` package export pointed at a non-existent `lib/routes.js`; it now resolves
  to the real `lib/routes/index.js` entry.

## [0.4.0-alpha.5] - 2026-08-26

UI/UX quality pass: theming, charts, calendar, bilingual copy, accessibility.

### Added
- In-app confirmation dialog replacing native `window.confirm`: theme-aware panel with backdrop, Esc/cancel-safe defaults (danger actions focus "Cancel"), Tab cycling, focus restore, and a solid-danger variant for irreversible actions; pending dialogs settle as cancelled when the plugin unloads.
- Unified chart language across the growth page bar chart and chat stat cards: shared baseline, hover detail strip, minimum visible segment guard, rounded-top bars flush with the axis, hatch-pattern encoding for missed gaps (color-blind safe), transform-based progress-bar animation.
- Month calendar rebuilt as a connected grid sheet: shared hairlines, adjacent-month filler days shown grayed and non-selectable, compact 40 px rows so the day-detail panel stays above the fold.

### Changed
- Growth level hero uses a solid two-stop gradient — white text keeps WCAG AA contrast in the light theme; on-glyph foregrounds for toast badges calibrated per theme.
- De-emphasized text opacity floors raised so secondary/danger text stays ≥ 4.5:1 effective contrast in both themes.
- Bilingual copy hardening: plural rules via `Intl.PluralRules`, locale-aware punctuation in errors/charts, localized AI-summary prompt for English users, typographic quotes, shorter action labels for tight layouts, form control names plus `inputMode`/`enterKeyHint`.
- Calendar cells expose identical hover titles and screen-reader labels; focus rings pulled inside cells.

### Fixed
- Page width jitter (~15 px) when expanding task details or opening quick-create forms: scroll gutter pinned pre-paint via `useLayoutEffect` plus an unconditional `scrollbar-gutter: stable` patch for the shell's conversation scroller.
- Stale or wrong copy: category color-clear feedback now matches its action, settings hint describes the new in-app dialog, growth legend color description corrected.

### Removed
- Dead CSS rules, an unused i18n key and barrel export, a stray development diagnostic script, and internal sprint tags from comments.

## [0.4.0-alpha.4] - 2026-08-26

Initial open-source release of the renamed `@starwish-ai/xingyuan-dsh` package.
