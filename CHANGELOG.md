# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] - 2026-09-05

### Added
- **Wishes page: collapsible task area**: each wish card's task list now starts collapsed
  behind a full-row disclosure toggle ("N 个任务" / "Tasks (N)" with a chevron that flips
  when expanded). Card-header progress, the "N to claim" badge and the wrap-up guidance
  line stay visible while collapsed; expanding restores the task rows exactly as before —
  claim / check-in buttons and the inline per-task detail expansion now nest inside the
  card-level disclosure. Achieved wishes collapse the same way; wishes without tasks keep
  their existing hint and get no toggle. Expanded cards are remembered across view-tab
  switches (view-state snapshot). Client-only: no API, storage or write-path changes.

### Changed
- Wish-card copy de-jargoned: the empty hint now says "还没有任务" (was "暂无下属任务")
  and the delete-wish confirmation says "它的任务…" (was "下属任务…"), matching the
  established plain-wording standard for user-facing surfaces.

## [0.6.0] - 2026-09-05

> **Note:** behavioral revision — long-term ratios (wish progress, progress charts) join
> the commitment semantics: unclaimed tasks no longer count in the denominator, and
> achievement additionally requires zero unclaimed tasks. No data format change; upgrades
> from 0.5.x are seamless — the switch can only raise progress, and every newly-qualifying
> wish carries unclaimed candidates that the achievement gate holds back (nothing archives
> by accident).

### Added
- **Achievement gate and the "wrapping up" state**: a wish achieves only at 100% progress
  with no unclaimed tasks (single formula `wishProgressFromAgg` shared by the write path and
  the read side). Full progress with unclaimed tasks parks the wish at "wrapping up" — the
  bar is full, the wish is not archived — and the card shows the pending count with the
  guidance line "claim to continue, or delete to achieve". The call is always the user's:
  the assistant never claims or deletes on its own to force achievement.
- **Gate flips always reach the model**: check-in / claim / update / cancel / delete / create
  (including batches) compare before/after wish views and, on achieve / wrap-up / rollback,
  say so in the tool reply and re-emit the wish event, so chat card, reply and wishes page
  stay in sync. Count drift without a flip also re-emits (the "N to claim" badge never
  freezes).
- **Single-source display bits**: `pendingCount` / `settled` / `planning` / `achieved` are
  produced by `freshWishes` and delivered via `/api/wishes` and `xingyuan/wish` events;
  replays of older events degrade honestly to a plain progress display.
- **Wording standard**: all user-facing and verbatim-relay surfaces (i18n, tool replies,
  prompt guides, standalone pages) say "待领取的任务" / "待收尾" — no internal jargon.
  Locked by a banned-word test (`test/prompts.test.ts`) and a shared guidance-line constant.

### Changed
- `wishProgress` and `taskCompletionRate` now divide by claimed-task days only; the
  subtitle is fixed to "已领取任务" (the conditional "含未领取任务" wording is gone —
  one metric, one meaning).
- Growth-page achievement counts and the `wishAchievement` chart consume the derived
  achieved bit instead of `progress >= 100`, matching the wish card exactly.
- The session-opening overview reads fresh derived views (not the stored `archived` bit)
  and distinguishes "all wishes achieved" from "no wishes yet".

### Fixed
- Creating a bare wish showed "进度 0%" on the chat card while the wishes page said
  "计划中" (the create event dropped the derived bits).
- Claiming a standalone task (no parent wish) claimed its days were folded into "wish
  progress".
- Batch-delete replies glued the achievement guidance onto the summary line; batch paths
  no longer re-scan the task table per wish on the after side.

## [0.5.9] - 2026-09-04

> **Note:** this release migrates the plugin to DeepSeek Harness `0.1.2-rc.1`
> (the host is still a technical preview and broke APIs on this bump). No data
> format changes: existing databases, settings and recorded sessions replay as
> before. On older hosts (`0.1.1-rc.2`) this version no longer loads — pin
> `0.5.8` if you must stay on the previous harness.

### Changed
- **Settings namespaces now install through the service face**
  (`ctx.inject(['settings'], (inv) => inv.settings.installSection(...))`):
  `dsh-settings` removed the standalone `installSettingsSection` /
  `settingsNamespace` helpers, so `xingyuan-pref` and `xingyuan-ui` register
  via the new API and are no longer imported at runtime. The persistence
  guarantee is unchanged — namespaces stay on the bundle-resident layer.
- **Client half re-wired to the reshaped browser packages**:
  `@deepseek-ai/dsh-client-runtime` is gone; `ClientContext` is now plain
  Cordis `Context`. The `ChatNodeDataMap` declaration merge moved to
  `@deepseek-ai/dsh-client-ui-chat/client`, `ConversationStepDataMap` stays in
  `dsh-client-ui-conversation/client`, event-card definitions register through
  `ctx.uiConversation.events`, and the slot service is provided by
  `dsh-client-ui-renderer`. `dsh.client.inject` was rewritten to the new
  package-row semantics (baseline modules are seeded by the shell and need no
  declaration).
- **Session-preset detection for tab visibility** now reads
  `projectionValues.agentPreset` from the sessions list row — the
  `SessionSummary.agentPreset` field was removed upstream in
  `0.1.2-rc.1` (this was silently hiding all Xingyuan view tabs after the
  host bump; same data source the official preset label uses).
