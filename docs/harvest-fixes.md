# Harvest Studio: what to fix

From the runs of 2026-10-31 (34 icons, all "found", gate ok). The second run (18:12 UTC) produced the same icon files and manifest as the first; only the Protocols failure reason changed, and the notes below use the newer report. I read `harvest-report.json`, `manifest.v2.json` and every cell of the favicon atlas. I have not seen Studio's own code, and I could not reach the sites from my sandbox, so each item says what the report shows and what to ask for.

What you see in the launcher today is fine: every icon has a glyph, and the favicon atlas is only the third fallback. What is wrong is mostly the source Studio picked and the colour it derived from it.

## Fix these first

### 1. Protocols: Studio used its old bundled copy
- Evidence: for `https://strong-snickerdoodle-02a92f.netlify.app/` the page fetch failed with "needs the fetch proxy: this site does not allow direct browser access" and the `favicon.ico` was skipped ("the site did not answer"), so the source is `bundled` ("live fetch failed, using the copy shipped with the app"). The first run reported two 20-second timeouts instead, so the site may also be slow.
- Result: the favicon cell is a pixelated, opaque white square (about 84% white). The glyph is built from that stale copy and only falls back to the raster mask because its trace score is 0.949, just under the 0.95 cut-off.
- Ask: turn on Studio's fetch proxy for this site, then re-harvest (add a longer timeout and a retry if it still fails), or let me upload the real icon. When an icon has a white background, remove it or mask it like the others.

### 2. Drug List Full: wrong source, so the colour is wrong
- Evidence: the source is `https://lx-search-kappa.vercel.app/icon-spring.jpg`, which the site declares as its apple-touch-icon. The cell is a dark tile with lavender strokes, and the tint came out as a grey lavender (`#908abd`). The launcher uses that tint as the version's accent, so the tile looks washed out.
- The original brief says the site's real icon is `https://lx-search-kappa.vercel.app/favicon.svg`: two violet strokes (`#6c58d4` and `#b9aee6`) on transparent, with a `prefers-color-scheme: dark` block inside the SVG.
- Ask: for this icon prefer the SVG over the apple-touch-icon, render it in the light scheme, and derive the tint from the violet. A per-icon "pin this source" option would solve it.
- Drug List Free is fixed (real orange rings, source apple-touch-icon).

### 3. Alt and Harvest need re-reading from the new `links.json`
- Evidence: Studio keyed the Harvest site as `studio`, but the launcher's id is `harvest`, so the Harvest tile has no mark. The `studio` entry is unused.
- `links.json` (PR #8) now has a category with the id `palette` that holds `alt` and `harvest`.
- Ask: re-harvest from the updated `links.json`, read the `palette` category like any other, and key the entry `harvest`.

## Worth asking for

### 4. Six glyphs fell back to raster masks
- Trace score below 0.95: Form Folio 0.909, Protocols 0.949, ROI Full 0.937, Qisma/Mizan Full 0.926, Plan Maker Full 0.939, Criteria Builder Meridian 0.925.
- The glyph atlas is now 17.7 KB (it was 9.0 KB for 7 masks before) and loads on every first visit. I raised the first-load budget by 9 KB to fit it.
- Ask: trace these more carefully (simplify, or accept a lower score for clean shapes) and compress the mask atlas harder. If they become vectors, I can lower the budget again.

### 5. Tints are too similar
- The report flags 17 of 34 icons as similar, and the colour mode is `keep` with no groups. Many are the same terracotta (`#d27556`, `#d47354`, `#d47452`, `#cb7a5b`).
- You asked earlier for muted, distinct colours within a tab.
- Ask: a mode that separates the tints within a tab, or pin the colours for the flagged ones.

### 6. Seven favicon cells have square corners, the rest are rounded
- `dafter`, `id-dates--contacts`, `ledger-form--tally`, `paid-calculator--calc`, `protocols`, `solver`, `studio`. They come from apple-touch-icons, which are square by design.
- Not visible today because the favicon atlas is only a fallback.
- Ask: apply the same rounded mask to every cell.

## Minor
- Entity Tracker: its apple-touch-icon was blocked ("needs the fetch proxy: this site does not allow direct browser access"), so Studio used the SVG. Fine today, but allow the fetch proxy for that site too (the same cause as Protocols).
- Form Folio comes from a small `.ico` and its trace failed (0.909), so the mark is soft. Use an apple-touch-icon or SVG if the site has one.
- Six tints were nudged for contrast (entity-tracker, index-builder, paid-calculator--calc, plan-maker--express, protocols, solver). Informational only.

## Short version to paste into Studio
1. Protocols: the live fetch was blocked ("needs the fetch proxy") and the old bundled white square was used. Use the fetch proxy for this site, or take my upload, and remove the white background.
2. Drug List Full: use the SVG favicon in the light scheme instead of the apple-touch-icon, and take the tint from the violet.
3. Re-read `links.json` (it now has a `palette` category with `alt` and `harvest`) and key the Harvest entry `harvest`.
4. Trace the six rejected glyphs better and shrink the mask atlas.
5. Separate the similar tints within each tab.
6. Round the corners of the seven square cells.
