# Harvest Studio — Rebuild Plan (UI/UX, control, Netlify, no-regression)

Repo: github.com/datakid/harvest-studio
Start from branch `ui/quiet-report`. Work on `ui/v1-rebuild`.
Never reference code by line number anywhere (commits, comments, notes, PR text). Refer to
files, exported functions, CSS selectors, i18n keys, `data-act` values and test names.

---

## Part A — Review of the existing quiet-UI attempt (`ui/quiet-report`)

Verdict: a good base for colour and reports. It is only a reskin, not the rebuild. Keep it,
fix it, and build on it.

Keep:
- The OKLCH bone/ink palette with one muted green accent, light and dark, no gradients,
  and the ink-filled primary button.
- No headline, intro text or decorative grid on the intake screen.
- `core/report.js` (`siteReports`): `reports/<site>.json` plus `reports/_index.json` in
  every export, and the separate Report download. It is pure data code in core, which is
  the right place.

Fix:
1. No control was added. `src/main.js` is still one file of about 1,660 lines with the same
   screens. This plan replaces it.
2. Corners shrank and became inconsistent (buttons, tiles, stage and inputs all differ),
   and shadows were replaced by a single 1px line. The result is flat, not sleek. Replace
   with the token scale in Part C.
3. The header is still busy: the theme switch and language button stay there. Move both
   to Settings.
4. Long copy remains (`proxyBody`, `dupBody`, `startOverBody`). Arabic mixes احصد and
   اجمع for "harvest".
5. `core/report.js` detects "bundled" by searching the reason text for "shipped". It must
   use `source.type === 'bundled'`, falling back to the `stale-source` flag. Icons with
   status `override` are reported as `live`; give them their own outcome, `override`.
6. The `.cell .why` warning caption under tiles adds noise. Remove it; show the reason in
   the tooltip and the inspector.

---

## Part B — Ground rules

1. **The pipeline's default output is sacred.** With no user adjustments, `core/`, `cli/`,
   `api/`, the workflow, and the v3/v4 launcher outputs (`manifest.v2.json`, atlas, glyph
   sprite, glyph atlas, `harvest-report.json`) must be byte-identical to `main`. The
   manifest hash must not move. Every new per-icon setting defaults to "current behaviour".
2. **Stack:** vanilla JS + esbuild. No framework. Keep the lazy worker, wasm codecs and
   fonts. Budget: `app.js` ≤ 48 KB gzip.
3. **Test hooks:** before deleting anything, list every `data-act`, role, label and
   `window.__studio` hook the current UI suite uses (see `test/run-all.mjs`). Keep each one
   or update its test in the same commit, on purpose.
4. **Bilingual and RTL** from the first commit. All strings go through `t()` in both `en`
   and `ar`. Use logical CSS properties only.
5. Read the whole README first. The UI must expose everything it documents: pins, kept
   colours, colour modes, palettes, polish, the budget gate, the contrast guard,
   repeated-site handling, additive adding, undo and projects.

---

## Part C — Design language: quiet, minimal, sleek, rounded

The mood: a precise tool that stays out of the way. No welcome copy, no jokes, no
exclamation marks. The icons are the only saturated colour on screen.

