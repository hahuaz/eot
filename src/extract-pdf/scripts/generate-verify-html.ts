// Usage (from extract-pdf/):
//   npx tsx scripts/generate-verify-html.ts
//   npx tsx scripts/serve-pdfs.ts          # run once, leave running - only needed for the "Open PDF" fallback link
//
// Builds one standalone HTML file per quarter (local-data/extract-pdf/verify/<quarter>/verify.html)
// with, for each symbol, one block per PDF page that produced a matched
// value: a small table of just that page's values (abbreviated as K/M/B/T)
// sitting side by side with a screenshot of the page itself (rendered by
// basic-extract.ts via render-page-screenshots.ts) - so each screenshot only
// ever needs to be checked against the handful of rows it's actually for,
// not all ~13 keys at once. It's plain HTML (not markdown) so it opens
// directly in a browser - no markdown-preview extension needed. The
// "Open PDF" link is kept as a fallback for cases a screenshot doesn't
// answer.
//
// Every quarter under local-data/extract-pdf/pdfs/ is discovered and regenerated (see
// discoverQuarters) - same auto-discovery basic-extract.ts uses - so a new
// quarter needs no code change here either.

import fs from "fs";
import path from "path";

import { PDF_SERVER_PORT } from "./constants";

const ROOT_DIR = path.join(__dirname, "..");
// Large per-quarter data lives outside the repo under local-data/
// (gitignored) rather than under assets/, which stays for small tracked
// outputs like results/.
const LOCAL_DATA_DIR = path.join(
  ROOT_DIR,
  "..",
  "..",
  "local-data",
  "extract-pdf",
);
const PDFS_ROOT_DIR = path.join(LOCAL_DATA_DIR, "pdfs");
// All three siblings of PDFS_ROOT_DIR (same per-quarter shape), not nested
// under one basic-extract/<quarter>/ base - see basic-extract.ts's
// matching PDF_CONVERTED_ROOT_DIR/RESULTS_ROOT_DIR/VERIFY_ROOT_DIR.
const PDF_CONVERTED_ROOT_DIR = path.join(LOCAL_DATA_DIR, "pdf-converted");
const RESULTS_ROOT_DIR = path.join(ROOT_DIR, "assets", "results");
const VERIFY_ROOT_DIR = path.join(LOCAL_DATA_DIR, "verify");

interface QuarterPaths {
  quarter: string;
  resultsDir: string;
  pdfDir: string;
  verifyDir: string;
  convertedDir: string;
  pagesDir: string;
  screenshotsDir: string;
  outputPath: string;
}

