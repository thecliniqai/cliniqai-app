# Fonts: provenance and licences

Vendored by V2-06 plan 06-01b (ruling R-4 as revised 2026-11-14, R-43). Loaded with `next/font/local`
(`app/fonts/fonts.ts`); the build fetches nothing. Approved state: G2-D addendum of 2026-11-14 in
`docs/v2/VERIFICATION_LOG.md` (V2-DX branch `v2/phase-dx-design-exploration` at `3a78a5d`, PR #7 head). The four font
files and `Manrope-OFL.txt` were copied from that commit with `git show 3a78a5d:<path> > app/fonts/<name>`
(binary-safe) and each SHA-256 was checked against the 06-PLAN revision note before use.

| File | Bytes | SHA-256 | Source |
|---|---|---|---|
| `Inter-latin-wght.woff2` | 48,444 | `f052ee44c3728dfd23aba8a4567150bc314d23903026fbb6ad089422c2df56af` | `3a78a5d:.planning/sketches/themes/fonts/Inter-latin-wght.woff2` |
| `Inter-latin-ext-wght.woff2` | 74,328 | `48f540fb71166bf65a0fe187a71fad500c43143d3e2e42038f527e38c786e90f` | `3a78a5d:.planning/sketches/themes/fonts/Inter-latin-ext-wght.woff2` |
| `Manrope-latin-wght.woff2` | 24,472 | `69379a4a2e4bc31a7e3e3db66951692fef0c8c00ca0aba63668331004559a886` | `3a78a5d:.planning/sketches/themes/fonts/Manrope-latin-wght.woff2` |
| `Manrope-latin-ext-wght.woff2` | 14,756 | `78e9f6cf3867ffb2daa80d211eea9ecaacff15c715ff27bc5c24b26d621a9ea3` | `3a78a5d:.planning/sketches/themes/fonts/Manrope-latin-ext-wght.woff2` |
| `Manrope-OFL.txt` | 4,480 | `05e0d611afd8398bb3285d05eceaf2fbebbb42d930afaa5c40dca1c4254aae26` | `3a78a5d:.planning/sketches/themes/fonts/Manrope-OFL.txt` |
| `Inter-OFL.txt` | 4,380 | `262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a` | rsms/inter `LICENSE.txt` at tag `v4.1` (see below) |

## Inter

- Typeface: Inter by Rasmus Andersson and the Inter Project Authors, <https://github.com/rsms/inter>. Variable font,
  weights 100-900. Role: body and UI text (`--font-sans`).
- Files: from rsms/inter via the npm package `@fontsource-variable/inter` 5.2.5, unmodified
  (`inter-latin-wght-normal.woff2`, `inter-latin-ext-wght-normal.woff2`; the same bytes as V2-DX
  `shared/fonts-trial/SHA256SUMS`). The package was not added to `package.json`.
- Licence: SIL Open Font License 1.1. `Inter-OFL.txt` is rsms/inter's own licence file (CTO ruling in the G2-D
  addendum: "vendor rsms/inter's own OFL.txt (correct copyright line)"), fetched once on 2026-11-14 from
  `https://raw.githubusercontent.com/rsms/inter/v4.1/LICENSE.txt` (byte-identical to the `master` branch file that
  day). It starts with "Copyright (c) 2016 The Inter Project Authors (https://github.com/rsms/inter)".
- Licence-header note: the copy V2-DX vendored (`3a78a5d` `themes/fonts/Inter-OFL.txt`, SHA-256
  `18aabf190848725e2576eefb5c29ba06aac1029d02132252a7f312eac2e50cf3`, as shipped by `@fontsource-variable/inter`)
  starts with the line "Google Inc." and has no Inter Project Authors copyright line. Compared with rsms/inter's file it
  differs only in that first line, one blank line and the heading "PERMISSION & CONDITIONS" (rsms: "PERMISSION AND
  CONDITIONS"); the licence terms are the same OFL 1.1 text. It is not vendored.
- Glyph coverage: ₹ (U+20B9) is in the Latin Extended file, not the Latin file (`fc-query`, 2026-11-14), so a page
  that draws ₹ in body text also loads `Inter-latin-ext-wght.woff2` (risk K-12).

## Manrope

- Typeface: Manrope by Mikhail Sharanda and the Manrope Project Authors, <https://github.com/googlefonts/manrope>.
  Variable font, weights 200-800. Role: titles, display text, prices and token numbers (`--font-display`; the CliniQ AI
  logo's face).
- Files: from google/fonts `ofl/manrope/Manrope[wght].ttf`, fetched by V2-DX on 2026-11-14 and subset to woff2 with
  fontTools (latin and latin-ext ranges, all layout features kept), as recorded in V2-DX
  `themes/fonts/PROVENANCE.txt` at `3a78a5d`. ₹ (U+20B9) is in the Latin file.
- Licence: SIL Open Font License 1.1, no Reserved Font Name (`Manrope-OFL.txt`, verbatim from `3a78a5d`).

## Not vendored

- IBM Plex Sans and IBM Plex Sans Devanagari (in V2-DX `themes/fonts/`): no token names IBM Plex Sans since G2-D.
  "IBM Plex Sans Devanagari" and "Noto Sans Devanagari" stay in the font stacks as names only and are not loaded until
  Hindi renders (PWA_STRATEGY §3.9).
- Nothing was copied from the brand kit in `docs/design-v2/` (reference only).

The PO confirms these files with 06-P5.
