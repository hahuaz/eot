import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // #config row fields (outstandingShares, trimDigit, selectedGrowthMetrics),
  // so stock_info can fully replace the CSV's config for valuation calcs.
  pgm.addColumn("stock_info", {
    outstanding_shares: { type: "double precision" },
    trim_digit: { type: "double precision" },
    growth_selection: { type: "text[]" },
  });

  // yoy_financial_reports only ever had TR data; now that US fundamentals
  // are being imported too, it needs the same region dimension as
  // stock_info/quarterly_stock_prices to avoid symbol collisions.
  pgm.addColumn("yoy_financial_reports", {
    region: { type: "text" },
  });
  pgm.sql(`UPDATE yoy_financial_reports SET region = 'tr'`);
  pgm.alterColumn("yoy_financial_reports", "region", { notNull: true });
  pgm.dropConstraint("yoy_financial_reports", "yoy_financial_reports_pkey");
  pgm.addConstraint("yoy_financial_reports", "yoy_financial_reports_pkey", {
    primaryKey: ["region", "symbol", "quarter"],
  });

  // Dividend is sourced from CSV (not Yahoo), independent of price - make
  // price nullable too so a quarter can have either value on its own.
  pgm.addColumn("quarterly_stock_prices", {
    dividend: { type: "double precision" },
  });
  pgm.alterColumn("quarterly_stock_prices", "price", { notNull: false });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.alterColumn("quarterly_stock_prices", "price", { notNull: true });
  pgm.dropColumn("quarterly_stock_prices", "dividend");

  pgm.dropConstraint("yoy_financial_reports", "yoy_financial_reports_pkey");
  pgm.addConstraint("yoy_financial_reports", "yoy_financial_reports_pkey", {
    primaryKey: ["symbol", "quarter"],
  });
  pgm.dropColumn("yoy_financial_reports", "region");

  pgm.dropColumn("stock_info", [
    "outstanding_shares",
    "trim_digit",
    "growth_selection",
  ]);
}
