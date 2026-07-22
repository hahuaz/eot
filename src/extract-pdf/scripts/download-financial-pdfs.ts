// npx tsx src/extract-pdf/scripts/download-financial-pdfs.ts

import "@/config";

import { chromium } from "playwright";
import type { Page } from "playwright";
import path from "path";
import fs from "fs";

import { pool } from "@/db/pool";
import { getSymbols } from "@/db/stock-info.repository";
// A real fintables.com page load, once per browser page. api.fintables.com
// sits behind a Cloudflare bot check keyed off the browser's TLS/JA3
// fingerprint - Node's own fetch and even Playwright's context.request
// client get a 403 challenge page, but fetch() run inside an actual loaded
// Chromium page (via page.evaluate below) passes, and headless Chromium
// still gets challenged (needs headless: false in the browser launch).
// One navigation unlocks that page for every ticker's API call afterwards,
// not just the ticker whose URL was loaded.
const BASE_URL = "https://fintables.com";
// fintables' own period label, e.g. "2024/3" for the report whose
// period-end month is March (period-end month, not quarter number:
// 3/6/9/12 -> Q1/Q2/Q3/Q4). Split into year/month for the API call below.
const TARGET_PERIOD = "2024/12";
const [TARGET_YEAR, TARGET_MONTH] = TARGET_PERIOD.split("/");
// Local folder name for these downloads - kept separate from TARGET_PERIOD
// since that string contains "/" and would otherwise be split into nested
// "2024"/"3" directories by path.join, and separate from the shared
// QUARTER export (lib/constants.ts) since that's a different period used
// by the main extraction pipeline.
const LOCAL_QUARTER_DIR = "2024Q4";
const PDFS_DIR = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "local-data",
  "extract-pdf",
  "pdfs",
  LOCAL_QUARTER_DIR,
);

interface SheetAttachment {
  title: string;
  url: string;
}

/**
 * Collects one ticker's log lines instead of writing them straight to
 * stdout, so they can be printed as a single flush() call once this ticker
 * is done - workers still run scrapeTicker concurrently (see CONCURRENCY),
 * but each ticker's lines land on the console back-to-back instead of
 * interleaved with whichever other ticker's await happened to resolve first.
 */
function createTaskLogger(ticker: string) {
  const lines: string[] = [`\n--- Processing ${ticker} ---`];
  return {
    log: (...args: unknown[]) => lines.push(args.join(" ")),
    error: (...args: unknown[]) => lines.push(`ERROR: ${args.join(" ")}`),
    flush: () => console.log(lines.join("\n")),
  };
}

// Interim reports and activity ("faaliyet") reports are never what we want,
// regardless of which fallback tier below ends up picking the actual target
// - drop them up front so neither tier can accidentally choose one.
// Turkish text needs toLocaleLowerCase("tr") specifically: plain
// toLowerCase() turns "İ" into "i" + a combining dot-above character
// instead of a plain "i", so "FAALİYET".toLowerCase() never actually
// contains "faaliyet" as a substring.
// But tr-locale casing cuts the other way for English words: it maps plain
// ASCII "I" to dotless "ı" (not "i"), so "Interim" becomes "ınterim" under
// toLocaleLowerCase("tr") and silently stops matching the "interim" keyword
// below - checking both normalizations catches whichever casing rule the
// item's text actually needs.
const EXCLUDED_KEYWORDS = ["interim", "activity", "faaliyet", "financial"];

const PREFERRED_KEYWORDS = ["mali", "finansal", "konsolide", "spk", "bdr"];
// "tr" alone is a much weaker signal than the keywords above - it's short
// enough to turn up inside unrelated words, so it only gets tried as a
// second tier once none of those found anything, not mixed in with them.
const TR_FALLBACK_KEYWORD = "tr";

function findByKeywords(
  candidates: SheetAttachment[],
  keywords: string[],
): SheetAttachment | undefined {
  return candidates.find(({ title }) => {
    const normalizedTitle = title.toLocaleLowerCase("tr");
    return keywords.some((keyword) => normalizedTitle.includes(keyword));
  });
}

