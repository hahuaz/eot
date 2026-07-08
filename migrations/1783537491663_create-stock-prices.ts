import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable(
    "stock_prices",
    {
      region: { type: "text", notNull: true },
      symbol: { type: "text", notNull: true },
      price: { type: "double precision", notNull: true },
      color: { type: "text" },
      notes: { type: "text[]" },
    },
    {
      constraints: {
        primaryKey: ["region", "symbol"],
      },
    },
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("stock_prices");
}
