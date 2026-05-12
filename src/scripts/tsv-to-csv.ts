// Convert TSV files to CSV format
import fs from "fs";
import path from "path";

const STOCKS_TR_PATH = path.join(process.cwd(), "local-data", "stocks", "tr");
const STOCKS_US_PATH = path.join(process.cwd(), "local-data", "stocks", "us");

/**
 * Escape CSV field: wrap in quotes if contains comma, quote, or newline
 */
function escapeCSVField(field: string): string {
  if (
    field.includes(",") ||
    field.includes('"') ||
    field.includes("\n") ||
    field.includes("\r")
  ) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Convert TSV line to CSV line
 */
function tsvToCsv(tsvLine: string): string {
  const fields = tsvLine.split("\t");
  return fields.map(escapeCSVField).join(",");
}

/**
 * Process TSV file and save as CSV
 */
function convertTsvToCsv(inputPath: string, outputPath: string): void {
  try {
    const content = fs.readFileSync(inputPath, "utf-8");
    // Normalize line endings and split
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    // Filter out completely empty lines but keep lines with data
    const csvLines = lines
      .filter((line) => line.trim().length > 0)
      .map(tsvToCsv);
    const csvContent = csvLines.join("\n");

    fs.writeFileSync(outputPath, csvContent, "utf-8");
    console.log(
      `✓ Converted: ${path.basename(inputPath)} → ${path.basename(outputPath)}`,
    );
  } catch (error) {
    console.error(`✗ Error converting ${inputPath}:`, error);
  }
}

/**
 * Process all TSV files in a directory
 */
function processDirectory(dirPath: string): void {
  try {
    const files = fs
      .readdirSync(dirPath)
      .filter((file) => file.endsWith(".tsv"));

    if (files.length === 0) {
      console.log(`No TSV files found in ${dirPath}`);
      return;
    }

    console.log(
      `Processing ${files.length} files in ${path.basename(dirPath)}...`,
    );

    files.forEach((file) => {
      const inputPath = path.join(dirPath, file);
      const outputPath = path.join(dirPath, file.replace(".tsv", ".csv"));
      convertTsvToCsv(inputPath, outputPath);
    });
  } catch (error) {
    console.error(`Error processing directory ${dirPath}:`, error);
  }
}

/**
 * Main function
 */
async function main(): Promise<void> {
  console.log("🔄 Starting TSV to CSV conversion...\n");

  processDirectory(STOCKS_TR_PATH);
  console.log();
  processDirectory(STOCKS_US_PATH);

  console.log("\n✨ Conversion complete!");
}

main().catch(console.error);
