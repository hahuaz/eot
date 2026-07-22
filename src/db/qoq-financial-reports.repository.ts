import { eq, and, InferSelectModel } from "drizzle-orm";

import { db } from "@/db/pool";
import { qoqFinancialReports } from "@/db/schema";

export type QoqFinancialReportDbRow = InferSelectModel<
  typeof qoqFinancialReports
>;

/**
 * Fetches every quarter on record for a (region, symbol) from
 * qoq_financial_reports, one row per quarter.
 */
export async function getFinancialReportsBySymbol(
  region: string,
  symbol: string,
): Promise<QoqFinancialReportDbRow[]> {
  return db
    .select()
    .from(qoqFinancialReports)
    .where(
      and(
        eq(qoqFinancialReports.region, region),
        eq(qoqFinancialReports.symbol, symbol.toLowerCase()),
      ),
    );
}

export type QoqFinancialReportFields = Partial<{
  cashAndEquivalents: number;
  financialInvestments: number;
  noncurrentFinancialInvestments: number;
  shortTermBorrowings: number;
  currentPortionOfLongTermBorrowings: number;
  shortTermLeaseLiabilities: number;
  longTermBorrowings: number;
  longTermLeaseLiabilities: number;
  equity: number;
  totalAssets: number;
  revenue: number;
  operatingIncome: number;
  netIncome: number;
}>;

/**
 * Upserts a qoq_financial_reports record for a (region, symbol, quarter) - a
 * true partial patch, same pattern as upsertStockInfo: only the fields
 * actually passed in `data` are written, anything omitted is left exactly as
 * it is on conflict.
 */
export async function upsertQoqFinancialReport(
  region: string,
  symbol: string,
  quarter: string,
  data: QoqFinancialReportFields,
): Promise<void> {
  await db
    .insert(qoqFinancialReports)
    .values({ region, symbol: symbol.toLowerCase(), quarter, ...data })
    .onConflictDoUpdate({
      target: [
        qoqFinancialReports.region,
        qoqFinancialReports.symbol,
        qoqFinancialReports.quarter,
      ],
      set: data,
    });
}