- **Peer dependency ranges** bumped to `^0.1.2-rc.1` (Cordis `^4.0.2`);
  AGENTS.md records the migration facts and the new troubleshooting rows
  (`cannot get property without inject`, missing view tabs).

## [0.5.8] - 2026-09-04

> **Note:** this release is the fourth six-perspective quality pass. It finishes
> the promised-vs-planned caliber split across every surface: the Today tab and
> the calendar day panel now show only claimed obligations (the unclaimed pool
> lives on the Tasks tab and in chat), the growth 30-day range chart no longer
> counts unclaimed tasks as failure gaps, and every surface labels expired
> tasks honestly instead of mislabeling them as unclaimed. No data format
> changes; existing databases and recorded sessions replay as before.

### Changed
- **Today tab shows claimed obligations only** (user decision): the unclaimed
  candidate group and its claim buttons were removed from the Today tab; the
  claim entry point now lives on the Tasks tab's unclaimed group and in chat
  (the opening overview and `get_today_unchecked_tasks` still list them
  separately, with the "never claim on the model's own" constraint). The
  standalone `/xingyuan/today` page follows the same rule.
- **Calendar day panel shows claimed tasks on every date** (user decision):
  previously only non-today panels filtered out unclaimed rows; today's panel
  kept them with a claim button. The panel is now claimed-only for today as
  well. Expired tasks still appear on their deadline day as honest "expired"
  failure records (not checkable; revived via the task detail panel), matching
  the chat tool labeling.
- **Growth 30-day range chart counts only claimed tasks**: unclaimed
  opportunity days no longer render as failure gaps (same caliber as the month
  calendar and the Today progress). The underlying plan API for future-schedule
  tools keeps the planned caliber and labels unclaimed counts explicitly.
- **Honest completion ratio on the Today page**: the progress now floors —
  249/250 displays 99% instead of 100% without the "all done" banner (same
  rule as wish progress).
- **Wish progress keeps its plan-caliber denominator, now labeled**: wish cards
  and the wish-progress chart subtitle append "includes unclaimed tasks"
  whenever any shown wish has unclaimed tasks; the future-arrangement query
  tools split their counts into "to check in N, unclaimed M".
- **Expired tasks are labeled "expired" on every surface**: the chat date query
  and the standalone calendar detail previously mislabeled them "unclaimed";
  the React calendar panel now renders the state word as well.
- **Single-source claimed predicate**: all host-side filtering goes through
  `store.ts` `isClaimed` (charts included), the day API exposes the `claimed`
  boolean for the client, and the client no longer duplicates status predicates
  on the day surface.

### Added
- Route-level test locks for the promised-caliber semantics: overview totals,
  month-calendar cells, day rows, the growth range (unclaimed ≠ failure gap),
  and expired-task retention on the schedule surface.

## [0.5.7] - 2026-08-29

> **Note:** this release is the third six-perspective quality pass (product,
> design, end-user, dsh-plugin engineering, architecture, UX). It closes the
> last honesty gap in the write paths, makes tab switching lossless for
> in-progress input, hardens the opportunity-date calculator against a
> process-hanging edge case, and lands the accessibility/contrast leftovers.
> No data format changes; existing databases and recorded sessions replay as before.

### Added
- **Draft snapshots across tab switches**: typing a memory (up to 1000 chars)
  or filling the quick-create forms used to be silently lost when switching
  conversation view tabs (pages unmount on switch). Form drafts now survive tab
  switches and panel collapse; successful saves clear them.
- **Instant growth feedback on check-in**: the check-in tool reply appends the
  current level and experience progress, closing the "check in → grow" loop at
  the moment of the action instead of deferring it to the Growth page.
- **Non-preset session hint on the chat-directed pages**: in "always show" mode the six tabs
  render in every session, but wishes/tasks/memory empty states directed users
  to a chat that has no XingYuan tools there. The Today page's "preset not
  enabled" hint row now also renders on the other three pages.
- **HTTP shell tests**: route dispatch (status-code mapping, the 64 KB limit,
  JSON parsing, the `ToolError.code` passthrough that powers client-side error
  localization) had zero coverage; locked with mocked `IncomingMessage`/
  `ServerResponse` in `test/routes-shell.test.ts`.

### Changed
- **Claiming an overdue unclaimed task is rejected, not silently closed**
  (`claim_expired`): the old flow claimed it and immediately expired-closed it
  while the tool reply asserted "claimed, now in progress" and the page toast
  said "go check in" — both false, and the task-line button kept offering an
  action that always fails. The row shows a guidance hint instead, the chat
  task card hides its claim button for the same state, and the detail panel's
  revive row (extend due date) now also covers overdue-unclaimed tasks.
- **The early check-in confirms no longer assert a falsehood**: the task-row,
  card and detail dialogs said "today is not a check-in day" — false when today
  was already checked in (the natural path: check in via chat, then tap the
  button on the updated card); the calendar dialog said "{date} is not a
  check-in day" for a day the panel only lists because it IS one. All four now
  state only what is true: the target day is after today, and an early check-in
  commits to finishing that day.
