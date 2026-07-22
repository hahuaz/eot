// Usage (from repo root):
//   npx tsx src/extract-pdf/scripts/update-sheet/push-detailed-results.ts             # push all symbols
//   npx tsx src/extract-pdf/scripts/update-sheet/push-detailed-results.ts zrgyo ahgaz  # push only these
//
// Pushes every quarter under assets/results/ into its own tab (named
// after the stock symbol) of the target spreadsheet below - column A is
// "Kalem", then one column per quarter in chronological order (2025Q1,
// 2025Q2, ...). Symbols come from stock_info (getSymbols), not a
// directory scan - a symbol with no results CSV in any quarter yet is
// skipped rather than pushed as an empty tab. Every run rebuilds the whole
// block from the local results/ folders and rewrites it in one shot, so a
// correction to an already-pushed quarter's extraction is picked up on the
// next push too, and a new quarter's PDFs need no code change here to
// start showing up.
//
// Once every symbol's tab is up to date, also rewrites the "stock-symbols"
// tab: every TR symbol tracked in stock_info (regardless of any CLI filter
// above - it's a full index, not scoped to this run), one per row, each a
// HYPERLINK("#gid=...") into its own tab. This runs last so tabs created
// above by ensureSheetExists already exist and get a real link instead of
// falling back to plain text.

import "@/config";

import path from "path";
import { google } from "googleapis";

import { pool } from "@/db/pool";
import { getSymbols } from "@/db/stock-info.repository";
import {
  ROOT_DIR,
  RESULTS_ROOT_DIR,
  discoverQuarters,
  quarterResultsDir,
  readCsvValues,
  applyQuarterOnlyRevenue,
  applyScaleOverride,
  detectScaleBreak,
} from "../results-reader";

const SERVICE_ACCOUNT_FILE = path.join(
  ROOT_DIR,
  "..",
  "..",
  "credentials",
  "tr-stocks.json",
);
const SPREADSHEET_ID = process.env.V2_SPREADSHEET_ID;
if (!SPREADSHEET_ID) {
  throw new Error("Missing required environment variable: V2_SPREADSHEET_ID");
}
const STOCK_SYMBOLS_SHEET_NAME = "stock-symbols";
const DELAY_BETWEEN_REQUESTS = 1000; // ms, to stay under Sheets API rate limits
const MAX_RETRIES = 5;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries with exponential backoff on Google API rate-limit (429/quota) errors. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isRateLimit =
        error?.code === 429 || /quota exceeded/i.test(error?.message ?? "");
      if (!isRateLimit || attempt >= MAX_RETRIES) throw error;

      const backoffMs = 2000 * 2 ** attempt;
      console.warn(`  ⏳ Rate limited, retrying in ${backoffMs / 1000}s...`);
      await delay(backoffMs);
    }
  }
}

/**
 * Builds one symbol's full multi-quarter block: header row ["Kalem",
 * ...quarters], then one row per Kalem label with that label's value in
 * each quarter's column (blank if the symbol wasn't processed that
 * quarter). Label order follows the first quarter that has data for this
 * symbol - every quarter uses the same fixed set of labels (see
 * basic-extract.ts's `sections`), so this is consistent across quarters.
 */
function buildSymbolRows(
  symbol: string,
  quarters: string[],
  scaleBreakWarnings: string[],
): string[][] {
  const perQuarterValues = quarters.map((quarter) => {
    const values = readCsvValues(
      path.join(quarterResultsDir(quarter), `${symbol}.csv`),
    );
    if (!values) return null;

    const scaled = applyScaleOverride(quarter, symbol, values);
    const scaleBreak = detectScaleBreak(symbol, quarter, scaled);
    if (scaleBreak) scaleBreakWarnings.push(scaleBreak);
    return applyQuarterOnlyRevenue(quarter, symbol, scaled);
  });

  const labelOrder: string[] = [];
  for (const values of perQuarterValues) {
    if (!values) continue;
    for (const label of Object.keys(values)) {
      if (!labelOrder.includes(label)) labelOrder.push(label);
    }
  }

  const header = ["Kalem", ...quarters];
  const dataRows = labelOrder.map((label) => [
    label,
    ...perQuarterValues.map((values) => values?.[label] ?? ""),
  ]);
  return [header, ...dataRows];
}

async function ensureSheetExists(
  sheetsApi: ReturnType<typeof google.sheets>,
  sheetIdByTitle: Map<string, number>,
  title: string,
): Promise<number> {
  const existingId = sheetIdByTitle.get(title.toLowerCase());
  if (existingId !== undefined) return existingId;

  const response = await withRetry(() =>
    sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }],
      },
    }),
  );
  const sheetId = response.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (sheetId == null) {
    throw new Error(`addSheet for "${title}" didn't return a sheetId`);
  }
  sheetIdByTitle.set(title.toLowerCase(), sheetId);
  return sheetId;
}

