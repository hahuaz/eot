import "./config";

import path from "path";
import fs from "fs";

import express, { Response, Request, NextFunction, Router } from "express";
import cors from "cors";

import { DATA_DIR, StockAnalyzer } from "@/lib";
import { BadRequestError } from "@/lib/errors";
import { SymbolReturnsCalculator } from "@/lib/symbol-returns.js";
import { StockResponse } from "./shared/types/index.js";

// --- Express App Setup ---
const app = express();
const router = Router();
const PORT = process.env.PORT || 5555;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Middlewares ---

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
 * @description Returns cumulative returns for a specific symbol.
 * @queryparam {string} symbol - The symbol to get returns for (e.g., 'BGP', 'TP2', 'USDTRY', 'EURTRY', 'GOLD').
 */
router.get("/cummulative-returns", (req, res, next) => {
  const { symbol } = req.query;

  try {
    // TODO: I shouldn't declare it's type as string, check result should provide the correct type
    const calculator = new SymbolReturnsCalculator(symbol as string);
    const cummulativeReturns = calculator.getCummulativeReturns();
    res.status(200).json(cummulativeReturns);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/yoy-returns
 * @description Returns year-over-year annualized returns for a specific symbol.
 * @queryparam {string} symbol - The symbol to get returns for (e.g., 'USDTRY', 'EURTRY', 'GOLD').
 */
router.get("/yoy-returns", (req, res, next) => {
  const { symbol } = req.query;
  try {
    const calculator = new SymbolReturnsCalculator(symbol as string);
    const yoyReturns = calculator.getYoyReturns();
    res.status(200).json(yoyReturns);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/stock-names
 * @description Returns a list of all stock symbols for a given region.
 * @queryparam {string} region
 */
router.get("/stock-names", (req, res) => {
  const region = StockAnalyzer.requireRegion(req.query.region);
  res.status(200).json(StockAnalyzer.getStockNames(region));
});

/**
 * @route GET /api/all-stock
 * @description Returns detailed data for all stocks in a given region.
 * @queryparam {string} region
 */
router.get("/all-stock", (req, res) => {
  const region = StockAnalyzer.requireRegion(req.query.region);
  res.status(200).json(StockAnalyzer.getAllStockData(region));
});

/**
 * @route GET /api/stock
 * @description Returns detailed data for a single stock in a given region.
 * @queryparam {string} region
 * @queryparam {string} stock - The stock symbol.
 */
router.get("/stock", async (req, res) => {
  const stockSymbol = StockAnalyzer.requireStockSymbol(req.query.stock);
  const region = StockAnalyzer.requireRegion(req.query.region);
  const stockService = new StockAnalyzer(stockSymbol, region);
  const metrics = stockService.getMetrics();

  if (["ktlev", "froto", "alfas"].includes(stockSymbol)) {
    // write data to temp file
    const tempFilePath = path.join(DATA_DIR, "snapshot", `${stockSymbol}.json`);
    fs.writeFileSync(tempFilePath, JSON.stringify(metrics, null, 2));
  }

  res.status(200).json(metrics as StockResponse);
});

// Mount the router under the /api prefix
app.use("/api", router);

// Handle errors and send appropriate responses
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof BadRequestError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  console.error("Unhandled request error:", err);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