function pickAttachment(
  attachments: SheetAttachment[],
  log: (...args: unknown[]) => void,
): SheetAttachment | null {
  const candidates = attachments.filter(({ title }) => {
    const normalizedTitlePlain = title.toLowerCase();
    const normalizedTitleTr = title.toLocaleLowerCase("tr");
    const excludedKeyword = EXCLUDED_KEYWORDS.find(
      (keyword) =>
        normalizedTitlePlain.includes(keyword) ||
        normalizedTitleTr.includes(keyword),
    );
    if (excludedKeyword) {
      log(`Skipping "${excludedKeyword}" attachment: "${title}"`);
    }
    return !excludedKeyword;
  });

  const preferredMatch =
    findByKeywords(candidates, PREFERRED_KEYWORDS) ??
    findByKeywords(candidates, [TR_FALLBACK_KEYWORD]);

  if (preferredMatch) {
    log(`Found matching attachment: "${preferredMatch.title}"`);
    return preferredMatch;
  }

  if (candidates.length > 0) {
    log(
      `No "mali"/"finansal" attachment found. Using the first remaining one as fallback: "${candidates[0].title}"`,
    );
    return candidates[0];
  }

  if (attachments.length > 0) {
    log(
      `Every attachment looks like an interim or activity report - using the first one anyway.`,
    );
    return attachments[0];
  }

  return null;
}

const PDF_MAGIC = Buffer.from("%PDF");

/**
 * storage.fintables.com occasionally serves a PDF wrapped in a Java
 * ObjectOutputStream byte[] envelope (starts with the 0xACED stream magic
 * and a "[B" class descriptor) instead of the raw file - visible via
 * cf-cache-status: HIT, so it looks like a broken response got cached at
 * some point on their end. The real PDF bytes are intact right after the
 * envelope header, starting at the first "%PDF" signature.
 */
function stripJavaSerializationWrapper(buffer: Buffer): Buffer {
  if (buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    return buffer;
  }
  const magicIndex = buffer.indexOf(PDF_MAGIC);
  return magicIndex === -1 ? buffer : buffer.subarray(magicIndex);
}

async function scrapeTicker(page: Page, ticker: string) {
  const {
    log: consoleLog,
    error: consoleError,
    flush,
  } = createTaskLogger(ticker);

  try {
    const apiUrl = `https://api.fintables.com/companies/${ticker.toUpperCase()}/sheet_attachments/?year=${TARGET_YEAR}&month=${TARGET_MONTH}`;
    consoleLog(`Fetching ${apiUrl}`);

    // Run the fetch inside the page itself (see BASE_URL comment) rather
    // than page.context().request, which would hit Cloudflare's challenge.
    const listResult = await page.evaluate(async (url) => {
      const res = await fetch(url, {
        headers: { accept: "application/json, text-plain, */*" },
      });
      return { ok: res.ok, status: res.status, text: await res.text() };
    }, apiUrl);

    if (!listResult.ok) {
      consoleError(
        `Failed to fetch attachment list (${listResult.status}): ${listResult.text.slice(0, 200)}`,
      );
      return;
    }

    const attachments = JSON.parse(listResult.text) as SheetAttachment[];
    if (attachments.length === 0) {
      consoleLog(`No attachments found for ${TARGET_YEAR}/${TARGET_MONTH}.`);
      return;
    }

    const target = pickAttachment(attachments, consoleLog);
    if (!target) {
      consoleError("No attachment could be selected.");
      return;
    }

    const pdfResponse = await page.context().request.get(target.url);
    if (!pdfResponse.ok()) {
      consoleError(
        `Failed to download PDF (${pdfResponse.status()}): ${pdfResponse.statusText()}`,
      );
      return;
    }

    if (!fs.existsSync(PDFS_DIR)) {
      fs.mkdirSync(PDFS_DIR, { recursive: true });
    }
    const downloadPath = path.join(PDFS_DIR, `${ticker}.pdf`);
    const pdfBuffer = stripJavaSerializationWrapper(await pdfResponse.body());
    fs.writeFileSync(downloadPath, pdfBuffer);
    consoleLog(`Saved PDF to: ${downloadPath}`);
  } catch (error: any) {
    consoleError(`Error processing ${ticker}:`, error.message);
  } finally {
    flush();
  }
}

async function main() {
  const TICKERS = await getSymbols("tr");
  await pool.end();
  const missingTickers = TICKERS.filter(
    (ticker) => !fs.existsSync(path.join(PDFS_DIR, `${ticker}.pdf`)),
  );

  if (missingTickers.length === 0) {
    console.log("Every symbol already has a PDF - nothing to download.");
    return;
  }

  console.log(
    `${missingTickers.length}/${TICKERS.length} symbols missing a PDF - downloading those.`,
  );

  // headless: false is required - see BASE_URL comment above.
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  const CONCURRENCY = 5;
  const queue = [...missingTickers];

  async function worker() {
    const page = await context.newPage();
    // One navigation per page unlocks api.fintables.com for every ticker
    // this worker will fetch afterwards.
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

    let ticker: string | undefined;
    while ((ticker = queue.shift())) {
      await scrapeTicker(page, ticker);
    }
    await page.close();
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log("\nAll tasks finished.");
  await browser.close();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
