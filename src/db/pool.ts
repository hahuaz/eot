import { Pool } from "pg";

import { APP_CONFIG } from "@/config";

export const pool = new Pool({
  connectionString: APP_CONFIG.DATABASE_URL,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client:", err);
});
