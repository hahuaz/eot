# PDF text-extraction library comparison

Why this pipeline uses Apache PDFBox instead of pdfplumber (the original
extractor) or any of the other libraries evaluated along the way. Every
library below was tested against the same real, previously-broken PDF -
2024Q4 `ccola` (Coca-Cola İçecek) - whose "Hasılat (net)" row and several
"-İlişkili..." balance-sheet detail rows were the hardest case found in the
dataset, plus spot checks against other symbols as noted.

## The root problem

`ccola`'s PDF embeds a font (`TimesNewRoman`, `/Encoding /Identity-H`) with:

- no `/ToUnicode` CMap entry, and
- no embedded font program (`/FontFile`, `/FontFile2`, `/FontFile3` all
  absent from its `/FontDescriptor`).

This was confirmed by dumping the PDF's own object dictionary directly. There
is **no information in the file** that maps this font's glyph IDs back to
real Unicode characters - any tool has to guess, by substituting a system
font and assuming its glyph-ID ordering lines up with whatever the original
document generator used. Every library below guesses differently.

## Libraries tried, worst to best

### Poppler (`pdftotext -layout`)

Broadly garbled - not just Turkish-specific characters. Values come out
misaligned or missing entirely, and header text renders as visibly scrambled
runs (e.g. `Baimsiz` for `Bağımsız`, and outright cipher-looking garbage
like `7XWDUODU DNVL EHOLUWLOPHGLNoH` for `Tutarlar aksi belirtilmedikçe`).
Ruled out immediately - clearly the worst option tested.

### pypdf

Same failure class as Poppler for the broken-font row: the label comes out
as consistently-shifted cipher-like garbage (`+DVÕODW` for `Hasılat`, a
fixed +29 character-code offset from the correct text - confirmed by byte
math), and **the numeric values for that row are dropped entirely**, not
just garbled. Worse than doing nothing, since a caller can't tell the row
failed versus legitimately being zero.

### PDFium (`pypdfium2`)

Mixed results: most rows on the same page render with fully correct Turkish
characters (better than pypdf/Poppler), but the one row that matters most -
`Hasılat` - shows the same shift-cipher-style label corruption **and** drops
its values completely, identically to pypdf. Not usable as the primary
extractor for exactly the row this investigation started over.

### pdfminer.six (direct)

Identical behavior to pdfplumber below, as expected - pdfplumber is a
higher-level wrapper around pdfminer.six's own text extraction, so testing
it directly confirmed there's no daylight between them for this bug.

### pdfplumber / pdfminer.six (the original extractor)

When a font has no ToUnicode CMap, pdfminer.six emits the literal string
`(cid:N)` per un-decodable glyph instead of a real character - technically
honest about not knowing the answer, but useless as extracted text. A
single broken glyph run poisoned an entire section's value-column detection
(the anchor-row scan for trailing value tokens aborted the moment it hit
one `(cid:N)` token), so a handful of unreadable characters caused _whole
balance sheet sections_ to resolve to `0`, not just the specific broken
cells.

Separately, pdfplumber/pdfminer's `doctop`-based line clustering breaks on
PDFs with corrupted font `FontDescriptor` metrics (2025Q1 `kimmr`): two
physically-separate rows get merged into one and their characters
interleaved into unreadable garbage. `pdf_to_md.py`'s
`extract_text_by_baseline()` existed specifically to work around this by
clustering on the text matrix's baseline instead of `doctop` - a real fix,
but it only patches pdfplumber's own layout bug; it does nothing for the
ToUnicode problem above.

### PyMuPDF (`fitz`, Python) / `mupdf` (Node - same underlying MuPDF engine)

The first tool that actually recovers usable text for the broken font:
correct numbers, and correct labels for _most_ rows, including ones that
were previously all-zero. It also independently avoids pdfplumber's
`doctop`-clustering bug (no `extract_text_by_baseline`-equivalent needed).

Shortcomings found through further testing:

- **Non-embedded-font character substitution.** For fonts falling back to
  MuPDF's "TrueType-UCS2" system-font substitution (visible via `warning:
non-embedded font using identity encoding: ... (mapping via
TrueType-UCS2)`), specific Turkish characters get mis-decoded - `ı`
  (U+0131) sometimes becomes `û` (U+00FB) instead. This is inconsistent
  _within the same page_: `esas faaliyet karı` decoded with a correct `ı` on
  one line, while `Hasılat` two lines away decoded `ı` as `û`, depending on
  which specific font instance rendered that particular run of text. No
  reliable blanket character-substitution fix was found for this - it isn't
  a fixed 1:1 mapping.
- **Output shape.** Text comes back one table cell per line (label,
  footnote-number, value1, value2 each on their own line) rather than a
  whole row per line, requiring a row-reconstruction pass that pdfplumber's
  layout never needed.

`pdf.js` (Mozilla, Node, tested via `pdfjs-dist`) landed in the same tier:
correctly recovers the previously-missing numbers, but exhibits the same
class of non-embedded-font substitution bug for Turkish characters (a
different wrong character - `Õ`, U+00D5 - for the same `ı`, confirming the
root cause is generic to "non-embedded font, guessed substitution," not a
MuPDF-specific quirk). No evidence it does better than MuPDF anywhere it was
checked, so it wasn't pursued further once MuPDF was already integrated and
verified.

### Marker (ML/OCR-based, `marker-pdf`)

The only tool that got the single hardest row (`Hasılat`) **completely**
correct - both the label and both value columns - because it renders the
page to an image and runs actual OCR plus layout/table recognition instead
of touching the PDF's broken text-encoding data at all. Explicitly **not**
used as the primary extractor here (OCR is out of scope for this pipeline -
digit-misread risk on financial figures is a worse failure mode than a
label matching gap, and no Turkish OCR language pack is set up), but worth
recording since it's the strongest result found in absolute terms:

- ~13 seconds to process just 2 pages on a GPU (mostly one-time model-load
  overhead) - far too slow to be the default across a batch of hundreds of
  PDFs, and needs a GPU to be practical at all.
- Multi-GB PyTorch/ML dependency stack vs. a single lightweight package.
- Not uniformly better: it dropped an entire comparative-period column
  (empty cells) on the balance sheet page of the same document, where
  text-layer tools at least preserved _garbled-but-positioned_ data.

### Apache PDFBox (Java) - what this pipeline uses

The only library that got **every** checked row on **every** checked page
completely correct via pure digital text-layer parsing - no OCR - including
`Hasılat`, every `-İlişkili taraflardan/olmayan...` detail row, and both the
current and comparative period columns. Zero character corruption, zero
data loss, anywhere checked. Also faster than expected: ~1.6 seconds for a
PDF's full relevant page range (2-15), JVM startup included - comparable to
the Python subprocess spawn the old pipeline already paid per PDF.

Its own shortcomings, found through the extended testing that followed
adopting it (each has a corresponding fix or manual correction in
`basic-extract.ts` - see the referenced functions):

- **No page-boundary markers in plain-text mode.** `export:text` without
  `-html` returns one undifferentiated blob for a multi-page range - no
  form feed, no separator. `-html` mode is the only way to get page
  boundaries (`page-break-before:always` div markers), which
  `#page-end#`-based downstream logic and `verify.html` page tracking both
  depend on. This is _why_ `-html` mode is used, not because it produces
  cleaner text - plain-text mode was directly tested and has the identical
  paragraph-splitting artifacts described below, just with no way to
  recover page numbers at all.
- **Blank-line-separated label/value pairs.** PDFBox represents the
  horizontal rule often drawn above a "Toplam" (total) row as an empty
  paragraph, splitting the label from its values across several
  blank-ish lines. Fixed by `stripBlankLines()` - blank lines carry no other
  meaning downstream, so dropping them is a pure adjacency restoration, not
  a loss of information.
- **Value columns split onto their own line.** On wide tables, PDFBox can
  emit a row's label plus first value on one line and each remaining value
  column as its own subsequent line. `mergeSplitLabelValueLines()` absorbs
  these, but only when the current line still looks incomplete (0-1
  trailing values) - see that function's doc comment for why a real
  duplicated-subtotal line (2024Q1 `asels`) must _not_ be absorbed the same
  way.
- **Currency-unit headers split across many lines.** Dual-currency
  (TL/USD) reports' header row can fragment the same way, breaking a
  single-line currency-marker scan. `detectTlColumnOffset()` falls back to
  a sliding multi-line window only when a single line doesn't match, so
  every previously-working single-line case is untouched.
- **Extraction-restricted PDFs - resolved.** Some PDFs (2025Q2 `rygyo`,
  2024Q1 `doas`) have permission flags disallowing text extraction - a
  "soft DRM" restriction (blank user password so anyone can _view_ the
  file, but a real, unknown owner password would be needed to lift
  extraction rights via the normal route). PDFBox is the only library
  tested that **honors** this flag by policy; every other tool here
  (pypdfium2, MuPDF, pdf.js, pypdf, Poppler) ignores it and reads the
  content regardless, since the restriction isn't backed by real
  cryptographic strength - the content stream decrypts fine with the known
  blank _user_ password, PDFBox just refuses to hand back the result on
  top of that. The bundled CLI (`pdfbox export:text`) has no flag for this
  (`-password ""` doesn't help; `decrypt` refuses without the real owner
  password) - but `PDDocument.setAllSecurityToBeRemoved(true)`, part of
  PDFBox's own public Java API, lifts the restriction once a document is
  loaded, without needing the owner password at all. That method isn't
  reachable through the CLI, so `java-tools/PdfBoxExtractText.java` calls
  the same internal `PDFText2HTML` stripper class the CLI uses directly,
  with that one call added first. Compiled once (targeting Java 8
  bytecode) and the resulting `.class` committed, so no JDK is needed at
  runtime - only the JRE this pipeline already depends on. Confirmed fixed
  for both known-affected symbols; both manual corrections were removed
  entirely once extraction succeeded on its own. `rygyo` needed one more
  fix on top: PDFBox splits a wide row's label from its values onto
  separate lines, and `loadReportLines`'s front-matter-trimming scan (which
  looks for the first same-line label+value match to find where the table
  of contents ends) used to run on unmerged lines, so it skipped the real
  (split) balance sheet row and locked onto a much later, unrelated
  footnote table that happened to repeat the same label with its values on
  one line - discarding the entire real balance sheet as "front matter" in
  the process. Fixed by merging split label/value lines _before_ that
  front-matter scan runs, not after.

## Bottom line

No library recovers 100% of a PDF that's missing its own ToUnicode data -
that's fundamentally unrecoverable information, not a tooling gap - but
PDFBox got the closest to it of every non-OCR option, with the smallest and
most fixable set of remaining quirks. Its failure modes are also the
easiest to _detect_: empty output (permission-restricted PDFs) or
detectably-malformed intermediate line shapes (the splitting issues above),
versus other tools' silent wrong-character substitutions, which are much
harder to catch automatically.