- **Growth-ladder and completed rows dim by text color, not row opacity**:
  whole-row `opacity` (0.65-0.78) blended 12 px text below the WCAG AA 4.5:1
  line (≈2.6-3.1:1 measured in both themes); the hierarchy now comes from the
  secondary text color (4.76/5.15:1) while transparency stays on decorative
  elements only.
- **Danger icon buttons share one quiet tier**: the memory-row delete joined
  the wish-card delete at 0.78 idle opacity with hover/focus restore (long
  lists stop glowing red; non-text contrast ≥3:1, the stale "≥4.5:1" comment
  corrected to the non-text standard).
- **Growth chart stops squeezing its columns on narrow panels**: below the
  520 px breakpoint the 30 daily columns scroll horizontally at a minimum
  width (~13 px per column, up from ~10 px) instead of being flex-crushed;
  a deliberate trade-off against the 24 px touch-target ideal, whose full
  width would make the chart scroll several screens.
- **HITL confirm sorts callers by whether any confirm UI exists**: callers
  with no confirm UI at all (`NO_PROVIDER`, `CALLER_NOT_LIVE` — both raised
  before `NO_PROVIDER` in rc.2) are allowed, as before for headless; a
  delegated caller (`DELEGATED_CALLER`, e.g. a session-spawned subagent) is
  now failed closed with actionable guidance ("confirm in the main
  conversation, then run it there") instead of the raw platform error —
  keeping the always-on delete confirmation intact on delegated paths.
  Recorded in the engineering doc's HITL contract section.
- **weekly/monthly expectation management**: tool descriptions and the task
  guide now state that opportunity days run from the claim date (every 7 days /
  monthly by claim date) and never bind to a weekday — the model must say so
  instead of silently accepting "every Wednesday" requests. Recorded in Known
  Limitations.
- **The recommendation tool states its ordering**: `get_recommended_tasks` is
  a fixed "top 5 by historical check-in count" ranking, not curation;
  description and reply now say so.
- **Dedup guidance covers paraphrase**: the wish/task guides instruct the model
  to sweep the existing list semantically when substring dedup finds no hit but
  the request is loosely phrased.
- **Prompt/UI drift sync**: the Tasks page has four status groups (not three)
  and two more settings entries (confirm-card language, tab visibility) — the
  capabilities section now matches what users see.
- **Copy/wording**: user-facing strings unify "机会日" to "打卡日" (the check-in
  tool guidance already used the plain term; leftover error strings swept
  too); the bare-wish card points to the
  chat path for task suggestions; the task-created toast explains "claim it to
  start checking in"; five English strings polished ("To check in", "entries",
  "Check-ins · last 30 days", "saved when you leave the field", the grid
  summary).

### Fixed
- **Opportunity-date loops can no longer hang the process**: termination used
  ISO string comparison, which silently assumes four-digit years — a sequence
  crossing 9999-12-31 (only reachable via hand-edited sqlite) compared
  `'10000-xx' <= '9999-xx'` as true forever, hanging daily/weekly/monthly in an
  allocating loop. Termination is now numeric (UTC day numbers; the monthly
  branch via `Date.UTC`, since `Date.parse('10000-…')` returns `NaN`). Locked
  by termination tests including the year-boundary crossing.
- **Toast glyph semantics & screen readers**: the info glyph was "★" — the star
  is the high-importance memory marker (`.xy-star-hi`); info is now "i", and
  toast glyphs are `aria-hidden` so decorative symbols are not announced inside
  the live region.
- **Centered header baselines**: the `.xy-meta` top margin leaked into centered
  card/page heads, sinking secondary text by 2 px; the treatment the detail
  area already had now covers the heads too.
- **Focus management**: closing the category rename editor returns focus (to
  the row's rename button, or the page title when the row was rebuilt by a
  rename); finishing the last "load more" page moves focus to the "all shown"
  line and announces it (`role="status"`).
- **Docs**: reference links pointed at the nonexistent `main` branch of the
  upstream repository (the default branch is `master`) and at a cookbook page
  that does not exist (the conversation-node contract lives in
  `subsystems/conversation`); a dsh upgrade checklist now records the two
  patch-DSL hazards (schedule insert id collision, storage-domain whole-line
  replacement).

## [0.5.6] - 2026-08-29

> **Note:** this release is the follow-up to the v0.5.5 six-perspective quality
> pass: the same six reviews re-ran against 0.5.5 and every accepted finding is
> fixed here — one data-safety gate, honesty fixes in the growth ladder, focus
> management on the highest-frequency action, and a batch of contrast, copy and
> localization closures. No data format changes; existing databases and recorded
> sessions replay as before.

### Added
- **Write-path schema gate** (`makeXingyuanStore`): the storage domain validates
  records only when cold-opening the medium — a write path that skipped a field
  check (e.g. an over-long task name from the model) used to persist silently and
  then brick the next startup (`invalid-record` refuses to open, plugin dead until
  manual surgery). Every `put`/`update`/`global.set` is now guarded by the declared
  zod schema at the single store assembly point and rejected at write time with a
  stable `invalid_record` code; valid records parse as identity, reads pay nothing.
  Locked by `test/domain-guard.test.ts`.
