import puppeteer, { type Browser } from "puppeteer";

import type { ScrapeResult, Site } from "@/types";

/**
 * Scrapes a single URL and returns the result.
 * @param browser - The Puppeteer browser instance.
 * @param url - The URL to scrape.
 * @param querySelector - The CSS selector to find the element.
 * @param isLocalTr - Whether to normalize the value for the Turkish locale.
 * @returns A promise that resolves to a single scrape result.
 */
async function scrapeUrl(
  browser: Browser,
  url: string,
  querySelector: string,
  isLocalTr: boolean | undefined = false,
): Promise<ScrapeResult[0] | null> {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    );
    await page.goto(url, { waitUntil: "networkidle2" });

    await page.waitForSelector(querySelector, { timeout: 55000 }); // ensures element exists
    await page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        return el && el.textContent && el.textContent.trim().length > 0;
      },
      { polling: "mutation", timeout: 55000 },
      querySelector,
    );

    let scrapeValue = await page.evaluate((qs) => {
      const element = document.querySelector(qs);
      return element?.textContent?.trim();
    }, querySelector);

    const symbol = url.split("/").pop()?.split("?")[0];
    if (!symbol) {
      throw new Error(`Could not extract symbol from URL: ${url}`);
    }

    if (!scrapeValue) {
      throw new Error(`scrapeValue is ${scrapeValue} for ${url}`);
    }

    // Normalize number format
    if (isLocalTr) {
      // Turkish locale uses a comma for the decimal separator and a dot for thousands.
      scrapeValue = scrapeValue.replace(/\./g, "").replace(",", ".");
    } else {
      // Default to removing commas for thousands separation.
      scrapeValue = scrapeValue.replace(/,/g, "");
    }

    return {
      symbol,
      value: scrapeValue,
    };
  } catch (error) {
    console.error(`Error scraping ${url}:`, error);
    return null;
  } finally {
    await page.close();
  }
}

/**
 * Scrapes a list of sites for data sequentially.
 * @param sites - An array of sites to scrape.
 * @returns A promise that resolves to an array of scrape results.
 */
export async function scrape(sites: Site[]): Promise<ScrapeResult> {
  const browser = await puppeteer.launch({
    // executablePath: "/usr/bin/google-chrome",
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const allResults: ScrapeResult = [];

  for (const site of sites) {
    for (const endpoint of site.endpoints) {
      try {
        const url = `${site.domain}${endpoint}`;
        const result = await scrapeUrl(
          browser,
          url,
          site.querySelector,
          site.isLocalTr,
        );
        if (result) {
          allResults.push(result);
        }
      } catch (error) {
        console.error(
          `Failed to scrape endpoint ${endpoint} from site ${site.domain}:`,
          error,
        );
      }
    }
    await browser.close();
  }

  return allResults;
}
