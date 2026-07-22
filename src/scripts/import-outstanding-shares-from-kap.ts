/**
 * Scrapes KAP (Kamuyu Aydınlatma Platformu, Turkey's official public
 * disclosure platform) for every listed company's outstanding shares and
 * updates stock_info.outstanding_shares for our existing TR symbols - the
 * sole source for this now. It replaced Yahoo Finance's sharesOutstanding
 * field, which turned out stale for ~15 of our 81 current TR symbols when
 * cross-checked against this page (independently confirmed correct via
 * news/investor-relations sources beyond KAP itself).
 *
 * "Outstanding shares" here is read off paid-in capital (in TL), which
 * numerically equals share count since BIST nominal value is 1 TL/share
 * for every company we track (spot-checked against kboru and froto's
 * already-known-correct values - both matched exactly).
 *
 * Two KAP pages are combined since neither has both pieces alone:
 *   - https://kap.org.tr/tr/tumKalemler/kpy41_acc5_odenmis_sermaye lists
 *     every company's name + paid-in capital, but not its ticker.
 *   - https://www.kap.org.tr/tr/bist-sirketler embeds a company-title ->
 *     stockCode mapping (in a backslash-escaped JSON blob meant for client
 *     hydration, hence the unescaping below). A handful of tickers share
 *     one stockCode cell with another (e.g. "GARAN, TGB" for Garanti
 *     BBVA) - each is indexed separately.
 *
 * Usage:
 *   tsx src/scripts/import-outstanding-shares-from-kap.ts             # all TR symbols
 *   tsx src/scripts/import-outstanding-shares-from-kap.ts froto ahgaz # only these
 */
import "@/config";

import { pool } from "@/db/pool";
import {
  getOutstandingSharesMap,
  upsertStockInfo,
} from "@/db/stock-info.repository";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";
const REGION = "tr";
const SIRKETLER_URL = "https://www.kap.org.tr/tr/bist-sirketler";
const CAPITAL_URL =
  "https://kap.org.tr/tr/tumKalemler/kpy41_acc5_odenmis_sermaye";

async function fetchTickerToName(): Promise<Map<string, string>> {
  const res = await fetch(SIRKETLER_URL, {
    headers: { "User-Agent": USER_AGENT },
  });
  const html = (await res.text()).replace(/\\"/g, '"');

  const tickerToName = new Map<string, string>();
  const re =
    /"kapMemberTitle":"([^"]+)","relatedMemberTitle":"[^"]*","stockCode":"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const name = match[1].trim().toUpperCase();
    const tickers = match[2]
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    for (const ticker of tickers) {
      if (!tickerToName.has(ticker)) tickerToName.set(ticker, name);
    }
  }
  return tickerToName;
}

async function fetchNameToCapital(): Promise<Map<string, number>> {
  const res = await fetch(CAPITAL_URL, {
    headers: { "User-Agent": USER_AGENT },
  });
  const html = await res.text();

  const nameToCapital = new Map<string, number>();
  const re =
    /<a[^>]*href="\/tr\/sirket-bilgileri\/ozet\/[^"]*"[^>]*>([^<]+)<\/a><\/td><td[^>]*><div>([^<]*)<\/div><\/td>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const name = match[1].trim().toUpperCase();
    // Turkish number format: "." thousands separator, "," decimal point.
    const capital = parseFloat(match[2].replace(/\./g, "").replace(",", "."));
    if (!Number.isNaN(capital)) nameToCapital.set(name, capital);
  }
  return nameToCapital;
}

async function main() {
  const only = process.argv.slice(2).map((s) => s.toLowerCase());

  const currentShares = await getOutstandingSharesMap(REGION);
  const symbols = Object.keys(currentShares).filter(
    (symbol) => only.length === 0 || only.includes(symbol),
  );

  console.log(`Fetching KAP data for ${symbols.length} TR symbol(s)...`);
  const [tickerToName, nameToCapital] = await Promise.all([
    fetchTickerToName(),
    fetchNameToCapital(),
  ]);

  let updated = 0;
  let unchanged = 0;
  for (const symbol of symbols) {
    const name = tickerToName.get(symbol.toUpperCase());
    if (!name) {
      console.warn(
        `${symbol} - no KAP company name found for this ticker, skipping`,
      );
      continue;
    }
    const outstandingShares = nameToCapital.get(name);
    if (outstandingShares == null) {
      console.warn(
        `${symbol} (${name}) - no paid-in capital row found on KAP, skipping`,
      );
      continue;
    }

    const before = currentShares[symbol];
    if (before != null && Math.abs(before - outstandingShares) < 1) {
      unchanged++;
      continue;
    }

    await upsertStockInfo(REGION, symbol, { outstandingShares });
    console.log(
      `${symbol} (${name}) - ${before ?? "null"} -> ${outstandingShares}`,
    );
    updated++;
  }

  console.log(
    `Done. Updated ${updated}, unchanged ${unchanged}, out of ${symbols.length} symbol(s).`,
  );
  await pool.end();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
