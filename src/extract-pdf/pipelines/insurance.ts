/**
 * Full, self-contained pipeline for insurers (SEDDK-regulated, pdf_type
 * "insurance" - agesa, anhyt, ansgr, raysg, tursg, ...). Deliberately
 * doesn't share label/token parsing or the matching loop with
 * general.ts/bank.ts/finance.ts - see general.ts's doc comment for why.
 * Insurance-only quirks live entirely in this file:
 *  - Rows are numbered with digit ("1-"), letter ("j-"), or roman-numeral
 *    ("ı.") markers depending on the section, and a marker can end up
 *    glued directly onto the label's first word with no space at all (see
 *    stripGluedLetterMarker) - a PDFBox rendering quirk.
 *  - Totals restate their own derivation in a trailing parenthetical using
 *    either an ASCII "-" or an en dash "–" as the subtraction operator (see
 *    isFormulaFragment).
 *  - Premiums are split per business segment (hayat dışı / hayat), each its
 *    own repeat of the same row text, and need summing rather than
 *    first-match-wins (see KeywordSchema.sumAllMatches on "hasılat").
 *  - Some annual reports never state a combined "genel teknik bölüm
 *    dengesi" total and only print one row per segment instead, needing a
 *    sum-of-fallback-keywords reconstruction (see
 *    KeywordSchema.sumFallbackKeywords on "esas faaliyet karı").
 *  - Some annual reports also never restate net income within the income
 *    statement itself, only once inside the equity roll-forward's
 *    current-period-profit line - insurance.ts's equity section defines
 *    "ana ortaklık payları" a second time there as a fallback source (see
 *    resolveValuesFromMatches's cross-section clobber guard).
 */
import fs from "fs";
import path from "path";
import { insuranceSections } from "../sections/insurance";
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

/**
 * A leading enumeration marker: a digit-group marker like "1-", "2-", "10-",
 * "1.1-"; a single-letter marker like "a-", "b-", "j-", "n-"; or a
 * roman-numeral marker like "ı.", "ıv.", "xxv." - SEDDK reports prefix
 * every single line item with one of these ("a- nakit ve nakit benzeri
 * varlıklar", "1- kazanılmış primler ...", "j- genel teknik bölüm dengesi
 * ...", "ı. faiz gelirleri ...").
 *
 * The digit form needs stripping from the label entirely: a bare digit
 * token is otherwise indistinguishable from a real number to the
 * label-boundary scan below, which would stop dead at position 0 and
 * collapse the whole label to just "1-".
 *
 * The letter and roman-numeral forms don't hit that bug (they contain no
 * digit, so the boundary scan already runs past them fine either way) -
 * but they're still stripped here, otherwise they stay glued onto the
 * front of the label and every configured keyword for these rows would
 * have to spell out its specific marker too, which isn't stable to depend
 * on (an unrelated line item being added/removed by the regulator would
 * shift every subsequent marker).
 */
function isEnumerationMarker(token: string): boolean {
  return (
    /^(\d+(\.\d+)*|[a-zçğıöşü])-$/.test(token) || /^[ivxlcdmı]+\.$/.test(token)
  );
}

const GLUED_LETTER_MARKER_RE = /^[a-zçğıöşü]-(\S.+)$/;

/**
 * A single-letter marker glued directly onto the label's first word with no
 * space (e.g. 2025Q4 tursg/ansgr: "f-dönem net karı..." instead of the usual
 * "f- dönem net karı..." with a space) - a PDFBox rendering quirk where the
 * source PDF draws the marker and the label right up against each other.
 * isEnumerationMarker only recognizes a marker as its own standalone token,
 * so this handles the glued case as a fallback, given only the label's
 * first token (once isEnumerationMarker's own loop has already run out).
 */
function stripGluedLetterMarker(token: string): string {
  const match = token.match(GLUED_LETTER_MARKER_RE);
  return match ? match[1] : token;
}

/**
 * A single fragment of a trailing "(A-B)"/"(C+F+I)"-style formula recap:
 * only letters/digits/"+"/"-"/"–", optionally wrapped in one leading "("
 * and/or trailing ")". Matches both a whole recap rendered as one dense
 * token ("(c+f+ı)") and a single piece of one rendered with spaces around
 * its operator ("(ı", "+", "ıı)", or "(a", "–", "b)"). "–" (en dash, not the
 * ASCII hyphen "-") covers insurers that render the subtraction operator as
 * one (2025Q4 ansgr/anhyt: "teknik bölüm dengesi- hayat dışı (a – b)").
 */
