/**
 * Sector-agnostic orchestration shared by every pipeline (general/bank/
 * insurance/finance - see ../extract-financial-values.ts, which looks up
 * each symbol's pdf_type and dispatches to the matching pipeline's
 * processPdfFile): PDF discovery, PDFBox conversion, screenshot rendering,
 * CSV/manifest writing, and the concurrent task runner. None of this reads
 * a single sector-specific keyword or line-format rule - the label/marker
 * parsing and keyword matching that actually differs per sector lives
 * entirely in each pipeline's own file instead (see e.g. general.ts's doc
 * comment for why those aren't shared even though it costs some
 * duplication).
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import prettier from "prettier";
import { ensureDirectories, logger } from "../lib";
import { renderPageScreenshots } from "../render-page-screenshots";
import {
  isConsistNumber,
  isUsableValueToken,
  isValueToken,
} from "./turkish-numbers";

export const REGION = "tr";

const ROOT_DIR = path.join(__dirname, "..");

// --- Directories ---
const ASSETS_DIR = "assets";
// Large per-quarter data (source PDFs, converted text, verify pages) lives
// outside the repo under local-data/ (gitignored) rather than under assets/,
// which stays for small tracked outputs like results/.
const LOCAL_DATA_DIR = path.join(
  ROOT_DIR,
  "..",
  "..",
  "local-data",
  "extract-pdf",
);
// Every subdirectory here is a quarter (e.g. "2025Q1", "2026Q1") - discovered
// dynamically (see discoverQuarters) rather than fixed to one, so a new
// quarter just needs its PDFs dropped in and a `npx tsx basic-extract.ts`
// run, with no code change.
const PDFS_ROOT_DIR = path.join(LOCAL_DATA_DIR, "pdfs");
// These three are all kept as siblings of PDFS_ROOT_DIR (same per-quarter
// shape) rather than nested under one basic-extract/<quarter>/ base - each
// is independently useful output tied to the PDF itself, not something only
// this one pipeline's own internals should own the location of.
const PDF_CONVERTED_ROOT_DIR = path.join(LOCAL_DATA_DIR, "pdf-converted");
const RESULTS_ROOT_DIR = path.join(ROOT_DIR, ASSETS_DIR, "results");
const VERIFY_ROOT_DIR = path.join(LOCAL_DATA_DIR, "verify");

export interface QuarterPaths {
  quarter: string;
  pdfDir: string;
  // Raw plain-text pages extracted straight from the PDF (see convertPdfToMd)
  convertedDir: string;
  // Final per-symbol CSVs land directly here, one per PDF - no subfolder.
  resultsDir: string;
  // Screenshots of the specific PDF pages that produced a matched value,
  // plus the manifest recording which pages those are per symbol - both
  // consumed by scripts/generate-verify-html.ts so verify.html can show the
  // actual PDF page next to each symbol's numbers instead of requiring the
  // PDF be opened separately.
  verifyDir: string;
  verifyPagesDir: string;
  verifyScreenshotsDir: string;
}

export function getQuarterPaths(quarter: string): QuarterPaths {
  const verifyDir = path.join(VERIFY_ROOT_DIR, quarter);

  return {
    quarter,
    pdfDir: path.join(PDFS_ROOT_DIR, quarter),
    convertedDir: path.join(PDF_CONVERTED_ROOT_DIR, quarter),
    resultsDir: path.join(RESULTS_ROOT_DIR, quarter),
    verifyDir,
    verifyPagesDir: path.join(verifyDir, "pages"),
    verifyScreenshotsDir: path.join(verifyDir, "screenshots"),
  };
}

/** Every quarter with a pdfs/ folder, e.g. ["2025Q1", "2026Q1"] - sorted so processing order is stable and predictable. */
export function discoverQuarters(): string[] {
  if (!fs.existsSync(PDFS_ROOT_DIR)) return [];
  return fs
    .readdirSync(PDFS_ROOT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function normalizeText(text: string): string {
  if (!text) return "";
  return text
    .replace(/[*_]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .replace(/I/g, "ı")
    .replace(/İ/g, "i")
    .toLowerCase();
}

// --- PDF text extraction (Apache PDFBox) ---
//
// Every other PDF library tried here - pdfplumber/pdfminer (this project's
// original extractor), PyMuPDF, pdf.js, PDFium, Poppler, pypdf - either
// falls back to raw "(cid:N)" glyph-ID placeholders or silently mangles or
// drops text for at least some reports. Root cause: a handful of these
// PDFs embed a font with Identity-H encoding, no ToUnicode CMap, and no
// embedded font program - there is no Unicode mapping recorded in the file
// for that font's glyphs at all, so every tool has to guess. PDFBox is the
// only one tried that recovers such text correctly and completely (verified
// against 2024Q4 ccola's balance sheet and income statement, including its
// "Hasılat" row and every "-İlişkili..." detail row, both periods).
const PDFBOX_VERSION = "3.0.3";
const PDFBOX_JAR_PATH = path.join(
  ROOT_DIR,
  "vendor",
  `pdfbox-app-${PDFBOX_VERSION}.jar`,
);
const PDFBOX_JAR_URL = `https://repo1.maven.org/maven2/org/apache/pdfbox/pdfbox-app/${PDFBOX_VERSION}/pdfbox-app-${PDFBOX_VERSION}.jar`;

/** Downloads the PDFBox CLI jar on first use (not committed - see .gitignore) and caches it under vendor/ for every run after. */
export async function ensurePdfBoxJar(): Promise<string> {
  if (fs.existsSync(PDFBOX_JAR_PATH)) return PDFBOX_JAR_PATH;

  console.log(`Downloading Apache PDFBox ${PDFBOX_VERSION}...`);
  const response = await fetch(PDFBOX_JAR_URL);
  if (!response.ok) {
    throw new Error(`Failed to download PDFBox jar: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(PDFBOX_JAR_PATH), { recursive: true });
  fs.writeFileSync(PDFBOX_JAR_PATH, buffer);
  return PDFBOX_JAR_PATH;
}

// Compiled from java-tools/PdfBoxExtractText.java (targeting Java 8
// bytecode, so it runs on this project's plain java.exe with no JDK/compiler
// needed at runtime - see that file's doc comment). Committed rather than
// built on demand, same reasoning as PDFBOX_JAR_PATH being downloaded
// instead of built from PDFBox's own source.
const PDFBOX_EXTRACT_TOOL_DIR = path.join(ROOT_DIR, "java-tools");

/**
 * Runs java-tools/PdfBoxExtractText.java on `pdfPath` for pages `startPage`
 * through `endPage` (1-indexed, inclusive) and writes the raw HTML to
 * `outputHtmlPath`.
 *
 * This wraps PDFBox's own PDFText2HTML stripper directly (the same class
 * the `pdfbox export:text -html` CLI command uses internally, so the output
 * shape - page-break divs, entity encoding - is identical to what
 * parsePdfBoxHtmlPages below expects) rather than shelling out to the CLI,
 * because the CLI has no way to override a PDF's "extraction not allowed"
 * permission flag (2025Q2 rygyo, 2024Q1 doas - a "soft DRM" restriction not
 * backed by real cryptographic strength, since a blank user password
 * already lets anyone view these files - see
 * docs/pdf-extraction-library-comparison.md). PdfBoxExtractText.java calls
 * PDDocument.setAllSecurityToBeRemoved(true), PDFBox's own documented API
 * for lifting that restriction once a document is successfully loaded,
 * which the CLI never exposes a flag for.
 */
function runPdfBoxHtmlExtraction(
  jarPath: string,
  pdfPath: string,
  outputHtmlPath: string,
  startPage: number,
  endPage: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const classpath = [PDFBOX_EXTRACT_TOOL_DIR, jarPath].join(path.delimiter);
    const child = spawn(
      "java",
      [
        "-cp",
        classpath,
        "PdfBoxExtractText",
        pdfPath,
        outputHtmlPath,
        String(startPage),
        String(endPage),
      ],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`PdfBoxExtractText exited with code ${code}`));
    });
  });
}

/** Decodes PDFBox's HTML output's character references - always numeric decimal (e.g. "&#305;"), never named entities or hex form (verified against every distinct entity this tool emits across a full report). */
function decodeHtmlEntities(text: string): string {
  return text.replace(/&#(\d+);/g, (_, code) =>
    String.fromCodePoint(Number(code)),
  );
}

/**
 * A PDF's "Toplam ..." (total) rows are often set off from a horizontal
 * rule/underline drawn just above them - PDFBox represents that as an
 * empty bold paragraph, e.g.:
 *   <p><b>Toplam Özkaynaklar</b> <i> </i></p>
 *   <p><b> </b></p>
 *   <p><b>11.386.108.733 12.182.771.905 </b></p>
 * which after tag-stripping becomes several blank/whitespace-only lines
 * sitting between the label and its values - breaking the immediately-
 * adjacent-line assumption mergeSplitLabelValueLines needs to glue them
 * back together. Blank lines carry no other meaning downstream (every scan
 * already skips them via `if (!trimmed) continue`), so dropping them here
 * is strictly a restoration of adjacency, not a loss of information.
 *
 * if you wanna see example issues:
 * - 2026Q1: banvt - toplam özkaynaklar, toplam kaynaklar
 */
function stripBlankLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

/**
 * Splits PDFBox's HTML output into one plain-text string per page, in the
 * same row-per-line shape pdfplumber's extraction produced (a label and its
 * values sit on one physical line) - unlike PyMuPDF/pdf.js, which put each
 * table cell on its own line and would need a separate row-reconstruction
 * pass to be usable here. Page boundaries come from PDFBox's own
 * `page-break-before:always` div marker (see runPdfBoxHtmlExtraction);
 * tags are stripped with a plain regex since the only tags this tool emits
 * are html/head/title/meta/body/div/p/b/i, none worth preserving once
 * split into pages.
 */
function parsePdfBoxHtmlPages(html: string): string[] {
  const pageChunks = html.split(
    '<div style="page-break-before:always; page-break-after:always">',
  );
  // The first chunk is the doctype/head/body-open boilerplate before the
  // first page's div - never a real page.
  return pageChunks
    .slice(1)
    .map((chunk) =>
      stripBlankLines(decodeHtmlEntities(chunk.replace(/<[^>]+>/g, ""))),
    );
}

/**
 * Bank-sector (BDDK) reports format numbers English-style - comma
 * thousands, dot decimals (e.g. "2,685,235,121") - instead of every other
 * report's Turkish convention (dot thousands, comma decimals, e.g.
 * "2.685.235.121") this pipeline's number-parsing is otherwise built
 * entirely around. Rather than teach every token-parsing function a second
 * number format, normalize comma-grouped numbers to the Turkish dot form
 * once, right after extraction.
 *
 * Applied unconditionally by convertPdfToMd below, not gated to bank's own
 * pipeline: a genuine Turkish-formatted report never has 3-digit comma
 * groups (that's not how "," is used in that convention - if anything it'd
 * mark a decimal, which this regex's exactly-3-digit requirement doesn't
 * match), so this is a no-op for every other sector. Unlike label/marker
 * parsing, this is a property of the *text itself*, not sector-dependent
 * interpretation, so there's no real duplication cost to keeping it here.
 */
function normalizeCommaThousands(text: string): string {
  return text.replace(/\d{1,3}(,\d{3})+/g, (match) => match.replace(/,/g, "."));
}

// Page range convertPdfToMd extracts (1-indexed, inclusive) - matches this
// project's original pdf_to_md.py range, plus headroom added for annual
// (year-end) bank filings specifically: a full-year audit opinion runs
// noticeably longer than an interim quarter's limited-review report, which
// can push the real balance sheet/income statement a few pages later than
// usual (2025Q4 garan: income statement starts on page 17, entirely missing
// under the original end page of 15 - "faiz gelirleri" absent from the
// converted text at all, not just misplaced). Cheap and safe to extend:
// extra pages only cost a little more PDFBox conversion time on first run
// (cached after), and since matching is first-occurrence-wins, a report
// that already resolves correctly within the old page range can never
// have that resolution changed by pages arriving later in the same scan -
// confirmed via full regression.
export const PDF_SCAN_START_PAGE = 2;
const PDF_EXTRACT_END_PAGE = 20;

// A PDF whose cover page mentions this is very likely the wrong document
// entirely (an activity report, not financial statements). Checked against
// the PDF's actual page 1 - never covered by convertedDir, see
// PDF_SCAN_START_PAGE - by convertPdfToMd itself, which prepends a
// "#first-page-warning:<keyword>#" marker line to mdPath when it hits, for
// loadReportLines and generate-verify-html.ts to pick back out.
const FIRST_PAGE_WARNING_KEYWORD = "faaliyet";

/**
 * Extracts pages 1 through PDF_EXTRACT_END_PAGE from pdfPath via PDFBox,
 * checks page 1 for FIRST_PAGE_WARNING_KEYWORD (see that constant's doc
 * comment) and, if it hits, prepends a bare "#first-page-warning:<keyword>#"
 * marker line - loadReportLines below picks it back out - then joins pages
 * PDF_SCAN_START_PAGE onward with "#page-end#" and writes the result to
 * mdPath. Each page is lowercased (Turkish-aware: "I" -> "ı", "İ" -> "i",
 * then plain toLowerCase()) before either of those steps, both to match
 * mdPath's historical format and so the keyword check isn't tripped up by
 * an uppercase hit that plain toLowerCase() alone would mangle.
 */
export async function convertPdfToMd(pdfPath: string, mdPath: string) {
  console.log(
    `Converting ${path.basename(pdfPath)} to text using Apache PDFBox...`,
  );
  const tempHtmlPath = `${mdPath}.pdfbox.html`;
  try {
    const jarPath = await ensurePdfBoxJar();
    await runPdfBoxHtmlExtraction(
      jarPath,
      pdfPath,
      tempHtmlPath,
      1,
      PDF_EXTRACT_END_PAGE,
    );

    const html = fs.readFileSync(tempHtmlPath, "utf-8");
    const pages = parsePdfBoxHtmlPages(html).map((page) =>
      page.replace(/I/g, "ı").replace(/İ/g, "i").toLowerCase(),
    );

    const hasFirstPageWarning = (pages[0] ?? "").includes(
      FIRST_PAGE_WARNING_KEYWORD,
    );
    const mainContent = pages
      .slice(PDF_SCAN_START_PAGE - 1)
      .join("\n#page-end#\n");
    const output = normalizeCommaThousands(
      hasFirstPageWarning
        ? `#first-page-warning:${FIRST_PAGE_WARNING_KEYWORD}#\n${mainContent}`
        : mainContent,
    );

    fs.mkdirSync(path.dirname(mdPath), { recursive: true });
    fs.writeFileSync(mdPath, output);
  } catch (error: any) {
    console.error(`Error during PDF text extraction: ${error.message}`);
  } finally {
    if (fs.existsSync(tempHtmlPath)) fs.rmSync(tempHtmlPath);
  }
}

/**
 * Some PDFs insert a stray space right after the opening paren of a negative
 * number (e.g. "( 2.451)" instead of "(2.451)"). Split on whitespace, that
 * becomes two tokens - "(" and "2.451)" - and the bare "(" derails label
 * detection for the whole row.
 * Fix only touches whitespace directly touching a
 * digit, so real parenthetical phrases like "(zararı)" are untouched.
 *
 * see example issues:
 * - 2026Q1: thyao - esas faaliyet zararı
 */
function fixSpacedParenNumbers(line: string): string {
  return line
    .replace(/\(\s+(?=[\d.,])/g, "(")
    .replace(/(?<=[\d.,])\s+\)/g, ")");
}

/** How many trailing tokens of `line` are value tokens - see mergeSplitLabelValueLines. */
function countTrailingValueTokens(line: string): number {
  const tokens = line.trim().split(/\s+/);
  let count = 0;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (!isValueToken(tokens[i])) break;
    count++;
  }
  return count;
}

/**
 * A footnote/dipnot reference number standing alone (e.g. "21", "24.1") - a
 * number by a loose "has a digit" definition, but not a real
 * thousands-grouped value by isValueToken's stricter one. PDFBox sometimes
 * places this column right before the value columns on a row's
 * continuation line instead of on its label line (see
 * mergeSplitLabelValueLines - 2025Q4 kfein "hasılat", whose continuation
 * line is "21 2.844.268.102 2.511.760.278").
 */
function isDipnotRefToken(token: string): boolean {
  return isConsistNumber(token) && !isValueToken(token);
}

/**
 * Some PDFs wrap a row across two or more lines - either the label alone,
 * then all its values on the next line, or (PDFBox's HTML export, for
 * pages wide enough that it treats each value column as its own text
 * block) the label plus the *first* value column, then each remaining
 * value column arriving as its own line right after. Our flow expects a
 * label and every one of its values on the same line, so glue these back
 * together first. A next line is only ever absorbed when it's entirely
 * value tokens with no label text of its own - a bare row of numbers with
 * no label is never a legitimate standalone row in this domain, so on its
 * own that could only be a wrapped continuation of whatever came before
 * it. Loops so a row split across 3+ lines (one extra line per extra value
 * column) gets fully reassembled, not just its first continuation line.
 *
 * But a bare value-only line isn't *always* a continuation - some reports
 * repeat a subtotal's figures again right below its own already-complete
 * row (e.g. asels 2024Q1's "dönem kârının dağılımı" breakdown restates the
 * total under "ana ortaklık payları", whose own row already has both its
 * values). Blindly absorbing that duplicate would silently corrupt an
 * already-correct row. So a merge is only attempted when the current line
 * looks incomplete to begin with - 0 or 1 trailing value tokens, since
 * even the simplest report needs at least 2 columns per row and a
 * genuinely complete row already has that many or more; a current line
 * that already has 2+ trailing values is left alone.
 *
 * see example issues:
 * - 2026Q1: brsan - DÖNEM KARI (ZARARI)
 * - 2026Q1: ulker - kısa vadeli borçlanmalar (PDFBox HTML: label + first
 *   value on one line, second value arrives as its own line right after)
 * - 2024Q1: asels - ana ortaklık payları (NOT a continuation - see above)
 */
function mergeSplitLabelValueLines(lines: string[]): string[] {
  const merged: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let current = lines[i].trim();
    if (!current || countTrailingValueTokens(current) > 1) {
      merged.push(lines[i]);
      continue;
    }

    let next = lines[i + 1]?.trim();
    while (next) {
      const nextTokens = next.split(/\s+/);
      const valueTokens =
        nextTokens.length > 0 && isDipnotRefToken(nextTokens[0])
          ? nextTokens.slice(1)
          : nextTokens;
      const nextIsValueOnly =
        valueTokens.length > 0 && valueTokens.every((t) => isValueToken(t));
      if (!nextIsValueOnly) break;

      current = `${current} ${next}`;
      i++; // consume the value-only line too
      next = lines[i + 1]?.trim();
    }
    merged.push(current);
  }
  return merged;
}

// Matches the bare "#first-page-warning:<keyword>#" line convertPdfToMd
// prepends to mdPath when page 1 hits FIRST_PAGE_WARNING_KEYWORD - see that
// constant's doc comment.
const FIRST_PAGE_WARNING_RE = /^#first-page-warning:(.+)#$/;

/**
 * Loads and lightly pre-processes a report's converted text (converting it
 * first if not cached yet), then finds where its table-of-contents front
 * matter ends by scanning for a "nakit ve nakit benzerleri" row that
 * already carries a real value - the general template's mandatory first
 * balance-sheet line. `splitLabelAndTokens` is supplied by the calling
 * pipeline rather than fixed here, since label parsing (enumeration
 * markers, formula-recap stripping, ...) is exactly the part that differs
 * per sector - see general.ts's doc comment. Bank/insurance/finance
 * templates never have this anchor line at all, so this scan simply never
 * matches for them (logged as "no end line for <file>") and every line is
 * kept - not a bug, just this front-matter-trim being a no-op outside the
 * general template.
 */
export async function loadReportLines(
  file: string,
  pdfPath: string,
  mdPath: string,
  splitLabelAndTokens: (line: string) => { label: string; tokens: string[] },
): Promise<{
  lines: string[];
  startPage: number;
  firstPageWarning: string | null;
}> {
  if (!fs.existsSync(mdPath)) {
    await convertPdfToMd(pdfPath, mdPath);
  }
  if (!fs.existsSync(mdPath)) {
    throw new Error(`Markdown file not found for ${file}`);
  }

  let allLines = fs.readFileSync(mdPath, "utf-8").split("\n");

  let firstPageWarning: string | null = null;
  const warningMatch = allLines[0]?.match(FIRST_PAGE_WARNING_RE);
  if (warningMatch) {
    firstPageWarning = warningMatch[1];
    allLines = allLines.slice(1);
  }

  // Merged (and paren-fixed) before the front-matter scan below, not after -
  // on wide tables PDFBox can split a row's label from its own values onto
  // the next line(s) (see mergeSplitLabelValueLines's doc comment), and the
  // real balance sheet's "nakit ve nakit benzerleri" row is no exception.
  // Scanning pre-merge raw lines for the first same-line label+value match
  // would skip right past that split real row and lock onto a much later,
  // unrelated one instead - e.g. 2025Q2/2025Q3 rygyo, whose footnote
  // inflation-restatement table repeats every balance sheet label
  // (including this one) complete with values on one line, causing the
  // entire real balance sheet before it to be discarded as "front matter".
  // #page-end# markers are never value-only, so merging never consumes one -
  // the startPage counting below still lines up.
  allLines = mergeSplitLabelValueLines(allLines.map(fixSpacedParenNumbers));

  // Initialize to -1 to indicate "not found" (since 0 is a valid index)
  //
  // Used to find where the table of contents front matter
  // ends, so it can be sliced off below.
  let summaryEndLine = -1;
  for (let i = 0; i < allLines.length; i++) {
    const { label, tokens } = splitLabelAndTokens(allLines[i]);
    if (normalizeText(label) !== normalizeText("nakit ve nakit benzerleri"))
      continue;
    if (tokens.some((t) => isUsableValueToken(t))) {
      summaryEndLine = i - 1;
      break;
    }
  }

  let reportLines = allLines;
  // The slice below can drop whole pages of front matter (cover, table of
  // contents) before the returned lines even start - so PDF_SCAN_START_PAGE
  // isn't necessarily the page reportLines[0] is on. Count the "#page-end#"
  // markers dropped along with that front matter to find the real one, for
  // pageNumberForLineIndex to build on (used for verify.html's screenshots).
  let startPage = PDF_SCAN_START_PAGE;
  if (summaryEndLine === -1) {
    logger.warn("no end line for" + file);
  } else {
    for (let i = 0; i < summaryEndLine; i++) {
      if (allLines[i].trim() === "#page-end#") startPage++;
    }
    reportLines = allLines.slice(summaryEndLine + 1);
  }

  return {
    lines: reportLines,
    startPage,
    firstPageWarning,
  };
}

/**
 * The PDF's real (1-indexed) page number for lines[index], derived by
 * counting the "#page-end#" boundary markers loadReportLines leaves intact
 * before it - the Nth marker means everything after it is `startPage` + N
 * pages in (loadReportLines's own return value, accounting for any front
 * matter its own slicing dropped before lines[0]). Used to know which page
 * to screenshot for verify.html, so a matched value can be checked against
 * the actual PDF without opening it.
 */
export function pageNumberForLineIndex(
  lines: string[],
  index: number,
  startPage: number,
): number {
  let page = startPage;
  for (let k = 0; k < index; k++) {
    if (lines[k].trim() === "#page-end#") page++;
  }
  return page;
}

/**
 * Renders each of `pageNumbers` (1-indexed PDF pages) to a PNG under
 * `verifyScreenshotsDir` (see render-page-screenshots.ts), so verify.html
 * can show the actual page next to a symbol's extracted values. Skips pages
 * whose screenshot already exists rather than re-rendering on every run.
 */
export async function renderVerifyScreenshots(
  pdfPath: string,
  symbol: string,
  pageNumbers: number[],
  verifyScreenshotsDir: string,
) {
  if (pageNumbers.length === 0) return;

  const alreadyRendered = pageNumbers.every((pageNumber) =>
    fs.existsSync(
      path.join(verifyScreenshotsDir, `${symbol}-p${pageNumber}.png`),
    ),
  );
  if (alreadyRendered) return;

  console.log(
    `Rendering page screenshot(s) [${pageNumbers.join(", ")}] for ${symbol}...`,
  );
  try {
    await renderPageScreenshots(
      pdfPath,
      verifyScreenshotsDir,
      symbol,
      pageNumbers,
    );
  } catch (error: any) {
    console.error(`Error rendering verify screenshots: ${error.message}`);
  }
}

/** Prints a human-readable table of the values extracted for one file. */
export function printExtractionSummary(
  file: string,
  resolvedValues: Record<string, string>,
) {
  const entries = Object.entries(resolvedValues);
  const labelWidth = Math.max(...entries.map(([label]) => label.length));

  console.log(`\n${file}`);
  console.log("-".repeat(file.length));
  for (const [label, value] of entries) {
    console.log(`${label.padEnd(labelWidth)}  ${value}`);
  }
  console.log();
}

/**
 * Writes labelPages through prettier (using the repo's own .prettierrc)
 * before saving, so the manifest is already in the exact shape the
 * lint-staged pre-commit hook (prettier --write on staged json) would leave
 * it in - otherwise every run re-uglifies these files and every commit
 * reformats them right back, showing up as unrelated-looking diff noise.
 */
export async function writePagesManifest(
  pagesManifestPath: string,
  labelPages: Record<string, number[]>,
): Promise<void> {
  const config = await prettier.resolveConfig(pagesManifestPath);
  const formatted = await prettier.format(JSON.stringify(labelPages), {
    ...config,
    filepath: pagesManifestPath,
  });
  fs.writeFileSync(pagesManifestPath, formatted);
}

export interface PdfTask {
  file: string;
  quarterPaths: QuarterPaths;
  // Looked up from stock_info.pdf_type - null/absent for the vast majority
  // of symbols, which use the general template.
  pdfType: string | null | undefined;
}

// Each in-flight PDF spawns its own PDFBox (java) subprocess, so cap the
// pool rather than leaving it unbounded; override via a plain-number CLI arg
// (see discoverTasks) e.g. `... 1` to force strictly serial processing
// (cleaner, non-interleaved logs).
const DEFAULT_CONCURRENCY = 8;

const QUARTER_ARG_PATTERN = /^\d{4}q[1-4]$/i;
const CONCURRENCY_ARG_PATTERN = /^\d+$/;

/**
 * Every PDF across every discovered quarter, optionally narrowed by plain
 * CLI args (same convention as scripts/v2/push-detailed-results.ts), in any
 * order:
 *   - a quarter, e.g. `2025q1` -> only that quarter
 *   - a number, e.g. `1`       -> concurrency override
 *   - anything else, e.g. `kimmr` -> only that symbol (repeatable)
 * e.g. `npx tsx extract-financial-values.ts kimmr 2025q1` is the equivalent
 * of temporarily hardcoding a single file+quarter while debugging one
 * report's extraction, without editing the source.
 */
export function discoverTasks(pdfTypeMap: Record<string, string | null>): {
  tasks: PdfTask[];
  concurrency: number;
} {
  const quarters = discoverQuarters();
  const args = process.argv.slice(2);

  const quarterArg = args.find((a) => QUARTER_ARG_PATTERN.test(a));
  const concurrencyArg = args.find((a) => CONCURRENCY_ARG_PATTERN.test(a));
  const quarterFilter = quarterArg?.toUpperCase();
  const concurrency = concurrencyArg
    ? parseInt(concurrencyArg, 10)
    : DEFAULT_CONCURRENCY;
  const symbolFilter = args
    .filter((a) => a !== quarterArg && a !== concurrencyArg)
    .map((s) => s.toLowerCase());

  const tasks: PdfTask[] = [];
  for (const quarter of quarters) {
    if (quarterFilter && quarter !== quarterFilter) continue;

    const quarterPaths = getQuarterPaths(quarter);
    const {
      pdfDir,
      convertedDir,
      resultsDir,
      verifyPagesDir,
      verifyScreenshotsDir,
    } = quarterPaths;

    ensureDirectories([
      pdfDir,
      convertedDir,
      resultsDir,
      verifyPagesDir,
      verifyScreenshotsDir,
    ]);

    const pdfFiles = fs
      .readdirSync(pdfDir)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .filter(
        (f) =>
          symbolFilter.length === 0 ||
          symbolFilter.includes(path.parse(f).name.toLowerCase()),
      );

    if (pdfFiles.length === 0) {
      logger.info(`No matching PDF files found in '${pdfDir}'.`);
      continue;
    }

    for (const file of pdfFiles) {
      const symbol = path.parse(file).name.toLowerCase();
      tasks.push({ file, quarterPaths, pdfType: pdfTypeMap[symbol] });
    }
  }
  return { tasks, concurrency };
}

/**
 * Processes `tasks`, keeping at most `concurrency` PDFs in flight at once -
 * each slot pulls the next task as soon as it finishes its current one, so a
 * slot stuck on a big PDF doesn't block the others from moving on.
 *
 * `processOne` is supplied by the caller (extract-financial-values.ts) as
 * the dispatcher that picks the right pipeline's processPdfFile per task's
 * pdfType - this function itself has no opinion on which pipeline runs,
 * only on how many run at once.
 *
 * Node itself is single-threaded, so this isn't `concurrency` JS threads -
 * it's `concurrency` java.exe child processes running at once. `spawn`
 * (see runPdfBoxHtmlExtraction) hands each PDF off to the OS and returns
 * right away; `await` just parks that slot until its process's exit event
 * fires. While parked, the JS thread is free to do whatever's next - spawn
 * another slot's subprocess, or run the exit handler for whichever process
 * finished first. The OS is what actually runs those processes in parallel
 * across CPU cores; this JS loop only ever does one thing at a time.
 */
export async function processTasksConcurrently(
  tasks: PdfTask[],
  concurrency: number,
  processOne: (task: PdfTask) => Promise<void>,
) {
  let nextIndex = 0;

  async function runSlot() {
    while (nextIndex < tasks.length) {
      const task = tasks[nextIndex++];
      try {
        await processOne(task);
      } catch (err: any) {
        logger.error(`Error processing file ${task.file}`, err.message);
      }
    }
  }

  const slots = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    runSlot,
  );
  await Promise.all(slots);
}

/**
 * Runs scripts/generate-verify-html.ts (rebuilds verify.html for every
 * quarter from the results/verify data this file just wrote) once the whole
 * pipeline finishes, so verify.html never goes stale behind a manual step.
 * Spawns tsx's own CLI entry directly via the current Node executable rather
 * than "npx tsx ..." - npx resolves to a .cmd shim on Windows, which spawn()
 * can't run without shell:true, and shelling out just to invoke a script
 * that's already available locally is unnecessary indirection. Resolved via
 * require.resolve rather than a hardcoded node_modules path so this keeps
 * working regardless of where in the workspace tsx actually gets hoisted to.
 */
export function runGenerateVerifyHtml(): Promise<void> {
  return new Promise((resolve, reject) => {
    const tsxCli = require.resolve("tsx/cli");
    const scriptPath = path.join(
      ROOT_DIR,
      "scripts",
      "generate-verify-html.ts",
    );
    const child = spawn(process.execPath, [tsxCli, scriptPath], {
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`generate-verify-html.ts exited with code ${code}`));
    });
  });
}
