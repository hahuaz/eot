/**
 * Full, self-contained pipeline for BDDK-regulated "finansman şirketi"
 * companies (factoring / leasing / consumer-finance / savings-finance
 * firms, pdf_type "finance" - e.g. ktlev). Deliberately doesn't share
 * label/token parsing or the matching loop with general.ts/bank.ts/
 * insurance.ts - see general.ts's doc comment for why. Finance-only quirks
 * live entirely in this file's own splitLabelAndTokens/processPdfFile:
 *  - Every row is numbered with roman numerals ("ı.", "xıv."), and totals
 *    restate their own derivation in a trailing parenthetical that can
 *    elide a run of referenced rows with an ellipsis instead of spelling
 *    each one out ("net faaliyet k/z (v+…+vııı)") - both stripped here
 *    directly.
 *  - Balance-sheet rows (equity, total assets) carry the same 6 trailing
 *    TP | YP | Toplam × current/prior columns as banks, so the
 *    balance-sheet column index is fixed at -4 rather than auto-detected.
 *  - A row's trailing value can be a "--" placeholder instead of a real
 *    number, which - if not treated as a value-column boundary - gets
 *    swallowed straight into the label and silently breaks that row's own
 *    matching (see isPlaceholderToken).
 */
import fs from "fs";
import path from "path";
import { financeSections } from "../sections/finance";
import { SectionsConfig } from "../sections/types";
import {
  QuarterPaths,
  loadReportLines,
  normalizeText,
  pageNumberForLineIndex,
  printExtractionSummary,
  renderVerifyScreenshots,
  writePagesManifest,
} from "./shared";
import {
  formatSummedNumber,
  isConsistNumber,
  isValueToken,
  isZeroPlaceholder,
  mergeSplitNumberTokens,
  parseTurkishNumber,
  stripThousandsSeparators,
} from "./turkish-numbers";
import { logger } from "../lib";

/** A roman-numeral marker ("ı.", "ıv.", "xxv.") - the only enumeration-marker style this template uses. */
function isEnumerationMarker(token: string): boolean {
  return /^[ivxlcdmı]+\.$/.test(token);
}

/**
 * A single fragment of a trailing "(A+B)"-style formula recap: letters/
 * digits/"+"/"-"/"…", optionally wrapped in one leading "(" and/or trailing
 * ")". "…" covers a recap that elides a run of referenced rows instead of
 * spelling each one out (2026Q1 ktlev: "net faaliyet k/z (v+…+vııı)").
 */
function isFormulaFragment(token: string): boolean {
  return /^\(?[a-zçğıöşü0-9+\-…]+\)?$/.test(token);
}

/**
 * Reports restate a total's derivation in parens right after its label and
 * before its dipnot/value columns (2026Q1 ktlev: "dönem net karı/zararı
 * (xv+xx)"). The letters inside are just references to other rows on the
 * same page (arbitrary per line, and liable to shift if a component row is
 * ever added/removed), not descriptive content, so keyword configs
 * shouldn't have to spell them out.
 *
 * Scans backward from the label's current last token for a run of
 * isFormulaFragment tokens, stopping at the one that opens the
 * parenthetical. Requires an internal "+"/"-" among them so a genuine
 * one-word parenthetical qualifier is never mistaken for one - a real
 * recap always joins at least two row-references with an operator, a bare
 * qualifier never does. Returns the label's new last index (unchanged if
 * no recap is found).
 */
function trimTrailingFormulaRecap(
  tokens: string[],
  labelStartIndex: number,
  labelLastIndex: number,
): number {
  if (labelLastIndex < labelStartIndex) return labelLastIndex;
  if (!tokens[labelLastIndex].endsWith(")")) return labelLastIndex;

  let sawOperator = false;
  for (let i = labelLastIndex; i >= labelStartIndex; i--) {
    const token = tokens[i];
    if (!isFormulaFragment(token)) return labelLastIndex;
    if (token.includes("+") || token.includes("-")) sawOperator = true;
    if (token.startsWith("(")) {
      return sawOperator ? i - 1 : labelLastIndex;
    }
  }
  return labelLastIndex;
}

