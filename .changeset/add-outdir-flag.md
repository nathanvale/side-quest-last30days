---
'@side-quest/last-30-days': patch
---

Add --outdir flag to write output files to a custom directory instead of the default ~/.local/share/last-30-days/out/. This enables parallel CLI invocations to write to isolated directories without racing on the same output path.
