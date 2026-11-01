# Baseline before v0.2

Measured on 2026-11-01 at commit `60d8baa` (package version 0.1.0), Node v22.23.4, 2 CPUs. The same numbers are in `docs/baseline.json`, which the Phase 6 tests read.

## Numbers

| Measure | Value |
|---|---|
| `npm test` (build plus all 19 suites, 194 checks) | 104 s wall, 0 failed |
| Fixture harvest through the CLI (`--from test/fixtures --links config/catalogue.json`) | 1.84 s median of 3 (1.82, 1.84, 1.96) |
| Same harvest in one process, repeated | 2.08 s cold, then 1.22, 1.19, 0.92, 0.87, 0.88 s |
| Targets in the fixture run | 34 targets, 33 found, 1 not found (`studio` has no fixture) |
| Favicon atlas | 87,216 bytes, `lossy-q90` |
| Glyph atlas | 12,860 bytes, lossless |
| Glyph sprite | 15,917 bytes raw, 6,437 gzipped |
| Raster mask fallbacks | 4 |
| Icons flagged similar | 17, inside 2 colour groups that cover 29 keys; mode `follow` |
| `dist/app.js` | 26,596 bytes gzipped |
| `dist/worker.js` | 328,845 bytes gzipped |
| `dist/app.css` | 5,693 bytes gzipped |

The four raster fallbacks on the fixtures are `ledger-form--folio` (IoU 0.908), `roi--full` (0.940), `plan-maker--full` (0.919) and `criteria-builder--meridian` (0.934).

The owner's live run of 2026-10-31 reported 6 raster fallbacks and a 17.7 KB glyph atlas. The fixtures do not reproduce that: Protocols is the stale white square on the live run but a normal icon in `test/fixtures`, and Qisma/Mizan Full traces fine on the fixture. The Phase 3 targets are checked on the fixtures, so the live run needs its own check after release.

## Where the time goes

In-process warm runs take about 0.9 s. Tracing is the largest part and the first run adds about 1.2 s of wasm start-up. A CLI run adds Node start-up on top. The CLI already uses 8 workers in `--from` mode, so a bigger fetch pool changes little there. The Phase 6 target of 30% faster has to come from tracing, decode and start-up work.

## Brief against the code

Things the brief assumes that the code confirms:
- `prefs.proxyUrl` defaults to `''`, the worker marks any failed direct fetch `fatal`, and the proxy answers 500 when `STUDIO_TOKEN` is not set.
- `TARGET_TIMEOUT_MS` is 25000, and `fetchRetry` throws straight away on `e.timeout`.
- The worker's `harvest` handler replaces `records` with a new `Map`.
- `processTarget` skips every same-host candidate when the page fetch failed, which is why `favicon.ico` was skipped for Protocols.

Things that need a decision or differ:
1. **Tint shape.** `config/manifest.v2.schema.json` requires `tint` to be exactly 3 hex values, and today they are `[base at L 0.66, light at L 0.86, dark at L 0.38]` built from one hue and a clamped chroma. The brief describes a two-stop gradient (`#6c58d4` to `#b9aee6`) and tests the accent within 0.03 of the real colour, which the fixed 0.66 lightness cannot meet. Plan: keep 3 stops so the schema and launcher keep working, put the measured accent in stop 0 with its real lightness, the second cluster (or a synthetic lighter stop) in stop 1, and a darker derived stop in stop 2.
2. **Symbol size cap.** `SYMBOL_MAX_BYTES` is 1536. The brief's clean-shape rule says "path under 2 KB", which the cap would reject first. Plan: keep 1536 as the cap and apply the clean-shape rule to paths under it, unless the owner wants the cap raised.
3. **Tab grouping.** `separate` works inside a launcher tab, but `buildTargets` does not carry the category id onto a target. Plan: add `groupId` to targets (category id for the launcher, `group` for Fihrist) without changing the manifest schema.
4. **Existing `family` mode.** `separateTints` already separates tints across different apps and is used by `family` and `legacy-v1`. The new `separate` mode is a separate function with its own thresholds, so the old behaviour stays as it is.
5. **Corner mask.** `src/tokens.css` defines `--r-icon` as .27 of the edge (.31 soft, .2 crisp). `matteCorners` only removes dark corners today.
6. **`config/catalogue.json` and `test/links.json`** still hold the old `studio` key and have no `palette` category. They have to be refreshed from the launcher's current `links.json`, which needs the launcher repo name.
7. **No `.github/` folder and no `docs/` folder existed.** The "weekly job" from Phase 7 is not in this repo.
8. **The brief's T6.1** compares CLI wall time, which is mostly start-up. See the note above.
9. **The proxy header check is not a security boundary.** `Sec-Fetch-Site` and `Origin` can be set by any non-browser client, so the tokenless path is safe only because of the known-hosts list, the per-IP limit and the existing SSRF checks. The PR says so plainly.

## Environment note

Three Playwright suites (`ui.mjs`, `features.mjs`, `fihrist.mjs`) look for `chromium-*/chrome-linux/chrome`, but this machine has `chrome-linux64`. A symlink in `/opt/pw-browsers/chromium-1243` fixed it for the baseline run, and no test file changed.

## Open questions for the owner

1. The launcher repo name and the Fihrist repo name, the path of the Fihrist JSON, and where Fihrist reads its icons.
2. For workflow PRs: is `GITHUB_TOKEN` fine, or should it be a GitHub App token so CI runs on the PR?
3. Can the `_headers` CORS snippet go on the Netlify apps? It is optional.
4. Confirm the pins: `drug-list--full` to `favicon.svg`; any others?
5. Confirm the refreshed `known-icons/protocols.*` once the live fetch works.
6. Tint shape: is the 3-stop plan above right?
7. Symbol cap: keep 1536 bytes, or raise it to 2048?
8. Pushing: the Claude GitHub App is not installed for `datakid`, so branches and PRs cannot be pushed from this session.
