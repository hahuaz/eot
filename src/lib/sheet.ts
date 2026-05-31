import fs from "fs";
import path from "path";

import { google } from "googleapis";

import type { ScrapeResult } from "@/types";
import { APP_CONFIG } from "@/config";

const { SHEETS } = APP_CONFIG;

export async function updateScrapeSheet(scrapeResult: ScrapeResult) {
  // find invest sheet
  const investSheetConfig = SHEETS.find((sheet) => sheet.name === "invest");
  if (!investSheetConfig) {
    throw new Error(
      "Invest sheet configuration not found in APP_CONFIG.SHEETS",
    );
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: investSheetConfig.credentialPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const sheetName = "scraped-prices";

  try {
    // 1. Read Column A (Resources)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: investSheetConfig.id,
      range: `${sheetName}!A:A`,
    });

    const rows = response?.data?.values?.flat() ?? [];
    // console.log("Sheet Rows (Column A):", rows);

    if (!rows.length) {
      throw new Error("No data found in Column A.");
    }

    // 2. Map resource names to row indexes (row numbers)
    const resourceToRowMapping: Record<string, number> = {};
    rows.forEach((resource, index) => {
      resourceToRowMapping[resource] = index + 1; // Google Sheets uses 1-based index
    });
    // console.log("Resource Row Mapping:", resourceToRowMapping);

    // 3. Prepare update requests for the correct rows
    const updateRequests = scrapeResult.map(({ symbol, value }) => {
      const rowIndex = resourceToRowMapping[symbol];
      if (!rowIndex) {
        throw new Error(`Symbol not found in the sheet: ${symbol}`);
      }

      return {
        range: `${sheetName}!B${rowIndex}`, // Write to column B of the correct row
        values: [[value]],
      };
    });
    // console.log("Update Requests:", JSON.stringify(updateRequests));

    // 4. Perform batch update
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: investSheetConfig.id,
      requestBody: {
        data: updateRequests,
        valueInputOption: "RAW",
      },
    });
  } catch (error) {
    console.error("Error updating sheet:", error);
  }
}

export async function getTrStockSheets(sheetName: string) {
  console.log(`\n--- Retrieving from Google Sheet [${sheetName}]---`);

  // find tr-stocks sheet config
  const sheetConfig = SHEETS.find((sheet) => sheet.name === "tr-stocks");
  if (!sheetConfig) {
    throw new Error(
      "TR Stocks sheet configuration not found in APP_CONFIG.SHEETS",
    );
  }

  const spreadsheetId = sheetConfig.id;

  const auth = new google.auth.GoogleAuth({
    keyFile: sheetConfig.credentialPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheetsApi = google.sheets({ version: "v4", auth });

  try {
    // 1. Get spreadsheet metadata to find the exact sheet name (case-insensitive match)
    const spreadsheet = await sheetsApi.spreadsheets.get({
      spreadsheetId: spreadsheetId,
    });

    const sheet = (spreadsheet.data.sheets || []).find(
      (s) => s.properties?.title?.toLowerCase() === sheetName.toLowerCase(),
    );

    if (!sheet) {
      console.warn(`Sheet "${sheetName}" not found in spreadsheet.`);
      return null;
    }

    const actualSheetName = sheet.properties!.title!;
    // Set the range strictly from A1 to L15
    const range = `'${actualSheetName}'!A1:L15`;

    // 2. Read existing data
    const response = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: range,
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.warn(`No data found in sheet "${actualSheetName}".`);
      return null;
    }

    // --- Save retrieved range to sheets directory as CSV ---
    const maxColumns = Math.max(...rows.map((row) => row.length));

    const csvContent = rows
      .map((row) => {
        // Create a new array of length `maxColumns` and fill missing cells with empty strings
        const paddedRow = Array.from(
          { length: maxColumns },
          (_, i) => row[i] ?? "",
        );

        return paddedRow
          .map((cell) => {
            const str = String(cell);
            // Escape cell values if they contain commas, quotes, or newlines
            if (str.includes(",") || str.includes('"') || str.includes("\n")) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(",");
      })
      .join("\r\n");

    const sheetsDir = path.join(process.cwd(), "local-data", "stocks", "tr");
    if (!fs.existsSync(sheetsDir)) {
      fs.mkdirSync(sheetsDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(sheetsDir, `${actualSheetName}.csv`),
      csvContent,
    );
    console.log(`💾 Saved sheet data to: sheets/${actualSheetName}.csv`);
  } catch (error: any) {
    console.error(
      `❌ Error retrieving from Google Sheet ${sheetName}:`,
      error.message,
    );
    return null;
  }
}
