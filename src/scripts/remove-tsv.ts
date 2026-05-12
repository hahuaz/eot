// Remove TSV files after conversion to CSV
import fs from "fs";
import path from "path";

const STOCKS_TR_PATH = path.join(process.cwd(), "local-data", "stocks", "tr");
const STOCKS_US_PATH = path.join(process.cwd(), "local-data", "stocks", "us");

/**
 * Remove all TSV files in a directory
 */
function removeFiles(dirPath: string): void {
  try {
    const files = fs
      .readdirSync(dirPath)
      .filter((file) => file.endsWith(".tsv"));

    if (files.length === 0) {
      console.log(`No TSV files found in ${path.basename(dirPath)}`);
      return;
    }

    console.log(
      `Removing ${files.length} TSV files from ${path.basename(dirPath)}...`,
    );

    files.forEach((file) => {
      const filePath = path.join(dirPath, file);
      fs.unlinkSync(filePath);
      console.log(`✓ Removed: ${file}`);
    });
  } catch (error) {
    console.error(`Error removing files from ${dirPath}:`, error);
  }
}

/**
 * Main function
 */
async function main(): Promise<void> {
  console.log("🗑️  Starting TSV file removal...\n");

  removeFiles(STOCKS_TR_PATH);
  console.log();
  removeFiles(STOCKS_US_PATH);

  console.log("\n✨ Removal complete!");
}

main().catch(console.error);