- **Network-failure copy**: connection-level fetch failures (dsh restarting) no
  longer surface the browser's raw English (`Failed to fetch` / `Load failed`) in
  the Chinese UI; they map to a localized "network request failed, retry" message.
- **Task rows keep keyboard focus after group-migrating actions**: a successful
  check-in moves the row between the Today page's open/done lists and destroyed the
  pressed button, dropping focus to `<body>`; focus now falls back to the page
  title (the same pattern as undo). The same treatment covers a check-in that
  closes a task anywhere task rows render, and claiming a task on the Tasks page,
  where the row moves between status groups.
- **Memory page**: the search empty-state no longer flashes between keystrokes
  while the debounce is pending, a settled zero-hit search now shows the "no
  matches" copy instead of the "no memories yet" empty-library one (the server's
  `total` is query-filtered, so the two were indistinguishable before), and the
  key field's server minimum (2 characters) is validated inline with its guidance
  message instead of a generic error.

### Changed
- **Level rewards describe what exists**: the growth ladder no longer promises
  avatar frames, task templates or style gating that the product does not have
  (coach styles were always free in Settings); rewards are now the honorary title
  itself, capped by the Lv.10 pinnacle. Server table and both dictionaries updated
  together (the Chinese dictionary is locked to the server table by
  `test/growth.test.ts`).
- **Levels read "荣誉" not "权益"** on the Growth page hero and in `get_growth_stats`
  output, matching the honorary rewards.
- **Today plan keeps the achieved-closing row**: checking the last opportunity day
  closes the task, which used to remove the row from the Today page entirely (the
  counter shrank right after checking in). A closed-achieved task with a check-in
  on that date stays in the done group with its undo entry; cancelling the check-in
  revives the task through the existing freshness path.
- **Calendar hover preserves state colors**: hovering a partially/fully-completed
  day no longer washes the semantic amber/green chip with the accent hover tint —
  the state color is exactly what the hover was inspecting.
- **Contrast closures**: micro-action card secondary text and skipped steps use the
  `label-on-2` pair and a higher muted opacity so both themes stay above the
  4.5:1 line (the same lift applies to deleted wish cards in chat); calendar/
  check-in-cell state foreground colors moved into the theme token region as
  paired `--xyd-on-c2` / `--xyd-on-c3` / `--xyd-on-dcell` tokens.
- **Date validation accepts only real calendar dates**: `2026-02-30` used to pass
  the format check (`Date.parse` rolls it over instead of returning NaN) and then
  silently produce a task with an empty opportunity sequence — or land in the
  check-in table as a fake day that skews the streak replay. Task due dates, wish
  estimated dates and check-in target dates (including the any-date back-fill on
  no-deadline tasks) now share the opportunity calculator's semantic `isIsoDate`
  round-trip check, and the routes' duplicate implementation converges onto it.
- **Prompt coherence**: the check-in example moved out of the "no-confirm mode"
  section into confirm mode (check-in is a confirm-gated write) and no longer
  demonstrates a streak number the tool does not return; list-tool outputs tell the
  model to use bracketed IDs only for follow-up calls, not to render them to the
  user; `generate_chart`'s `wishId` parameter names the camelCase chart keys.
- **Memory search bar wraps** so the saved notice is not clipped off narrow panels.
- **Copy/wording**: the Settings preference-unavailable hint no longer hardcodes a
  stale count; the English "clear all memories" dialog is grammatical for one item;
  the Growth page EXP/experience units are consistent in Chinese; an unknown level
  falls back to a localized name instead of an empty label; the 404 API error and
  the wish-not-found tool/route error carry localizable codes; the English
  check-in grid summary is grammatical for one cell; README wording aligned with
  the UI ("连续加成", straight quotes in English).

### Fixed
- **sqlite backend**: a corrupted table row now reports `malformed-medium` like the
  global slot does, instead of a raw `SyntaxError` with a split troubleshooting path.
- **Mock generator**: the detail-panel fixture in `debug/gen-mock.ts` takes an id
  parameter so the wish/task scenarios no longer emit duplicate DOM ids.

## [0.5.5] - 2026-08-28

> **Note:** this release is a six-perspective quality pass (product, visual design,
> end user, dsh-platform conformance, architecture, UX) over every interaction,
> display and code path. It closes the failure side of the habit loop — an expired
> task used to be indistinguishable from an achieved one and was a dead end on the
> pages — and makes the plugin honest in English wherever it previously leaked
> built-in Chinese vocabulary. No data format changes; existing databases and
> recorded sessions replay as before.

### Added
- **Expired vs achieved, end to end**: task views carry `closedReason`; the Tasks
  page splits the former "Closed" bucket into **Achieved** and **Expired** groups,
  task rows say which one they are, and an expired task's detail panel explains the
  state and offers an in-page **extend due date → restart** action (same store write
  path as the chat-side `update_task`). An expired task is no longer a dead row with
  a delete button.
- **Confirm card language** (`xingyuan-pref.confirmLang`, default Chinese): the
  platform does not expose UI language to host-side plugins (verified against rc.2),
  so the in-chat confirmation card's header, buttons and question text now follow
  this explicit setting with full English strings; the Settings page gains a
  "Confirm card language" select with optimistic save and write verification.
