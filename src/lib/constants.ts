import path from "path";
import fs from "fs";

import { BaseMetricNames } from "@shared/types";

// metrics that are applicable for growth calculation
export const GROWTH_APPLIED_METRICS: BaseMetricNames[] = [
  "Equity",
  "Total assets",
  "Revenue",
  "Operating income",
  "Net income",
];

export const DATA_DIR = path.join(process.cwd(), "local-data");
export const DAILY_DIR = path.join(DATA_DIR, "daily");

export const TR_DYNAMIC_PATH = path.join(DATA_DIR, "stocks-dynamic", "tr.json");

if (!fs.existsSync(TR_DYNAMIC_PATH)) {
  throw new Error(`File not found: ${TR_DYNAMIC_PATH}`);
}

// observation start date for cummulative returns
export const BASELINE_DATE = "2024-12-30";