function isFormulaFragment(token: string): boolean {
  return /^\(?[a-zçğıöşü0-9+\-–]+\)?$/.test(token);
}

/**
 * Reports often restate a total's derivation in parens right after its
 * label and before its dipnot/value columns (tursg "genel teknik bölüm
 * dengesi (c+f+ı)", agesa "varlıklar toplamı (ı + ıı)" - note the spaces,
 * splitting this one into 3 tokens instead of 1). The letters inside are
 * just references to other rows on the same page (arbitrary per line, and
 * liable to shift if a component row is ever added/removed), not
 * descriptive content, so keyword configs shouldn't have to spell them
 * out.
 *
 * Scans backward from the label's current last token for a run of
 * isFormulaFragment tokens, stopping at the one that opens the
 * parenthetical. Requires an internal "+"/"-"/"–" among them so a genuine
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
    if (token.includes("+") || token.includes("-") || token.includes("–"))
      sawOperator = true;
    if (token.startsWith("(")) {
      return sawOperator ? i - 1 : labelLastIndex;
    }
  }
  return labelLastIndex;
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
  if (labelStartIndex < tokens.length) {
    tokens[labelStartIndex] = stripGluedLetterMarker(tokens[labelStartIndex]);
  }

  let labelLastIndex = labelStartIndex;
  for (let i = labelStartIndex; i <= tokens.length - 1; i++) {
    if (!isConsistNumber(tokens[i])) {
      labelLastIndex = i;
    } else {
      break;
    }
  }
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

/** Insurance statements have no dual-currency layout observed, so this just needs the trailing value-column count. */
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
    // A matched anchor row can still have no real values of its own (a
    // blank placeholder row) - skip it and keep looking for a later
    // occurrence that actually carries real values, rather than treating
    // "no values found" as "0 trailing columns" (valueStartIndex staying
    // null would otherwise coerce to 0 below, wrongly counting every
    // token in the row as a value column).
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
      if (schema.sumFallbackKeywords) {
        foundValues[`${sectionName}_${schema.chosenLabel}_FALLBACK`] = null;
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
          // sumAllMatches schemas (e.g. "hasılat") deliberately keep
          // matching every later occurrence of this same key instead of
          // stopping at the first - see KeywordSchema.sumAllMatches.
          if (!schema.sumAllMatches && foundValues[uniqueKey] !== null)
            continue;

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
            if (schema.sumAllMatches) {
              // Insurers split "kazanılmış primler" across business
              // segments (hayat dışı / hayat), each its own repeat of this
              // same row - accumulate rather than overwrite, so both
              // segments count (2026Q1 agesa: both segments non-trivial;
              // anhyt: life segment ~13x the non-life one, previously
              // silently dropped by first-match-wins).
              const priorTotal = foundValues[uniqueKey]
                ? parseTurkishNumber(foundValues[uniqueKey]!)
                : 0;
              foundValues[uniqueKey] = formatSummedNumber(
                priorTotal + parseTurkishNumber(resolvedValue),
              );
            } else {
              foundValues[uniqueKey] = resolvedValue;
            }
            const matchedLine = `MATCHED [${key}] (section: "${currentSection}"): label="${label}" val="${foundValues[uniqueKey]}" (full line: "${trimmed}")`;
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

      // --- Prefixed keyword matching (insurance sections never configure
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

      // --- Fallback-sum keyword matching (see KeywordSchema.sumFallbackKeywords) ---
      // Always scanned, whether or not the schema's primary `keyword` list
      // ends up resolving - resolveValuesFromMatches only uses this
      // accumulator when the primary list never resolves, so there's no
      // double-counting risk if a report happens to have both.
      for (const schema of sectionDef.keywordSchemas) {
        if (!schema.sumFallbackKeywords) continue;
        const fallbackKey = `${sectionName}_${schema.chosenLabel}_FALLBACK`;

        for (const key of schema.sumFallbackKeywords) {
          const wrapLineCount = matchWrappedLabel(
            lines,
            lineIndex,
            normalizeText(key),
          );
          if (wrapLineCount === 0) continue;

          const lastWrapLineIndex = lineIndex + wrapLineCount - 1;
          const { tokens: wrapTokens } = splitLabelAndTokens(
            lines[lastWrapLineIndex],
          );
          const value = wrapTokens.at(extractValueIndex);
          if (!value || !(isZeroPlaceholder(value) || isValueToken(value)))
            continue;

          const resolvedValue = isZeroPlaceholder(value) ? "0" : value;
          const priorTotal = foundValues[fallbackKey]
            ? parseTurkishNumber(foundValues[fallbackKey]!)
            : 0;
          foundValues[fallbackKey] = formatSummedNumber(
            priorTotal + parseTurkishNumber(resolvedValue),
          );
          logger.info(
            `MATCHED [fallback:${key}] (section: "${currentSection}"): label="${label}" val="${foundValues[fallbackKey]}" (full line: "${trimmed}")`,
          );
          foundValuePages[fallbackKey] = pageNumberForLineIndex(
            lines,
            lastWrapLineIndex,
            startPage,
          );
          lineIndex = lastWrapLineIndex;
          break;
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

/**
 * For each configured chosenLabel, picks its first matched keyword's value,
 * falling back (in order) to its sumFallbackKeywords accumulator, then to
 * the sum of its prefixed rows.
 */
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

      // Priority lookup: first keyword that resolved wins
      for (const key of schema.keyword) {
        const uniqueKey = `${sectionName}_${schema.chosenLabel}_${key}`;
        if (foundValues[uniqueKey]) {
          valToWrite = foundValues[uniqueKey];
          valPage = foundValuePages[uniqueKey];
          break;
        }
      }

      // No keyword resolved, but a sumFallbackKeywords accumulator did -
      // e.g. insurers whose annual report never states a combined "genel
      // teknik bölüm dengesi" total and only prints one row per business
      // segment instead.
      if (!valToWrite && schema.sumFallbackKeywords) {
        const fallbackKey = `${sectionName}_${schema.chosenLabel}_FALLBACK`;
        if (foundValues[fallbackKey]) {
          valToWrite = foundValues[fallbackKey];
          valPage = foundValuePages[fallbackKey];
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

      const newValue =
        valToWrite ||
        (prefixedTotal !== 0 ? formatSummedNumber(prefixedTotal) : "0");

      // A chosenLabel can be defined in two different sections, one as a
      // fallback source for the other ("ana ortaklık payları": revenue's
      // own income-statement row is the primary source, but some annual
      // reports never restate net income there and only print it once,
      // inside the equity roll-forward's current-period-profit line -
      // equity defines the same chosenLabel there as a fallback). Sections
      // resolve in object-key order, so don't let a later section's
      // unmatched "0" default clobber an earlier section's already-
      // resolved value for the same chosenLabel.
      const alreadyResolved =
        resolvedValues[schema.chosenLabel] !== undefined &&
        resolvedValues[schema.chosenLabel] !== "0";
      if (alreadyResolved && newValue === "0") continue;

      resolvedValues[schema.chosenLabel] = newValue;

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

/** Writes the final per-label values as a two-column CSV, in the same fixed row order as every other pipeline's output (insurance doesn't populate the cash/debt rows, written out as "0" like any other unmatched label). */
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

/** Processes one insurer PDF end to end: convert -> match -> resolve -> write CSV + verify assets. */
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
    `Starting basic processing for ${file} (${quarter}, pdfType=insurance)`,
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

  // No balance-sheet anchor exists (insurance has no currentAssets
  // section), so this always falls through to detectValueColumnIndex's own
  // STANDARD_COLUMN_INDEX default - matches how the shared engine used to
  // behave for insurance before this pipeline split.
  const balanceSheetValueIndex = detectValueColumnIndex(lines, new Set());
  const revenueValueIndex = detectValueColumnIndex(
    lines,
    buildRevenueRowLabels(insuranceSections),
  );
  const getValueIndexForSection = (sectionName: string): number =>
    sectionName === "revenue" ? revenueValueIndex : balanceSheetValueIndex;
  const { sectionStartKeyMap, sectionEndKeyMap } =
    buildSectionKeyMaps(insuranceSections);
  const {
    foundValues,
    prefixFoundValues,
    foundValuePages,
    prefixFoundValuePages,
  } = matchKeywordsInLines(
    insuranceSections,
    lines,
    getValueIndexForSection,
    sectionStartKeyMap,
    sectionEndKeyMap,
    startPage,
  );

  const { resolvedValues, labelPages } = resolveValuesFromMatches(
    insuranceSections,
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
