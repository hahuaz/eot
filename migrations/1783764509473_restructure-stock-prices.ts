import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

// The sentinel quarter value that stands in for "current" (live/latest)
// price, so one table can hold both historical quarter closes and the
// current price without a separate always-empty-except-one-row column.
const CURRENT_QUARTER = "CURRENT";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable(
    "quarterly_stock_prices",
    {
      region: { type: "text", notNull: true },
      symbol: { type: "text", notNull: true },
      // '<year>Q<1-4>' (e.g. '2025Q1') for historical quarters, or the
      // CURRENT_QUARTER sentinel for the live price.
      quarter: { type: "text", notNull: true },
      price: { type: "double precision", notNull: true },
    },
    {
      constraints: {
        primaryKey: ["region", "symbol", "quarter"],
      },
    },
  );

  // Carry over each stock's existing current price before the column
  // disappears from stock_prices.
  pgm.sql(`
    INSERT INTO quarterly_stock_prices (region, symbol, quarter, price)
    SELECT region, symbol, '${CURRENT_QUARTER}', price FROM stock_prices
  `);

  pgm.renameTable("stock_prices", "stock_info");
  pgm.dropColumn("stock_info", "price");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn("stock_info", {
    price: { type: "double precision" },
  });

  pgm.sql(`
    UPDATE stock_info
    SET price = quarterly_stock_prices.price
    FROM quarterly_stock_prices
    WHERE quarterly_stock_prices.region = stock_info.region
      AND quarterly_stock_prices.symbol = stock_info.symbol
      AND quarterly_stock_prices.quarter = '${CURRENT_QUARTER}'
  `);

  pgm.alterColumn("stock_info", "price", { notNull: true });
  pgm.renameTable("stock_info", "stock_prices");
  pgm.dropTable("quarterly_stock_prices");
}