**Colour tokens:** keep the quiet branch's `--ink --muted --bg --surface --surface-2
--line --line-strong --accent --ok --warn --bad --stage`. Add `--surface-raised` for
floating layers.

**Corners (one scale everywhere):**
- `--r-xs: 6px` for swatches and chips inside fields.
- `--r-sm: 10px` for inputs and small buttons.
- `--r-md: 14px` for buttons, cells and menu items.
- `--r-lg: 20px` for panels, the inspector and the stage.
- `--r-xl: 28px` for sheets and dialogs.
- `--r-pill: 999px` for segmented controls, toggles and status pills.
- Icon tiles keep the launcher's `--r-icon`.
- Nested elements: inner radius = outer radius − padding.

**Depth:** docked areas are flat (a 1px `--line` border). Only floating layers (popovers,
menus, sheets, toasts, the selection bar) get a soft shadow:
`0 1px 2px oklch(0 0 0 / .06), 0 12px 32px -12px oklch(0 0 0 / .22)`, a little stronger in
dark. No glow, no backdrop blur.

**Type:** Readex Pro. Sizes 12/13/15/18/22. Weights 400/500 (600 only for the project
name). Tabular numbers for counts.

**Spacing:** 4px grid (4, 8, 12, 16, 20, 24, 32).

**Motion:** 120–180 ms, `cubic-bezier(.2,0,0,1)`. No bounce. No hover scale on tiles. All
motion off under `prefers-reduced-motion`.

**Icons:** one line set, 1.5px stroke, 20px box, added to `icon()` in `src/dom.js`.
Icon-only buttons need an `aria-label` and a tooltip.

**Targets and focus:** 36px minimum, 44px under `(pointer: coarse)`. A visible
`:focus-visible` ring in `--accent`.

**Copy rules (rewrite `src/i18n.js`):**
- Labels are 1–3 words. Buttons are verbs.
- No sentences on screen except one-line errors with their fix, for example
  "12 not reached · Set proxy".
- Explanations go into ⓘ tooltips. Delete the inline `*Hint` paragraphs.
- Arabic uses one verb per concept: احصد (harvest), صدّر (export), احتفظ باللون (keep colour).
- Toasts only for actions that can be undone ("Removed · Undo").

---

## Part D — Architecture (split `src/main.js`)

```
src/
  main.js              boot: prefs, lang, theme, worker client, mount
  store.js             state, actions, subscribe(), undo/redo history (100 steps)
  actions/             harvest.js add.js colour.js adjust.js export.js project.js
  views/
    intake.js  workspace.js  rail.js  canvas.js  selection-bar.js
    inspector/look.js  inspector/source.js  inspector/app.js
    export-sheet.js  settings-sheet.js
  ui/                  button seg slider colour-field swatch toggle popover menu
                       sheet dialog toast tooltip tile kbd
  ui/tokens.css  ui/components.css  views/*.css      (replace app.css)
```

- Every user edit goes through `commit(action)`, which records its inverse for undo.
- Persistence reuses the existing project save logic, moved into `actions/project.js`.
- Rendering is keyed: only changed tiles re-render, so adding to the set never rebuilds
  existing tiles.
- `window.__studio` stays as a read-only debug and test surface.

---

## Part E — Per-icon adjustments (the core missing feature)

Each record gets an `adjust` object, saved in the project. An empty `{}` means current
behaviour.

| Field | Control | Effect |
|---|---|---|
| `tint` (3 stops) | OKLCH L/C/H sliders, hex input, eyedropper over the favicon's own colour clusters, "link stops" toggle | uses the existing `setManualColour` |
| `locked` | Keep colour toggle | existing behaviour |
| `render` | seg: Auto · Glyph · Image | forces the traced glyph or the raster atlas cell |
| `scale` | slider 50–90 %, default = pipeline value | how much of the cell the glyph fills |
| `offset` | x/y ±12 % in 0.5 % steps; Alt+arrow keys | nudges the glyph off its visual centre |
| `background` | seg: Auto · Keep · Remove | overrides the corner flood-fill decision |
| `weight` | slider −2…+2 | biases the trace threshold (lighter / heavier strokes) |
| `layers` | Two-tone toggle (v4 only) | keeps or flattens trace layers |
| `invert` | toggle | for light-on-dark marks |
| `exclude` | Leave out of export toggle | keeps the tile but skips it in every export |

Wiring:
1. In `core/`, find where glyph fill, visual centring, background removal and trace
   thresholds are set (the steps the `polish` block of `harvest-report.json` describes).
   Turn each constant into a parameter whose default is the current value.
2. Add a worker message, `adjust(key, adjust)`, that re-renders one icon from the cached
   original. Targets: under 120 ms for scale/offset, under 400 ms for a re-trace. Debounce
   slider input at 60 ms and update the tile live.
3. Exports respect `adjust`. The CLI reads the same object per key from
   `config/icon-overrides.json`. Add a "Copy override JSON" button so a Studio tweak can be
   committed and the weekly workflow reproduces it.

---

## Part F — Screens

### F1. Intake
- A centred column, max 560px, about 30 % down the viewport. No headline.
- One large field (r-lg), placeholder "Paste sites or drop files". It accepts typing,
  pasting, files, folders and JSON. The whole window is a drop target; its border turns
  `--accent` while dragging.
- Pill buttons under the field: `Launcher · N`, `Fihrist · N`, `Both · N`.
- A detected JSON file becomes a chip ("links.json · 33 · Launcher") with a remap popover
  (List / Site / Icon / Name / Names in). The mapping panel is shown inline only when
  detection fails.
- Recent work: rows with 8 tint dots, name, count and relative time. Open and delete
  appear on hover.
- Settings is a single corner icon.

### F2. Workspace
Three zones. The inspector becomes a bottom sheet under 980px.

**Top bar (56px, flat):** project name (inline edit) · status pill ("33 · 2 to review",
which filters on click) · spacer · Add (+ popover: field, files, folder, JSON, Launcher,
Fihrist, Both) · Undo · Redo · Export (primary) · overflow menu (Start over, Report,
Settings). A thin progress line runs under the bar while harvesting.

**Left rail (220px, collapses to 56px):**
- Search (`/`) by name, key or host.
- Groups: All, launcher tabs, Fihrist groups, each with a count.
- Smart filters: Needs review, Locked, Adjusted, Image-only, Excluded.
- Sort: Name · Group · Hue · Status.

**Canvas:**
- Cells (r-md). Each tile is drawn exactly as the launcher draws it, with the name
  underneath. Status is a 6px dot; the reason is only in the tooltip and inspector.
- Canvas toolbar: tile size (48–128px) · Vivid/Muted · Light/Dark · Balanced/Soft/Crisp ·
  Compare (shows the original favicon in the corner) · Colours (opens the F4 popover).
- While harvesting, ghost tiles shimmer, then cross-fade into the real icon.

**Selection:** click selects; Shift-click selects a range; Cmd/Ctrl-click toggles; drag a
marquee on empty canvas; Cmd/Ctrl-A selects all visible; Esc clears.

**Selection bar (2+ selected; floats at the bottom centre, pill shape, raised):**
"N selected" · Colour (one colour, or spread across the palette) · Keep colour · Scale
(relative) · Render · Re-harvest · Exclude · Remove · ✕. Each batch action is one undo step.

### F3. Inspector (360px, r-lg)
The header shows the tile at 96px, name, host and status pill. Three tabs:

- **Look:** a preview strip (Vivid/Muted × Light/Dark at 64px, plus 16/32px favicon
  renders), the colour field, Keep colour, then the Part E controls grouped under "Glyph"
  and "Background". Each changed control shows a dot and its own reset; "Reset all" at the
  bottom. Warnings are one line each with an action ("Separate", "Use suggested").
- **Source:** every attempt as a row (thumbnail, type, status, reason) with "Use this" and
  "Pin". Then Replace image (also by dropping onto the inspector), Re-harvest, Retry live,
  Copy pin JSON, Copy override JSON.
- **App:** name (per language), key, URL, group; then **Export this app**: a one-click
  favicon pack for that link (`favicon.ico` 16/32/48, PNGs, `apple-touch-icon.png`,
  `site.webmanifest`, `head.html` with a copy button).

With several tiles selected, the inspector shows shared values; mixed values show as "—",
and edits apply to all of them.

### F4. Set-wide colour (popover)
Modes: Separate · Follow · Family · Palette · One colour · Original. Then the Variation
slider and seed with Shuffle. The palette editor (presets, build from a colour, swatches,
save) shows only in Palette mode. Kept colours never move; "3 kept" links to a filter.

### F5. Export sheet (r-xl)
Scope: Launcher set · Per-app packs · Custom.
- **Launcher set:** v3/v4 seg; budget meter (atlas KiB out of 150); contrast gate as one
  row; glyph count; file list with sizes; polish details folded behind "Polish · 94".
- **Per-app packs:** one zip with one folder per app (`<key>/favicon.ico`, PNG sizes,
  `apple-touch-icon.png`, `site.webmanifest`, `head.html`). Choose sizes once; export the
  selection or everything visible.
- **Custom:** formats × sizes × quality, for the selection or everything.
- `reports/` is always included.

### F6. Settings sheet
Theme · Language · Proxy (one status line, with the explanation in an ⓘ tooltip) ·
Defaults (catalogue icon fallback, v3/v4, tile size).

### F7. Keyboard
`/` search · arrows move · Enter inspect · Space toggle · Cmd/Ctrl-A all · Esc clear ·
K keep colour · R re-harvest · Delete remove (undoable) · `[` `]` scale · Alt+arrows nudge ·
Cmd/Ctrl-Z undo · Shift+Cmd/Ctrl-Z redo · E export · `?` shortcut sheet.
Shortcuts are disabled while typing in a field.

---

## Part G — Netlify sites: harvest as directly as Vercel

Facts:
- `api/fetch.js` already treats `netlify.app` as a shared suffix, exactly like `vercel.app`.
- Four Netlify hosts are already listed in `api/known-hosts.json`.
- `core/protection.js` detects Netlify password protection only from response headers on
  a non-success status.

So Netlify is not blocked as a whole. Diagnose first, then fix only what the evidence shows.

**G0. Diagnose (no code changes).** Harvest every `*.netlify.app` key from the launcher and
Fihrist files with the CLI and through the deployed Studio. Save each per-site report
(`reports/<key>.json`). Write a table in the PR: host · each attempt's URL · upstream
status · content type · first bytes · final outcome. Fix only the causes the table shows.

**G1. Home page served as the icon.** Netlify apps that send every path back to their home
page return HTML with status 200 for `/favicon.ico`.
- In the source resolver (core), when an image was requested, accept the response only if
  its magic bytes match a real format: PNG, ICO, GIF, JPEG, WebP, AVIF, or SVG starting
  with `<svg` or `<?xml`.
- An HTML body gets attempt status `rejected` with the reason "page returned instead of
  image", and the chain moves to the next source.
- Apply the same check for every host, not just Netlify.

**G2. Password page returned with status 200.** Netlify's password page comes back with
status 200, so the current header check can miss it.
- Extend `netlifyProtection` with a body check for HTML responses from Netlify hosts
  (`x-nf-request-id` or `server: Netlify`). Record a sample of Netlify's password-page
  markup as a test fixture; never guess its markers.
- When detected, the outcome is `blocked` with the existing `NETLIFY_PROTECTED_MESSAGE`.

**G3. Icons embedded in the page.** Sites that put the icon inside the HTML (`data:` URIs,
for example `data:image/svg+xml,...`) must resolve with no network fetch. Add a fixture
modelled on `simpledashboard21.netlify.app`.

**G4. Redirects to a custom domain.** Without a token, a redirect is allowed only to a
listed host, the same registrable domain, or a listed CDN.
- Keep that rule.
- Let a redirect target pass when that target host itself appears in links.json or the
  Fihrist file (see G5).

**G5. Keep the host list complete automatically.**
- Add `cli/known-hosts.mjs`. It reads the launcher `links.json` and the Fihrist file and
  writes `api/known-hosts.json`: sorted, lowercase, every host plus every redirect target
  recorded in the last harvest report.
- Run it in the build and in the weekly workflow.
- Add a test that fails when a site host from either file is missing from the list.
- **Do not** allow all of `*.netlify.app` or `*.vercel.app` without a token. That would
  turn the public endpoint into an open proxy.

**G6. Bot protection.** If any host returns 429/403 with `x-vercel-mitigated` (Vercel) or
an equivalent Netlify challenge, report it as `blocked` with the reason "host challenge
page". Never try to get around it. The fix is to replace the image or add a pin.

Exit criteria for Part G: every Netlify key in both files ends `live`, or ends `blocked`
or `notfound` with a correct one-line reason. No HTML page is ever accepted as an icon.

---

## Part H — Testing and no-regression policy

### H1. Rules
1. Fix the code, not the test. Change a test only when the behaviour change is intended,
   and say why in the commit message.
2. Golden files (snapshots, screenshots, byte hashes) change only in a separate commit
   titled `baseline: <reason>`, with a before/after summary in the PR.
3. Each phase in Part I ends with `npm test` green. Never commit a red suite to "fix later".
4. Every bug found during the rebuild gets a failing test first, then the fix.

### H2. Suites to add or extend (all wired into `test/run-all.mjs`)
- **Byte identity:** run the CLI on the bundled fixtures for `--target v3` and `v4` and
  compare SHA-256 of every output file and the manifest hash against
  `test/golden/hashes.json`, generated once from `main` before any change.
- **Adjust determinism:** each `adjust` field gives the same bytes on two runs; undo
  restores identical bytes; an empty `adjust` equals the golden output.
- **Report outcomes:** one case each for live, bundled, stale, default, override,
  notfound and blocked in `siteReports`.
- **Proxy (offline):** `createHandler` already accepts injected `resolve` and `request`.
  Use recorded responses for: the home page returned as an icon, the Netlify password page
  (200 and 401), a header-protected 401, a `data:` icon page, a custom-domain redirect, a
  Vercel challenge 429, and a private-address redirect (must stay refused). No live
  network in `npm test`.
- **Host list:** every host in the launcher and Fihrist fixtures is in
  `api/known-hosts.json`.
- **i18n:** both languages have the same keys; no empty strings; no string over 40
  characters except keys ending in `Error` or `Confirm`; no `!` in either language.
- **Hook inventory:** a test lists the `data-act` values and `window.__studio` methods
  the UI suite depends on and asserts each still exists.
- **UI (Playwright):** intake → harvest fixtures → select → adjust → undo → batch edit →
  export each scope → reload → state restored. Run in en and ar.
- **Visual:** screenshots at 1440×900 and 390×844, light/dark, en/ar, for intake, the
  workspace with 34 tiles, the open inspector, the selection bar and the export sheet.
  Diff against `test/golden/screens/` with a ≤ 0.1 % pixel threshold.
- **Accessibility:** every interactive element has a name; tab order follows reading
  order; chrome text meets WCAG AA contrast in both themes (computed from tokens); the
  focus ring is visible.
- **Performance:** keep `test/perf.mjs`; no main-thread task over 200 ms during a 34-site
  harvest; scale/offset adjust under 120 ms.
- **Bundle size:** fail when `app.js` gzip is over 48 KB.

### H3. CI
Add `.github/workflows/test.yml`: on every push and PR, Node 22, install Chromium, run
`npm test`, and upload screenshot diffs and the hash report when anything fails. Never
merge to `main` with this check red.

### H4. Live smoke test (manual, before a release)
`npm run build && npm run serve`, then harvest the real launcher and Fihrist files through
the deployed proxy. Compare `reports/_index.json` with the previous release. Any key that
went from live to anything else blocks the release until explained.

---

## Part I — Phases (one commit each, tests green)
0. Golden baselines from `main`: hashes, screenshots, hook inventory. (`baseline:` commit)
1. Part A fixes to `core/report.js`, plus their tests.
2. Tokens, components, icon set, i18n rewrite and parity test. No behaviour change.
3. `store.js` with undo/redo; split `main.js` into views with the same screens.
4. Intake rebuild.
5. Workspace shell: top bar, rail, canvas toolbar, selection model, selection bar.
6. Core adjust parameters with byte-identity and determinism tests.
7. Inspector: Look / Source / App, live adjust, per-app export.
8. Colour popover and batch colour.
9. Export sheet and Settings sheet.
10. Netlify G0 diagnosis table, then G1–G6 with offline proxy tests.
11. Polish: RTL review, reduced motion, focus order, coarse pointer, empty and error
    states, budgets, and a README rewrite of "Using the Studio" in the same plain style.

## Part J — Acceptance
- `npm test` is green in CI. Output with no adjustments is byte-identical to `main`.
- Every icon can be recoloured, scaled, nudged, switched between glyph and image,
  re-traced lighter or heavier, background-forced, excluded and exported alone. All of it
  is undoable, survives a reload, and works on a multi-selection in one action.
- No visible sentence in the workspace except one-line errors.
- WCAG AA on chrome in both themes; every control reachable by keyboard.
- Every Netlify key ends `live`, or `blocked`/`notfound` with a correct reason.
- `app.js` ≤ 48 KB gzip; no long task over 200 ms.

## Notes from the reviewer
- What it keeps: the quiet branch's palette and reports stay as the base; its flatter
  corners and report bugs get fixed.
- Biggest change: the adjustments in Part E are the heart of "more control". They touch
  core, so byte identity with no adjustments is the safety net for the weekly workflow and
  the manifest hash.
- If Fihrist needs its own export format beyond per-app packs, the owner will specify the
  files.
- This review was done by reading the code. The quiet branch was not run and no
  screenshots were taken; the Netlify causes are hypotheses until the G0 table confirms
  them.