function getQuarterPaths(quarter: string): QuarterPaths {
  const verifyDir = path.join(VERIFY_ROOT_DIR, quarter);

  return {
    quarter,
    resultsDir: path.join(RESULTS_ROOT_DIR, quarter),
    pdfDir: path.join(PDFS_ROOT_DIR, quarter),
    verifyDir,
    // Raw plain-text pages extracted by basic-extract.ts's convertPdfToMd -
    // its first line is a "#first-page-warning:<keyword>#" marker when the
    // PDF's actual page 1 (never otherwise covered by this file - see
    // PDF_SCAN_START_PAGE) hit FIRST_PAGE_WARNING_KEYWORD.
    convertedDir: path.join(PDF_CONVERTED_ROOT_DIR, quarter),
    // Written by basic-extract.ts: which PDF pages actually produced a
    // matched value for each symbol (pages/<symbol>.json) and the rendered
    // screenshots of those pages (screenshots/<symbol>-p<N>.png).
    pagesDir: path.join(verifyDir, "pages"),
    screenshotsDir: path.join(verifyDir, "screenshots"),
    outputPath: path.join(verifyDir, "verify.html"),
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

// Mirrors the chosenLabels of basic-extract.ts's `revenue` section (all of
// them) plus `equity`'s "ana ortaklığa ait özkaynaklar" and "toplam
// kaynaklar" - kept as a literal list here (rather than imported) because
// basic-extract.ts runs its pipeline as a side effect of being loaded.
const CRITICAL_LABELS = [
  "hasılat",
  "esas faaliyet karı",
  "ana ortaklık payları",
  "ana ortaklığa ait özkaynaklar",
  "toplam kaynaklar",
];

// Mirrors basic-extract.ts's FIRST_PAGE_WARNING_KEYWORD (same reasoning as
// CRITICAL_LABELS above for why it's a literal here, not an import).
const FIRST_PAGE_WARNING_KEYWORD = "faaliyet";

/** Critical labels that are missing or "0" for this symbol's CSV - never expected for a real stock. */
function findMissingCriticalLabels(rows: string[][]): string[] {
  const [, ...dataRows] = rows;
  const valueByLabel = new Map(
    dataRows.map(([label, value]) => [label, value]),
  );
  return CRITICAL_LABELS.filter((label) => {
    const value = valueByLabel.get(label);
    return !value || value === "0";
  });
}

// Mirrors basic-extract.ts's FIRST_PAGE_WARNING_RE (same reasoning as
// CRITICAL_LABELS above for why it's a literal here, not an import).
const FIRST_PAGE_WARNING_RE = /^#first-page-warning:(.+)#$/;

/** The keyword pdf_to_md.py flagged on this symbol's PDF page 1, or null if it was clean (or hasn't been converted yet). */
function getFirstPageWarning(
  convertedDir: string,
  symbol: string,
): string | null {
  const mdPath = path.join(convertedDir, `${symbol}.txt`);
  if (!fs.existsSync(mdPath)) return null;
  // The marker is always exactly line 1 - see convertPdfToMd's doc comment
  // in basic-extract.ts.
  const firstLine = fs.readFileSync(mdPath, "utf-8").split("\n", 1)[0];
  return firstLine.match(FIRST_PAGE_WARNING_RE)?.[1] ?? null;
}

function symbolFromFilename(filename: string): string {
  return filename.replace(/\.csv$/i, "").toLowerCase();
}

/** http:// link to a symbol's PDF via serve-pdfs.ts, or null if the PDF isn't present. */
function getPdfUri(quarterPaths: QuarterPaths, symbol: string): string | null {
  const { quarter, pdfDir } = quarterPaths;
  const pdfFilename = `${symbol}.pdf`;
  if (!fs.existsSync(path.join(pdfDir, pdfFilename))) return null;
  return `http://localhost:${PDF_SERVER_PORT}/${encodeURIComponent(quarter)}/${encodeURIComponent(pdfFilename)}`;
}

function parseCsv(filePath: string): string[][] {
  return fs
    .readFileSync(filePath, "utf-8")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(","));
}

/**
 * Abbreviates a raw digit string (e.g. "35188818284" -> "35.2B") so it can
 * be eyeballed against the PDF at a glance. Preserves the Turkish
 * accounting "(value)" negative notation.
 */
function formatAbbreviated(rawValue: string): string {
  const isNegativeParen = /^\(.*\)$/.test(rawValue.trim());
  const num = Number(rawValue.replace(/[()]/g, ""));
  if (!Number.isFinite(num)) return rawValue;

  const abs = Math.abs(num);
  let formatted: string;
  if (abs >= 1e12) formatted = `${(num / 1e12).toFixed(1)}T`;
  else if (abs >= 1e9) formatted = `${(num / 1e9).toFixed(1)}B`;
  else if (abs >= 1e6) formatted = `${(num / 1e6).toFixed(1)}M`;
  else if (abs >= 1e3) formatted = `${(num / 1e3).toFixed(1)}K`;
  else formatted = String(num);

  return isNegativeParen ? `(${formatted})` : formatted;
}

/** Which PDF page(s) back each label's resolved value, per the manifest basic-extract.ts writes - {} if there's no manifest yet (not processed) or it's empty. */
function loadLabelPages(
  pagesDir: string,
  symbol: string,
): Record<string, number[]> {
  const manifestPath = path.join(pagesDir, `${symbol}.json`);
  if (!fs.existsSync(manifestPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Puts each page's screenshot directly beside just the handful of values
 * it backs, instead of one long table of all ~13 keys sitting above every
 * screenshot - with that many keys, by the time you scroll to a page you've
 * lost track of which rows it was even supposed to confirm.
 */
function buildSymbolSection(
  quarterPaths: QuarterPaths,
  symbol: string,
  rows: string[][],
): string {
  const { pagesDir, screenshotsDir } = quarterPaths;
  // Requires scripts/v2/serve-pdfs.ts running - see its header comment for
  // why a plain http:// link is used instead of file://.
  const pdfUri = getPdfUri(quarterPaths, symbol);
  const pdfLink = pdfUri
    ? `<a href="${pdfUri}">📄 Open PDF</a>`
    : `<em>PDF not found: ${escapeHtml(`${symbol}.pdf`)}</em>`;

  const [, ...dataRows] = rows;
  const abbreviatedByLabel = new Map(
    dataRows.map(([label, value]) => [label, formatAbbreviated(value)]),
  );

  const labelPages = loadLabelPages(pagesDir, symbol);
  const labelsByPage = new Map<number, string[]>();
  for (const [label] of dataRows) {
    const pages = labelPages[label];
    if (!pages || pages.length === 0) continue;
    // A label can (rarely) span more than one page - list it under each.
    for (const page of pages) {
      if (!labelsByPage.has(page)) labelsByPage.set(page, []);
      labelsByPage.get(page)!.push(label);
    }
  }

  const miniTable = (labels: string[]) =>
    [
      "<table>",
      ...labels.map(
        (label) =>
          `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(abbreviatedByLabel.get(label)!)}</td></tr>`,
      ),
      "</table>",
    ].join("\n");

  const sortedPages = Array.from(labelsByPage.keys()).sort((a, b) => a - b);
  const pageBlocks = sortedPages.flatMap((pageNumber) => {
    const filename = `${symbol}-p${pageNumber}.png`;
    if (!fs.existsSync(path.join(screenshotsDir, filename))) return [];

    return [
      `<h3>Page ${pageNumber}</h3>`,
      "<table><tr>",
      `<td valign="middle">${miniTable(labelsByPage.get(pageNumber)!)}</td>`,
      `<td valign="top"><img src="screenshots/${filename}" alt="page ${pageNumber}" style="max-width:1050px;width:100%;"></td>`,
      "</tr></table>",
    ];
  });

  return [
    `<section>`,
    `<h2>${escapeHtml(symbol)}</h2>`,
    `<p>${pdfLink}</p>`,
    ...pageBlocks,
    `</section>`,
  ].join("\n");
}

function generateForQuarter(quarter: string) {
  const quarterPaths = getQuarterPaths(quarter);
  const { resultsDir, verifyDir, outputPath } = quarterPaths;

  if (!fs.existsSync(resultsDir)) {
    console.log(`Skipping ${quarter}: no results at ${resultsDir}`);
    return;
  }

  const files = fs
    .readdirSync(resultsDir)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .sort();

  fs.mkdirSync(verifyDir, { recursive: true });

  const sections = files.map((file) => {
    const symbol = symbolFromFilename(file);
    const rows = parseCsv(path.join(resultsDir, file));
    return buildSymbolSection(quarterPaths, symbol, rows);
  });

  const symbolLabel = (symbol: string) => {
    const pdfUri = getPdfUri(quarterPaths, symbol);
    return pdfUri
      ? `<a href="${pdfUri}"><strong>${escapeHtml(symbol)}</strong></a>`
      : `<strong>${escapeHtml(symbol)}</strong>`;
  };

  // First, since a wrong-document PDF makes every other value below
  // meaningless - no point cross-checking numbers pulled from the wrong
  // report entirely.
  const firstPageWarningItems = files.flatMap((file) => {
    const symbol = symbolFromFilename(file);
    const keyword = getFirstPageWarning(quarterPaths.convertedDir, symbol);
    if (!keyword) return [];
    return [
      `<li>${symbolLabel(symbol)}: page 1 contains "${escapeHtml(keyword)}"</li>`,
    ];
  });

  const firstPageWarningsBlock =
    firstPageWarningItems.length > 0
      ? [
          '<div style="border:2px solid #c00; background:#fee; padding:1rem; margin-bottom:2rem;">',
          "<h2>⚠ Possible wrong document</h2>",
          `<p>This PDF's page 1 mentions "${escapeHtml(FIRST_PAGE_WARNING_KEYWORD)}" - it may be a faaliyet raporu (activity report) instead of financial statements, making every value pulled from it suspect:</p>`,
          "<ul>",
          ...firstPageWarningItems,
          "</ul>",
          "</div>",
        ].join("\n")
      : "";

  const warningItems = files.flatMap((file) => {
    const symbol = symbolFromFilename(file);
    const rows = parseCsv(path.join(resultsDir, file));
    const missing = findMissingCriticalLabels(rows);
    if (missing.length === 0) return [];
    return [
      `<li>${symbolLabel(symbol)}: ${missing.map(escapeHtml).join(", ")}</li>`,
    ];
  });

  const warningsBlock =
    warningItems.length > 0
      ? [
          '<div style="border:2px solid #c00; background:#fee; padding:1rem; margin-bottom:2rem;">',
          "<h2>⚠ Missing critical values</h2>",
          "<p>Revenue section values (hasılat / esas faaliyet karı / ana ortaklık payları), özkaynaklar, and toplam kaynaklar should never be empty for a stock:</p>",
          "<ul>",
          ...warningItems,
          "</ul>",
          "</div>",
        ].join("\n")
      : "";

  const content = [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>Pipeline Verification - ${quarter}</title>`,
    "<style>",
    "body { font-family: sans-serif; max-width: 1400px; margin: 0 auto; padding: 1rem; }",
    "table { border-collapse: collapse; }",
    "td { border: 1px solid #ccc; padding: 4px 8px; }",
    "section { margin-bottom: 2rem; }",
    "hr { margin: 2rem 0; }",
    "</style>",
    "</head>",
    "<body>",
    `<h1>Pipeline Verification - ${quarter}</h1>`,
    "<p>For each symbol, each page's screenshot sits next to just the values (abbreviated as K/M/B/T) it backs - open the PDF link only if a screenshot doesn't answer it.</p>",
    firstPageWarningsBlock,
    warningsBlock,
    sections.join("\n<hr>\n"),
    "</body>",
    "</html>",
    "",
  ].join("\n");

  fs.writeFileSync(outputPath, content);
  console.log(
    `✅ ${quarter}: wrote ${files.length} symbol section(s) to ${outputPath}`,
  );
}

function main() {
  const quarters = discoverQuarters();
  if (quarters.length === 0) {
    console.log(`No quarter folders found under '${PDFS_ROOT_DIR}'.`);
    return;
  }

  for (const quarter of quarters) {
    generateForQuarter(quarter);
  }
}

main();
