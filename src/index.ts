import path from "path";
import fs from "fs";

import express, { Response, Request, NextFunction, Router } from "express";
import cors from "cors";

import { APP_CONFIG } from "@/config";
import { DATA_DIR } from "@/lib";
import { BadRequestError } from "@/lib/errors";
import { StockService, YieldService } from "@/services";
import { StockResponse } from "@eot/shared";

// --- Express App Setup ---
const app = express();
const yieldRouter = Router();
const stockRouter = Router();
const { APP_PORT } = APP_CONFIG;

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
 * @route GET /api/yield/cumulative
 * @description Returns cumulative yields for a specific symbol.
 * @queryparam {string} symbol - The symbol to get yields for.
 */
yieldRouter.get("/cumulative", async (req, res, next) => {
  const { symbol } = req.query;
  try {
    const cumulativeYields = await YieldService.getCumulativeYields(
      YieldService.requireSymbol(symbol),
    );
    res.status(200).json(cumulativeYields);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/yield/yoy
 * @description Returns year-over-year annualized returns for a specific symbol.
 */
yieldRouter.get("/yoy", async (req, res, next) => {
  const { symbol } = req.query;
  try {
    const yoyYields = await YieldService.getYoyYields(
      YieldService.requireSymbol(symbol),
    );
    res.status(200).json(yoyYields);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/stock/:region/symbols
 * @description Returns a list of all stock symbols for a given region.
 */
stockRouter.get("/:region/symbols", async (req, res, next) => {
  const { region } = req.params;
  try {
    const stockNames = await StockService.getStockNames(
      StockService.requireRegion(region),
    );
    res.status(200).json(stockNames);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/stock/:region/:symbol
 * @description Returns detailed data for a single stock in a given region.
 */
stockRouter.get("/:region/:symbol", async (req, res) => {
  const { region, symbol } = req.params;
  const stockSymbol = StockService.requireStockSymbol(symbol);
  const stockRegion = StockService.requireRegion(region);
  const stockService = await StockService.create(stockSymbol, stockRegion);
  const metrics = stockService.getMetrics();

  if (["ktlev", "froto", "alfas"].includes(stockSymbol)) {
    // write data to temp file for manual debugging
    const tempFilePath = path.join(
      DATA_DIR,
      "debug-snapshot",
      `${stockSymbol}.json`,
    );
    fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
    fs.writeFileSync(tempFilePath, JSON.stringify(metrics, null, 2));
  }

  res.status(200).json(metrics as StockResponse);
});

/**
 * @route GET /api/stock/:region
 * @description Returns detailed data for all stocks in a given region.
 */
stockRouter.get("/:region", async (req, res, next) => {
  const { region } = req.params;
  try {
    const allStockData = await StockService.getAllStockData(
      StockService.requireRegion(region),
    );
    res.status(200).json(allStockData);
  } catch (error) {
    next(error);
  }
});

// Mount each domain's router under /api/<domain>
app.use("/api/yield", yieldRouter);
app.use("/api/stock", stockRouter);

// Handle errors and send appropriate responses
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof BadRequestError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  console.error("Unhandled request error:", err);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(APP_PORT, () => {
  console.log(`Server is running on http://localhost:${APP_PORT}`);
});