- **Built-in chart vocabulary localizes on the client**: chart cards map known
  built-in Chinese titles, enum labels (weekdays, hour buckets, task statuses,
  series names) and fixed subtitles to the interface language, while user data
  (wish/task names) and unknown values replay verbatim. Coverage is locked by
  `test/chart-labels.test.ts` against the real chart builder, so a new built-in
  word without a mapping fails the build.
- **Level names localize**: the Growth page renders level names and rewards from
  the interface language by level number (server strings remain the Chinese
  fallback); locked to the server table by the same test.
- **Route contract compliance**: `/xingyuan` prefix registration is effect-scoped —
  the disposer returned by `webServer.register` is no longer discarded, so hot
  reload / re-activation can no longer die on a duplicate-prefix throw or leave a
  stale handler serving a closed domain. A loader-level remount test with a
  duplicate-throwing webServer stub pins this.
- New contract tests: `style-contract` (no `color-mix(` anywhere; semi-transparent
  colors only inside the token zone; key semantic tokens must exist in both
  themes), `chart-labels` (built-in chart vocabulary fully covered by the
  localization maps, and client level names locked verbatim to the server table),
  `sqlite-backend` (version-mismatch rejection, corrupt-global rejection,
  write → cold-read persistence), plus a tool-suite audit pinning the 10-minute
  HITL timeout on every confirmation-waiting tool and the "use real IDs from list
  results" note on every ID parameter.

### Changed
- **System prompts no longer assert gated behavior**: six spots claimed the system
  "will pop a confirmation card" unconditionally — wrong when the write-confirmation
  setting is off (tool descriptions already hedged; the prompts now hedge the same
  way, "删除始终弹出" stays asserted since deletes always confirm).
- **Memory overwrite asks once**: creating a memory with an existing key showed the
  overwrite confirmation, then the server rejection re-asked the identical question;
  the confirmed path now submits with `overwrite: true` directly.
- **Settings tab-visibility tells the truth**: memory-mode (non-loopback) and
  read-only states get their own notices instead of silently grey controls, and
  writes verify post-settle snapshot like the chat-preferences controls, toasting
  on silent revert (`scope.set()` resolves even on failure).
- **Honest stale-data degradation**: when a refetch fails after a successful action
  (or on focus refetch), pages keep the loaded data and show a "refresh failed,
  data may be outdated" banner with inline retry instead of flipping to a full-page
  error; Today's retry now reloads both endpoints at once.
- **Motion & touch discipline**: the growth bar drops its layout-animating `height`
  transition and the toggle knob animates `transform` only; every purely decorative
  hover is gated behind `(hover:hover) and (pointer:fine)` so touch screens no
  longer stick hover tints; error toasts use a dedicated assertive `role=alert`
  container; the confirm dialog locks body scroll; after deletes/undoes destroy the
  triggered row, focus moves to the page title instead of falling to `<body>`.
- **Cross-tab state survives**: memory search query, calendar month offset and
  expanded task details persist across view-tab switches via a module-scoped
  snapshot store; view pages scroll back to top on mount.
- **Visual tokens**: new `--xyd-label-on-2` pair fixes secondary text on secondary
  surfaces (≈4.3:1 → ≥5:1 in both themes) across the task-card preview strip, group
  count pills, level chips, future grid cells and the growth chart axis ticks;
  success/warn washes, calendar state fills,
  shadows and hero colors are explicit themed token pairs (no more shared-alpha
  washes that vanished on dark); calendar hover wash no longer paints over the
  picked chip; 待打卡 chips gain the inset ring their legend dot always had;
  standalone dark "complete" chip darkens to AA contrast; 11px CJK text raises to
  12px; month-adjacent days brighten from 1.8:1 to readable-but-dim; the mock
  generator itself is `color-mix`-free again.
- **Error codes completed end-to-end**: `not_claimed`, `no_opportunity_left`,
  `no_checkins`, `title_too_long`, `name_too_long`, `once_today_only`,
  `payload_too_large`, `bad_json_body`, `bad_coach_style`, `bad_interests` now flow
  from store/routes to localized client strings (English users no longer receive
  raw Chinese domain messages); HTTP status suffixes localize their brackets.
- **Dates**: hover tooltips on the check-in grid and calendar cells localize while
  aria keeps ISO precision; memory timestamps render as medium dates; the growth
  chart axis uses Intl ticks (Aug 27 / 8-27); the English "Commit {date}" button
  becomes "Early check-in · {date}" so the button itself carries check-in semantics.
- **Writes stay in one place**: memory delete/clear and profile updates go through
  store use cases (`deleteMemory`, `clearMemories`, `updateProfileGlobal`) shared by
  tools and routes; profile fields clamp at the same limits on both faces (nickname
  50 / occupation 100 / interests 20×50) — the tool path was previously unbounded
  and injects into every system prompt turn.
- **Batch reads honor the store contract**: wish/task list paths use
  `freshWishes` and a single shared checkin-count index instead of per-item
  full-table rescans for the completed-day counts; the
  chart builder computes its checkin index only for the one chart that consumes it;
  semantically invalid dates (`2026-13-01`) are rejected with a stable `bad_date`
  code instead of an unlocalizable RangeError; session-log repair sweeps its
  `.xy-repair-*` atomic-write temp files; `./types` export resolves types and
  runtime to the same module.
