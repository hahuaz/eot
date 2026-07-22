/**
 * Extracts key balance-sheet / income-statement figures from Turkish
 * quarterly financial report PDFs.
 *
 * Runs over every quarter found under local-data/extract-pdf/pdfs/ (see
 * discoverQuarters) - a new quarter just needs its PDFs dropped in that
 * folder, no code change.
 *
 * Pipeline per PDF:
 *   1. Convert the PDF to plain text (Apache PDFBox, see convertPdfToMd), if not done yet.
 *   2. Scan the text line-by-line, tracking which financial "section"
 *      (current assets, short-term debts, long-term debts, revenue, ...)
 *      we're currently inside, and record the value for each configured
 *      line-item keyword the first time it's seen.
 *   3. Apply a handful of hand-verified corrections for specific PDFs whose
 *      layout didn't parse cleanly.
 *   4. Print a human-readable summary, then write the detailed CSV.
 *
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import prettier from "prettier";
import { ensureDirectories, logger } from "./lib";
import { renderPageScreenshots } from "./render-page-screenshots";

const ROOT_DIR = __dirname;

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

interface QuarterPaths {
  quarter: string;
  pdfDir: string;
  // Raw plain-text pages extracted straight from the PDF (see convertPdfToMd)
  convertedDir: string;
  // Final per-symbol CSVs land directly here, one per PDF - no subfolder.
  resultsDir: string;
  // Screenshots of the specific PDF pages that produced a matched value,
  // plus the manifest recording which pages those are per symbol - both
  // consumed by scripts/v2/generate-verify-html.ts so verify.html can show the
  // actual PDF page next to each symbol's numbers instead of requiring the
  // PDF be opened separately.
  verifyDir: string;
  verifyPagesDir: string;
  verifyScreenshotsDir: string;
}

function getQuarterPaths(quarter: string): QuarterPaths {
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
function discoverQuarters(): string[] {
  if (!fs.existsSync(PDFS_ROOT_DIR)) return [];
  return fs
    .readdirSync(PDFS_ROOT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// --- Section / keyword configuration ---
const sections = {
  currentAssets: {
    sectionStartKeys: ["nakit ve nakit benzerleri"],
    sectionEndKeys: [
      "toplam dönen varlıklar",
      "dönen varlıklar",
      "duran varlıklar",
    ],
    /**
     * For some reports, we can't detect section start because they don't include headers, etc. Thus we utilize nextSection chaining, if current section end is detected.
     */
    nextSection: "noncurrentAssets",
    /**
     * Whether a keyword's own row is allowed to resolve by summing its detail rows when it carries no value (see sumFollowingDetailLines).
     */
    allowDetailSum: true,
    keywordPrefixes: [],
    keywordSchemas: [
      {
        chosenLabel: "nakit ve nakit benzerleri",
        keyword: ["nakit ve nakit benzerleri"],
      },
      {
        chosenLabel: "finansal yatırımlar",
        keyword: ["finansal yatırımlar", "Finansal varlıklar"],
      },
    ],
  },
  noncurrentAssets: {
    sectionStartKeys: [],
    sectionEndKeys: ["toplam varlıklar", "toplam kaynaklar"],
    nextSection: "shortDebts",
    allowDetailSum: true,
    keywordPrefixes: [],
    keywordSchemas: [
      {
        chosenLabel: "duran finansal yatırımlar",
        keyword: ["finansal yatırımlar", "Finansal varlıklar"],
      },
    ],
  },
  shortDebts: {
    sectionStartKeys: [
      "kısa vadeli borçlanmalar",
      "kısa vadeli yükümlülükler",
      "Kısa vadeli yükümlülükler:",
    ],
    sectionEndKeys: ["TOPLAM KISA VADELİ YÜKÜMLÜLÜKLER"],
    nextSection: "longDebts",
    allowDetailSum: true,
    // this feature only effects ttkom and ttrak.
    // Some reports split a debt line into  "İlişkili taraflardan <keyword>" rows. We include those rows in our calculations but we don't want to produce seperate output keys, which makes verification harder. So we introduced keywordPrefixes
    keywordPrefixes: ["İlişkili taraflardan", "İlişkili olmayan taraflardan"],
    keywordSchemas: [
      {
        chosenLabel: "kısa vadeli borçlanmalar",
        keyword: ["kısa vadeli borçlanmalar", "Banka kredileri"],
      },
      {
        chosenLabel: "uzun vadeli borçlanmaların kısa vadeli kısımları",
        keyword: [
          "uzun vadeli borçlanmaların kısa vadeli kısımları",
          "Uzun vadeli borçlanmaların kısa vadeli kısmı",
          "uzun vadeli finansal borçların kısa vadeli kısımları",
        ],
      },
      {
        chosenLabel: "kısa dönem kira yükümlülükleri",
        keyword: [
          "Kiralama işlemlerinden kaynaklanan yükümlülükler",
          "Kısa vadeli kiralama işlemlerinden borçlar",
          "Kısa Vadeli Kiralama Borçları",
          "kısa vadeli kiralama yükümlülükleri",
          "Kiralama işlemlerinden borçların kısa vadeli kısımları",
          "kiralama yükümlülükleri",
          "kiralama işlemlerinden kısa vadeli yükümlülükler",
          "kiralama işlemlerinden borçlar",
          "finansal kiralama işlemlerinden borçlar",
        ],
      },
    ],
  },
  longDebts: {
    sectionStartKeys: [
      "Uzun vadeli borçlanmalar",
      "Uzun vadeli yükümlülükler",
      "Uzun vadeli yükümlülükler:",
    ],
    sectionEndKeys: ["TOPLAM UZUN VADELİ YÜKÜMLÜLÜKLER"],
    nextSection: "equity",
    allowDetailSum: true,
    keywordPrefixes: ["İlişkili taraflardan", "İlişkili olmayan taraflardan"],
    keywordSchemas: [
      {
        chosenLabel: "uzun vadeli borçlanmalar",
        keyword: ["uzun vadeli borçlanmalar", "Banka kredileri"],
      },
      {
        chosenLabel: "uzun dönem kira yükümlülükleri",
        keyword: [
          "Kiralama işlemlerinden kaynaklanan yükümlülükler",
          "Uzun vadeli kiralama işlemlerinden borçlar",
          "Uzun Vadeli Kiralama Borçları",
          "uzun vadeli kiralama yükümlülükleri",
          "kiralama yükümlülükleri",
          "kiralama işlemlerinden uzun vadeli yükümlülükler",
          "kiralama işlemlerinden borçlar",
          "finansal kiralama işlemlerinden borçlar",
        ],
      },
    ],
  },

  equity: {
    sectionStartKeys: [
      "özkaynaklar",
      "ana ortaklığa ait özkaynaklar",
      "ana ortaklığa ait özkaynaklar:",
      "Ana ortaklığa ait özkaynaklar toplamı",
      "toplam özkaynaklar",
    ],
    sectionEndKeys: [
      "toplam kaynaklar",
      "toplam yükümlülükler ve özkaynaklar",
      "TOPLAM YÜKÜMLÜLÜKLER VE ÖZKAYNAK",
      "Toplam özkaynaklar ve yükümlülükler",
    ],
    // TODO nextsection doens't work since between equity and revenue section there is always #page-end# (equity page is finished). when equity ended, revenue section starts by force chain but then middle #page-end# ends the revenue.
    // nextSection: "revenue",
    allowDetailSum: false,
    keywordPrefixes: [],
    keywordSchemas: [
      {
        chosenLabel: "ana ortaklığa ait özkaynaklar",
        keyword: [
          "ana ortaklığa ait özkaynaklar",
          "ana ortaklığa ait özkaynaklar:",
          "Ana ortaklığa ait özkaynaklar toplamı",
          "özkaynaklar",
          "toplam özkaynaklar",
          "toplam özkaynak",
        ],
      },
      {
        chosenLabel: "toplam kaynaklar",
        keyword: [
          "toplam kaynaklar",
          "toplam yükümlülükler ve özkaynaklar",
          "TOPLAM YÜKÜMLÜLÜKLER VE ÖZKAYNAK",
          "toplam yükümlülük ve özkaynaklar",
          "Toplam özkaynaklar ve yükümlülükler",
          "toplam kaynaklar ve özkaynaklar",
        ],
      },
    ],
  },
  revenue: {
    sectionStartKeys: ["hasılat", "Hasılat (net)", "Satışlar", "gelirler"],
    sectionEndKeys: [
      "DİĞER KAPSAMLI GELİRLER",
      "diğer kapsamlı gelirler",
      "DİĞER KAPSAMLI GİDER/GELİR",
      "diğer kapsamlı gelir/(gider)",
      "diğer kapsamlı gider/gelir",
      "diğer kapsamlı gelirler:",
      "Pay Başına Kazanç (Zarar)",
      "#page-end#",
    ],
    allowDetailSum: false,
    keywordPrefixes: [],
    keywordSchemas: [
      {
        chosenLabel: "hasılat",
        keyword: ["hasılat", "Hasılat (net)", "Satışlar", "gelirler"],
      },
      {
        chosenLabel: "esas faaliyet karı",
        keyword: [
          "esas faaliyet karı",
          "esas faaliyet kârı",
          "esas faaliyet karı veya (zararı)",
          "esas faaliyet karı/(zararı)",
          "esas faaliyet (zararı) / karı",
          "Esas faaliyet (zararı) karı",
          "Esas faaliyet (zararı)",
          "faaliyet karı / (zararı)",
          "Esas Faaliyet Karı/Zararı",
          "esas faaliyet zararı",
          "ESAS FAALİYET KAR / (ZARARI)",
          "ESAS FAALİYET KARI (ZARARI)",
          "Esas faaliyet karı/zararı",
          "Esas Faaliyet Kârı/Zararı",
          "ESAS FAALİYET KÂRI / (ZARARI)",
          "esas faaliyet kârı / (zararı)",
          "Esas Faaliyet Karı / Zararı (-)",
          "Esas faaliyet kar (zararı)",
          "ESAS FAALİYET ZARARI",
          "faaliyet karı",
        ],
      },
      {
        chosenLabel: "ana ortaklık payları",
        keyword: [
          "ana ortaklık payları",
          "-ana ortaklık payları",
          "- ana ortaklık payları",
          "kontrol gücü olmayan paylar ana ortaklık payları",
          "net dönem karı",
          "dönem zararı",
          "dönem net karı",
          "dönem karı",
          "dönem karı (zararı)",
          "Dönem karı / (zararı)",
          "dönem karı veya (zararı)",
          "dönem net karı/(zararı)",
          "Dönem Net Karı/Zararı",
          "Net dönem kârı",
          "net dönem karı / (zararı)",
          "DÖNEM KARI (ZARARI)",
          "DÖNEM KARI/ZARARI",
          "Sürdürülen Faaliyetler Net Dönem Karı",
          "Sürdürülen faaliyetler dönem karı",
          "sürdürülen faaliyetler dönem karı (zararı)",
          "Sürdürülen faaliyetler net dönem karı/(zararı)",
        ],
      },
    ],
  },
};

