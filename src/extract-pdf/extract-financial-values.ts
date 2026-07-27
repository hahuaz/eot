/**
 * Extracts key balance-sheet / income-statement figures from Turkish
 * quarterly financial report PDFs.
 *
 * Runs over every quarter found under local-data/extract-pdf/pdfs/ (see
 * pipelines/shared.ts's discoverQuarters) - a new quarter just needs its
 * PDFs dropped in that folder, no code change.
 *
 * This file is just the dispatcher: it fetches each symbol's pdf_type from
 * stock_info (see getPdfTypeMap) and, per task, calls the matching
 * pipeline's own processPdfFile - general/bank/insurance/finance (see
 * ./pipelines) each own a complete, independent copy of the actual label
 * parsing, keyword matching, and value resolution for their template.
 * Previously all four templates ran through one shared set of parsing
 * functions with sector-specific quirks bolted on as conditionals - that
 * became unmaintainable as more sectors were added (a bank-only formula-
 * recap rule, an insurance-only segment-sum, a finance-only placeholder
 * boundary case all living in the same low-level functions every other
 * sector's rows also passed through), so each pipeline now owns its own
 * copy instead. See pipelines/general.ts's doc comment for the full
 * reasoning, and pipelines/shared.ts for what's still genuinely
 * sector-agnostic (PDF conversion, screenshot rendering, CSV writing, the
 * concurrent task runner).
 */
import "@/config";

import { pool } from "@/db/pool";
import { getPdfTypeMap } from "@/db/stock-info.repository";
import { logger } from "./lib";
import {
  PdfTask,
  REGION,
  discoverTasks,
  ensurePdfBoxJar,
  processTasksConcurrently,
  runGenerateVerifyHtml,
} from "./pipelines/shared";
import { processPdfFile as processGeneralPdfFile } from "./pipelines/general";
import { processPdfFile as processBankPdfFile } from "./pipelines/bank";
import { processPdfFile as processInsurancePdfFile } from "./pipelines/insurance";
import { processPdfFile as processFinancePdfFile } from "./pipelines/finance";

/** Picks the pipeline matching this task's pdf_type - null/absent (the vast majority of symbols) runs the general CMB/BIST template. */
async function dispatchToPipeline(task: PdfTask): Promise<void> {
  switch (task.pdfType) {
    case "bank":
      return processBankPdfFile(task.file, task.quarterPaths);
    case "insurance":
      return processInsurancePdfFile(task.file, task.quarterPaths);
    case "finance":
      return processFinancePdfFile(task.file, task.quarterPaths);
    default:
      return processGeneralPdfFile(task.file, task.quarterPaths);
  }
}

async function runPipeline() {
  // Which sector-specific pipeline each symbol needs - fetched once, up
  // front, rather than per-file, since it's the same one DB round-trip
  // either way.
  const pdfTypeMap = await getPdfTypeMap(REGION);
  const { tasks, concurrency } = discoverTasks(pdfTypeMap);

  if (tasks.length === 0) {
    logger.info(`No PDFs to process.`);
    return;
  }

  // Resolved once here, before any concurrent task starts, so 8 PDFs
  // needing conversion at once don't each independently see the jar
  // missing and race to download it.
  await ensurePdfBoxJar();

  logger.info(
    `--- Processing ${tasks.length} PDF(s) with concurrency ${concurrency} ---`,
  );
  await processTasksConcurrently(tasks, concurrency, dispatchToPipeline);

  logger.info("--- Regenerating verify.html for all quarters ---");
  try {
    await runGenerateVerifyHtml();
  } catch (err: any) {
    logger.error("Failed to regenerate verify.html", err.message);
  }
}

runPipeline()
  .catch((err) => logger.error("Fatal error in pipeline:", err))
  .finally(() => pool.end());