/**
 * Forces every value cell (everything but the "Kalem" label column) to a
 * plain, non-thousands-separated integer format. values.update only ever
 * writes cell *values*, never formatting - so with valueInputOption
 * USER_ENTERED, Sheets is free to render a cell using whatever number
 * format it already carries (e.g. a thousands-separator format applied by
 * Sheets' own auto-detection on some earlier write), which is how the
 * sheet ended up with some quarters showing "1.234.567" and others
 * "1234567" for the same symbol. Reapplying this on every push keeps every
 * cell's format deterministic regardless of its history.
 */
async function applyPlainNumberFormat(
  sheetsApi: ReturnType<typeof google.sheets>,
  sheetId: number,
  rowCount: number,
  columnCount: number,
): Promise<void> {
  await withRetry(() =>
    sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 1, // skip the header row
                endRowIndex: rowCount,
                startColumnIndex: 1, // skip the "Kalem" label column
                endColumnIndex: columnCount,
              },
              cell: {
                userEnteredFormat: {
                  numberFormat: { type: "NUMBER", pattern: "0" },
                },
              },
              fields: "userEnteredFormat.numberFormat",
            },
          },
        ],
      },
    }),
  );
}

async function pushSymbol(
  sheetsApi: ReturnType<typeof google.sheets>,
  sheetIdByTitle: Map<string, number>,
  symbol: string,
  rows: string[][],
): Promise<void> {
  const sheetId = await ensureSheetExists(sheetsApi, sheetIdByTitle, symbol);

  // The row/column count is always fixed per run (same Kalem labels, same
  // discovered quarters), so a plain update - no separate clear - can't
  // leave stale cells behind.
  await withRetry(() =>
    sheetsApi.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${symbol}'!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    }),
  );

  await applyPlainNumberFormat(sheetsApi, sheetId, rows.length, rows[0].length);

  console.log(
    `✅ ${symbol}: pushed ${rows.length - 1} row(s) x ${rows[0].length - 1} quarter(s)`,
  );
}

/**
 * Rewrites the "stock-symbols" tab: every symbol in `allSymbols`, one per
 * row, linked to its own tab via HYPERLINK("#gid=...") when that tab
 * exists in `sheetIdByTitle` - otherwise written as plain text.
 */
async function pushStockSymbolsTab(
  sheetsApi: ReturnType<typeof google.sheets>,
  sheetIdByTitle: Map<string, number>,
  allSymbols: string[],
): Promise<void> {
  const rows = [
    ["stockSymbol"],
    ...allSymbols.map((symbol) => {
      const gid = sheetIdByTitle.get(symbol);
      if (gid == null) {
        console.warn(`  ⚠ no tab found for "${symbol}", writing as plain text`);
        return [symbol];
      }
      return [`=HYPERLINK("#gid=${gid}", "${symbol}")`];
    }),
  ];

  await withRetry(() =>
    sheetsApi.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${STOCK_SYMBOLS_SHEET_NAME}'!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    }),
  );

  console.log(
    `✅ Wrote ${allSymbols.length} symbol(s) to "${STOCK_SYMBOLS_SHEET_NAME}"`,
  );
}

async function main() {
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_FILE,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheetsApi = google.sheets({ version: "v4", auth });

  const spreadsheet = await sheetsApi.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });
  const sheetIdByTitle = new Map(
    (spreadsheet.data.sheets || [])
      .map((s) => [s.properties?.title?.toLowerCase(), s.properties?.sheetId])
      .filter(
        (entry): entry is [string, number] => !!entry[0] && entry[1] != null,
      ),
  );

  const quarters = discoverQuarters();
  if (quarters.length === 0) {
    console.log(`No quarters with results found under '${RESULTS_ROOT_DIR}'.`);
    return;
  }

  const only = process.argv.slice(2).map((s) => s.toLowerCase());
  const allSymbols = await getSymbols("tr");
  await pool.end();
  const symbols = allSymbols.filter(
    (symbol) => only.length === 0 || only.includes(symbol),
  );

  console.log(
    `Found ${symbols.length} symbol(s) (from stock_info) across ${quarters.length} quarter(s) [${quarters.join(", ")}] to push.\n`,
  );

  const scaleBreakWarnings: string[] = [];

  for (const symbol of symbols) {
    const rows = buildSymbolRows(symbol, quarters, scaleBreakWarnings);
    // No results CSV in any quarter for this symbol yet (e.g. never run
    // through the PDF pipeline) - skip rather than push a bare header row
    // into a new, otherwise-empty tab.
    if (rows.length === 1) {
      console.log(`⏭ ${symbol}: no results in any quarter, skipping`);
      continue;
    }

    try {
      await pushSymbol(sheetsApi, sheetIdByTitle, symbol, rows);
    } catch (error: any) {
      console.error(`❌ ${symbol}: failed -`, error.message);
    }

    await delay(DELAY_BETWEEN_REQUESTS);
  }

  if (scaleBreakWarnings.length > 0) {
    console.log("\n⚠ Possible scale breaks:");
    for (const warning of scaleBreakWarnings) console.log(`  ${warning}`);
  }

  // sheetIdByTitle now includes any tabs ensureSheetExists created above, so
  // symbols pushed for the first time this run still get a real hyperlink
  // instead of falling back to plain text.
  await pushStockSymbolsTab(sheetsApi, sheetIdByTitle, allSymbols);

  console.log("\nDone.");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
