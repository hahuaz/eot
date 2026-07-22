import puppeteer from "puppeteer";

import type { ScrapeItem } from "@/types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

/**
 * Fetches each fund code's latest daily close by loading its Fintables page
 * in a real browser and intercepting the JSON response from Fintables' own
 * internal market-data API (markets.fintables.com/barbar/udf/history - a
 * TradingView-style UDF feed, the same one its own charts use), rather than
 * scraping the rendered DOM text via a CSS selector.
 *
 * A real browser is still required: markets.fintables.com sits behind
 * Cloudflare's bot challenge, which a real browser passes naturally but a
 * bare server-side fetch() can't (confirmed - 403 "Just a moment..." even
 * with full browser-matching headers, since it's TLS-fingerprint-based, not
 * header-based). What this avoids is depending on the page's CSS/utility
 * classes (which change on every redesign) - instead it depends only on the
 * URL shape of a backend API contract, which is far more stable, and reads
 * structured JSON directly instead of parsing/reformatting displayed text.
 */
export async function fetchFintables(
  fundCodes: string[],
): Promise<ScrapeItem[]> {
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const results: ScrapeItem[] = [];
  try {
    for (const code of fundCodes) {
      const page = await browser.newPage();
      try {
        await page.setUserAgent(USER_AGENT);

        const historyResponsePromise = page.waitForResponse(
          (res) =>
            res.url().includes("/barbar/udf/history") &&
            res.url().includes(`symbol=${code}`),
          { timeout: 55000 },
        );

        await page.goto(`https://fintables.com/fonlar/${code}`, {
          waitUntil: "networkidle2",
        });

        const historyResponse = await historyResponsePromise;
        const data = await historyResponse.json();

        if (data.s !== "ok" || !Array.isArray(data.c) || data.c.length === 0) {
          throw new Error(
            `No price data in intercepted response for fund ${code}`,
          );
        }

        const latestClose = data.c[data.c.length - 1];
        results.push({ symbol: code, value: String(latestClose) });
      } catch (error) {
        console.error(`Failed to fetch fund price for ${code}:`, error);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}
