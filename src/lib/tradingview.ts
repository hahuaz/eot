import type { ScrapeItem } from "@/types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

// This project's own symbol keys -> TradingView's EXCHANGE:TICKER codes,
// found by inspecting the network requests each symbol's
// tradingview.com/symbols/{key} page actually makes (undocumented
// elsewhere) - the page slug doesn't always match TradingView's internal
// code (e.g. the GOLD page is TVC:GOLD, not just "GOLD").
const SYMBOL_CODES: Record<string, string> = {
  USDTRY: "FX:USDTRY",
  EURTRY: "FX:EURTRY",
  "BIST-ALTIN": "BIST:ALTIN",
  GOLD: "TVC:GOLD",
  "AMEX-GLD": "AMEX:GLD",
};

/**
 * Fetches each symbol's current price from TradingView's own scanner API
 * (scanner.tradingview.com/symbol) - the same endpoint its symbol pages
 * use to render their own price widgets - rather than scraping the
 * rendered DOM text via a CSS selector. Unlike Fintables' market-data API,
 * this one isn't behind a bot challenge - a plain fetch() works, no
 * browser needed.
 *
 * isBistSymbol controls how `symbols` are resolved to TradingView's
 * EXCHANGE:TICKER codes: true looks each one up as a BIST-listed TR stock
 * (this project's stock_info.symbol values, e.g. "garan" -> "BIST:GARAN" -
 * spot-checked against several real TR stocks, all returned plausible
 * prices), false looks it up in SYMBOL_CODES (the fixed set of non-stock
 * symbols this project tracks, e.g. "USDTRY", "GOLD").
 */
export async function fetchTradingViewPrices(
  symbols: string[],
  isBistSymbol: boolean,
): Promise<ScrapeItem[]> {
  const results: ScrapeItem[] = [];
  for (const symbol of symbols) {
    const code = isBistSymbol
      ? `BIST:${symbol.toUpperCase()}`
      : SYMBOL_CODES[symbol];
    if (!code) {
      console.error(`No TradingView symbol code mapping for ${symbol}`);
      continue;
    }

    try {
      const url = `https://scanner.tradingview.com/symbol?symbol=${encodeURIComponent(code)}&fields=close`;
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      const data = await res.json();

      if (typeof data.close !== "number") {
        throw new Error(
          `No close price returned for ${symbol}: ${JSON.stringify(data)}`,
        );
      }

      results.push({ symbol, value: String(data.close) });
    } catch (error) {
      console.error(`Failed to fetch TradingView price for ${symbol}:`, error);
    }
  }

  return results;
}