// --- Text helpers ---

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
async function ensurePdfBoxJar(): Promise<string> {
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
 * Extracts pages 1 through PDF_EXTRACT_END_PAGE from pdfPath via PDFBox,
 * checks page 1 for FIRST_PAGE_WARNING_KEYWORD (see that constant's doc
 * comment) and, if it hits, prepends a bare "#first-page-warning:<keyword>#"
 * marker line - loadReportLines below picks it back out - then joins pages
 * PDF_SCAN_START_PAGE onward with "#page-end#" and writes the result to
 * mdPath. Each page is lowercased (Turkish-aware: "I" -> "ı", "İ" -> "i",
 * then plain toLowerCase()) before either of those steps, both to match
 * mdPath's historical format and so the keyword check isn't tripped up by
 * an uppercase hit that plain toLowerCase() alone would mangle (see
 * EXCLUDED_KEYWORDS's doc comment in download-financial-pdfs.ts for why).
 */
async function convertPdfToMd(pdfPath: string, mdPath: string) {
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
    const output = hasFirstPageWarning
      ? `#first-page-warning:${FIRST_PAGE_WARNING_KEYWORD}#\n${mainContent}`
      : mainContent;

    fs.mkdirSync(path.dirname(mdPath), { recursive: true });
    fs.writeFileSync(mdPath, output);
  } catch (error: any) {
    console.error(`Error during PDF text extraction: ${error.message}`);
  } finally {
    if (fs.existsSync(tempHtmlPath)) fs.rmSync(tempHtmlPath);
  }
}

/**
 * Renders each of `pageNumbers` (1-indexed PDF pages) to a PNG under
 * `verifyScreenshotsDir` (see render-page-screenshots.ts), so verify.html
 * can show the actual page next to a symbol's extracted values. Skips pages
 * whose screenshot already exists rather than re-rendering on every run.
 */
async function renderVerifyScreenshots(
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
    renderPageScreenshots(pdfPath, verifyScreenshotsDir, symbol, pageNumbers);
  } catch (error: any) {
    console.error(`Error rendering verify screenshots: ${error.message}`);
  }
}

// A PDF whose cover page mentions this is very likely the wrong document
// entirely (an activity report, not financial statements). Checked against
// the PDF's actual page 1 - never covered by convertedDir, see
// PDF_SCAN_START_PAGE - by convertPdfToMd itself, which prepends a
// "#first-page-warning:<keyword>#" marker line to mdPath when it hits, for
// loadReportLines and generate-verify-html.ts to pick back out.
const FIRST_PAGE_WARNING_KEYWORD = "faaliyet";

