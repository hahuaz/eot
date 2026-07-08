import "./config";

import path from "path";
import fs from "fs";

import express, { Response, Request, NextFunction, Router } from "express";
import cors from "cors";

import { DATA_DIR } from "@/lib";
import { BadRequestError } from "@/lib/errors";
import { StockService, YieldService } from "@/services";
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
 * @route GET /api/cumulative-returns
 * @description Returns cumulative yields for a specific symbol.
 * @queryparam {string} symbol - The symbol to get yields for.
 */
router.get("/cumulative-returns", (req, res, next) => {
  const { symbol } = req.query;
  try {
    const cumulativeYields = YieldService.getCumulativeYields(
      YieldService.requireSymbol(symbol),
    );
    res.status(200).json(cumulativeYields);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/yoy-returns
 * @description Returns year-over-year annualized returns for a specific symbol.
 */
router.get("/yoy-returns", (req, res, next) => {
  const { symbol } = req.query;
  try {
    const yoyReturns = YieldService.getYoyYields(
      YieldService.requireSymbol(symbol),
    );
    res.status(200).json(yoyReturns);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/stock-names
 * @description Returns a list of all stock symbols for a given region.
 */
router.get("/stock-names", (req, res) => {
  const { region } = req.query;
  res
    .status(200)
    .json(StockService.getStockNames(StockService.requireRegion(region)));
});

/**
 * @route GET /api/all-stock
 * @description Returns detailed data for all stocks in a given region.
 */
router.get("/all-stock", (req, res) => {
  const { region } = req.query;
  res
    .status(200)
    .json(StockService.getAllStockData(StockService.requireRegion(region)));
});

/**
 * @route GET /api/stock
 * @description Returns detailed data for a single stock in a given region.
 */
router.get("/stock", async (req, res) => {
  const { stock, region } = req.query;
  const stockSymbol = StockService.requireStockSymbol(stock);
  const stockRegion = StockService.requireRegion(region);
  const stockService = new StockService(stockSymbol, stockRegion);
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
