// Usage (from repo root):
//   npx tsx src/extract-pdf/scripts/push-financial-reports-db.ts             # push all symbols
//   npx tsx src/extract-pdf/scripts/push-financial-reports-db.ts zrgyo ahgaz  # push only these
//
// Pushes every quarter under assets/results/ into the qoq_financial_reports
// Postgres table (one row per region+symbol+quarter) - the DB counterpart of
// push-detailed-results.ts's Google Sheets push, sharing the same CSV
// reading and quarter-only revenue derivation (see results-reader.ts).
// Symbols come from stock_info (getSymbols) - stock_info is the source
// of truth for which symbols exist, so one with a stray results CSV but no
// stock_info row is skipped rather than pushed.
//
// qoq_financial_reports keeps every "Kalem" row extract-financial-values.ts
// extracts as its own column - see LABEL_TO_COLUMN below and src/db/schema.ts
// for the exact schema (the table was originally named
// yoy_financial_reports, renamed to qoq_financial_reports since it holds
// quarterly, not year-over-year, data).

import "@/config";

import path from "path";

import { pool } from "@/db/pool";
import { getSymbols } from "@/db/stock-info.repository";
import {
  upsertQoqFinancialReport,
  QoqFinancialReportFields,
} from "@/db/qoq-financial-reports.repository";
import {
  RESULTS_ROOT_DIR,
  discoverQuarters,
  quarterResultsDir,
  readCsvValues,
  applyQuarterOnlyRevenue,
  applyScaleOverride,
  detectScaleBreak,
  parseTurkishNumber,
} from "./results-reader";

const REGION = "tr";

// Every "Kalem" label extract-financial-values.ts writes (see its
// `sections`), mapped onto qoq_financial_reports's columns - kept as a
// literal list here (rather than imported) for the same reason
// results-reader.ts can't import extract-financial-values.ts: it runs its
// whole extraction pipeline as a side effect of being loaded.
const LABEL_TO_COLUMN: Record<string, keyof QoqFinancialReportFields> = {
  "nakit ve nakit benzerleri": "cashAndEquivalents",
  "finansal yatırımlar": "financialInvestments",
  "duran finansal yatırımlar": "noncurrentFinancialInvestments",
  "kısa vadeli borçlanmalar": "shortTermBorrowings",
  "uzun vadeli borçlanmaların kısa vadeli kısımları":
    "currentPortionOfLongTermBorrowings",
  "kısa dönem kira yükümlülükleri": "shortTermLeaseLiabilities",
  "uzun vadeli borçlanmalar": "longTermBorrowings",
  "uzun dönem kira yükümlülükleri": "longTermLeaseLiabilities",
  "ana ortaklığa ait özkaynaklar": "equity",
  "toplam kaynaklar": "totalAssets",
  hasılat: "revenue",
  "esas faaliyet karı": "operatingIncome",
  "ana ortaklık payları": "netIncome",
};

/**
 * Upserts one (region, symbol, quarter) row. Only labels present in
 * `values` are written; a column with no matching label is left untouched
 * on conflict - see upsertQoqFinancialReport's doc comment.
 */
async function upsertRow(
  symbol: string,
  quarter: string,
  values: Record<string, string>,
): Promise<void> {
  const data: QoqFinancialReportFields = {};
  for (const [label, column] of Object.entries(LABEL_TO_COLUMN)) {
    const raw = values[label];
    if (raw !== undefined) data[column] = parseTurkishNumber(raw);
  }
  await upsertQoqFinancialReport(REGION, symbol, quarter, data);
}

async function main() {
  const quarters = discoverQuarters();
  if (quarters.length === 0) {
    console.log(`No quarters with results found under '${RESULTS_ROOT_DIR}'.`);
    return;
  }

  const only = process.argv.slice(2).map((s) => s.toLowerCase());
  const allSymbols = await getSymbols(REGION);
  const symbols = allSymbols.filter(
    (symbol) => only.length === 0 || only.includes(symbol),
  );

  console.log(
    `Found ${symbols.length} symbol(s) (from stock_info) across ${quarters.length} quarter(s) [${quarters.join(", ")}] to push.\n`,
  );

  const scaleBreakWarnings: string[] = [];

  for (const symbol of symbols) {
    let pushedCount = 0;
    for (const quarter of quarters) {
      const values = readCsvValues(
        path.join(quarterResultsDir(quarter), `${symbol}.csv`),
      );
      if (!values) continue;

      const scaled = applyScaleOverride(quarter, symbol, values);
      const scaleBreak = detectScaleBreak(symbol, quarter, scaled);
      if (scaleBreak) scaleBreakWarnings.push(scaleBreak);
      const adjusted = applyQuarterOnlyRevenue(quarter, symbol, scaled);
      try {
        await upsertRow(symbol, quarter, adjusted);
        pushedCount++;
      } catch (error: any) {
        console.error(`❌ ${symbol} ${quarter}: failed -`, error.message);
      }
    }
    console.log(`✅ ${symbol}: upserted ${pushedCount} quarter(s)`);
  }

  if (scaleBreakWarnings.length > 0) {
    console.log("\n⚠ Possible scale breaks:");
    for (const warning of scaleBreakWarnings) console.log(`  ${warning}`);
  }

  console.log("\nDone.");
  await pool.end();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
