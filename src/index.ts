import path from "path";
import fs from "fs";

import express, { Response, Request, NextFunction, Router } from "express";
import cors from "cors";

import { APP_CONFIG } from "@/config";
import { BadRequestError } from "@/lib/errors";
import {
  requireRegion,
  requireStockSymbol,
  getStockSymbols,
  getStockData,
  getAllStockData,
  YieldService,
} from "@/services";
import { StockResponse, StockSummaryEntry } from "@eot/shared";

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
 * @route GET /api/yield/all
 * @description Returns cumulative + YoY yields for every yield-included
 * symbol - the symbol list itself is DB-driven, so callers don't need to
 * know it up front.
 */
yieldRouter.get("/all", async (req, res, next) => {
  try {
    const allYieldData = await YieldService.getAllYieldData();
    res.status(200).json(allYieldData);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/stock/:region/symbols
 * @description Returns symbols with at least one quarter of data for a
 * given region - registered before /:region/:symbol so the literal
 * "symbols" segment isn't swallowed as a symbol name.
 */
stockRouter.get("/:region/symbols", async (req, res, next) => {
  const { region } = req.params;
  try {
    const stockSymbols = await getStockSymbols(requireRegion(region));
    res.status(200).json(stockSymbols);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/stock/:region/:symbol
 * @description Returns per-line-item, QoQ growth financial data for a
 * single stock from qoq_financial_reports.
 */
stockRouter.get("/:region/:symbol", async (req, res, next) => {
  const { region, symbol } = req.params;
  try {
    const validRegion = requireRegion(region);
    const validSymbol = requireStockSymbol(symbol);
    const data = await getStockData(validRegion, validSymbol);
    res.status(200).json(data as StockResponse);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/stock/:region
 * @description Returns data for every stock in a given region.
 */
stockRouter.get("/:region", async (req, res, next) => {
  const { region } = req.params;
  try {
    const allStockData = await getAllStockData(requireRegion(region));
    res.status(200).json(allStockData as StockSummaryEntry[]);
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