- **Copy honesty**: delete confirmations (chat and pages) now mention the
  micro-step plan that the cascade removes; quick-create forms soft-confirm on an
  exact duplicate name/title (the chat path dedupes via `check_similar_*`, the
  page path previously did not); wish progress bars expose `role=progressbar`; the
  four create tools declare the same 10-minute HITL timeout as their siblings;
  task-related ID parameters all carry the "use real IDs from list results"
  discipline.

### Fixed
- `start_micro_action` gates on a freshened task status, so a task that expired
  since its last write can no longer start a breakdown.
- `create_wish_with_tasks` no longer over-claims atomicity in its pre-validation
  comment (task-field failures are honestly reported; the wish and created tasks
  are kept).

## [0.5.4] - 2026-08-28

> **Note:** trailing chart statistics no longer count future pre-checked days (see
> *Changed*). Chart cards generated by this version carry a "generated on" stamp so a
> stale card is distinguishable from current data; cards written by earlier versions
> replay unchanged, without the stamp.

**Charts and records now tell the truth about time.** Future pre-checked days were
counted by every trailing statistic as if they had already happened — a "how is this
week going" chart could be inflated by check-ins for days that have not occurred, and a
task's check-in grid could end up showing nothing but future days while today's check-in
was invisible. Undoing a check-in said "revert today's?" while actually reverting a
future pre-check, because the pages let the server fall back to "most recent record".

### Added
- **Chart snapshot stamp**: chart events carry `generatedAt` and the card renders a
  localized "generated on" date; cards generated by older versions replay without it
  (the field is optional and degrades honestly).
- **"No schedule" ≠ 0%**: in the daily completion-rate trend, days with no scheduled
  opportunity render as an empty slot labelled "no schedule" (tooltip and screen reader
  alike) instead of a 0% data point.
- The completion-rate chart annotates its subtitle with "including unclaimed tasks"
  when pending tasks count toward the total, so the denominator is never a mystery.
- **Startup consistency sweep** (`src/consistency-sweep.ts`): check-ins whose task no
  longer exists, tasks whose wish was deleted out from under them, and dangling
  micro-action states are cleaned once per launch through the same cascade the delete
  tools use. Idempotent, runs after activation without blocking it, and pinned by
  `test/integrity.test.ts`.
- **Task-detail grid window**: the check-in grid shows the last 28 opportunity days up
  to today, plus every checked day — future pre-checks stay visible (they are standing
  commitments), and check-ins outside the opportunity series (deadline-free tasks) make
  the grid their check-in history. Today is never squeezed out of the window, however
  many future days are pre-checked; unchecked future days remain in the "upcoming"
  preview line.
- **gzip content negotiation** for the standalone pages (`/xingyuan/today`, `/calendar`,
  `/growth`) per RFC 9110 §12.5.3: absent header accepts any coding, an empty value or
  an explicit opt-out gets plaintext, `Vary: Accept-Encoding` is always sent, and the
  compressed template is cached per body.
- **Request timeout**: client fetches abort after 15 s with a localized message instead
  of hanging forever.
- **Focus refetch**: page data refetches when the window regains focus if older than
  60 s, and always when the local day has changed — overnight sessions no longer show
  yesterday's "today".
- **Undo readability**: the detail panel's undo button announces the exact day it will
  revert (screen-reader label), and its visibility no longer requires today to be the
  checked day — a pre-check can be undone right where it was made.

### Fixed
- **The cancel dialog said "today" while a different day was reverted.** The today page
  and the task detail panel posted the cancel without a date and the server falls back
  to the most recent check-in — which a future pre-check satisfies. Every page now sends
  the explicit date; the dialog, the toast and the reverted record all name the same day.
- `weekComparison` folded future pre-checks into weekday buckets as if they were in the
  current week; the week window is now a closed interval from last Monday to today.
- Wish progress **rounded** instead of flooring: 249/250 displayed as 100% and could
  archive the wish one day early.
- Checking in an expired (closed) task failed with a generic error; it now explains that
  the deadline must be extended to revive the task before further check-ins.
- Concurrent writes to the global document (coach style, profile, category colors,
  micro-action state) could lose updates under interleaving; all writers now serialize
  through one promise chain, a failed writer no longer poisons the chain, and no-op
  mutations skip the write entirely.
- The memory page could deadlock with a perpetual "loading more" spinner when an
  in-flight request was superseded by a newer one (the reset ran on only one of two
  completion paths).
- The calendar's post-action detail refetch swallowed failures; the panel now shows an
  error state with a retry button instead of silently keeping stale content.
- A deadline-free one-shot task disappeared from the today page the moment it was
  checked; the completed row now stays revocable for the rest of the day (it never
  reappears the next day).
- `/xingyuan/api/day` and `/xingyuan/api/range` answered a malformed `date` with an
  empty day list or an unlabelled `RangeError`; both now reject with a structured
  `bad_date` error, consistent with the POST action surface.
- Creating a task with a name over 100 characters through a page action failed with a
  bare validation message; the error now states the limit and the actual length.
