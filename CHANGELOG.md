# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
