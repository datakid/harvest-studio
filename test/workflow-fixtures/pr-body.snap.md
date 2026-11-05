Icons re-harvested for the launcher set by the reusable Harvest Studio workflow.

**Added:** `epsilon`, `gamma--three`
**Changed:** `alpha`, `beta`
**Removed:** `delta`, `gamma--two`

| Key | Source | Tint | Trace | Flags |
| --- | --- | --- | --- | --- |
| `alpha` | svg alpha-new.example.com/icon.svg | #112233 #445566 #778899 | IoU 0.971 | - |
| `beta` | png beta.example.com/icon.png | #aa3344 #dd7788 #551122 | raster fallback | similar-to:alpha |
| `gamma--three` | apple-touch-icon gamma.example.com/touch.png | #3a6 #7c9 #154 | rejected (trace IoU below 0.93) | - |
| `epsilon` | - | - | - | blocked |

**Polish:** 4 tiles, 3 glyphs, 1 raster fallbacks, 0 contrast flags, 1 similar pairs, 1 stroke retraces.

**Needs the owner**

- [ ] `epsilon`: blocked, challenge page without icon links
- [ ] `gamma--one`: stale source, the previous icon was kept

Full report: https://example.com/artifact/1
