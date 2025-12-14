import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables based on NODE_ENV
dotenv.config({
  path: `.env.${process.env.NODE_ENV || "development"}`,
});

interface AppConfig {
  NODE_ENV: string;
  GOOGLE_SHEET_ID: string;
  GOOGLE_CREDENTIAL_PATH: string;
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
  GOOGLE_SHEET_ID: getEnv("GOOGLE_SHEET_ID"),
  GOOGLE_CREDENTIAL_PATH: path.join(
    process.cwd(),
    "credentials",
    "google.json",
  ),
};

// Log config only in development mode for debugging
if (APP_CONFIG.NODE_ENV === "development") {
  console.log("APP_CONFIG:", APP_CONFIG);
}