function normalizeText(text: string): string {
  if (!text) return "";
  return text
    .replace(/[*_]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .replace(/I/g, "ı")
    .replace(/İ/g, "i")
    .toLowerCase();
}

function isConsistNumber(token: string): boolean {
  const clean = token
    .replace(/\(/g, "")
    .replace(/\)/g, "")
    .replace(/-/g, "")
    .replace(/—/g, "")
    .replace(/\./g, "")
    .replace(/,/g, "")
    .replace(/%/g, "")
    .trim();

  // Using /\d/.test(clean) checks if there is at least one digit present
  return !!clean && /\d/.test(clean);
}

/**
 * A complete Turkish-formatted number: one leading group of 1-3 digits, then
 * zero or more dot-separated groups of exactly 3 digits (e.g. "38.327.850",
 * "7.605", "605"), optionally wrapped in a *matched* pair of parens for
 * negatives (e.g. "(1.234)"). The parens must both be present or both be
 * absent - unlike a naive `\(?...\)?`, this doesn't also match a lone
 * unbalanced fragment like "(100 .280.688)" (which mergeSplitNumberTokens relies on
 * failing, so it knows to glue it onto the next split-off fragment).
 */
const COMPLETE_NUMBER_RE = /^(?:-?\d{1,3}(\.\d{3})*|\(-?\d{1,3}(\.\d{3})*\))$/;

/**
 * Some PDFs render a single thousands-grouped number as two separate text
 * runs with a stray gap between them (e.g. "40.00" + "7.605" instead of
 * "40.007.605"), which the line-splitting below then treats as two tokens.
 * Detects a numeric token that can't be a complete number on its own (its
 * last dot-group isn't exactly 3 digits) and glues it onto the next token
 * when doing so produces a valid one.
 *
 * Not the same bug as an invisible space glyph drawn stacked on top of a
 * digit (a per-character rendering quirk, fixable once at the extraction
 * source): this is a genuine layout split - the PDF's TEXT ITSELF is broken
 * into two separate runs (e.g. two different text-drawing commands) with
 * real space between them, so there's no single "phantom char" to strip -
 * the two pieces have to be recombined here, after line-splitting, based on
 * which one fails to be a valid number by itself.
 *
 * if you wanna see example issues:
 * - 2026Q1: mpark - ana ortaklığa ait özkaynaklar
 * - 2026Q1: odine - esas faaliyet karı
 * - 2026Q1: sekur - toplam kaynaklar
 */
/**
 * A bare, dot-less 1-3 digit token (e.g. "9", "1") already matches
 * COMPLETE_NUMBER_RE on its own - that's how a real small value like "605"
 * looks - so the check above never fires for it, and a split like "9" +
 * "26.546.816" (real value: "926.546.816") is left as two tokens even
 * though "26.546.816" *also* already looks like a perfectly valid number by
 * itself. There's no way to tell those two readings apart from the token
 * text alone.
 *
 * The tie can't be broken by "is the previous token numeric" - a row can
 * carry more than one bare footnote reference before its real values start
 * (e.g. 2024Q1 cimsa: "hasılat  2  22  5.323.692  4.798.491", two dipnot
 * numbers "2" and "22" both sitting before the real value; merging "22"
 * into "5.323.692" would wreck this already-correct row exactly the way
 * this fix is meant to prevent). What's actually safe to key on is whether
 * a genuine multi-group value - something with a dot, i.e. >= 1000 - has
 * already appeared earlier in the row: footnote references never follow a
 * real value (they only ever precede it), so a bare short token seen after
 * one has no legitimate reason to be its own standalone column in this
 * domain (every real figure here runs into the millions/billions) and is
 * fair game to glue onto the next token despite "looking" complete alone.
 *
 * if you wanna see example issues:
 * - 2024Q3: ttrak - esas faaliyet karı, ana ortaklık payları
 */
function isBareDigitMidRun(
  token: string,
  hasSeenGroupedValue: boolean,
): boolean {
  return (
    hasSeenGroupedValue &&
    !token.includes(".") &&
    COMPLETE_NUMBER_RE.test(token)
  );
}

function mergeTwoPieceSplitNumber(
  token: string,
  next: string,
  hasSeenGroupedValue: boolean,
): string | null {
  if (!isConsistNumber(token) || !isConsistNumber(next)) return null;

  const isMergeCandidate =
    !COMPLETE_NUMBER_RE.test(token) ||
    isBareDigitMidRun(token, hasSeenGroupedValue);
  if (!isMergeCandidate) return null;

  return COMPLETE_NUMBER_RE.test(token + next) ? token + next : null;
}

/** A genuine multi-group Turkish-formatted value (has a "." group, unlike a bare dipnot reference number). */
function isGroupedNumber(token: string): boolean {
  return token.includes(".") && COMPLETE_NUMBER_RE.test(token);
}

/**
 * Some PDFs split a number into 3+ runs where every fragment but the last is
 * a bare 1-3 digit group (e.g. "1" + "6" + ".753.182.070" instead of
 * "16.753.182.070"). Unlike the two-piece case above, a bare short digit
 * group is itself a valid COMPLETE_NUMBER_RE match (that's how a real value
 * like "605" looks), so mergeTwoPieceSplitNumber's "first fragment must fail
 * on its own" check never fires and each fragment is kept as its own token.
 *
 * The reliable signal here is the *last* fragment: a real, standalone value
 * never starts with ".", so a token doing that can only be the tail of a
 * thousands-grouped number whose leading digits got split off before it.
 * Once we see that, every immediately preceding bare-digit (no dot) token is
 * necessarily part of the same broken number - a legitimate column never
 * sits directly adjacent to one with zero separating label text - so they
 * all get pulled back in, however many there are.
 *
 * if you wanna see example issues:
 * - 2024Q3: ttrak - nakit ve nakit benzerleri, toplam kaynaklar
 */
function absorbLeadingDigitFragments(
  merged: string[],
  continuationToken: string,
): string {
  let combined = continuationToken;
  while (merged.length > 0 && /^\d{1,3}$/.test(merged[merged.length - 1])) {
    combined = merged.pop() + combined;
  }
  return combined;
}

function mergeSplitNumberTokens(tokens: string[]): string[] {
  const merged: string[] = [];
  let hasSeenGroupedValue = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens[i + 1];

    const twoPieceMerge =
      next !== undefined &&
      mergeTwoPieceSplitNumber(token, next, hasSeenGroupedValue);
    if (twoPieceMerge) {
      merged.push(twoPieceMerge);
      hasSeenGroupedValue ||= isGroupedNumber(twoPieceMerge);
      i++;
      continue;
    }

    if (/^\.\d/.test(token)) {
      const combined = absorbLeadingDigitFragments(merged, token);
      merged.push(combined);
      hasSeenGroupedValue ||= isGroupedNumber(combined);
      continue;
    }

    merged.push(token);
    hasSeenGroupedValue ||= isGroupedNumber(token);
  }
  return merged;
}

function isValueToken(token: string): boolean {
  const cleanToken = token.trim();
  if (!cleanToken) return false;
  // If it contains any alphabetic characters, it's not a value token
  if (/[a-zA-ZığüşöçİĞÜŞÖÇ]/.test(cleanToken)) return false;

  // if it contains comma "," it's not value token
  if (cleanToken.includes(",")) return false;

  // if it doesn't contain "." it's not value token
  if (!cleanToken.includes(".")) return false;

  // A dipnot sub-reference (e.g. "24.1") also has no letters/comma and
  // contains a dot, but isn't a real thousands-grouped number - its
  // trailing group isn't exactly 3 digits. Require the real format so
  // these don't get miscounted as value columns (see 2025q2 cvkmd
  // "hasılat 24.1 ..." throwing off the whole revenue section's column
  // index and starving every later row of a match).
  if (!COMPLETE_NUMBER_RE.test(cleanToken)) return false;

  return true;
}

/** Splits a line into tokens and the leading "label" portion (everything before the numeric columns start). */
function splitLabelAndTokens(line: string): {
  label: string;
  tokens: string[];
} {
  const tokens = mergeSplitNumberTokens(line.trim().split(/\s+/));

  let labelLastIndex = 0;
  for (let i = 0; i <= tokens.length - 1; i++) {
    if (!isConsistNumber(tokens[i])) {
      labelLastIndex = i;
    } else {
      break;
    }
  }

  const label = tokens.slice(0, labelLastIndex + 1).join(" ");
  return { label, tokens };
}