/**
 * A value-column placeholder shape, for label-boundary detection only -
 * "--" in addition to isZeroPlaceholder's "-"/"—". Deliberately NOT folded
 * into isZeroPlaceholder itself: that function's result is used to accept
 * a row as a *resolved* zero value once a keyword has already matched it,
 * and a row whose PARENT total is left blank with the real figure only
 * stated on one specific child line beneath it (2024Q1 ktlev: "esas
 * faaliyet gelirleri -- --" - see the "hasılat" schema's fallback keyword
 * in ../sections/finance.ts) needs "--" to NOT count as a confirmed zero,
 * or it'd wrongly win priority over that fallback with "0" instead of
 * falling through to it. This only needs "--" to stop the label from
 * swallowing it as label text, so the row's own sectionStartKey/keyword
 * can still find its label at all.
 */
function isPlaceholderToken(token: string): boolean {
  return isZeroPlaceholder(token) || token.trim() === "--";
}

/** Splits a line into tokens and the leading "label" portion (everything before the numeric columns start). */
function splitLabelAndTokens(line: string): {
  label: string;
  tokens: string[];
} {
  const tokens = mergeSplitNumberTokens(line.trim().split(/\s+/));

  let labelStartIndex = 0;
  while (
    labelStartIndex < tokens.length &&
    isEnumerationMarker(tokens[labelStartIndex])
  ) {
    labelStartIndex++;
  }

  let labelLastIndex = labelStartIndex;
  for (let i = labelStartIndex; i <= tokens.length - 1; i++) {
    // isConsistNumber's loose digit-check never fires for a bare "--"/"-"
    // placeholder (stripping its only punctuation leaves nothing to test a
    // digit against) - without also checking isPlaceholderToken here, a row
    // whose values are all placeholders never finds its real value
    // boundary and swallows them straight into the label.
    if (!isConsistNumber(tokens[i]) && !isPlaceholderToken(tokens[i])) {
      labelLastIndex = i;
    } else {
      break;
    }
  }
  // A line can be nothing but marker(s) sitting alone, with the actual
  // label text wrapping onto the next line instead - labelStartIndex then
  // walks all the way to tokens.length, one past the last valid index, with
  // no label token left to trim a recap from. Skip the trim entirely rather
  // than indexing tokens[tokens.length] (undefined) - label ends up "" either
  // way, same as any other row with no usable label.
  if (labelStartIndex < tokens.length) {
    labelLastIndex = trimTrailingFormulaRecap(
      tokens,
      labelStartIndex,
      labelLastIndex,
    );
  }

  const label = tokens.slice(labelStartIndex, labelLastIndex + 1).join(" ");
  return { label, tokens };
}

function buildRevenueRowLabels(sections: SectionsConfig): Set<string> {
  const schema = sections.revenue.keywordSchemas.find(
    (s) => s.chosenLabel === "hasılat",
  );
  return new Set((schema?.keyword ?? []).map(normalizeText));
}

const STANDARD_COLUMN_INDEX = -2; // 4-column layout: second from the right

/** Finance-company income statements are TL-only in practice (no dual-currency layout observed), so this just needs the trailing value-column count. */
function detectValueColumnIndex(
  lines: string[],
  anchorLabels: Set<string>,
): number {
  for (const line of lines) {
    const { label, tokens } = splitLabelAndTokens(line);
    if (!anchorLabels.has(normalizeText(label))) continue;

    let valueStartIndex = null;
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (isValueToken(tokens[i])) {
        valueStartIndex = i;
      } else {
        break;
      }
    }
    // A matched anchor row can still have no real values of its own (e.g.
    // 2024Q1 ktlev: "esas faaliyet gelirleri -- --", a blank placeholder
    // row whose real figure lives on a specific child line instead - see
    // the "hasılat" schema in ../sections/finance.ts) - skip it and keep
    // looking for a later occurrence that actually carries real values,
    // rather than treating "no values found" as "0 trailing columns"
    // (valueStartIndex staying null would otherwise coerce to 0 below,
    // wrongly counting every token in the row as a value column).
    if (valueStartIndex === null) continue;

    const valueColumnCount = tokens.length - valueStartIndex;
    if (valueColumnCount < 4) return STANDARD_COLUMN_INDEX;
    return -valueColumnCount;
  }

  return STANDARD_COLUMN_INDEX;
}

const MAX_LABEL_WRAP_LINES = 3;

function matchWrappedLabel(
  lines: string[],
  startIndex: number,
  normalizedTarget: string,
): number {
  let combinedLabel = "";
  for (
    let k = 0;
    k < MAX_LABEL_WRAP_LINES && startIndex + k < lines.length;
    k++
  ) {
    const { label, tokens } = splitLabelAndTokens(lines[startIndex + k]);
    combinedLabel += normalizeText(label);
    if (combinedLabel === normalizedTarget) return k + 1;
    if (!normalizedTarget.startsWith(combinedLabel)) break;

    const labelTokenCount = label.trim() ? label.trim().split(/\s+/).length : 0;
    if (tokens.length > labelTokenCount) break;
  }
  return 0;
}