- The claim button in the calendar is gated to the picked day being today, matching the
  server-side anchor semantics.
- Display dates across cards, toasts and pages are localized (ISO strings remain only in
  confirm-dialog copy and screen-reader strings, per the documented convention).
- The standalone growth page used `color-mix()`, which some shells render as an invalid
  declaration; the darker tone is now precomputed in JS.

### Changed
- Trailing chart statistics (trend, daily rate, week comparison, by-category, ranking,
  time-of-day, weekday activity) only count check-ins up to today; the calendar heatmap
  deliberately keeps future pre-checks visible. Chart cards are snapshots of their
  generation time — the coach guide tells the model to regenerate for current data.
- `cancel_check_in_task` parameter guidance now instructs the model to pass the date
  whenever the user names a day (including "today"), so the "most recent" fallback is a
  deliberate choice rather than an accident.
- zh copy no longer pads localized dates with spaces ("已撤销 8月29日 的打卡" →
  "已撤销8月29日的打卡"), and the grid legend says "待打卡" where it previously said
  "未来机会日" for what is now only ever today's pending slot.

## [0.5.3] - 2026-08-28

> **Note:** this is a patch release but it carries one breaking change — the `xingyuan`
> settings namespace is replaced by `xingyuan-pref` (see *Removed*). Consumers of the
> `./domain` subpath must also adapt to `makeXingyuanStore()` taking a second, required
> argument. Read *Upgrading from 0.5.2 or earlier* before updating.

**Chat preferences are now always editable.** Settings → XingYuan rendered the
write-confirmation toggle and the memory-injection limit as permanently disabled until a
XingYuan session had been opened once since the last dsh start; clicking them did nothing
and produced no error. Both preferences lived in the preset-layer namespace, which only
comes into existence when the preset is first mounted, so they now live in a
bundle-resident namespace registered whenever the bundle row is active.

### Upgrading from 0.5.2 or earlier

The two chat preferences moved from the `xingyuan` block of `$DSH_HOME/settings.yaml` to a
new `xingyuan-pref` block. **A value you had customised is not carried over** and falls back
to the default: `confirmWrites` returns to `true` (the safe direction — write actions ask for
confirmation again) and `memoryInjectLimit` to `40`. Re-apply your choices under
**Settings → XingYuan → Chat preferences**. The leftover `xingyuan:` block is inert and is
safe to delete.

### Added
- **`xingyuan-pref` settings namespace** (`src/pref-settings.ts`), installed by the bundle
  layer next to the existing `xingyuan-ui` namespace, carrying `confirmWrites` (default
  `true`) and `memoryInjectLimit` (default `40`, integer `5`–`200`). The schema declares
  `.step(1)`, so the Host also rejects fractional values that a hand-edited settings
  document or a direct RPC write could otherwise smuggle in.
- **Shared preference policy module** (`src/pref-policy.ts`) holding the bounds, defaults
  and input parser for both halves — the host module depends on
  `@deepseek-ai/dsh-settings` and must never reach the browser bundle. This also removes
  the `5`/`200`/`40` literals that were previously repeated in the settings page. Covered
  by `test/pref-policy.test.ts`.
- **Write verification**: `scope.set()` resolves rather than rejects on failure (the client
  controller catches, recovers and returns silently), so `toastError` never fired. The page
  now compares the snapshot after each write and raises a "did not save" toast when the
  value did not change. Both controls share one scope — and therefore one write queue — so
  the comparison is gated on a per-component write sequence number to stay honest under
  interleaved writes (see below).
- **Regression lock** (`test/pref-settings.test.ts`): five tests pinning that the bundle
  layer registers `xingyuan-pref` as soon as the settings service is available, that the
  read thunk resolves fresh on every call, that the headless path falls back to the schema
  defaults, and — structurally — that **no namespace bound by the settings page is ever
  registered from the preset layer**. That last one is the abstract shape of this bug and is
  what stops it from coming back.
- **Four-way readiness notice** for the preferences card: loading, remote/temporary
  connection (`mode === 'memory'`), namespace not registered, and read-only document. The
  previous code only covered the first two, leaving the rest as silently disabled controls.

### Fixed
- The two preferences could not be changed before the first XingYuan session of the process
  — the root cause described above.
- The write-confirmation toggle rendered as **on** whenever its value was unavailable
  (`value?.confirmWrites !== false` reads "unknown" as "true"), which is the worst possible
  default for a safety switch. It now falls back to the schema default explicitly.
- Namespace-unavailable and read-only states disabled the controls with no explanation.
- The "did not save" toast could fire on a write that **had** been saved. Both controls share
  one settings scope, and the client controller fences writes with a generation counter: when
  a write is superseded by a newer one it only records a pending revision and does **not**
  fold the result into the snapshot, while the superseded write's `.then` still runs first and
  sees the stale value. Verification is now skipped for superseded writes, and the number
  input got the pending guard the toggle already had.
- Clearing the memory-injection-limit field and blurring reported "enter an integer between 5
  and 200" while simultaneously refilling the field with the saved value — two contradictory
  messages at once. An empty field is again treated as abandoning the edit.