/** Prints a human-readable table of the values extracted for one file. */
function printExtractionSummary(
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
/**
 * A footnote/dipnot reference number standing alone (e.g. "21", "24.1") - a
 * number by isConsistNumber's loose definition, but not a real
 * thousands-grouped value by isValueToken's stricter one. PDFBox sometimes
 * places this column right before the value columns on a row's
 * continuation line instead of on its label line (see
 * mergeSplitLabelValueLines - 2025Q4 kfein "hasılat", whose continuation
 * line is "21 2.844.268.102 2.511.760.278").
 */
function isDipnotRefToken(token: string): boolean {
  return isConsistNumber(token) && !isValueToken(token);
}

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

// Page range convertPdfToMd extracts (1-indexed, inclusive) - matches this
// project's original pdf_to_md.py range.
const PDF_SCAN_START_PAGE = 2;
const PDF_EXTRACT_END_PAGE = 15;

// Matches the bare "#first-page-warning:<keyword>#" line convertPdfToMd
// prepends to mdPath when page 1 hits FIRST_PAGE_WARNING_KEYWORD - see that
// constant's doc comment.
const FIRST_PAGE_WARNING_RE = /^#first-page-warning:(.+)#$/;

async function loadReportLines(
  file: string,
  pdfPath: string,
  mdPath: string,
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

const TL_MARKER_WORDS = new Set(["tl", "lirası", "lirasi"]);
const FX_MARKER_WORD_PREFIXES = ["dolar", "doları", "euro", "avro"];

/** Currency markers found in `text`, in reading order - see detectTlColumnOffset. */
function findCurrencyMarkers(text: string): Array<"TL" | "FX"> {
  const markers: Array<"TL" | "FX"> = [];
  for (const rawToken of text.trim().split(/\s+/)) {
    const cleanToken = rawToken.replace(/[^a-zçğıöşü]/gi, "");
    if (!cleanToken) continue;
    if (TL_MARKER_WORDS.has(cleanToken)) {
      markers.push("TL");
    } else if (FX_MARKER_WORD_PREFIXES.some((w) => cleanToken.startsWith(w))) {
      markers.push("FX");
    }
  }
  return markers;
}

// How many consecutive lines detectTlColumnOffset's wide-window fallback
// joins into one candidate header before scanning it - see that function's
// doc comment for why a single line isn't always enough.
const CURRENCY_HEADER_WINDOW = 16;

/**
 * Some dual-currency reports group columns by currency across both periods
 * (e.g. penta/pgsus: TL-current, TL-previous, USD-current, USD-previous),
 * but others interleave currency within each period (e.g. eregl:
 * USD-current, TL-current, USD-previous, TL-previous). A fixed column
 * offset can't handle both, so this reads the report's own currency-unit
 * header row (e.g. "not bin abd doları bin tl bin abd doları bin tl") and
 * returns the negative (from-the-right) index of the *first* TL marker,
 * which is always the current-period TL column regardless of layout.
 *
 * Tries a single line first (windowSize 1) - this is the original,
 * narrowest match and stays exactly as strict as before for every report
 * that already worked this way, so it can never regress one. Only if that
 * finds nothing does it retry with a wider sliding window of consecutive
 * lines joined together: the currency-unit header is sometimes spread
 * across several lines instead of sitting on one - e.g. PDFBox's HTML
 * export can turn "31 Mart 2026 Bin TL 31 Aralık 2025 Bin TL 31 Mart 2026
 * Bin USD ..." into 8 separate lines, one date or unit per line. The exact
 * `markers.length === valueColumnCount` match below is what keeps a wide
 * window safe even then: unrelated content sliding into view essentially
 * never happens to contain exactly that many currency-unit words with both
 * TL and FX present.
 *
 * Returns null:
 * - the real header not found: it needs to have exactly one marker
 * per valueColumnCount
 * - the report is TL-only
 *
 * if you wanna see example issues:
 * - 2026Q1: brsan - the currency-unit header split across lines (PDFBox),
 *   and separately a false-positive single-line match against a footnote
 *   discussing exchange rates (pre-existing, not PDFBox-specific)
 */
function detectTlColumnOffset(
  lines: string[],
  valueColumnCount: number,
): number | null {
  for (const windowSize of [1, CURRENCY_HEADER_WINDOW]) {
    for (let start = 0; start < lines.length; start++) {
      const windowText = lines.slice(start, start + windowSize).join(" ");
      // escape boilerplate (tutarlar aksi belirtilmedikçe bin türk lirası
      // ("tl")) and prose footnotes discussing exchange rates (e.g. "...1
      // euro= 51,0098 tl) ... 31 aralık 2025 ... 1 euro = 50,2859 tl..." -
      // a real header row is just dates/units, never "=" or ";", which
      // only show up in that kind of sentence - see doc comment.
      if (/tutarlar|belirtil|[=;]/.test(windowText)) continue;

      const markers = findCurrencyMarkers(windowText);
      if (
        markers.length === valueColumnCount &&
        markers.includes("TL") &&
        markers.includes("FX")
      ) {
        return -(markers.length - markers.indexOf("TL"));
      }
    }
  }
  return null;
}

/**
 * Finds the negative column index (e.g. -2) that holds the TL figure,
 * used by the rest of the matching loop to extract value.
 *
 * Balance sheet and income statement rows can have a *different* number of
 * trailing value columns within the very same report - e.g. 2025Q2 ahgaz's
 * balance sheet has 2 (current/prior), but its income statement has 4
 * (6-month-current, 3-month-current, 6-month-prior, 3-month-prior), because
 * only the income statement breaks each period into cumulative + standalone
 * quarter figures. A single document-wide index can't fit both, so this is
 * called once per anchor row type (see BALANCE_SHEET_ROW_LABELS /
 * REVENUE_ROW_LABELS below) and the result applied only to that anchor's
 * own section(s) - see getValueIndexForSection.
 *
 * Within one anchor's columns, a currency split (e.g. pgsus/eregl: TL +
 * EUR/USD side by side) can further widen the column count on top of that;
 * detectTlColumnOffset locates the TL sub-column when that's the case.
 */
const REVENUE_ROW_LABELS = new Set(
  sections.revenue.keywordSchemas
    .find((schema) => schema.chosenLabel === "hasılat")!
    .keyword.map(normalizeText),
);

/**
 * Anchor for balance sheet rows - "nakit ve nakit benzerleri" is the first
 * line item of every balance sheet and is a mandatory sectionStartKey, so
 * it's always present and always carries a real value on its own row.
 */
const BALANCE_SHEET_ROW_LABELS = new Set(
  sections.currentAssets.keywordSchemas
    .find((schema) => schema.chosenLabel === "nakit ve nakit benzerleri")!
    .keyword.map(normalizeText),
);

function detectValueColumnIndex(
  lines: string[],
  anchorLabels: Set<string>,
): number {
  const STANDARD_COLUMN_INDEX = -2; // 4-column layout: second from the right

  for (const line of lines) {
    const { label, tokens } = splitLabelAndTokens(line);
    if (!anchorLabels.has(normalizeText(label))) continue;

    // Detect last value token index from right-to-left
    let valueStartIndex = null;
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (isValueToken(tokens[i])) {
        valueStartIndex = i;
      } else {
        break;
      }
    }

    const valueColumnCount = tokens.length - valueStartIndex!;
    if (valueColumnCount < 4) return STANDARD_COLUMN_INDEX;

    const tlOffset = detectTlColumnOffset(lines, valueColumnCount);
    if (tlOffset !== null) return tlOffset;

    // Reports without a readable interleaved currency header (e.g. no
    // per-column "tl"/"avro" marker row at all) group same-currency columns
    // together with TL first (see detectTlColumnOffset's doc comment), so
    // the first trailing value column is the TL one regardless of how many
    // columns there are in total - unlike a hardcoded offset, this holds
    // whether the row has 4 columns (pgsus balance sheet) or 8 (pgsus
    // income statement, which adds a quarter/cumulative split on top of the
    // currency split).
    return -valueColumnCount;
  }

  return STANDARD_COLUMN_INDEX;
}

/** Matches a "- Label ..." bullet/detail row, as opposed to a lone "-" standing in for a missing value in a value column. */
function isDetailLine(line: string): boolean {
  return /^-\s*[a-zçğıöşü]/i.test(line.trim());
}

/** Parses a Turkish-formatted number token (e.g. "18.068.564", "(1.234)") into a plain integer. */
function parseTurkishNumber(token: string): number {
  const trimmed = token.trim();
  const isNegative = trimmed.startsWith("(") || trimmed.startsWith("-");
  const digits = trimmed.replace(/\D/g, "");
  const n = parseInt(digits, 10) || 0;
  return isNegative ? -n : n;
}

/** Formats a plain integer back into Turkish thousands-separated form (e.g. 18068564 -> "18.068.564") to match the format of directly-matched values. */
function formatSummedNumber(n: number): string {
  return n.toLocaleString("tr-TR");
}

/** A lone "-" (or em-dash) standing in a value column means "no figure for this period" - a real, resolved zero, not a missing/wrapped value. */
function isZeroPlaceholder(token: string): boolean {
  return token.trim() === "-" || token.trim() === "—";
}

/** A usable value token: either a real number, or a "-" standing in for a real (zero) figure. */
function isUsableValueToken(token: string | undefined): token is string {
  return !!token && (isZeroPlaceholder(token) || isValueToken(token));
}

/** Parses a usable value token to a number - a zero placeholder ("-") is 0, everything else goes through parseTurkishNumber. */
function parseUsableValueToken(token: string): number {
  return isZeroPlaceholder(token) ? 0 : parseTurkishNumber(token);
}

/**
 * Reads one "-" detail row's value, starting at `lines[index]`. Normally
 * the value sits on that same line, but the row's label can spill onto the
 * next physical line first (e.g. 2026Q1 tavhl: "- gerçeğe uygun değer farkı
 * kar / zarara yansıtılan" continues on the next line). So if the row's own line has no value, this
 * peeks at exactly one following line for it - but only if that line isn't
 * itself a new "-" row, which would mean there's no wrapped value here at
 * all. Returns the value (null if never found) and how many lines the row
 * took up (1, or 2 if the value was on the wrapped continuation line).
 */
function readDetailRowValue(
  lines: string[],
  index: number,
  extractValueIndex: number,
): { value: string | null; lineCount: number } {
  const { tokens } = splitLabelAndTokens(lines[index]);
  const ownValue = tokens.at(extractValueIndex);
  if (isUsableValueToken(ownValue)) {
    return { value: ownValue, lineCount: 1 };
  }

  const nextLine = lines[index + 1];
  if (nextLine === undefined || !nextLine.trim() || isDetailLine(nextLine)) {
    return { value: null, lineCount: 1 };
  }

  const { tokens: wrappedTokens } = splitLabelAndTokens(nextLine);
  const wrappedValue = wrappedTokens.at(extractValueIndex);
  return isUsableValueToken(wrappedValue)
    ? { value: wrappedValue, lineCount: 2 }
    : { value: null, lineCount: 1 };
}

/**
 * Some reports leave a keyword's own row blank (label only, no value) and
 * break the figure down into sub-items directly below it instead. Those
 * sub-items' own labels are arbitrary per PDF, so sum every "-" detail row
 * that follows and use that as the parent keyword's value (see
 * readDetailRowValue for how each row's value is read).
 *
 * The scan ends at the first line that isn't a "-" row (and isn't a
 * wrapped continuation already accounted for) - that's the next sibling
 * keyword/label, not a detail of this one.
 *
 * if you wanna see example issues:
 * - 2026Q1: froto - uzun vadeli borçlanmaların kısa vadeli kısımları
 * - 2026Q1: tavhl - finansal yatırımlar (a detail row's label wraps onto the next line)
 */
function sumFollowingDetailLines(
  lines: string[],
  startIndex: number,
  extractValueIndex: number,
): { total: number; detailLineCount: number; lastConsumedIndex: number } {
  let total = 0;
  let detailLineCount = 0;
  let lastConsumedIndex = startIndex - 1;

  let rowIndex = startIndex;
  while (rowIndex < lines.length) {
    const line = lines[rowIndex];
    if (!line.trim()) {
      rowIndex++;
      continue;
    }
    if (!isDetailLine(line)) break;

    const { value, lineCount } = readDetailRowValue(
      lines,
      rowIndex,
      extractValueIndex,
    );
    if (value !== null) {
      total += parseUsableValueToken(value);
      detailLineCount++;
    }
    lastConsumedIndex = rowIndex + lineCount - 1;
    rowIndex += lineCount;
  }

  return { total, detailLineCount, lastConsumedIndex };
}

/** Leading-whitespace width of a raw (untrimmed) line - used by blankSummedIndentedDetailChildren to tell an indented detail row from its parent. */
function indentDepth(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Some reports print a line-item's own total on one row, then restate that
 * same figure broken down into indented sub-rows directly below it - no "-"
 * prefix, just deeper leading whitespace than the parent (as opposed to the
 * "parent has no value, sum its detail rows" case sumFollowingDetailLines
 * handles). Left alone, those sub-rows can themselves accidentally match a
 * *different* configured keyword (e.g. "banka kredileri" as an alt spelling
 * of "kısa vadeli borçlanmalar", or "kiralama işlemlerinden kaynaklanan
 * yükümlülükler" as a spelling of the lease-liabilities label), corrupting
 * an unrelated label with what's actually just a breakdown of this row.
 *
 * Only called for `lines[parentIndex]` while inside a section whose
 * allowDetailSum is true (see call site in matchKeywordsInLines) - the same
 * gating sumFollowingDetailLines respects. Without it, this pattern also
 * shows up in e.g. the revenue section's net-income split ("dönem karı" ->
 * "-kontrol gücü olmayan paylar" + "-ana ortaklık payları"), where the
 * split-out child row *is* the correct value for its own configured keyword
 * and must not be blanked.
 *
 * Detects a run of immediately-following more-indented rows whose values
 * sum back to `lines[parentIndex]`'s own value, and blanks those rows out in
 * place (rather than removing them, so every other line's index / page-marker
 * position stays intact) so the keyword-matching loop skips over them
 * entirely.
 *
 * see example issues:
 * - koton: "kısa vadeli borçlanmalar" (two of its children -
 *   "uzun vadeli borçlanmaların kısa vadeli kısımları" and "kiralama
 *   işlemlerinden kaynaklanan yükümlülükler" - are themselves configured
 *   keywords for other labels)
 * - ekgyo: "uzun vadeli borçlanmaların kısa vadeli kısımları" (one child -
 *   "banka kredileri" - is itself a configured alt-keyword for "kısa vadeli
 *   borçlanmalar")
 */
function blankSummedIndentedDetailChildren(
  lines: string[],
  parentIndex: number,
  extractValueIndex: number,
): void {
  const parentLine = lines[parentIndex];
  const parentIndent = indentDepth(parentLine);
  const ownValue = splitLabelAndTokens(parentLine).tokens.at(extractValueIndex);
  if (!isUsableValueToken(ownValue)) return;

  let total = 0;
  let detailCount = 0;
  let j = parentIndex + 1;
  while (j < lines.length) {
    const detailLine = lines[j];
    if (!detailLine.trim()) {
      j++;
      continue;
    }
    if (indentDepth(detailLine) <= parentIndent) break;

    const detailValue =
      splitLabelAndTokens(detailLine).tokens.at(extractValueIndex);
    if (!isUsableValueToken(detailValue)) break;

    total += parseUsableValueToken(detailValue);
    detailCount++;
    j++;
  }

  if (detailCount > 0 && total === parseUsableValueToken(ownValue)) {
    for (let k = parentIndex + 1; k < j; k++) {
      if (lines[k].trim()) lines[k] = "";
    }
  }
}

/**
 * A label can be long and can wrap onto a second (or third) physical line before
 * any value appears. Tries concatenating consecutive lines' labels starting at
 * `startIndex` and returns how many lines matched (0 if it never does).
 */
const MAX_LABEL_WRAP_LINES = 3;

function matchWrappedLabel(
  lines: string[],
  startIndex: number,
  normalizedTarget: string,
): number {
  let combinedLabel = "";
  for (
    let k = 0;
    k < MAX_LABEL_WRAP_LINES && startIndex + k < lines.length;
    k++
  ) {
    const { label, tokens } = splitLabelAndTokens(lines[startIndex + k]);
    combinedLabel += normalizeText(label);
    if (combinedLabel === normalizedTarget) return k + 1;
    if (!normalizedTarget.startsWith(combinedLabel)) break;

    // A genuine wrapped label's intermediate line carries nothing but the
    // label text. If this line already has trailing tokens of its own
    // (dipnot/value columns), it's a complete, distinct row that just
    // happens to share a text prefix with the target - not a continuation -
    // so don't glue the next line's label onto it (see odine 2025Q1
    // "kontrol gücü olmayan paylar" / "ana ortaklık payları": two separate
    // sibling rows, not one wrapped label).
    const labelTokenCount = label.trim() ? label.trim().split(/\s+/).length : 0;
    if (tokens.length > labelTokenCount) break;
  }
  return 0;
}

function equityKeywordsFullyResolved(
  foundValues: Record<string, string | null>,
): boolean {
  return sections.equity.keywordSchemas.every((schema) =>
    schema.keyword.some(
      (key) => foundValues[`equity_${schema.chosenLabel}_${key}`] !== null,
    ),
  );
}

/** Step 2b: builds normalizedKey -> sectionName maps used to track which section the scan is currently inside. */
function buildSectionKeyMaps(): {
  sectionStartKeyMap: Record<string, string>;
  sectionEndKeyMap: Record<string, string>;
} {
  const sectionStartKeyMap: Record<string, string> = {};
  const sectionEndKeyMap: Record<string, string> = {};

  for (const [sectionName, sectionDef] of Object.entries(sections)) {
    if (!sectionDef.sectionStartKeys) continue;
    for (const sk of sectionDef.sectionStartKeys) {
      sectionStartKeyMap[normalizeText(sk)] = sectionName;
    }
    if (sectionDef.sectionEndKeys) {
      for (const ek of sectionDef.sectionEndKeys) {
        sectionEndKeyMap[normalizeText(ek)] = sectionName;
      }
    }
  }

  return { sectionStartKeyMap, sectionEndKeyMap };
}

/**
 * Walks every line, tracks which section we're currently inside and records the first matching value for each configured keyword.
 */
/**
 * The PDF's real (1-indexed) page number for lines[index], derived by
 * counting the "#page-end#" boundary markers loadReportLines leaves intact
 * before it - the Nth marker means everything after it is `startPage` + N
 * pages in (loadReportLines's own return value, accounting for any front
 * matter its own slicing dropped before lines[0]). Used to know which page
 * to screenshot for verify.html, so a matched value can be checked against
 * the actual PDF without opening it.
 */
function pageNumberForLineIndex(
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

function matchKeywordsInLines(
  lines: string[],
  getValueIndexForSection: (sectionName: string) => number,
  sectionStartKeyMap: Record<string, string>,
  sectionEndKeyMap: Record<string, string>,
  startPage: number,
): {
  foundValues: Record<string, string | null>;
  prefixFoundValues: Record<string, string | null>;
  foundValuePages: Record<string, number>;
  prefixFoundValuePages: Record<string, number>;
} {
  // Keyed by sectionName_label_keyword to handle duplicate keywords across sections and labels
  const foundValues: Record<string, string | null> = {};
  // Keyed by sectionName_label_PREFIX::prefix - tracked separately
  const prefixFoundValues: Record<string, string | null> = {};
  for (const [sectionName, sectionDef] of Object.entries(sections)) {
    for (const schema of sectionDef.keywordSchemas) {
      for (const key of schema.keyword) {
        foundValues[`${sectionName}_${schema.chosenLabel}_${key}`] = null;
      }
      for (const prefix of sectionDef.keywordPrefixes) {
        prefixFoundValues[
          `${sectionName}_${schema.chosenLabel}_PREFIX::${prefix}`
        ] = null;
      }
    }
  }

  // Which PDF page each resolved uniqueKey's value came from - keyed the
  // same way as foundValues/prefixFoundValues, so resolveValuesFromMatches
  // can look up the page for whichever uniqueKey actually wins instead of
  // this function guessing (it doesn't know the priority-selection rules).
  const foundValuePages: Record<string, number> = {};
  const prefixFoundValuePages: Record<string, number> = {};

  let currentSection = "";

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const trimmed = line.trim();
    if (!trimmed) continue;

    const { label, tokens } = splitLabelAndTokens(line);
    const normalizedLabel = normalizeText(label);

    // --- Section detection (start) ---
    const matchedStartKey = Object.keys(sectionStartKeyMap).find(
      (k) => normalizedLabel === normalizeText(k),
    );
    if (matchedStartKey !== undefined) {
      const targetSection = sectionStartKeyMap[matchedStartKey];
      const isEquityToRevenue =
        currentSection === "equity" && targetSection === "revenue";
      // Block only the equity -> revenue switch, and only while equity
      // hasn't resolved all its own keywords yet. Every other section
      // switch goes through untouched.
      const allowSwitch =
        !isEquityToRevenue || equityKeywordsFullyResolved(foundValues);
      if (allowSwitch) {
        currentSection = targetSection;
        logger.info(`###Section START: "${currentSection}" (${trimmed})`);
        // In some cases, we use actual keyword as section starter so don't continue next line
      }
    }

    // --- Section detection (end) ---
    const matchedEndKey = Object.keys(sectionEndKeyMap).find(
      (k) => normalizedLabel === normalizeText(k),
    );
    const foundSectionEnding =
      matchedEndKey !== undefined ? sectionEndKeyMap[matchedEndKey] : undefined;

    // --- Blank indented detail rows that just restate this row's own total,
    // so they can't later be mistaken for a standalone keyword row (see
    // blankSummedIndentedDetailChildren). Gated the same way
    // sumFollowingDetailLines is: only sections that opted into
    // allowDetailSum actually use this total+breakdown reporting style.
    if (
      currentSection &&
      sections[currentSection as keyof typeof sections]?.allowDetailSum
    ) {
      // TODO: this feature only seems to efect koton 2025q1. remove it.
      blankSummedIndentedDetailChildren(
        lines,
        lineIndex,
        getValueIndexForSection(currentSection),
      );
    }

    // --- Keyword matching ---
    for (const [sectionName, sectionDef] of Object.entries(sections)) {
      // Only match a section's keywords while we're inside that section.
      if (currentSection !== sectionName) {
        continue;
      }
      const extractValueIndex = getValueIndexForSection(sectionName);

      for (const schema of sectionDef.keywordSchemas) {
        // one line can belong to one label. if line matched break outer as well.
        let lineMatched = false;
        for (const key of schema.keyword) {
          const normalizedKey = normalizeText(key);
          const uniqueKey = `${sectionName}_${schema.chosenLabel}_${key}`;
          if (foundValues[uniqueKey] !== null) continue;

          // A keyword's label can itself wrap across lines before any value
          // appears - so
          // this always goes through matchWrappedLabel rather than a plain
          // same-line equality check (wrapLineCount is 1 for the common,
          // non-wrapped case).
          const wrapLineCount = matchWrappedLabel(
            lines,
            lineIndex,
            normalizedKey,
          );
          if (wrapLineCount === 0) continue;

          const lastWrapLineIndex = lineIndex + wrapLineCount - 1;
          const { tokens: wrapTokens } = splitLabelAndTokens(
            lines[lastWrapLineIndex],
          );
          const value = wrapTokens.at(extractValueIndex);

          // isValueToken guards against lines like "özkaynaklar 19" where the keyword is used as section and should be ignored
          if (value && (isZeroPlaceholder(value) || isValueToken(value))) {
            const resolvedValue = isZeroPlaceholder(value) ? "0" : value;
            foundValues[uniqueKey] = resolvedValue;
            const matchedLine = `MATCHED [${key}] (section: "${currentSection}"): label="${label}" val="${resolvedValue}" (full line: "${trimmed}")`;
            logger.info(matchedLine);
            foundValuePages[uniqueKey] = pageNumberForLineIndex(
              lines,
              lastWrapLineIndex,
              startPage,
            );
            lineMatched = true;
            lineIndex = lastWrapLineIndex;
            break;
          } else {
            // Found keyword but no value on its own row - try summing its detail rows instead

            if (!sectionDef.allowDetailSum) break;

            const { total, detailLineCount, lastConsumedIndex } =
              sumFollowingDetailLines(
                lines,
                lastWrapLineIndex + 1,
                extractValueIndex,
              );

            // if conditions are not met, don't write a bogus "0", so a later line can still resolve it normally.
            if (detailLineCount > 0 && total !== 0) {
              const summedValue = formatSummedNumber(total);
              foundValues[uniqueKey] = summedValue;
              const matchedLine = `MATCHED [${key}] (section: "${currentSection}"): label="${label}" val="${summedValue}" (summed ${detailLineCount} detail row(s) below: "${trimmed}")`;
              logger.info(matchedLine);
              foundValuePages[uniqueKey] = pageNumberForLineIndex(
                lines,
                lastWrapLineIndex,
                startPage,
              );
              lineMatched = true;
              lineIndex = lastConsumedIndex;
              break;
            }
          }
        }
        if (lineMatched) break;
      }

      // --- Prefixed keyword matching ---
      for (const prefix of sectionDef.keywordPrefixes) {
        for (const schema of sectionDef.keywordSchemas) {
          const prefixedLabel = `${prefix} ${schema.chosenLabel}`;
          const uniqueKey = `${sectionName}_${schema.chosenLabel}_PREFIX::${prefix}`;
          if (prefixFoundValues[uniqueKey] !== null) continue;

          const wrapLineCount = matchWrappedLabel(
            lines,
            lineIndex,
            normalizeText(prefixedLabel),
          );
          if (wrapLineCount === 0) continue;
          const lastWrapLineIndex = lineIndex + wrapLineCount - 1;
          const { tokens: wrapTokens } = splitLabelAndTokens(
            lines[lastWrapLineIndex],
          );

          const value = wrapTokens.at(extractValueIndex);
          if (value && (isZeroPlaceholder(value) || isValueToken(value))) {
            const resolvedValue = isZeroPlaceholder(value) ? "0" : value;
            prefixFoundValues[uniqueKey] = resolvedValue;
            const matchedLine = `MATCHED [${prefixedLabel}] (section: "${currentSection}"): label="${label}" val="${resolvedValue}" (full line: "${trimmed}")`;
            logger.info(matchedLine);
            prefixFoundValuePages[uniqueKey] = pageNumberForLineIndex(
              lines,
              lastWrapLineIndex,
              startPage,
            );
            lineIndex = lastWrapLineIndex;
            continue;
          }

          if (!sectionDef.allowDetailSum) continue;

          const { total, detailLineCount, lastConsumedIndex } =
            sumFollowingDetailLines(
              lines,
              lastWrapLineIndex + 1,
              extractValueIndex,
            );
          if (detailLineCount > 0 && total !== 0) {
            const summedValue = formatSummedNumber(total);
            prefixFoundValues[uniqueKey] = summedValue;
            const matchedLine = `MATCHED [${prefixedLabel}] (section: "${currentSection}"): label="${label}" val="${summedValue}" (summed ${detailLineCount} detail row(s) below: "${trimmed}")`;
            logger.info(matchedLine);
            prefixFoundValuePages[uniqueKey] = pageNumberForLineIndex(
              lines,
              lastWrapLineIndex,
              startPage,
            );
            lineIndex = lastConsumedIndex;
          }
        }
      }
    }

    // finished with line. if it was section ending move to next section
    if (
      foundSectionEnding !== undefined &&
      foundSectionEnding === currentSection
    ) {
      const nextSection = (
        sections[currentSection as keyof typeof sections] as {
          nextSection?: string;
        }
      )?.nextSection;
      logger.info(
        `###Section END: "${currentSection}" (${trimmed})` +
          (nextSection ? ` -> forced chaining into "${nextSection}"` : ""),
      );
      currentSection = nextSection ?? "";
    }
  }

  // console.log("foundvalues", foundValues);
  return {
    foundValues,
    prefixFoundValues,
    foundValuePages,
    prefixFoundValuePages,
  };
}

/**
 * for each configured chosenLabel, picks its first matched
 * keyword's value. If there is no matched keyword value, falls back to the
 * sum of its prefixed rows instead.
 *
 * Why fall back instead of always adding both? Reports use the prefixed
 * rows one of two ways:
 * 1. Some (2026Q1: selec, tcell) print the keyword's own row already
 *    holding the full total, with the prefixed rows underneath just
 *    re-stating that same total - adding those on top of the bare value
 *    would double-count it.
 * 2. Others (2026Q1: ttrak, ttkom) print the keyword's own row with no
 *    value at all, reporting the total only as the sum of the prefixed
 *    rows - there, adding them together is the only way to get the total.
 *
 * There can be reports that outside of these two patterns. We need to find and state here just to design better flow.
 */
function resolveValuesFromMatches(
  foundValues: Record<string, string | null>,
  prefixFoundValues: Record<string, string | null>,
  foundValuePages: Record<string, number>,
  prefixFoundValuePages: Record<string, number>,
): {
  resolvedValues: Record<string, string>;
  labelPages: Record<string, number[]>;
} {
  const resolvedValues: Record<string, string> = {};
  // Which PDF page(s) back each label's resolved value, for verify.html to
  // show next to the right screenshot instead of one long table above all
  // of them. A bare match has exactly one page; a summed prefix match can
  // span as many pages as it has prefixes (usually just one in practice).
  const labelPages: Record<string, number[]> = {};

  for (const [sectionName, sectionDef] of Object.entries(sections)) {
    for (const schema of sectionDef.keywordSchemas) {
      let valToWrite: string | null = null;
      let valPage: number | undefined;

      // Priority lookup: first keyword that resolved wins
      for (const key of schema.keyword) {
        const uniqueKey = `${sectionName}_${schema.chosenLabel}_${key}`;
        if (foundValues[uniqueKey]) {
          valToWrite = foundValues[uniqueKey];
          valPage = foundValuePages[uniqueKey];
          break;
        }
      }

      let prefixedTotal = 0;
      const prefixPages = new Set<number>();
      for (const prefix of sectionDef.keywordPrefixes) {
        const uniqueKey = `${sectionName}_${schema.chosenLabel}_PREFIX::${prefix}`;
        const prefixedValue = prefixFoundValues[uniqueKey];
        if (prefixedValue) {
          prefixedTotal += parseTurkishNumber(prefixedValue);
          const page = prefixFoundValuePages[uniqueKey];
          if (page !== undefined) prefixPages.add(page);
        }
      }

      resolvedValues[schema.chosenLabel] =
        valToWrite ||
        (prefixedTotal !== 0 ? formatSummedNumber(prefixedTotal) : "0");

      const pages = valToWrite
        ? valPage !== undefined
          ? [valPage]
          : []
        : Array.from(prefixPages).sort((a, b) => a - b);
      if (pages.length > 0) labelPages[schema.chosenLabel] = pages;
    }
  }

  return { resolvedValues, labelPages };
}

/**
 * hand-verified corrections for specific PDFs whose layout didn't
 * parse cleanly through the normal keyword scan above. Mutates
 * `resolvedValues` in place.
 */
function applyManualCorrections(
  baseName: string,
  quarter: string,
  resolvedValues: Record<string, string>,
): void {
  // this bdf is broken. it has no ToUnicode mapping.
  if (baseName === "bsoke" && quarter === "2025Q2") {
    resolvedValues["nakit ve nakit benzerleri"] = "2.613.490";
    resolvedValues["kısa vadeli borçlanmalar"] = "444.096";
    resolvedValues["uzun vadeli borçlanmaların kısa vadeli kısımları"] =
      "460.301";
    resolvedValues["uzun vadeli borçlanmalar"] = "1.842.382";
    resolvedValues["ana ortaklığa ait özkaynaklar"] = "11.547.941";
    resolvedValues["toplam kaynaklar"] = "15.489.463";
    resolvedValues["hasılat"] = "2.613.490";
    resolvedValues["esas faaliyet karı"] = "(77.912)";
    resolvedValues["ana ortaklık payları"] = "344.063";
  }

  /**
   * label line comes after value:
   * 2.211.953.801  1.919.620.101 
toplam kaynaklar   
   */
  if (baseName === "kfein" && quarter === "2025Q4") {
    resolvedValues["toplam kaynaklar"] = "2.211.953.801";
  }

  // the given pdf is image
  if (baseName === "kimmr" && quarter === "2025Q4") {
    resolvedValues["nakit ve nakit benzerleri"] = "1.460.923.163";
    resolvedValues["finansal yatırımlar"] = "608.882";
    resolvedValues["duran finansal yatırımlar"] = "0";
    resolvedValues["kısa vadeli borçlanmalar"] = "301.325.302";
    resolvedValues["uzun vadeli borçlanmaların kısa vadeli kısımları"] =
      "6.073.814";
    resolvedValues["kısa dönem kira yükümlülükleri"] = "269.893.744";
    resolvedValues["uzun vadeli borçlanmalar"] = "0";
    resolvedValues["uzun dönem kira yükümlülükleri"] = "1.555.031.699";
    resolvedValues["ana ortaklığa ait özkaynaklar"] = "4.377.841.509";
    resolvedValues["toplam kaynaklar"] = "9.011.978.714";
    resolvedValues["hasılat"] = "13.983.809.841";
    resolvedValues["esas faaliyet karı"] = "117.032.662";
    resolvedValues["ana ortaklık payları"] = "650.808.229";
  }

  // the given pdf is image
  if (baseName === "marbl" && quarter === "2025Q2") {
    resolvedValues["nakit ve nakit benzerleri"] = "60.001.656";
    resolvedValues["finansal yatırımlar"] = "0";
    resolvedValues["duran finansal yatırımlar"] = "0";
    resolvedValues["kısa vadeli borçlanmalar"] = "316.529.570";
    resolvedValues["uzun vadeli borçlanmaların kısa vadeli kısımları"] =
      "114.668.611";
    resolvedValues["uzun vadeli borçlanmalar"] = "371.206.380";
    resolvedValues["ana ortaklığa ait özkaynaklar"] = "2.444.443.836";
    resolvedValues["toplam kaynaklar"] = "4.084.072.806";
    resolvedValues["hasılat"] = "802.181.160";
    resolvedValues["esas faaliyet karı"] = "51.730.291";
    resolvedValues["ana ortaklık payları"] = "57.031.821";
  }
}

/** Turkish thousands separator is "." (e.g. "345.599.501") - drop it so the saved value is a plain number. */
function stripThousandsSeparators(value: string): string {
  return value.replace(/\./g, "");
}

/**
 * Writes labelPages through prettier (using the repo's own .prettierrc)
 * before saving, so the manifest is already in the exact shape the
 * lint-staged pre-commit hook (prettier --write on staged json) would leave
 * it in - otherwise every run re-uglifies these files and every commit
 * reformats them right back, showing up as unrelated-looking diff noise.
 */
async function writePagesManifest(
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

/** Step 4: writes the final per-label values as a two-column CSV. */
function writeDetailedCsv(
  outputCsv: string,
  resolvedValues: Record<string, string>,
  quarter: string,
): void {
  let csvOutput = `Kalem,${quarter}\n`;
  for (const sectionDef of Object.values(sections)) {
    for (const schema of sectionDef.keywordSchemas) {
      const value = stripThousandsSeparators(
        resolvedValues[schema.chosenLabel],
      );
      csvOutput += `${schema.chosenLabel},${value}\n`;
    }
  }
  fs.writeFileSync(outputCsv, csvOutput);
}

// --- Main Pipeline ---

async function processPdfFile(file: string, quarterPaths: QuarterPaths) {
  const {
    quarter,
    pdfDir,
    convertedDir,
    resultsDir,
    verifyPagesDir,
    verifyScreenshotsDir,
  } = quarterPaths;
  const baseName = path.parse(file).name;
  const pdfPath = path.join(pdfDir, file);
  const mdPath = path.join(convertedDir, `${baseName}.txt`);
  const outputCsv = path.join(resultsDir, `${baseName}.csv`);

  logger.info(`Starting basic processing for ${file} (${quarter})`);

  const { lines, startPage, firstPageWarning } = await loadReportLines(
    file,
    pdfPath,
    mdPath,
  );
  if (firstPageWarning) {
    logger.warn(
      `${file}: page 1 contains "${firstPageWarning}" - possibly the wrong document (e.g. a faaliyet raporu instead of financial statements)`,
    );
  }
  const balanceSheetValueIndex = detectValueColumnIndex(
    lines,
    BALANCE_SHEET_ROW_LABELS,
  );
  const revenueValueIndex = detectValueColumnIndex(lines, REVENUE_ROW_LABELS);
  // Revenue is the only section whose value columns come from the income
  // statement; every other configured section lives on the balance sheet.
  //
  // This resolves to the leftmost (current-year, cumulative year-to-date)
  // value column, same as every other section - not the standalone-quarter
  // figure. Reports order their other 3 columns (prior-year YTD,
  // current/prior standalone quarter) inconsistently between templates
  // (grouped by period-type vs. by year - see git history for the
  // now-removed detectQuarterColumnOffset/detectSplitQuarterColumnOffset/
  // detectAuditStatusColumnOffset, which tried to disambiguate that), but
  // every report seen puts current-year YTD first regardless. The
  // standalone-quarter figure (YTD - previous quarter's YTD) is derived
  // downstream from these saved YTD values when pushed to the db, not here.
  const getValueIndexForSection = (sectionName: string): number =>
    sectionName === "revenue" ? revenueValueIndex : balanceSheetValueIndex;
  const { sectionStartKeyMap, sectionEndKeyMap } = buildSectionKeyMaps();
  const {
    foundValues,
    prefixFoundValues,
    foundValuePages,
    prefixFoundValuePages,
  } = matchKeywordsInLines(
    lines,
    getValueIndexForSection,
    sectionStartKeyMap,
    sectionEndKeyMap,
    startPage,
  );

  const { resolvedValues, labelPages } = resolveValuesFromMatches(
    foundValues,
    prefixFoundValues,
    foundValuePages,
    prefixFoundValuePages,
  );

  const pagesManifestPath = path.join(verifyPagesDir, `${baseName}.json`);
  await writePagesManifest(pagesManifestPath, labelPages);
  const allPages = Array.from(new Set(Object.values(labelPages).flat())).sort(
    (a, b) => a - b,
  );
  await renderVerifyScreenshots(
    pdfPath,
    baseName,
    allPages,
    verifyScreenshotsDir,
  );

  applyManualCorrections(baseName, quarter, resolvedValues);
  printExtractionSummary(file, resolvedValues);

  writeDetailedCsv(outputCsv, resolvedValues, quarter);
  logger.info(`Detailed results saved to: ${outputCsv}`);
}

/**
 * Processes `tasks`, keeping at most `concurrency` PDFs in flight at once -
 * each slot pulls the next task as soon as it finishes its current one, so a
 * slot stuck on a big PDF doesn't block the others from moving on.
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
async function processTasksConcurrently(tasks: PdfTask[], concurrency: number) {
  let nextIndex = 0;

  async function runSlot() {
    while (nextIndex < tasks.length) {
      const { file, quarterPaths } = tasks[nextIndex++];
      try {
        await processPdfFile(file, quarterPaths);
      } catch (err: any) {
        logger.error(`Error processing file ${file}`, err.message);
      }
    }
  }

  const slots = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    runSlot,
  );
  await Promise.all(slots);
}

// Each in-flight PDF spawns its own PDFBox (java) subprocess, so cap the
// pool rather than leaving it unbounded; override via a plain-number CLI arg
// (see discoverTasks) e.g. `... 1` to force strictly serial processing
// (cleaner, non-interleaved logs).
const DEFAULT_CONCURRENCY = 8;

interface PdfTask {
  file: string;
  quarterPaths: QuarterPaths;
}

const QUARTER_ARG_PATTERN = /^\d{4}q[1-4]$/i;
const CONCURRENCY_ARG_PATTERN = /^\d+$/;

/**
 * Every PDF across every discovered quarter, optionally narrowed by plain
 * CLI args (same convention as scripts/v2/push-detailed-results.ts), in any
 * order:
 *   - a quarter, e.g. `2025q1` -> only that quarter
 *   - a number, e.g. `1`       -> concurrency override
 *   - anything else, e.g. `kimmr` -> only that symbol (repeatable)
 * e.g. `npx tsx basic-extract.ts kimmr 2025q1` is the equivalent of
 * temporarily hardcoding a single file+quarter while debugging one report's
 * extraction, without editing the source.
 */
function discoverTasks(): { tasks: PdfTask[]; concurrency: number } {
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
      tasks.push({ file, quarterPaths });
    }
  }
  return { tasks, concurrency };
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
function runGenerateVerifyHtml(): Promise<void> {
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

async function runPipeline() {
  const { tasks, concurrency } = discoverTasks();

  if (tasks.length === 0) {
    logger.info(`No PDFs to process under '${PDFS_ROOT_DIR}'.`);
    return;
  }

  // Resolved once here, before any concurrent task starts, so 8 PDFs
  // needing conversion at once don't each independently see the jar
  // missing and race to download it.
  await ensurePdfBoxJar();

  logger.info(
    `--- Processing ${tasks.length} PDF(s) with concurrency ${concurrency} ---`,
  );
  await processTasksConcurrently(tasks, concurrency);

  logger.info("--- Regenerating verify.html for all quarters ---");
  try {
    await runGenerateVerifyHtml();
  } catch (err: any) {
    logger.error("Failed to regenerate verify.html", err.message);
  }
}

runPipeline().catch((err) => logger.error("Fatal error in pipeline:", err));
