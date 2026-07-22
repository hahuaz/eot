import { google } from "googleapis";

import type { ScrapeItem } from "@/types";
import { APP_CONFIG } from "@/config";

const { SHEETS } = APP_CONFIG;

export async function updateSheetSymbols(scrapeResult: ScrapeItem[]) {
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
