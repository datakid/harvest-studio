# Harvest Studio

A standalone web app that harvests favicons for apps, traces glyphs, colours the whole set and exports it. It does two jobs:

- **Launcher profile**: produces exactly the icon files the LinkExpress launcher reads (`atlas.<hash8>.webp`, `glyphs.<hash8>.svg`, `glyph-atlas.<hash8>.webp`, `manifest.v2.json`, `harvest-report.json`), with a budget gate and a contrast guardrail. This is what the weekly job and the "Launcher set" export use.
- **Any app, any JSON**: paste a site address, drop images or a folder, or load any JSON that lists sites or icons (the launcher `links.json` and the Fihrist file are detected automatically). Export a favicon pack for one site, or every icon in custom formats and sizes.

The work view is additive: you can keep adding sites, files, folders or whole sets to a harvest that is already on screen (see [Adding to a set](#adding-to-a-set)). A reusable GitHub workflow re-harvests the icons of the launcher and Fihrist repositories whenever their JSON changes (see [Automatic updates](#automatic-updates)).

## Using the Studio

**Start.** Paste addresses, drop images or a folder, or load a JSON file. The launcher `links.json` and the Fihrist file are recognised on their own and show as a chip; any other JSON asks which fields hold the name, address and icon. The Launcher, Fihrist and Both buttons harvest the shipped sets. Pick the launcher format (v3 or v4) once; it is remembered.

**Work view.** The left rail searches and filters (groups, needs review, kept, adjusted, image only, left out) and sorts. The middle is the canvas: click a tile to select it, Shift-click for a range, Ctrl or Cmd-click to add or remove one, drag on empty space to select with a box. Tile size, vivid or muted, light or dark, corner shape, Faithful (every tile shows the real favicon in its true colours) and Compare (the source favicon beside each tile) sit above the canvas. Expanding "Colours in this icon" in the inspector lists the icon's real colours, neutrals and black included, so you can pick one, or up to three as a gradient or a mix, as the kept tile colour; a pick outside the v4 launcher range is flagged in the report, never changed. The right side is the inspector for the selection:

- **Look**: the previews, the tile colour (hex, from the icon, fine tune in OKLCH, keep this colour) and the per-icon adjustments: render as glyph or image, size, position, background, stroke weight, two-tone and invert (v4), and Leave out of the set.
- **Source**: what was found, every source tried, Use this one, Unpin, Copy pin JSON, Re-harvest, Replace image.
- **App**: name, key, address and group, and the favicon pack for that app.

With two or more tiles selected a bar offers Colour, Keep, Size, Render, Re-harvest, Leave out and Remove for all of them at once. The **Colours** button opens the set-wide modes (Separate, Follow, Family, Palette, One colour, Original) with their palette editor. **Export** opens a sheet with the Launcher set (with the budget gate and the Polish checklist), Per-app packs for the selection, the visible tiles or everything, and Custom formats and sizes. Settings (theme, language, defaults, fetch proxy) are in the menu beside Export.

**Undo and redo** cover colour, adjustment, name and removal changes, a whole batch counting as one step (Ctrl or Cmd+Z, add Shift to redo). Toasts appear only for undoable actions and for errors; everything else is announced to screen readers.

**Keyboard.** `/` search, arrow keys move between tiles, Enter inspects, Space toggles, Ctrl or Cmd+A selects all, Esc clears, `K` keeps the colour, `R` re-harvests, Delete removes, `[` and `]` change size, Alt with the arrow keys nudges (Shift for larger steps), `E` exports, `?` lists them all.

The interface is English and Arabic (right to left) with logical layout properties throughout, and it adapts to a phone: the rail becomes a drawer and the inspector a bottom sheet.

## Run it

```
npm install        # also installs core/
npm run build      # writes dist/
npm run serve      # http://localhost:4173
npm test           # builds, then runs every suite in test/run-all.mjs
```

Node 22 or newer. The UI suite drives Chromium through Playwright (set `PLAYWRIGHT_BROWSERS_PATH` or have Chromium installed).

## Launcher icons from the command line

```
cd path/to/launcher-repo
node path/to/harvest-studio/cli/harvest.mjs --profile launcher
```

The CLI works relative to the folder you run it in: it reads `./links.json` and writes `./icons/` unless you pass `--links` and `--out`.

Flags: `--from <dir>` (read `<key>.<ext>` files instead of fetching), `--set launcher|fihrist` (what kind of file `--links` is, default `launcher`), `--profile launcher|legacy-v1`, `--out <dir>`, `--links <file>`, `--seed <8 hex>`, `--fa-fallback`, `--only <key>[,<key>...]` (`--only none` keeps every key and only rebuilds the manifest, which prunes removed keys), `--workers <n>` (run analysis and tracing in worker threads; off by default, because it is slower on machines with few cores), `--target v3|v4` (`v4` writes the launcher v4 icon contract: 192 px glyphs in a 124 px box, two-tone layers, OKLCH tint rules and the `ink`, `bbox`, `layers`, `tintRole` fields; see `docs/launcher-v4-contract.md`).

- Exit 0 on success, even when some keys are `stale`. Exit 1 when the budget gate blocks the export or `links.json` is invalid.
- Without `--seed` the CLI reuses the seed from the existing `manifest.v2.json`, or `1f2e3d4c`.
- Tints marked `locked: true` in the existing manifest are kept; `sourceTint` is refreshed from the current favicon.
- `legacy-v1` writes the old PNG files and v1 manifest with the old `separateTints` logic. It exists only for comparing against the old harvest script.
- `config/icon-overrides.json` and `config/extras.json` carry the same meaning as the old `harvest/` files. A `config/source-pins.json` or `config/icon-overrides.json` in the folder you run the CLI in is merged over the shipped one.
- `cli/diff-links.mjs --base <sha> --head <sha> --links <file> --set launcher|fihrist` prints `{ added, changed, removed, renamedOnly, full, only }` for two versions of a links file. A key counts as changed when its address, its FontAwesome icon or its catalogue colour changed; a rename of titles or labels changes no icon.

## Using the catalogue

When the input is a launcher catalogue, each app's own data is used where a favicon falls short:

- **Colour:** a favicon with no usable colour (black, white or grey) takes the app's `gradient` (or `color`) from the catalogue. The report marks it `tintSource: "catalogue"`. A kept (`locked`) tint still wins, and the contrast guard still runs on it.
- **Re-harvesting a few keys:** `--only key1,key2` fetches only those keys. Every other key keeps its entry, image and tint from the existing `manifest.v2.json` and atlas, so the manifest hash does not move when nothing changed. Unknown keys stop the run. Without an earlier manifest the other keys are left out and a warning says so.
- **Blocked sites:** a page answering 401, 403 or 429, or carrying a Vercel or Cloudflare challenge, is reported `blocked`. Netlify documents 401 for password-protected sites and a `Netlify-Site-Protection-Expires-In` header for single sign-on; it documents no markers in the prompt page, so none are matched.
- **Missing favicons:** with `--fa-fallback` (CLI) or the "Use the catalogue icon when no favicon is found" switch in the Studio, a key that ends `notfound` and has no earlier entry to keep is marked `override` and the report names its FontAwesome icon in `fa`. Blocked keys are never converted; they stay `blocked` so you can act on them. It is off by default.
- **Names:** titles and variant labels given as `{ "ar": …, "en": … }` are shown as plain text, the app title plus the variant label (for example "Paid · Daleel 460"). The Studio uses its own language, the CLI uses English. The same applies to any JSON: a name, url or icon field written as `{ "en": …, "ar": … }` is read as one field, and when a file has more than one label language the import panel shows a "Names in" picker (default: the interface language). Keys come from `id`, or from the English label, so they never change with the chosen language.
- **Shipped icons:** `config/known-icons/<key>.<ext>` holds one favicon for each app in `config/catalogue.json`, and the Studio and CLI copy them into the build. When a live fetch ends `notfound` or fails with an error (no proxy, site down, blocked by the network), and there is no earlier manifest entry, the shipped copy is used; the report names it `source.type: "bundled"` and the attempts list says the live fetch failed. A live favicon always wins, a kept manifest entry always wins over the shipped one, and a blocked page still lists the block in its attempts before the shipped copy is used. Refresh a file by dropping a new image into that folder under the same key. `paper` ships the current Messiry mark, and `quoin` and `typing-practice--platen` ship generated marks, because their sites declare no favicon at all; the shipped copy is used whenever a live harvest finds nothing, and the same files serve the Fihrist entries `power-query-manager` and `platen` by address. `typing-practice--tarq` has no shipped copy yet: a live harvest fetches it through the proxy, and an offline run reports it as not found until its icon is saved here and the key is removed from `AWAITING_ICONS` in `test/util.mjs`.
- **One-click catalogue:** the Studio loads `catalogue.json` on start and shows "Harvest my catalogue (N)" on the first screen. It needs no files, no proxy and no typing. The catalogue and icons are served as static files from the deployed site, so anyone who can open the app can read them.
- **Bundled icons by address:** the shipped copy is also found by site address, so an app listed under a different key in another file (the Fihrist set uses `ledger-form--main` where the catalogue uses `ledger-form--tally`) still gets the icon for the same site.
- **Fihrist set:** `config/fihrist.json` (format `fihrist/5`: `tools[]` with `id`, `group`, `pigment`, `ar`/`en`, optional `url` or `variants[]`) is read as its own kind, `fihrist`, with one target per site, named in the chosen language and tinted from its `pigment`. The first screen offers three buttons: the launcher catalogue, the Fihrist apps, or both. Dropping a Fihrist JSON file works the same way.
- **Repeated sites:** when the combined input lists the same site more than once (matched on host without `www`, path without a trailing slash, and query; scheme and case are ignored), the Studio asks before it starts: harvest each site once (the first entry wins), keep every entry, or cancel. It applies to pasted addresses, files and both sets alike, and asks nothing when there are no repeats.
- **Closed apps:** `closed: true` is copied to the report item. The launcher output is not changed.

`test/sample-output/` holds the Launcher profile run on the 33 current icons, for checking the launcher against real output.

## Where icons are looked for

For each site the page head is read and icons are tried in this order, stopping at the first usable one: `apple-touch-icon`, SVG icon links, PNG icon links, web manifest icons, `.ico` icon links, `/favicon.ico`, then `rel="mask-icon"` (a one-colour SVG), the `msapplication-TileImage` meta tag, a set of well-known paths and finally `og:image`. The report names the winner in `source.type` (`mask-icon`, `tile-image`, `well-known`, `og-image`).

- The well-known paths (`/apple-touch-icon.png`, `/apple-touch-icon-precomposed.png`, `/favicon.svg`, `/favicon.png`, `/icon.png`, `/icon.svg`, `/logo192.png`) are tried only when the page was read and declares no icon link at all. Each one is an extra request, so a page with no icon costs up to seven more.
- `og:image` is a last resort and is used only when it is square within 10%; share cards are usually wide and are skipped with the reason `not square`.
- An address reached by two routes is fetched once.
- **Favicon pack:** `favicon.ico` holds three PNG frames at 16, 32 and 48 pixels, each scaled from the full-size original. A custom `.ico` export never adds frames larger than its source (a 32 px source gives 16 and 32).
- The font for SVG text is loaded only when an SVG contains `<text>`. It is `fonts/readex-pro-text.ttf` in the build (100 KB, from `@expo-google-fonts/readex-pro`, because the renderer cannot read the Studio's woff2 files); the built site grew by 100,285 bytes and `worker.js` by 461 bytes.
- Every try is kept in the report as `attempts`, in order: `{ type, href, status, reason }` with status `used`, `failed`, `rejected` (decoded but unusable, for example a single flat colour) or `blocked`. `error` stays the short summary. The Studio shows the list in the Source tab of the inspector, and saves it with the project.

## Colours

Every icon is read in OKLab: its pixels are grouped into colour clusters (k-means, deterministic), and the accent is the cluster with the best mix of area and chroma, with near-white, near-black and edge clusters counted down. A favicon with no usable colour takes the catalogue gradient or the Fihrist pigment. A launcher tint always has exactly three stops.

The default mode is **Separate**. Inside each launcher tab or Fihrist group, tints are pushed apart until every pair differs by at least 0.06 in OKLab, and by at least 14 degrees of hue where chroma allows, moving each icon as little as it can (hue 25 degrees, chroma 15 percent, lightness 0.05 at most) and always passing the contrast guard. The result is seeded, so every run is the same. Kept (locked) tints never move. **Follow** keeps every favicon on its own colour and varies only look-alikes slightly. **One colour** paints everything with a colour you pick, **Family** spreads look-alikes further, **Palette** spreads a palette over the set, and **Original** leaves the favicon colours alone. Any icon can be given its own colour and kept.

The contrast guardrail checks the launcher's vivid tile (white glyph on the clamped tint) in light and dark. Tints that fail are darkened by up to 0.12 lightness; locked or manual tints are flagged instead of changed. A tint that still fails blocks the Launcher export.

**Polish score.** `harvest-report.json` carries a `polish` block (tiles, glyph tiles, glyphs inside the safe area, rounded corners, similar pairs, raster fallbacks, contrast flags and the keys whose stroke was re-traced) and the Studio shows the same checklist in its Polish dialog, with preview strips for the vivid and muted tiles in light and dark. Glyphs fill 72 percent of the cell and are centred on their visual centre. A traced glyph whose stroke is more than 1.6 times the set median is traced again with a heavier or lighter threshold.

**Backgrounds.** A flat white or near-black square behind a logo is removed (flood fill from the corners, only when it covers at least 18 percent of the image and enough of the mark stays), and the mark is re-centred in the safe area. A flat chromatic background is kept.

## Source pins

An icon can be pinned to one source. `config/source-pins.json` maps a key to an address, and the Source tab shows every source it tried, with "Use this one", "Unpin" and "Copy pin JSON". A pinned source is recorded as `source.type: "pinned"`. A photographic or JPEG `apple-touch-icon` yields to a declared SVG that renders with at least two chromatic colours.

## Pages are read only up to the head

The CLI, the Studio and the proxy read a page only until its closing `</head>`, or its first 256 KiB if there is none, so pages that inline a lot of content (Protocols is about 412 KB) are no problem. The Studio asks the proxy for this with `mode=head`; it applies to `text/html` only, and images and JSON keep the full 512 KiB limit.

## Fetch proxy

Browsers cannot read most sites (Netlify sites send no CORS headers), so `api/fetch.js` (a Vercel function) fetches pages and icons for the app.

**Built in, no setup.** The deployed Studio reaches every site in `api/known-hosts.json` (built from the catalogue, the extras and the Fihrist file by `scripts/known-hosts.mjs`) with no token: same-origin browser requests to those hosts are answered, limited per address by `STUDIO_PUBLIC_RATE` (default 300 a minute). Settings shows "Proxy: built-in (automatic)". Redirects may go to another known host, to the same registrable domain, or to a host in `config/proxy-cdn.json` for images and pages. Any other host still needs a token. If you prefer that a Netlify site answers the browser itself, `docs/netlify-cors.md` has an optional `_headers` snippet.

**With a token.** Requests that carry the `x-studio-token` header matching the `STUDIO_TOKEN` environment variable can fetch any public address, and the function:

- accepts only http and https on ports 80, 443, 8080 and 8443, with no credentials in the URL
- resolves the host and refuses any private, loopback, link-local, multicast or reserved address (IPv4 and IPv6), then connects to the address it checked, so a changing DNS answer cannot redirect it
- follows at most three redirects and checks every hop the same way
- cuts the response at 512 KiB (an HTML page requested with `mode=head` stops at its closing head tag or 256 KiB) and the request at 8 seconds
- passes only pages, images, JSON and manifests
- returns the upstream status in `x-upstream-status`
- forwards `If-None-Match` and `If-Modified-Since`, and returns a 304 as status 200 with `x-upstream-status: 304`, an empty body and the upstream `x-upstream-etag` and `x-upstream-last-modified`

Without a proxy the Studio can only reach sites that allow direct browser access; every other address ends `not found` with the reason "needs the fetch proxy" in its item panel, and a notice names how many were not reached. Images you drop in never need the proxy.

The Studio's launcher export includes `harvest-report.json` from the last harvest (with a `note` saying so); edits made in the Studio afterwards are not reflected in it. Opened sets have no report.

Set `STUDIO_TOKEN` (and optionally `STUDIO_ORIGIN` to lock CORS to your Studio address) in the Vercel project, then paste the function address and the token into Settings if you want to harvest sites outside the known list. The token stays in the browser tab only. Keep the token private. The CLI and the GitHub workflow run in Node, where CORS does not apply, so they need neither a proxy nor a token.

- **Rate limit:** each token may make `STUDIO_RATE_LIMIT` requests per minute (default 1200, which covers a full catalogue run; `0` turns it off). Over the limit the proxy answers 429 with `retry-after`, and the Studio stops with a message naming the wait. Requests with a wrong token do not count. The counter lives in the memory of one function instance, so on Vercel it limits each warm instance, not the whole project; treat it as a guard against loops, not as a quota.
- **Caching:** a successful image response carries `cache-control: private, max-age=300` and `vary: x-studio-token`, so a request with another token never reuses the cached copy. Everything else, including errors, stays `no-store`.

## Adding to a set

The Add button in the top bar opens a panel: type or paste one or many addresses, or use Files, Folder, JSON, and the Launcher, Fihrist and Both buttons (they add only the entries that are not there yet). You can also drop files anywhere on the view, or paste addresses with Ctrl or Cmd+V when no field has focus. Ghost tiles with the names appear at once and fill in as each site finishes, and the tiles already on screen are not rebuilt.

- **Same key:** from the same site (or a file with no address) the Studio asks once for the whole batch: update the existing tile, keep both, or skip. A key from a different site is added with a `-2` suffix and a notice says so. Updating keeps a kept colour.
- **Colours:** new tiles are coloured against every tile already there, which stay where they are.
- **Each tile** has Re-harvest, Use another source and Replace image in the Source tab, Keep this colour in the Look tab and Remove in the App tab (with Undo for 8 seconds).
- **Saving:** additions, removals and kept colours are saved to the project automatically. Start over asks first only while there are unsaved changes.

## Performance

Measured on a 2-CPU machine against `docs/baseline.json`, and checked by `test/perf.mjs`.

- Requests go through one limiter: 8 at a time, 2 per host, first in first out. The first tile of a 34-site harvest shows in about one second with 300 ms of proxy latency, and the whole harvest takes about six seconds. No main-thread task passes 200 ms.
- The worker caches fetched pages and icons in IndexedDB (`hs:cache`, 24 hours, 50 MB, least recently used first) and re-harvest revalidates with `If-None-Match`. A second harvest of the same set makes no upstream requests.
- When the pixels of an icon are unchanged, its colour analysis and trace are reused, with byte-identical output.
- The worker, the wasm codecs and the font subsets load only when needed. `app.js` is 46.8 KB gzip against a budget of 48 KB, and `test/perf.mjs` enforces the budget.
- The CLI harvest of the 34 fixtures takes about 2.3 seconds, 1.24 times the v0.1 time: glyphs are now traced as up to eight candidates and heavy strokes are traced again, which is what makes the icons correct.

## Automatic updates

`.github/workflows/harvest-icons.yml` is a reusable workflow. When the launcher's `links.json` (or the Fihrist JSON) changes on `main`, it finds the keys that were added or changed, re-harvests only those, prunes removed ones, and commits the result to `beta/icons`. It opens one pull request `beta/icons` into `main`, or updates it. If the manifest hash does not change there is no commit and no pull request. A change that touches only titles or labels stops early with "no icon-relevant changes".

Add a short caller to each repository (`docs/callers/launcher-icons.yml` and `docs/callers/fihrist-icons.yml` are ready to copy):

```
jobs:
  icons:
    permissions:
      contents: write
      pull-requests: write
    uses: datakid/harvest-studio/.github/workflows/harvest-icons.yml@v0.2.0
    with:
      set: launcher
      links-path: links.json
      icons-dir: icons
      base-sha: ${{ github.event.before }}
      head-sha: ${{ github.sha }}
    secrets: inherit
```

The caller runs on a push to the links file, by hand, and weekly. On the weekly and manual runs there is no `before`, so everything is harvested. The run fails when the budget gate or the contrast gate blocks, and `harvest-report.json` is uploaded either way. The pull request text lists the added, changed and removed keys, a table of each icon's source, tint, trace score and flags, the polish counts, and a checklist of blocked or stale-source items.

Pull requests opened with the default `GITHUB_TOKEN` do not start other workflows. If the repository's own checks must run on `beta/icons`, create a GitHub App, give the workflow its token with `actions/create-github-app-token`, and pass it as the `token` secret.

## Deploy

Push this folder as its own repository and import it in Vercel with the default root directory. `vercel.json` sets the build, a strict content security policy and long caching for wasm and fonts.

## Layout

- `core/`: the portable pipeline (ESM, runs in Node 22 and a Web Worker)
- `src/`: the app (vanilla JS, built with esbuild): `store.js` holds state, history and the event bus, `actions/` change it, `views/` and `ui/` draw it, `worker.js` runs the codecs
- `cli/`: the harvest entry point, `diff-links.mjs` and the workflow helpers
- `.github/workflows/`: the reusable icon workflow
- `docs/`: the baseline numbers, the launcher v4 contract, the Netlify note, caller workflows and screenshots
- `api/`: the fetch proxy
- `config/`: overrides, extras and the `manifest.v2.json` schema (replace it with the launcher's own once that lands)
- `test/`: suites and the 33 fixtures

`src/ui/tokens.css` is a snapshot of the launcher's corner tokens, taken from launcher commit `25298f3`. The vivid and muted tile rules in `src/colour.js` follow the same commit.

## Manifest notes

`hash` in `manifest.v2.json` is the first 8 hex characters of the SHA-256 of the canonical JSON of `icons` without `checkedAt`, so a weekly run that changes nothing keeps the same hash. Per-icon `hash` is the SHA-256 of the 192 by 192 RGBA pixels of the normalised favicon.

## Licences

The traced glyphs use `esm-potrace-wasm`, which is GPL-2.0 (it wraps potrace). The built Studio bundles it, so distributing the built app means following the GPL for that bundle. `@resvg/resvg-wasm` is MPL-2.0, the `@jsquash/*` codecs are Apache-2.0, `svgo`, `fflate` and `omggif` are MIT, and Readex Pro is OFL-1.1.

## Opening earlier work

- **Existing sets:** drop `manifest.v2.json` together with its `atlas.<hash>.webp` (and optionally `glyph-atlas.<hash>.webp` and `glyphs.<hash>.svg`) and press "Open this set". Colours, kept colours and the seed carry over, and nothing is recoloured on open. The icons come from the atlas cells, so they are at the atlas cell size (128 px by default).
- **Projects:** every working set is saved automatically in this browser (IndexedDB, newest 12) and listed on the start screen under "Recent work". A restored project keeps its colours, locks, pins, seed and mode. Images you replaced lose the full-size original, so a favicon pack's 512 px icon is made from the 192 px image.
- **Palettes:** the Palette mode spreads a palette evenly across the icons, with optional slight variation. Start from a preset, build one from a colour (analogous, complementary, triad, split, four, shades) or edit the swatches, then save it by name. Saved palettes live in this browser's local storage.

## Known limits

- Lossy atlas files use WebP effort 5 and the lossless probe skips the slow encode when it cannot fit, so a full catalogue harvest takes about a third of the time of earlier versions; atlas files are a few percent larger for the same quality step, still inside the 150 KiB budget. Each target in the Studio is capped at 30 seconds in total; a timeout is retried once, and the progress line names the sites it is still waiting for.
- An SVG favicon with `<text>` is drawn with the bundled Readex Pro Regular (Latin, Latin Extended, Vietnamese and Arabic). Text with emoji or other scripts is rejected as `failed` with the reason "svg text uses characters the bundled font lacks" instead of drawing empty boxes, and the next icon source is tried. Drop the image in yourself or use Replace image for those sites.
