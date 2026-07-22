import * as dotenv from "dotenv";
import * as path from "path";

// Pin the process to UTC so local-timezone Date accessors (getFullYear,
// getMonth, setHours, ...) can't silently disagree with their getUTC*
// counterparts depending on what machine/container this runs on - every
// entry point (server + scripts) loads this file first, before any Date
// parsing happens.
process.env.TZ = "UTC";

// Load environment variables based on NODE_ENV
dotenv.config({
  path: `.env.${process.env.NODE_ENV || "development"}`,
});

interface AppConfig {
  NODE_ENV: string;
  APP_PORT: number;
  DATABASE_URL: string;
  SHEETS: {
    name: string;
    id: string;
    credentialPath: string;
  }[];
}

function getEnv(key: string, required: boolean = true): string {
  const value = process.env[key];
  if (required && !value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || "";
}

export const APP_CONFIG: AppConfig = {
  NODE_ENV: getEnv("NODE_ENV", false) || "development",
  APP_PORT: Number(getEnv("BACKEND_PORT", false)) || 3333,
  DATABASE_URL: getEnv("DATABASE_URL"),
  SHEETS: [
    {
      name: "invest",
      id: getEnv("INVEST_SHEET_ID"),
      credentialPath: path.join(process.cwd(), "credentials", "invest.json"),
    },
  ],
};

// Log config only in development mode for debugging
if (APP_CONFIG.NODE_ENV === "development") {
  console.log("APP_CONFIG:", APP_CONFIG);
}
