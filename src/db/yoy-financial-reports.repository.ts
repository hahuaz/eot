import { pool } from "@/db/pool";

export type FinancialReportRow = {
  cashAndEquivalents?: number;
  shortTermLiabilities?: number;
  longTermLiabilities?: number;
  equity?: number;
  totalAssets?: number;
  revenue?: number;
  operatingIncome?: number;
  netIncome?: number;
};

// Shared between the CSV importer and the DB-backed stock service reader,
// so both agree on how CSV metric names map onto FinancialReportRow fields.
export const METRIC_FIELD_MAP: Record<string, keyof FinancialReportRow> = {
  "Cash & cash equivalents": "cashAndEquivalents",
  "Short term liabilities": "shortTermLiabilities",
  "Long term liabilities": "longTermLiabilities",
  Equity: "equity",
  "Total assets": "totalAssets",
  Revenue: "revenue",
  "Operating income": "operatingIncome",
  "Net income": "netIncome",
};

type FinancialReportDbRow = {
  cash_and_equivalents: number | null;
  short_term_liabilities: number | null;
  long_term_liabilities: number | null;
  equity: number | null;
  total_assets: number | null;
  revenue: number | null;
  operating_income: number | null;
  net_income: number | null;
};

function toFinancialReportRow(row: FinancialReportDbRow): FinancialReportRow {
  return {
    ...(row.cash_and_equivalents != null && {
      cashAndEquivalents: row.cash_and_equivalents,
    }),
    ...(row.short_term_liabilities != null && {
      shortTermLiabilities: row.short_term_liabilities,
    }),
    ...(row.long_term_liabilities != null && {
      longTermLiabilities: row.long_term_liabilities,
    }),
    ...(row.equity != null && { equity: row.equity }),
    ...(row.total_assets != null && { totalAssets: row.total_assets }),
    ...(row.revenue != null && { revenue: row.revenue }),
    ...(row.operating_income != null && {
      operatingIncome: row.operating_income,
    }),
    ...(row.net_income != null && { netIncome: row.net_income }),
  };
}

/**
 * Fetches every quarter on record for a (region, symbol), ordered oldest to
 * newest. Quarters are plain text in '<year>Q<1-4>' form (e.g. '2025Q1'),
 * which sorts correctly lexicographically.
 */
export async function getFinancialReportsBySymbol(
  region: string,
  symbol: string,
): Promise<Record<string, FinancialReportRow>> {
  const { rows } = await pool.query<FinancialReportDbRow & { quarter: string }>(
    `SELECT * FROM yoy_financial_reports WHERE region = $1 AND symbol = $2 ORDER BY quarter ASC`,
    [region, symbol.toLowerCase()],
  );

  return Object.fromEntries(
    rows.map((row) => [row.quarter, toFinancialReportRow(row)]),
  );
}

/**
 * Fetches a single (region, symbol, quarter) financial report row.
 */
export async function getFinancialReport(
  region: string,
  symbol: string,
  quarter: string,
): Promise<FinancialReportRow | undefined> {
  const { rows } = await pool.query<FinancialReportDbRow>(
    `SELECT * FROM yoy_financial_reports WHERE region = $1 AND symbol = $2 AND quarter = $3`,
    [region, symbol.toLowerCase(), quarter],
  );

  const row = rows[0];
  return row ? toFinancialReportRow(row) : undefined;
}

/**
 * Upserts a (region, symbol, quarter) financial report row. Only the fields
 * present in `data` are written; omitted fields are left as NULL on insert
 * or untouched on conflict.
 */
export async function upsertFinancialReport(
  region: string,
  symbol: string,
  quarter: string,
  data: FinancialReportRow,
): Promise<void> {
  await pool.query(
    `INSERT INTO yoy_financial_reports (
       region, symbol, quarter, cash_and_equivalents, short_term_liabilities,
       long_term_liabilities, equity, total_assets, revenue,
       operating_income, net_income
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (region, symbol, quarter) DO UPDATE SET
       cash_and_equivalents = COALESCE(EXCLUDED.cash_and_equivalents, yoy_financial_reports.cash_and_equivalents),
       short_term_liabilities = COALESCE(EXCLUDED.short_term_liabilities, yoy_financial_reports.short_term_liabilities),
       long_term_liabilities = COALESCE(EXCLUDED.long_term_liabilities, yoy_financial_reports.long_term_liabilities),
       equity = COALESCE(EXCLUDED.equity, yoy_financial_reports.equity),
       total_assets = COALESCE(EXCLUDED.total_assets, yoy_financial_reports.total_assets),
       revenue = COALESCE(EXCLUDED.revenue, yoy_financial_reports.revenue),
       operating_income = COALESCE(EXCLUDED.operating_income, yoy_financial_reports.operating_income),
       net_income = COALESCE(EXCLUDED.net_income, yoy_financial_reports.net_income)`,
    [
      region,
      symbol.toLowerCase(),
      quarter,
      data.cashAndEquivalents ?? null,
      data.shortTermLiabilities ?? null,
      data.longTermLiabilities ?? null,
      data.equity ?? null,
      data.totalAssets ?? null,
      data.revenue ?? null,
      data.operatingIncome ?? null,
      data.netIncome ?? null,
    ],
  );
}
