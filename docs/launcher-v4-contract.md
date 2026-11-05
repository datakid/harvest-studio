# Launcher v4 icon contract

Harvest Studio produces the icons the LinkExpress v4 launcher needs with `--target v4`. The default target is `v3` and its output is unchanged.

## Running it

```
node cli/harvest.mjs --profile legacy-v1 --links links.json --out icons --target v4
node cli/harvest.mjs --profile launcher --links links.json --out icons --target v4
```

The reusable workflow takes `target: v4` as an input. The first v4 run must be a full harvest, because kept icons from a v3 run keep their old 96 px glyphs.

## What a v4 run changes

| Area | v3 | v4 |
| --- | --- | --- |
| Glyph PNG (`<key>.glyph.png`) | 96 px | 192 x 192, transparent, pure white |
| Mark placement | 72 percent of the canvas | inside the central 124 x 124 box, centred on its centre of mass and kept fully inside the box |
| Two-tone marks | one flat layer | the darker plane is drawn at flat alpha 0.5 under the primary plane |
| Sprite symbol | one path | two paths, the low one `fill="var(--lx-ga,currentColor)" fill-opacity=".5"`, up to 2560 bytes |
| Tint | any 3-stop tint | `[base, light, deep]` obeying the OKLCH rules below |
| Manifest entry | favicon, glyph, tint | also `ink`, `bbox`, `layers`, `tintRole` |

`ink` is the fraction of the 192 x 192 canvas whose alpha is at least 0.5. `bbox` is `[x, y, w, h]` as fractions of the canvas. `layers` is 1 or 2. `tintRole` is `brand` for a tint derived from the harvested colour and `authored` for a catalogue tint. Entries without a tint have no `tintRole`. The fields are optional in `config/manifest.v2.schema.json`.

## Tint rules

- base: L 0.56 to 0.66, C 0.09 to 0.16
- light: L plus 0.12 to 0.16, hue minus 8 to 14 degrees
- deep: L minus 0.18 to 0.24, hue plus 10 to 16 degrees
- yellows and olives (hue 70 to 115): C at least 0.11 and base hue minus 10 degrees
- white on the base: at least 3.0:1

Colour separation runs inside these limits, so look-alike icons are told apart by hue. Locked tints are never changed. Any tint that still breaks a rule is listed in `harvest-report.json` under `v4.nonConforming`, and tints that were brought into range are listed under `v4.conformed`.

## Checks

`test/v4-contract.mjs` covers the target switch, the manifest fields and schema, the 124 px box, the tint rules, 192 px pure white glyphs, two-tone detection and layered symbols, reuse across targets and the CLI round trip.

Run through the launcher's own `tools/icons-v2.mjs`, the v4 legacy-v1 output builds the sprite, atlases and manifest. The launcher independently picks the same eight two-tone marks Studio detected.

## Launcher side

- `tools/icons-v2.mjs` copies only `sourceTint` today. It must also copy `ink`, `bbox`, `layers` and `tintRole` from the v1 manifest.
- The launcher schema needs the same four optional fields, validated by ajv in `qa:icons`.
- After merging an icons PR from Studio, run `npm run build` so the committed `dist/` matches.
- Studio's web UI still harvests with the v3 contract. v4 is available from the CLI and the workflow.
