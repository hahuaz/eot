// execute config to load environment variables
import "@/config";

import fs from "fs";
import path from "path";

import { parseCSV, DAILY_DIR, pool } from "@/lib";
import type { DailyPrice } from "@/types";

async function migrateSymbolCsv(fileName: string): Promise<number> {
  const symbol = path.basename(fileName, ".csv").toUpperCase();
  const filePath = path.join(DAILY_DIR, fileName);

  const { data } = parseCSV<DailyPrice>({ filePath, header: true });
  if (data.length === 0) {
    console.log(`  ${symbol}: no rows, skipping`);
    return 0;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of data) {
      await client.query(
        `INSERT INTO daily_prices (symbol, date, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (symbol, date) DO UPDATE SET value = EXCLUDED.value`,
        [symbol, row.date, row.value],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  console.log(`  ${symbol}: migrated ${data.length} rows`);
  return data.length;
}

async function main() {
  const files = fs
    .readdirSync(DAILY_DIR)
    .filter((f) => f.toLowerCase().endsWith(".csv"));

  if (files.length === 0) {
    console.log(`No CSV files found in ${DAILY_DIR}`);
    return;
  }

  console.log(`Migrating ${files.length} CSV file(s) from ${DAILY_DIR}...`);

  let total = 0;
  for (const file of files) {
    total += await migrateSymbolCsv(file);
  }

  console.log(`Done. Migrated ${total} total rows.`);
  await pool.end();
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
