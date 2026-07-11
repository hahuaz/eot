import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable(
    "yoy_financial_reports",
    {
      symbol: { type: "text", notNull: true },
      // Format: '<year>Q<1-4>', e.g. '2025Q1'. Sorts correctly as plain text.
      quarter: { type: "text", notNull: true },
      cash_and_equivalents: { type: "double precision" },
      short_term_liabilities: { type: "double precision" },
      long_term_liabilities: { type: "double precision" },
      equity: { type: "double precision" },
      total_assets: { type: "double precision" },
      revenue: { type: "double precision" },
      operating_income: { type: "double precision" },
      net_income: { type: "double precision" },
    },
    {
      constraints: {
        primaryKey: ["symbol", "quarter"],
      },
    },
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("yoy_financial_reports");
}