function equityKeywordsFullyResolved(
  sections: SectionsConfig,
  foundValues: Record<string, string | null>,
): boolean {
  return sections.equity.keywordSchemas.every((schema) =>
    schema.keyword.some(
      (key) => foundValues[`equity_${schema.chosenLabel}_${key}`] !== null,
    ),
  );
}

function buildSectionKeyMaps(sections: SectionsConfig): {
  sectionStartKeyMap: Record<string, string>;
  sectionEndKeyMap: Record<string, string>;
} {
  const sectionStartKeyMap: Record<string, string> = {};
  const sectionEndKeyMap: Record<string, string> = {};

  for (const [sectionName, sectionDef] of Object.entries(sections)) {
    if (!sectionDef.sectionStartKeys) continue;
    for (const sk of sectionDef.sectionStartKeys) {
      sectionStartKeyMap[normalizeText(sk)] = sectionName;
    }
    if (sectionDef.sectionEndKeys) {
      for (const ek of sectionDef.sectionEndKeys) {
        sectionEndKeyMap[normalizeText(ek)] = sectionName;
      }
    }
  }

  return { sectionStartKeyMap, sectionEndKeyMap };
}

function matchKeywordsInLines(
  sections: SectionsConfig,
  lines: string[],
  getValueIndexForSection: (sectionName: string) => number,
  sectionStartKeyMap: Record<string, string>,
  sectionEndKeyMap: Record<string, string>,
  startPage: number,
): {
  foundValues: Record<string, string | null>;
  prefixFoundValues: Record<string, string | null>;
  foundValuePages: Record<string, number>;
  prefixFoundValuePages: Record<string, number>;
} {
  const foundValues: Record<string, string | null> = {};
  const prefixFoundValues: Record<string, string | null> = {};
  for (const [sectionName, sectionDef] of Object.entries(sections)) {
    for (const schema of sectionDef.keywordSchemas) {
      for (const key of schema.keyword) {
        foundValues[`${sectionName}_${schema.chosenLabel}_${key}`] = null;
      }
      for (const prefix of sectionDef.keywordPrefixes) {
        prefixFoundValues[
          `${sectionName}_${schema.chosenLabel}_PREFIX::${prefix}`
        ] = null;
      }
    }
  }

  const foundValuePages: Record<string, number> = {};
  const prefixFoundValuePages: Record<string, number> = {};

  let currentSection = "";

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const trimmed = line.trim();
    if (!trimmed) continue;

    const { label } = splitLabelAndTokens(line);
    const normalizedLabel = normalizeText(label);

    // --- Section detection (start) ---
    const matchedStartKey = Object.keys(sectionStartKeyMap).find(
      (k) => normalizedLabel === normalizeText(k),
    );
    if (matchedStartKey !== undefined) {
      const targetSection = sectionStartKeyMap[matchedStartKey];
      const isEquityToRevenue =
        currentSection === "equity" && targetSection === "revenue";
      const allowSwitch =
        !isEquityToRevenue ||
        equityKeywordsFullyResolved(sections, foundValues);
      if (allowSwitch) {
        currentSection = targetSection;
        logger.info(`###Section START: "${currentSection}" (${trimmed})`);
      }
    }

    // --- Section detection (end) ---
    const matchedEndKey = Object.keys(sectionEndKeyMap).find(
      (k) => normalizedLabel === normalizeText(k),
    );
    const foundSectionEnding =
      matchedEndKey !== undefined ? sectionEndKeyMap[matchedEndKey] : undefined;

    // --- Keyword matching ---
    for (const [sectionName, sectionDef] of Object.entries(sections)) {
      if (currentSection !== sectionName) {
        continue;
      }
      const extractValueIndex = getValueIndexForSection(sectionName);

      for (const schema of sectionDef.keywordSchemas) {
        let lineMatched = false;
        for (const key of schema.keyword) {
          const normalizedKey = normalizeText(key);
          const uniqueKey = `${sectionName}_${schema.chosenLabel}_${key}`;
          if (foundValues[uniqueKey] !== null) continue;

          const wrapLineCount = matchWrappedLabel(
            lines,
            lineIndex,
            normalizedKey,
          );
          if (wrapLineCount === 0) continue;

          const lastWrapLineIndex = lineIndex + wrapLineCount - 1;
          const { tokens: wrapTokens } = splitLabelAndTokens(
            lines[lastWrapLineIndex],
          );
          const value = wrapTokens.at(extractValueIndex);

          if (value && (isZeroPlaceholder(value) || isValueToken(value))) {
            const resolvedValue = isZeroPlaceholder(value) ? "0" : value;
            foundValues[uniqueKey] = resolvedValue;
            const matchedLine = `MATCHED [${key}] (section: "${currentSection}"): label="${label}" val="${resolvedValue}" (full line: "${trimmed}")`;
            logger.info(matchedLine);
            foundValuePages[uniqueKey] = pageNumberForLineIndex(
              lines,
              lastWrapLineIndex,
              startPage,
            );
            lineMatched = true;
            lineIndex = lastWrapLineIndex;
            break;
          }
        }
        if (lineMatched) break;
      }

      // --- Prefixed keyword matching (finance sections never configure
      // keywordPrefixes, so this is always a no-op - kept for structural
      // parity with the other pipelines' matching loop shape) ---
      for (const prefix of sectionDef.keywordPrefixes) {
        for (const schema of sectionDef.keywordSchemas) {
          const prefixedLabel = `${prefix} ${schema.chosenLabel}`;
          const uniqueKey = `${sectionName}_${schema.chosenLabel}_PREFIX::${prefix}`;
          if (prefixFoundValues[uniqueKey] !== null) continue;

          const wrapLineCount = matchWrappedLabel(
            lines,
            lineIndex,
            normalizeText(prefixedLabel),
          );
          if (wrapLineCount === 0) continue;
          const lastWrapLineIndex = lineIndex + wrapLineCount - 1;
          const { tokens: wrapTokens } = splitLabelAndTokens(
            lines[lastWrapLineIndex],
          );

          const value = wrapTokens.at(extractValueIndex);
          if (value && (isZeroPlaceholder(value) || isValueToken(value))) {
            const resolvedValue = isZeroPlaceholder(value) ? "0" : value;
            prefixFoundValues[uniqueKey] = resolvedValue;
            logger.info(
              `MATCHED [${prefixedLabel}] (section: "${currentSection}"): label="${label}" val="${resolvedValue}" (full line: "${trimmed}")`,
            );
            prefixFoundValuePages[uniqueKey] = pageNumberForLineIndex(
              lines,
              lastWrapLineIndex,
              startPage,
            );
            lineIndex = lastWrapLineIndex;
          }
        }
      }
    }

    // finished with line. if it was section ending move to next section
    if (
      foundSectionEnding !== undefined &&
      foundSectionEnding === currentSection
    ) {
      const nextSection = (
        sections[currentSection as keyof typeof sections] as {
          nextSection?: string;
        }
      )?.nextSection;
      logger.info(
        `###Section END: "${currentSection}" (${trimmed})` +
          (nextSection ? ` -> forced chaining into "${nextSection}"` : ""),
      );
      currentSection = nextSection ?? "";
    }
  }

  return {
    foundValues,
    prefixFoundValues,
    foundValuePages,
    prefixFoundValuePages,
  };
}

