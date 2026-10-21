# Harvest Studio

A standalone web app that harvests favicons for apps, traces glyphs, colours the whole set and exports it. It does two jobs:

- **Launcher profile**: produces exactly the icon files the LinkExpress launcher reads (`atlas.<hash8>.webp`, `glyphs.<hash8>.svg`, `glyph-atlas.<hash8>.webp`, `manifest.v2.json`, `harvest-report.json`), with a budget gate and a contrast guardrail. This is what the weekly job and the "Launcher set" export use.
- **Any app, any JSON**: paste a site address, drop images or a folder, or load any JSON that lists sites or icons (the launcher `links.json` is detected automatically). Export a favicon pack for one site, or every icon in custom formats and sizes.

## Run it

```
npm install        # also installs core/
npm run build      # writes dist/
npm run serve      # http://localhost:4173
npm test           # builds, then runs the launcher, proxy, sources, UI and feature suites
```

Node 22 or newer. The UI suite drives Chromium through Playwright (set `PLAYWRIGHT_BROWSERS_PATH` or have Chromium installed).

## Launcher icons from the command line

```
cd path/to/launcher-repo
node path/to/harvest-studio/cli/harvest.mjs --profile launcher
```

The CLI works relative to the folder you run it in: it reads `./links.json` and writes `./icons/` unless you pass `--links` and `--out`.

Flags: `--from <dir>` (read `<key>.<ext>` files instead of fetching), `--profile launcher|legacy-v1`, `--out <dir>`, `--links <file>`, `--seed <8 hex>`, `--fa-fallback`.

- Exit 0 on success, even when some keys are `stale`. Exit 1 when the budget gate blocks the export or `links.json` is invalid.
- Without `--seed` the CLI reuses the seed from the existing `manifest.v2.json`, or `1f2e3d4c`.
- Tints marked `locked: true` in the existing manifest are kept; `sourceTint` is refreshed from the current favicon.
- `legacy-v1` writes the old PNG files and v1 manifest with the old `separateTints` logic. It exists only for comparing against the old harvest script.
- `config/icon-overrides.json` and `config/extras.json` carry the same meaning as the old `harvest/` files.

## Using the catalogue

When the input is a launcher catalogue, each app's own data is used where a favicon falls short:

- **Colour:** a favicon with no usable colour (black, white or grey) takes the app's `gradient` (or `color`) from the catalogue. The report marks it `tintSource: "catalogue"`. A kept (`locked`) tint still wins, and the contrast guard still runs on it.
- **Missing favicons:** with `--fa-fallback` (CLI) or the "Use the catalogue icon when no favicon is found" switch in the Studio, a key that ends `notfound` and has no earlier entry to keep is marked `override` and the report names its FontAwesome icon in `fa`. Blocked keys are never converted; they stay `blocked` so you can act on them. It is off by default.
- **Names:** titles and variant labels given as `{ "ar": …, "en": … }` are shown as plain text, the app title plus the variant label (for example "Paid · Daleel 460"). The Studio uses its own language, the CLI uses English.
- **Closed apps:** `closed: true` is copied to the report item. The launcher output is not changed.

`test/sample-output/` holds the Launcher profile run on the 33 current icons, for checking the launcher against real output.

## Colours

The default mode, **Follow**, keeps every icon on its own favicon colour. Only look-alikes (colours within a small distance) are varied, inside their own colour (hue about ±10°, lightness ±0.06, chroma ±8%), seeded per icon so the result is the same every run. **One colour** paints everything with a colour you pick, optionally varied. **Family** is the old harvest behaviour, which spreads look-alikes further. **Original** leaves the favicon colours alone. Any icon can be given its own colour and kept.

The contrast guardrail checks the launcher's vivid tile (white glyph on the clamped tint) in light and dark. Tints that fail are darkened by up to 0.12 lightness; locked or manual tints are flagged instead of changed. A tint that still fails blocks the Launcher export.

## Pages are read only up to the head

