import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { describe, it } from "vitest";

import { cumulativeSymbolsAll } from "@/shared/constants";
import { YieldService } from "@/services";

const SNAPSHOT_DIR = path.join(process.cwd(), "local-data", "snapshot");
const DATE_THRESHOLD = 1780261200000;

interface SymbolSnapshot {
  symbol: string;
  cumulativeYields: ReturnType<typeof YieldService.getCumulativeYields>;
  yoyYields: ReturnType<typeof YieldService.getYoyYields>;
}

function filterByDateThreshold<T extends { date: number }>(
  data: T[],
  threshold: number,
): T[] {
  return data.filter((item) => item.date < threshold);
}

function generateSnapshots() {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }

  console.log(
    `Starting snapshot generation for ${cumulativeSymbolsAll.length} symbols...`,
  );
  console.log(`Snapshots will be saved to: ${SNAPSHOT_DIR}`);

  for (const symbol of cumulativeSymbolsAll) {
    try {
      console.log(`Processing ${symbol}...`);

      let cumulativeYields = YieldService.getCumulativeYields(symbol);
      let yoyYields = YieldService.getYoyYields(symbol);

      cumulativeYields = filterByDateThreshold(
        cumulativeYields,
        DATE_THRESHOLD,
      );
      yoyYields = filterByDateThreshold(yoyYields, DATE_THRESHOLD);

      const snapshot: SymbolSnapshot = {
        symbol,
        cumulativeYields,
        yoyYields,
      };

      const fileName = `${symbol}.json`;
      const filePath = path.join(SNAPSHOT_DIR, fileName);
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));

      console.log(
        `Saved ${cumulativeYields.length} cumulative yields and ${yoyYields.length} YoY yields`,
      );
    } catch (error) {
      console.error(
        `Error processing ${symbol}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  const summary = {
    totalSymbols: cumulativeSymbolsAll.length,
    symbols: cumulativeSymbolsAll,
  };

  const summaryPath = path.join(SNAPSHOT_DIR, "snapshot-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log(
    "Snapshot generation complete! Summary saved to snapshot-summary.json",
  );
}

describe("Snapshot Integrity", () => {
  it("should regenerate snapshots and verify they are up-to-date", () => {
    generateSnapshots();

    try {
      execSync("git diff --exit-code local-data/snapshot/", {
        stdio: "pipe",
      });
    } catch (error: unknown) {
      if (error instanceof Error && "status" in error && error.status !== 0) {
        execSync("git diff local-data/snapshot/", { stdio: "inherit" });
        throw new Error(
          "Snapshots are out of date! Generated snapshots differ from committed ones. Please regenerate and commit them.",
        );
      }
      throw error;
    }
  });

  it("should not have any changes in local-data/snapshot", () => {
    try {
      execSync("git diff --exit-code HEAD local-data/snapshot", {
        stdio: "ignore",
      });
    } catch (_error) {
      throw new Error(
        "Changes detected in local-data/snapshot! These files are protected and should not be modified.",
      );
    }
  });

  it("should not have any untracked files in local-data/snapshot", () => {
    const untracked = execSync(
      "git ls-files --others --exclude-standard local-data/snapshot",
      { encoding: "utf-8" },
    ).trim();
    if (untracked) {
      throw new Error(
        `Untracked files found in local-data/snapshot:\n${untracked}`,
      );
    }
  });
});