function resolveValuesFromMatches(
  sections: SectionsConfig,
  foundValues: Record<string, string | null>,
  prefixFoundValues: Record<string, string | null>,
  foundValuePages: Record<string, number>,
  prefixFoundValuePages: Record<string, number>,
): {
  resolvedValues: Record<string, string>;
  labelPages: Record<string, number[]>;
} {
  const resolvedValues: Record<string, string> = {};
  const labelPages: Record<string, number[]> = {};

  for (const [sectionName, sectionDef] of Object.entries(sections)) {
    for (const schema of sectionDef.keywordSchemas) {
      let valToWrite: string | null = null;
      let valPage: number | undefined;

      for (const key of schema.keyword) {
        const uniqueKey = `${sectionName}_${schema.chosenLabel}_${key}`;
        if (foundValues[uniqueKey]) {
          valToWrite = foundValues[uniqueKey];
          valPage = foundValuePages[uniqueKey];
          break;
        }
      }

      let prefixedTotal = 0;
      const prefixPages = new Set<number>();
      for (const prefix of sectionDef.keywordPrefixes) {
        const uniqueKey = `${sectionName}_${schema.chosenLabel}_PREFIX::${prefix}`;
        const prefixedValue = prefixFoundValues[uniqueKey];
        if (prefixedValue) {
          prefixedTotal += parseTurkishNumber(prefixedValue);
          const page = prefixFoundValuePages[uniqueKey];
          if (page !== undefined) prefixPages.add(page);
        }
      }

      resolvedValues[schema.chosenLabel] =
        valToWrite ||
        (prefixedTotal !== 0 ? formatSummedNumber(prefixedTotal) : "0");

      const pages = valToWrite
        ? valPage !== undefined
          ? [valPage]
          : []
        : Array.from(prefixPages).sort((a, b) => a - b);
      if (pages.length > 0) labelPages[schema.chosenLabel] = pages;
    }
  }

  return { resolvedValues, labelPages };
}

