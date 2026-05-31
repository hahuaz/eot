import { getTrStockSheets } from "../lib/sheet";
import { ALL_TR_STOCK_SYMBOLS } from "../lib/constants";
import { wait } from "../lib/index";

async function getSheets() {
  for (const symbol of ALL_TR_STOCK_SYMBOLS) {
    try {
      // if (!["banvt"].includes(symbol)) {
      //   continue;
      // }
      // if (symbol.at(0)?.toLowerCase()! < "f") continue;

      await wait(5);
      await getTrStockSheets(symbol);
    } catch (error) {
      console.error(`Error processing symbol ${symbol}:`, error);
    }
  }
}

// Execute the function
getSheets();
