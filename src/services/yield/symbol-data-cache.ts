import { getSymbolPriceHistory } from "@/db/yield-prices.repository";
import { OBSERVATION_START_DATE } from "@/lib";
import { SymbolPrice } from "@/types";

export type SymbolPriceData = {
  // this is used for ordered access (scanning for the closest entry)
  priceHistory: SymbolPrice[];
  // this is used for O(1) lookup by exact date
  timeToPrice: Map<number, number>;
};

const symbolPriceCache = new Map<string, Promise<SymbolPriceData>>();

export function getSymbolData(symbol: string): Promise<SymbolPriceData> {
  const upperSym = symbol.toUpperCase();
  let cached = symbolPriceCache.get(upperSym);

  if (!cached) {
    // Cache the in-flight promise itself (not its resolved value) and don't
    // await it here. This way, concurrent callers for the same symbol all
    // get the same pending promise instead of racing into duplicate queries.
    cached = loadSymbolData(upperSym);
    symbolPriceCache.set(upperSym, cached);
  }
  return cached;
}

async function loadSymbolData(symbol: string): Promise<SymbolPriceData> {
  const fullHistory = await getSymbolPriceHistory(symbol);

  // The yield service is only ever meant to look at data from
  // OBSERVATION_START_DATE onward (this function's own check right below
  // already assumes that date is the true start) - filtered here, once, so
  // every consumer (getCumulativeYields's explicit start-index lookup,
  // getYoyYields's slice(1)/getClosestEntry baseline search) is immune to
  // whatever earlier history symbol_prices happens to also hold, e.g. from
  // a backfill covering dates before the observation start. Without this,
  // adding earlier rows would silently change getYoyYields's output (its
  // slice(1) would skip a different, wrong first entry, and its baseline
  // search could reach past the intended start) even though nothing about
  // the service's own intended behavior changed.
  const priceHistory = fullHistory.filter(
    (entry) => entry.date >= OBSERVATION_START_DATE,
  );

  if (priceHistory.length === 0) {
    throw new Error(`Data for symbol ${symbol} is missing or empty.`);
  }

  const startEntry = priceHistory.find(
    (entry) => entry.date === OBSERVATION_START_DATE,
  );
  if (startEntry?.value == null) {
    throw new Error(
      `Baseline date ${OBSERVATION_START_DATE} not found for symbol ${symbol}.`,
    );
  }

  for (let i = 1; i < priceHistory.length; i++) {
    if (priceHistory[i - 1].date >= priceHistory[i].date) {
      throw new Error(
        `Data integrity issue for symbol ${symbol}: duplicate or out-of-order dates detected.`,
      );
    }
  }

  const timeToPrice = new Map(
    priceHistory.map((entry) => [entry.date, entry.value]),
  );
  return { priceHistory, timeToPrice };
}
