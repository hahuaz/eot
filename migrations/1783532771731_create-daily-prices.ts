import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable(
    "daily_prices",
    {
      symbol: { type: "text", notNull: true },
      date: { type: "bigint", notNull: true }, // unix timestamp (ms), start-of-day
      value: { type: "double precision", notNull: true },
    },
    {
      constraints: {
        primaryKey: ["symbol", "date"],
      },
    },
  );

  pgm.createIndex("daily_prices", ["symbol", { name: "date", sort: "DESC" }], {
    name: "idx_daily_prices_symbol_date",
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("daily_prices");
}
