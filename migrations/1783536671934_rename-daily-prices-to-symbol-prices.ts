import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.renameTable("daily_prices", "symbol_prices");
  pgm.sql(
    `ALTER INDEX "idx_daily_prices_symbol_date" RENAME TO "idx_symbol_prices_symbol_date"`,
  );
  pgm.sql(
    `ALTER TABLE "symbol_prices" RENAME CONSTRAINT "daily_prices_pkey" TO "symbol_prices_pkey"`,
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(
    `ALTER TABLE "symbol_prices" RENAME CONSTRAINT "symbol_prices_pkey" TO "daily_prices_pkey"`,
  );
  pgm.sql(
    `ALTER INDEX "idx_symbol_prices_symbol_date" RENAME TO "idx_daily_prices_symbol_date"`,
  );
  pgm.renameTable("symbol_prices", "daily_prices");
}