- Tool descriptions for the creation / check-in / cancel-check-in tools asserted that a system
  confirmation card would appear. Toggle **Confirm write actions** off and the model kept
  telling users a card had been shown when none was. Tool descriptions are baked in at
  registration and dsh-tools requires a plain string (no getter), so they are now worded to
  hold in both states instead of asserting the card. Delete tools are unaffected — deletes
  always confirm.

### Changed
- The preset layer no longer registers a settings namespace. It reads preferences through
  `ctx.xingyuan.prefs()` — a thunk that resolves the current value on every call, so edits
  still take effect immediately without re-registering tools or prompts. The remaining
  `Config` fields (`batchWishLimit`, `chartTrendDays`, …) have no settings UI and stay as
  composition-only entry config, which matches the upstream rule that a namespace should
  carry only the user-editable subset.
- **Breaking for `./domain` consumers**: `makeXingyuanStore(domain)` now takes a second,
  required argument — `makeXingyuanStore(domain, readPrefs)`, where `readPrefs` is a thunk
  returning the resolved chat preferences. The required-ness is deliberate: every call site
  (one in production, five in tests) is surfaced by the compiler rather than silently
  missing the wiring. `XingyuanStore` gained a matching `prefs()` method.

### Removed
- The preset-layer `xingyuan` settings namespace and the `confirmWrites` /
  `memoryInjectLimit` fields of the preset `Config`. **A value customised under the old
  `xingyuan:` section of `$DSH_HOME/settings.yaml` is no longer read and falls back to the
  default** — `confirmWrites` therefore returns to `true`, the conservative direction. The
  stale section is left in the document and is harmless.

## [0.5.2] - 2026-08-27

### Added
- **Controllable conversation-view tabs**: the six tabs (Today / Wishes / Tasks /
  Calendar / Growth / Memory) are no longer always present. Default mode **follows the
  session preset** — tabs appear only in sessions composed from the `xingyuan` preset and
  stay out of every other conversation. Settings → XingYuan gains a **Tab visibility**
  card with three modes (`Follow session` / `Always show` / `Always hide`) plus
  per-tab toggles (`hiddenTabs`, all shown by default). The preference namespace
  (`xingyuan-ui`) is installed by the bundle layer, so it works before any XingYuan
  session exists and stays reachable even when tabs are fully hidden (a preset-layer
  namespace would be unavailable exactly when needed). Today's page shows a one-line
  notice when "Always show" puts the tabs into a non-XingYuan session (pages stay fully
  browsable and operable; only the chat-side capabilities are absent). Read-only URL
  pages (`/xingyuan/*`) and chat cards are unaffected.
- New tab-visibility policy (`visibleTabIds`) with dirty-value tolerance (unknown/duplicate
  hidden ids are ignored); covered by `test/tab-policy.test.ts`.

### Fixed
- Client boot crash: the tab-visibility controller subscribed to the injected `sessions`
  service itself, which has no `subscribe` — the session-list snapshot lives on
  `sessions.list`. The client half failed to load entirely ("Failed to load plugins"),
  which also hid the Settings → XingYuan card. Subscriptions now target
  `sessions.list` (`getSnapshot`/`subscribe`).
- Tab-visibility toggles had inverted semantics: the check chips rendered "hidden" as
  "checked", so ticking a tab produced no change. `shown` now reads
  `!hiddenTabs.includes(id)` (checked = shown).

## [0.5.1] - 2026-08-27

Patch release. Two hardening changes: sessions that contain `xingyuan/*` card events
now survive cold loads after a restart, and the client stylesheet no longer depends on
`color-mix()` support in the hosting browser. No schema changes; existing data stays
compatible.

### Added
- Session-log self-repair (`session-log-repair.ts`): at activation the bundle scans
  `$DSH_HOME/sessions` and adds `"ignorable": true` to `xingyuan/*` event lines, so
  conversations containing cards are no longer rejected wholesale by the session format
  reader after a process restart. Files without xingyuan events are never written;
  non-xingyuan lines keep their exact bytes; originals are backed up before the first
  rewrite (3 kept per session); torn tails, corrupt frames, version mismatches,
  unparsable lines, and live sessions are skipped whole-file. A per-session marker
  records the artifact byte size, so already-repaired sessions skip the decompress scan
  at the next startup (68 sessions: 3.6s → <10ms). Containers whose first zstd frame is
  not exactly one header line — a legacy single-frame layout that broke host startup —
  are rewritten into the valid layout even when no marking is needed.
- New bundle config `repairSessionLogs` (default `true`) to disable the self-repair pass.

### Changed
- Client styles no longer use `color-mix()`; derived colors are explicit per-theme rgba
  tokens (`--xyd-*-border/ring/hatch/hover`). Empty and error states are plain text
  layouts — the SVG line-art illustrations whose strokes relied on `color-mix()` are
  removed — and the growth hero gradient is pre-mixed in JS (`darkenHex`).

### Fixed
- Conversations containing `xingyuan/*` card events could not be reopened after a
  process restart (`SessionFormatUnsupportedError`); they are now self-healed at
  activation and replay their cards again.
- In browsers without `color-mix()` support, decorative strokes (empty-state art, hover
  rings, hatch fills, danger buttons) silently vanished, leaving isolated accent dots.

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