/** Writes the final per-label values as a two-column CSV, in the same fixed row order as every other pipeline's output (finance doesn't populate the cash/debt rows, written out as "0" like any other unmatched label). */
function writeDetailedCsv(
  outputCsv: string,
  resolvedValues: Record<string, string>,
  quarter: string,
): void {
  const CSV_ROW_LABELS = [
    "nakit ve nakit benzerleri",
    "finansal yatırımlar",
    "duran finansal yatırımlar",
    "kısa vadeli borçlanmalar",
    "uzun vadeli borçlanmaların kısa vadeli kısımları",
    "kısa dönem kira yükümlülükleri",
    "uzun vadeli borçlanmalar",
    "uzun dönem kira yükümlülükleri",
    "ana ortaklığa ait özkaynaklar",
    "toplam kaynaklar",
    "hasılat",
    "esas faaliyet karı",
    "ana ortaklık payları",
  ];
  let csvOutput = `Kalem,${quarter}\n`;
  for (const label of CSV_ROW_LABELS) {
    const value = stripThousandsSeparators(resolvedValues[label] ?? "0");
    csvOutput += `${label},${value}\n`;
  }
  fs.writeFileSync(outputCsv, csvOutput);
}

const BALANCE_SHEET_VALUE_INDEX_OVERRIDE = -4;

/** Processes one finance-company PDF end to end: convert -> match -> resolve -> write CSV + verify assets. */
export async function processPdfFile(file: string, quarterPaths: QuarterPaths) {
  const {
    quarter,
    pdfDir,
    convertedDir,
    resultsDir,
    verifyPagesDir,
    verifyScreenshotsDir,
  } = quarterPaths;
  const baseName = path.parse(file).name;
  const pdfPath = path.join(pdfDir, file);
  const mdPath = path.join(convertedDir, `${baseName}.txt`);
  const outputCsv = path.join(resultsDir, `${baseName}.csv`);

  logger.info(
    `Starting basic processing for ${file} (${quarter}, pdfType=finance)`,
  );

  const { lines, startPage, firstPageWarning } = await loadReportLines(
    file,
    pdfPath,
    mdPath,
    splitLabelAndTokens,
  );
  if (firstPageWarning) {
    logger.warn(
      `${file}: page 1 contains "${firstPageWarning}" - possibly the wrong document (e.g. a faaliyet raporu instead of financial statements)`,
    );
  }

  const revenueValueIndex = detectValueColumnIndex(
    lines,
    buildRevenueRowLabels(financeSections),
  );
  const getValueIndexForSection = (sectionName: string): number =>
    sectionName === "revenue"
      ? revenueValueIndex
      : BALANCE_SHEET_VALUE_INDEX_OVERRIDE;
  const { sectionStartKeyMap, sectionEndKeyMap } =
    buildSectionKeyMaps(financeSections);
  const {
    foundValues,
    prefixFoundValues,
    foundValuePages,
    prefixFoundValuePages,
  } = matchKeywordsInLines(
    financeSections,
    lines,
    getValueIndexForSection,
    sectionStartKeyMap,
    sectionEndKeyMap,
    startPage,
  );

  const { resolvedValues, labelPages } = resolveValuesFromMatches(
    financeSections,
    foundValues,
    prefixFoundValues,
    foundValuePages,
    prefixFoundValuePages,
  );

  const pagesManifestPath = path.join(verifyPagesDir, `${baseName}.json`);
  await writePagesManifest(pagesManifestPath, labelPages);
  const allPages = Array.from(new Set(Object.values(labelPages).flat())).sort(
    (a, b) => a - b,
  );
  await renderVerifyScreenshots(
    pdfPath,
    baseName,
    allPages,
    verifyScreenshotsDir,
  );

  printExtractionSummary(file, resolvedValues);

  writeDetailedCsv(outputCsv, resolvedValues, quarter);
  logger.info(`Detailed results saved to: ${outputCsv}`);
}
