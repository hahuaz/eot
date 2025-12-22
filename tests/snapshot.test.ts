import { describe, it, expect } from "vitest";
import { execSync } from "child_process";

describe("Snapshot Integrity", () => {
  it("should not have any changes in local-data/snapshot", () => {
    try {
      // Check if there are any changes (staged or unstaged) in the snapshot directory
      // relative to the last commit (HEAD).
      // --exit-code makes it return 1 if there are changes, 0 if not.
      execSync("git diff --exit-code HEAD local-data/snapshot", {
        stdio: "ignore",
      });
    } catch (error) {
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
