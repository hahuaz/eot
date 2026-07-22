import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

import { APP_CONFIG } from "@/config";
import * as schema from "@/db/schema";

export const pool = new Pool({
  connectionString: APP_CONFIG.DATABASE_URL,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client:", err);
});

export const db = drizzle(pool, { schema });