The CLI, the Studio and the proxy read a page only until its closing `</head>`, or its first 256 KiB if there is none, so pages that inline a lot of content (Protocols is about 412 KB) are no problem. The Studio asks the proxy for this with `mode=head`; it applies to `text/html` only, and images and JSON keep the full 512 KiB limit.

## Fetch proxy

Browsers cannot read most sites, so `api/fetch.js` (a Vercel function) fetches pages and icons for the app. It only answers requests that carry the `x-studio-token` header matching the `STUDIO_TOKEN` environment variable, and it:

- accepts only http and https on ports 80, 443, 8080 and 8443, with no credentials in the URL
- resolves the host and refuses any private, loopback, link-local, multicast or reserved address (IPv4 and IPv6), then connects to the address it checked, so a changing DNS answer cannot redirect it
- follows at most three redirects and checks every hop the same way
- cuts the response at 512 KiB (an HTML page requested with `mode=head` stops at its closing head tag or 256 KiB) and the request at 8 seconds
- passes only pages, images, JSON and manifests
- returns the upstream status in `x-upstream-status`

Set `STUDIO_TOKEN` (and optionally `STUDIO_ORIGIN` to lock CORS to your Studio address) in the Vercel project, then paste the function address and the token into Settings. The token stays in the browser tab only. There is no rate limiting; keep the token private.

## Deploy

Push this folder as its own repository and import it in Vercel with the default root directory. `vercel.json` sets the build, a strict content security policy and long caching for wasm and fonts.

## Layout

- `core/`: the portable pipeline (ESM, runs in Node 22 and a Web Worker)
- `src/`: the app (vanilla JS, built with esbuild), `worker.js` runs the codecs
- `cli/`: the Node entry point
- `api/`: the fetch proxy
- `config/`: overrides, extras and the `manifest.v2.json` schema (replace it with the launcher's own once that lands)
- `test/`: suites and the 33 fixtures

`src/tokens.css` is a snapshot of the launcher's corner tokens, taken from launcher commit `25298f3`. The vivid and muted tile rules in `src/colour.js` follow the same commit.

## Manifest notes

`hash` in `manifest.v2.json` is the first 8 hex characters of the SHA-256 of the canonical JSON of `icons` without `checkedAt`, so a weekly run that changes nothing keeps the same hash. Per-icon `hash` is the SHA-256 of the 192 by 192 RGBA pixels of the normalised favicon.

## Licences

The traced glyphs use `esm-potrace-wasm`, which is GPL-2.0 (it wraps potrace). The built Studio bundles it, so distributing the built app means following the GPL for that bundle. `@resvg/resvg-wasm` is MPL-2.0, the `@jsquash/*` codecs are Apache-2.0, `svgo`, `fflate` and `omggif` are MIT, and Readex Pro is OFL-1.1.

## Opening earlier work

- **Existing sets:** drop `manifest.v2.json` together with its `atlas.<hash>.webp` (and optionally `glyph-atlas.<hash>.webp` and `glyphs.<hash>.svg`) and press "Open this set". Colours, kept colours and the seed carry over, and the mode is set to Follow so nothing is recoloured on open. The icons come from the atlas cells, so they are at the atlas cell size (128 px by default).
- **Projects:** every working set is saved automatically in this browser (IndexedDB, newest 12) and listed on the start screen under "Recent work". A restored project keeps its colours, locks, seed and mode. Images you replaced lose the full-size original, so a favicon pack's 512 px icon is made from the 192 px image.
- **Palettes:** the Palette mode spreads a palette evenly across the icons, with optional slight variation. Start from a preset, build one from a colour (analogous, complementary, triad, split, four, shades) or edit the swatches, then save it by name. Saved palettes live in this browser's local storage.

## Known limits

- An SVG favicon that draws an emoji or other text (`<text>`) cannot be rendered, because the renderer has no fonts. Those sites report "fully transparent"; drop the image in yourself or use Replace image.

## Not included

Committing exports straight to GitHub (do that from your own repo), and the CLI does not offer the Palette mode.
