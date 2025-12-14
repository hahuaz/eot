import { describe, it, expect } from "vitest";
import path from "path";

import {
  getStockInfo,
  getStocksDynamic,
  populateStock,
  DATA_DIR,
} from "../src/lib";
import type { Inflation } from "../src/shared/types";
import { Region, regions } from "../src/types";

import { parseCSV } from "../src/lib";

function getMetric(metrics: any[], name: string) {
  const m = metrics.find((x) => x.metricName === name);
  if (!m) throw new Error(`Metric not found: ${name}`);
  return m;
}

const INFLATION = regions.reduce(
  (acc: any, region: Region) => {
    const inflationPath = path.join(DATA_DIR, "inflation", `${region}.csv`);
    const { data: inflationData } = parseCSV<Inflation>({
      filePath: inflationPath,
      header: true,
    });
    acc[region] = inflationData;
    return acc;
  },
  {} as Record<Region, Inflation[]>,
);

// TODO: test data belongs to q2 of 2025 and needs to be updated periodically
describe("populateStock (pure calc)", () => {
  it("computes derived metrics as expected", () => {
    // // Minimal, synthetic data you fully control
    // const inflationData: Inflation[] = [
    //   // whatever your function expects; keep it tiny
    //   // { date: '2020-01', cpi: 100 }, { date: '2021-01', cpi: 110 }, ...
    // ] as unknown as Inflation[];

    const stockDynamic = getStocksDynamic({
      region: "tr" as Region,
    })["test"];

    const region = "tr";
    const stockSymbol = "test";

    const inflation = INFLATION[region];

    const { baseMetrics, stockConfig } = getStockInfo({
      region,
      stockSymbol,
    });

    const result = populateStock({
      stockConfig,
      baseMetrics,
      stockDynamic,
      region,
      inflation,
    });
    console.log("result", result);

    // helpers
    const yieldMetric = getMetric(result.derivedMetrics, "Yield");
    const netDebtOIMetric = getMetric(
      result.derivedMetrics,
      "Net debt / operating income",
    );
    const enterpriseValueMetric = getMetric(
      result.derivedMetrics,
      "Enterprise value",
    );
    const evToOIMetric = getMetric(
      result.derivedMetrics,
      "EV / operating income",
    );
    const evNIMetric = getMetric(result.derivedMetrics, "EV / net income");
    const mvToBVMetric = getMetric(
      result.derivedMetrics,
      "Market value / book value",
    );
    const selectedGrowth = getMetric(result.derivedMetrics, "Selected growth");
    const equity = getMetric(result.baseMetrics, "Equity");

    expect(yieldMetric["Total growth"]).toBe(18.69119);
    expect(yieldMetric["Yearly growth"]).toBe(0.71918);
    expect(yieldMetric["TTM growth"]).toBe(17.30529);

    expect(netDebtOIMetric["current"]).toBe(-0.00781);
    expect(enterpriseValueMetric["current"]).toBe(199);

    expect(evToOIMetric["current"]).toBe(1.55469); // 199 / 128
    expect(evNIMetric["current"]).toBe(4.52273); // 199 / 44
    expect(mvToBVMetric["current"]).toBe(0.36036); // (100 * 2) / 555

    expect(selectedGrowth["Total growth"]).toBe(0.3288);
    expect(selectedGrowth["TTM growth"]).toBe(-0.35836);
    expect(selectedGrowth["Yearly growth"]).toBe(0.05305);

    expect(equity["Total growth"]).toBe(0.41783);
    expect(equity["Yearly growth"]).toBe(0.06554);
    expect(equity["TTM growth"]).toBe(-0.26052);
  });
});
