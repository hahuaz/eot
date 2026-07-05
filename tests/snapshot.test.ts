import { describe, it } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { SymbolReturnsCalculator } from "@/lib/symbol-returns";
import { cumulativeSymbolsAll } from "@/shared/constants";

const SNAPSHOT_DIR = path.join(process.cwd(), "local-data", "snapshot");
const DATE_THRESHOLD = 1780261200000;

interface SymbolSnapshot {
  symbol: string;
  cumulativeReturns: ReturnType<
    SymbolReturnsCalculator["getCummulativeReturns"]
  >;
  yoyReturns: ReturnType<SymbolReturnsCalculator["getYoyReturns"]>;
}

/**
 * Filter returns to only include dates less than threshold
 */
function filterByDateThreshold<T extends { date: number }>(
  data: T[],
  threshold: number,
): T[] {
  return data.filter((item) => item.date < threshold);
}

/**
 * Generate snapshots for all symbols and save to JSON files
 */
function generateSnapshots() {
  // Ensure snapshot directory exists
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }

  console.log(
    `📸 Starting snapshot generation for ${cumulativeSymbolsAll.length} symbols...`,
  );
  console.log(`💾 Snapshots will be saved to: ${SNAPSHOT_DIR}`);

  for (const symbol of cumulativeSymbolsAll) {
    try {
      console.log(`\n📊 Processing ${symbol}...`);

      // Get cumulative and YoY returns
      const calculator = new SymbolReturnsCalculator(symbol);
      let cumulativeReturns = calculator.getCummulativeReturns();
      let yoyReturns = calculator.getYoyReturns();

      // Filter to only include dates less than threshold
      cumulativeReturns = filterByDateThreshold(
        cumulativeReturns,
        DATE_THRESHOLD,
      );
      yoyReturns = filterByDateThreshold(yoyReturns, DATE_THRESHOLD);

      // Create snapshot object
      const snapshot: SymbolSnapshot = {
        symbol,
        cumulativeReturns,
        yoyReturns,
      };

      // Save to JSON file
      const fileName = `${symbol}.json`;
      const filePath = path.join(SNAPSHOT_DIR, fileName);
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));

      console.log(
        `   ✅ Saved ${cumulativeReturns.length} cumulative returns and ${yoyReturns.length} YoY returns`,
      );
    } catch (error) {
      console.error(
        `   ❌ Error processing ${symbol}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // Create summary file
  const summary = {
    totalSymbols: cumulativeSymbolsAll.length,
    symbols: cumulativeSymbolsAll,
  };

  const summaryPath = path.join(SNAPSHOT_DIR, "snapshot-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log(
    `\n✨ Snapshot generation complete! Summary saved to snapshot-summary.json`,
  );
}

describe("Snapshot Integrity", () => {
  it("should regenerate snapshots and verify they are up-to-date", () => {
    // Generate fresh snapshots
    generateSnapshots();

    // Check if any snapshots have changed using git diff
    try {
      execSync("git diff --exit-code local-data/snapshot/", {
        stdio: "pipe",
      });
      // If no error, snapshots are up-to-date
    } catch (error: unknown) {
      // Exit code non-zero means there are changes
      if (error instanceof Error && "status" in error && error.status !== 0) {
        // Show the diff
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
      // Check if there are any changes (staged or unstaged) in the snapshot directory
      // relative to the last commit (HEAD).
      // --exit-code makes it return 1 if there are changes, 0 if not.
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
