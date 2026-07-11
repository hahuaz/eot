/**
 * Fetches `sharesOutstanding` from Yahoo Finance's quote API for TR stock
 * symbols and writes the values back into the outstandingShares column of
 * local-data/stocks-tr - all_symbols.csv.
 *
 * Yahoo's quote endpoint requires a session cookie + crumb (obtained via an
 * unauthenticated handshake) since they locked down the API in 2024.
 *
 * Usage:
 *   tsx src/scripts/get-outstanding-shares.ts                # updates all symbols in the CSV
 *   tsx src/scripts/get-outstanding-shares.ts garan ykbnk     # updates only these symbols
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";
const SYMBOLS_CSV_PATH = join(
  __dirname,
  "..",
  "..",
  "local-data",
  "stocks-tr - all_symbols.csv",
);
// Turkish stocks are listed on Yahoo under the Istanbul exchange suffix.
const YAHOO_SUFFIX = ".IS";
// Yahoo rejects overly long symbol batches, so chunk requests.
const BATCH_SIZE = 40;

function readSymbolsFromCsv(): string[] {
  const csv = readFileSync(SYMBOLS_CSV_PATH, "utf-8");
  const newline = csv.includes("\r\n") ? "\r\n" : "\n";
  const [, ...rows] = csv.trim().split(newline);
  return rows
    .map((row) => row.split(",")[0].trim())
    .filter((symbol) => symbol && symbol !== "test");
}

function updateCsvWithShares(results: Map<string, number | null>): void {
  const csv = readFileSync(SYMBOLS_CSV_PATH, "utf-8");
  const newline = csv.includes("\r\n") ? "\r\n" : "\n";
  const [header, ...rows] = csv.trim().split(newline);

  const updatedRows = rows.map((row) => {
    const columns = row.split(",");
    const symbol = columns[0].trim();
    const shares = results.get(symbol);
    if (shares != null) {
      columns[1] = String(shares);
    }
    return columns.join(",");
  });

  writeFileSync(
    SYMBOLS_CSV_PATH,
    [header, ...updatedRows].join(newline) + newline,
  );
}

async function getCrumb(): Promise<{ cookie: string; crumb: string }> {
  const handshakeRes = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": USER_AGENT },
  });
  const cookie = handshakeRes.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) {
    throw new Error("Failed to obtain Yahoo session cookie");
  }

  const crumbRes = await fetch(
    "https://query1.finance.yahoo.com/v1/test/getcrumb",
    { headers: { "User-Agent": USER_AGENT, Cookie: cookie } },
  );
  const crumb = await crumbRes.text();
  if (!crumb || crumb.includes("<html")) {
    throw new Error("Failed to obtain Yahoo crumb");
  }

  return { cookie, crumb };
}

async function fetchOutstandingShares(
  symbols: string[],
  { cookie, crumb }: { cookie: string; crumb: string },
): Promise<Map<string, number | null>> {
  const results = new Map<string, number | null>();

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const yahooSymbols = batch.map((s) => `${s.toUpperCase()}${YAHOO_SUFFIX}`);

    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yahooSymbols.join(",")}&crumb=${encodeURIComponent(crumb)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Cookie: cookie },
    });
    const data = await res.json();

    if (data?.quoteResponse?.error) {
      throw new Error(
        `Yahoo API error: ${JSON.stringify(data.quoteResponse.error)}`,
      );
    }

    const quotes = data?.quoteResponse?.result ?? [];
    const bySymbol = new Map(
      quotes.map((q: { symbol: string; sharesOutstanding?: number }) => [
        q.symbol,
        q.sharesOutstanding ?? null,
      ]),
    );

    for (const symbol of batch) {
      const yahooSymbol = `${symbol.toUpperCase()}${YAHOO_SUFFIX}`;
      results.set(symbol, (bySymbol.get(yahooSymbol) as number | null) ?? null);
    }
  }

  return results;
}

async function main() {
  const argSymbols = process.argv.slice(2);
  const symbols = argSymbols.length > 0 ? argSymbols : readSymbolsFromCsv();

  console.log(`Fetching outstandingShares for ${symbols.length} symbol(s)...`);

  const { cookie, crumb } = await getCrumb();
  const results = await fetchOutstandingShares(symbols, { cookie, crumb });

  const notFound = symbols.filter((s) => results.get(s) == null);
  if (notFound.length > 0) {
    console.warn(
      `\nCould not resolve outstandingShares for: ${notFound.join(", ")} (left untouched in the CSV)`,
    );
  }

  updateCsvWithShares(results);
  console.log(`\nUpdated ${SYMBOLS_CSV_PATH}`);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
