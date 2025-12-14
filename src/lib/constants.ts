import { BaseMetricNames } from "@shared/types";
import path from "path";

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

export const BASELINE_DATE = "2024/12/30"; // buy date / start observation
