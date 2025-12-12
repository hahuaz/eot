// importing config at the seperate module to make sure environment variables are loaded before any other imports
import "./config.ts";

import path from "path";

import express, { Response, Request, NextFunction, Router } from "express";
import cors from "cors";

import {
  DATA_DIR,
  populateStock,
  parseCSV,
  getStockInfo,
  getStocksDynamic,
  getMoneyFundYield,
} from "@/lib";
import { Inflation, StockDynamic, Stock, BaseMetric } from "@shared/types";
import { Region, regions } from "@/types";

import { getCarryTrade } from "@/lib/carry-trade";

const INFLATION = regions.reduce(
  (acc, region) => {
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
 * @route GET /api/carry-trade
 * @description Returns carry trade data. This route is independent of region.
 */
router.get("/carry-trade", (req, res) => {
  try {
    const carryTradeData = getCarryTrade();
    res.status(200).json(carryTradeData);
  } catch (error) {
    console.error("Failed to get carry trade data:", error);
    res.status(500).json({ error: "Failed to calculate carry trade data." });
  }
});

/**
 * @route GET /api/money-fund
 * @description Calculates and returns the money fund yield adjusted for inflation for a given region.
 * @queryparam {string} region - The region ('tr' or 'us').
 */
router.get("/money-fund", validateRegion, (req, res) => {
  const region = req.query.region as Region;

  const inflation = INFLATION[region];

  const moneyFundYield = getMoneyFundYield({ inflation });

  if (moneyFundYield === null || moneyFundYield === undefined) {
    res.status(500).json({ error: "Failed to calculate money fund yield." });
    return;
  }

  res.status(200).json({ adjustedBGPYield: moneyFundYield });
});

/**
 * @route GET /api/stock-names
 * @description Returns a list of all stock symbols for a given region.
 * @queryparam {string} region - The region ('tr' or 'us').
 */
router.get("/stock-names", validateRegion, (req, res) => {
  const region = req.query.region as Region;

  const stocksDynamic = getStocksDynamic({ region });
  res.status(200).json(Object.keys(stocksDynamic));
});

/**
 * @route GET /api/all-stock
 * @description Returns detailed data for all stocks in a given region.
 * @queryparam {string} region - The region ('tr' or 'us').
 */
router.get("/all-stock", validateRegion, (req, res) => {
  const region = req.query.region as Region;
  const inflation = INFLATION[region];
  const stocksDynamic = getStocksDynamic({ region });
  const stockNames = Object.keys(stocksDynamic);

  const stocksData: any[] = stockNames.map((stockSymbol) => {
    const stockDynamic = stocksDynamic[stockSymbol];
    if (!stockDynamic) {
      res.status(404).json({ error: "Stock not found." });
      return;
    }

    const { baseMetrics, stockConfig } = getStockInfo({
      stockSymbol,
      region,
    });

    const stockData = populateStock({
      stockConfig,
      baseMetrics,
      stockDynamic,
      region,
      inflation,
    });

    return {
      stockDynamic,
      ...stockData,
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
  console.log("Region:", region);

  const { stock: stockSymbol } = req.query;
  if (!stockSymbol || typeof stockSymbol !== "string") {
    res.status(400).json({ error: "Stock symbol is required." });
    return;
  }

  const inflation = INFLATION[region];

  const stocksDynamic = getStocksDynamic({ region });
  const stockDynamic = stocksDynamic[stockSymbol];
  if (!stockDynamic) {
    res.status(404).json({ error: "Stock not found." });
    return;
  }

  const { baseMetrics, stockConfig } = getStockInfo({
    region,
    stockSymbol,
  });

  const stockData = populateStock({
    stockConfig,
    baseMetrics,
    stockDynamic,
    region,
    inflation,
  });

  res.status(200).json(stockData);
});

// Mount the router under the /api prefix
app.use("/api", router);

// --- Server Start ---

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
