import "./config.ts";

import express, { Response, Request, NextFunction, Router } from "express";
import cors from "cors";

import {
  INFLATION_DATA,
  STOCKS_DYNAMIC_DATA,
  getNightlyYield,
  DATA_DIR,
  StockAnalyzer,
} from "@/lib";

import { Region, regions } from "@/types";

import { getCummulativeReturns } from "@/lib/symbol-returns.js";
import path from "path";
import fs from "fs";

// --- Express App Setup ---
const app = express();
const router = Router();
const PORT = process.env.PORT || 5555;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Middleware ---
function validateRegion(req: Request, res: Response, next: NextFunction) {
  const region = req.query.region;
  if (typeof region !== "string" || !regions.includes(region as Region)) {
    res.status(400).json({ error: "Invalid or missing region parameter." });
    return;
  }
  next();
}

/**
 * Request logging middleware
 */
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// --- API Routes ---

/**
 * @route GET /api/cummulative-returns
 * @description Returns carry trade data. This route is independent of region.
 */
router.get("/cummulative-returns", (req, res) => {
  try {
    const cummulativeReturns = getCummulativeReturns();
    res.status(200).json(cummulativeReturns);
  } catch (error) {
    console.error("Failed to get cummulative returns data:", error);
    res
      .status(500)
      .json({ error: "Failed to calculate cummulative returns data." });
  }
});

/**
 * @route GET /api/ttm-nightly-yield
 * @description Calculates and returns the money fund yield adjusted for inflation for a given region.
 * @queryparam {string} region - The region ('tr' or 'us').
 */
router.get("/ttm-nightly-yield", validateRegion, (req, res) => {
  const region = req.query.region as Region;

  const inflation = INFLATION_DATA[region];

  const ttmNightlyYield = getNightlyYield({ inflation });

  if (ttmNightlyYield === null || ttmNightlyYield === undefined) {
    res.status(500).json({ error: "Failed to calculate ttm nightly yield." });
    return;
  }

  res.status(200).json({ ttmNightlyYield });
});

/**
 * @route GET /api/stock-names
 * @description Returns a list of all stock symbols for a given region.
 * @queryparam {string} region - The region ('tr' or 'us').
 */
router.get("/stock-names", validateRegion, (req, res) => {
  const region = req.query.region as Region;

  const stocksDynamic = STOCKS_DYNAMIC_DATA[region];
  res.status(200).json(Object.keys(stocksDynamic));
});

/**
 * @route GET /api/all-stock
 * @description Returns detailed data for all stocks in a given region.
 * @queryparam {string} region - The region ('tr' or 'us').
 */
router.get("/all-stock", validateRegion, (req, res) => {
  const region = req.query.region as Region;
  const stocksDynamic = STOCKS_DYNAMIC_DATA[region];
  const stockNames = Object.keys(stocksDynamic);

  const stocksData: any[] = stockNames.map((stockSymbol) => {
    const stockDynamic = stocksDynamic[stockSymbol];
    if (!stockDynamic) {
      res.status(404).json({ error: "Stock not found." });
      return;
    }

    const stock = new StockAnalyzer(stockSymbol, region);
    const metrics = stock.getMetrics();

    return {
      stockDynamic,
      ...metrics,
    };
  });

  res.status(200).json(stocksData);
});

/**
 * @route GET /api/stock
 * @description Returns detailed data for a single stock in a given region.
 * @queryparam {string} region - The region ('tr' or 'us').
 * @queryparam {string} stock - The stock symbol.
 */
router.get("/stock", validateRegion, async (req, res) => {
  const region = req.query.region as Region;

  const { stock: stockSymbol } = req.query;
  if (!stockSymbol || typeof stockSymbol !== "string") {
    res.status(400).json({ error: "Stock symbol is required." });
    return;
  }

  const stockService = new StockAnalyzer(stockSymbol, region);
  const metrics = stockService.getMetrics();

  if (["ktlev", "froto"].includes(stockSymbol)) {
    // write data to temp file
    const tempFilePath = path.join(DATA_DIR, "snapshot", `${stockSymbol}.json`);
    fs.writeFileSync(tempFilePath, JSON.stringify(metrics, null, 2));
  }

  res.status(200).json(metrics);
});

// Mount the router under the /api prefix
app.use("/api", router);

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
