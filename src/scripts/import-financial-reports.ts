/**
 * Reads TR and US stock CSV files from local-data/stocks/{region} and
 * upserts:
 *   - balance-sheet / income-statement metrics into yoy_financial_reports
 *   - the #config row (outstandingShares, trimDigit, selectedGrowthMetrics)
 *     into stock_info
 *   - the Dividend row into quarterly_stock_prices
 *
 * Price is intentionally NOT imported here - it's sourced from Yahoo via
 * import-quarterly-prices.ts, which is more authoritative than the
 * manually-maintained CSV Price row.
 *
 * CSV values are stored pre-divided by each stock's trimDigit (from the
 * #config row) - e.g. arclk's trimDigit=1000 means its CSV figures are in
 * thousands. This script multiplies back by trimDigit so every symbol ends
 * up in the same absolute units in the DB.
 *
 * Usage:
 *   tsx src/scripts/import-financial-reports.ts                       # imports all stocks, both regions
 *   tsx src/scripts/import-financial-reports.ts tr:garan us:aapl      # imports only these
 */
import "@/config";

import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import { pool } from "@/db/pool";
import { upsertStockConfig } from "@/db/stock-info.repository";
import { upsertQuarterlyDividend } from "@/db/quarterly-stock-prices.repository";
import {
  upsertFinancialReport,
  METRIC_FIELD_MAP,
  type FinancialReportRow,
} from "@/db/yoy-financial-reports.repository";
import { toQuarterLabel } from "@/lib/dates";

const REGIONS = ["tr", "us"];
const STOCKS_ROOT = join(__dirname, "..", "..", "local-data", "stocks");

type ParsedStockCsv = {
  reportsByQuarter: Map<string, FinancialReportRow>;
  dividendsByQuarter: Map<string, number>;
  outstandingShares: number;
  trimDigit: number;
  selectedGrowthMetrics: string[];
};

function parseStockCsv(region: string, symbol: string): ParsedStockCsv {
  const content = readFileSync(
    join(STOCKS_ROOT, region, `${symbol}.csv`),
    "utf-8",
  );
  const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
  const [headerLine, ...dataLines] = lines;

  const quarterColumns = headerLine.split(",").slice(1).map(toQuarterLabel);

  const configLine = dataLines.find((line) => line.startsWith("#config"));
  const configParts = configLine?.split(",") ?? [];
  const outstandingShares = Number(configParts[2]);
  const trimDigit = Number(configParts[3]) || 1;
  const selectedGrowthMetrics = (configParts[4] ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  const reportsByQuarter = new Map<string, FinancialReportRow>();
  const dividendsByQuarter = new Map<string, number>();

  for (const line of dataLines) {
    const columns = line.split(",");
    const metricName = columns[0].trim();
    const field = METRIC_FIELD_MAP[metricName];
    const isDividend = metricName === "Dividend";
    if (!field && !isDividend) continue;

    columns.slice(1).forEach((rawValue, i) => {
      const quarter = quarterColumns[i];
      const value = rawValue.trim();
      if (!quarter || !value) return;

      if (isDividend) {
        dividendsByQuarter.set(quarter, Number(value));
        return;
      }

      const report = reportsByQuarter.get(quarter) ?? {};
      report[field] = Number(value) * trimDigit;
      reportsByQuarter.set(quarter, report);
    });
  }

  return {
    reportsByQuarter,
    dividendsByQuarter,
    outstandingShares,
    trimDigit,
    selectedGrowthMetrics,
  };
}

async function importSymbol(region: string, symbol: string): Promise<number> {
  const parsed = parseStockCsv(region, symbol);

  await upsertStockConfig(region, symbol, {
    outstandingShares: parsed.outstandingShares,
    trimDigit: parsed.trimDigit,
    selectedGrowthMetrics: parsed.selectedGrowthMetrics,
  });

  for (const [quarter, report] of parsed.reportsByQuarter) {
    await upsertFinancialReport(region, symbol, quarter, report);
  }
  for (const [quarter, dividend] of parsed.dividendsByQuarter) {
    await upsertQuarterlyDividend(region, symbol, quarter, dividend);
  }

  return parsed.reportsByQuarter.size;
}

async function main() {
  const argPairs = process.argv.slice(2);

  const targets: { region: string; symbol: string }[] = [];
  if (argPairs.length > 0) {
    for (const arg of argPairs) {
      const [region, symbol] = arg.split(":");
      if (!region || !symbol) {
        throw new Error(
          `Invalid target "${arg}", expected "<region>:<symbol>"`,
        );
      }
      targets.push({ region, symbol });
    }
  } else {
    for (const region of REGIONS) {
      const symbols = readdirSync(join(STOCKS_ROOT, region))
        .filter((file) => file.endsWith(".csv") && file !== "test.csv")
        .map((file) => file.replace(/\.csv$/, ""));
      for (const symbol of symbols) {
        targets.push({ region, symbol });
      }
    }
  }

  console.log(
    `Importing financial reports for ${targets.length} (region, symbol) pair(s)...`,
  );

  for (const { region, symbol } of targets) {
    try {
      const count = await importSymbol(region, symbol);
      console.log(`${region}:${symbol} - upserted ${count} quarter(s)`);
    } catch (error) {
      console.error(`${region}:${symbol} - failed -`, error);
    }
  }

  console.log("Done.");
  await pool.end();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
