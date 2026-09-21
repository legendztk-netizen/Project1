# PI Unicode Fonts

Runtime embeds Noto Sans plus only static CJK chunks required by snapshot text.
Chunks partition non-Latin coverage into 64-codepoint ranges. The manifest
records exact coverage, lengths and SHA-256 hashes. Unsupported characters and
selection above 8 MiB fail before I/O, never silently omit/transliterate text.
The budget is a guard, not proof of a 128 MiB Worker ceiling: benchmark separately.

## Provenance

Unmodified Noto Sans Regular:
<https://github.com/notofonts/noto-fonts/blob/ffebf8c1ee449e544955a7e813c54f9b73848eac/hinted/ttf/NotoSans/NotoSans-Regular.ttf>.
SHA-256: `b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5`.
Original copyright and SIL OFL: `NotoSans-LICENSE.txt`.

CJK variable TrueType source:
<https://github.com/notofonts/noto-cjk/blob/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/Variable/TTF/NotoSansCJKsc-VF.ttf>.
Upstream SHA-256: `990c807e79c25662a5a9ecf7f971baeb2bf2eab9a559e5ecf15cdfdb8561d21f`.
Static intermediate SHA-256:
`dd53a28f9fabaf20ba1e136b00c60cc726cbde0609b16ef332cee5616efe83c4`.
Copyright (c) 2014-2021 Adobe (http://www.adobe.com/), Reserved Font Name
'Source'. Original copyright and OFL name-table records retained; license in
`OFL.txt`. Derivatives renamed Pi CJK Sans / PiCjkSans-Uxxxxxx.

## Deterministic Offline Recipe

Use Python with exactly `fonttools==4.65.0`, from this directory:

```sh
python build_cjk_font.py /tmp/NotoSansCJKsc-VF.ttf /tmp/PiCjkSans-Regular.ttf
python partition_cjk_font.py /tmp/PiCjkSans-Regular.ttf NotoSans-Regular.ttf chunks
```

Font timestamps are preserved. The second step generates `font-manifest.ts`
and chunks, removes obsolete generated chunks, and asserts exact cmap coverage.
Latin-covered codepoints are excluded from CJK chunks. Original encoded coverage
is retained across the union, not limited to a test fixture. The full static
intermediate is build-time only; never import/package it.

## Integration

```ts
const fonts = piUnicodeFonts({
  fontkit, // @pdf-lib/fontkit 1.1.1
  snapshot,
  loadFont: async (asset) => loadPinnedStaticAsset(asset.filename),
});
const pdf = await renderProformaInvoicePdf(snapshot, fonts);
// Persist pdf.fontSha256s, pdf.rendererVersion and pdf.sha256.
```

`loadFont` receives a manifest asset object and returns Uint8Array. Resolve
`NotoSans-Regular.ttf` here, all other filenames under `chunks/`, via Vite URL
assets / ASSETS. Never inline fonts in Worker JS or fetch the full collection.
The pure helper checks loaded lengths/hashes and loads sequentially. Latin-only
documents load Noto Sans alone. `selectPiFontAssets(snapshot)` exposes selection.

Fontkit runtime subsetting corrupts CJK outlines despite successful extraction.
Offline FontTools subsets are embedded intact (`subset:false`). CJK SC is a
regional glyph design, not every Unicode script; uncovered scripts fail issuance.
Semantic tests use layout extraction to preserve same-baseline font runs.
