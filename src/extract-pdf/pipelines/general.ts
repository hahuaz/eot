/**
 * Full, self-contained pipeline for the general CMB/BIST template - the
 * vast majority of symbols (pdf_type null/absent). Deliberately doesn't
 * share its label/token parsing or matching loop with bank.ts/insurance.ts/
 * finance.ts, even though a lot of it looks structurally similar: this
 * template has NO enumeration markers, NO trailing formula-recap
 * parentheticals, and NO "--"-style blank-value placeholder - every one of
 * those is a BDDK/SEDDK-specific rendering quirk that would otherwise sit
 * in this file as dead conditional branches nothing here ever needs.
 * Keeping this file free of them is exactly the point: a bug in a bank-only
 * rule (e.g. the placeholder-boundary fix) can never be introduced into, or
 * accidentally break, general's matching just because they used to share a
 * function.
 *
 * Only genuinely sector-agnostic machinery (PDF conversion/discovery,
 * screenshot rendering, CSV writing, Turkish number-format parsing) comes
 * from ./shared and ./turkish-numbers - see shared.ts's own doc comment.
 */
import fs from "fs";
import path from "path";
import { generalSections } from "../sections/general";
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
  isUsableValueToken,
  isValueToken,
  isZeroPlaceholder,
  mergeSplitNumberTokens,
  parseTurkishNumber,
  parseUsableValueToken,
  stripThousandsSeparators,
} from "./turkish-numbers";
import { logger } from "../lib";

/** Splits a line into tokens and the leading "label" portion (everything before the numeric columns start) - general template has no markers or formula-recap to strip, so this is a plain number boundary scan. */
function splitLabelAndTokens(line: string): {
  label: string;
  tokens: string[];
} {
  const tokens = mergeSplitNumberTokens(line.trim().split(/\s+/));

  let labelLastIndex = 0;
  for (let i = 0; i <= tokens.length - 1; i++) {
    const clean = tokens[i]
      .replace(/\(/g, "")
      .replace(/\)/g, "")
      .replace(/-/g, "")
      .replace(/—/g, "")
      .replace(/\./g, "")
      .replace(/,/g, "")
      .replace(/%/g, "")
      .trim();
    const isConsistNumber = !!clean && /\d/.test(clean);
    if (!isConsistNumber) {
      labelLastIndex = i;
    } else {
      break;
    }
  }

  const label = tokens.slice(0, labelLastIndex + 1).join(" ");
  return { label, tokens };
}

const TL_MARKER_WORDS = new Set(["tl", "lirası", "lirasi"]);
const FX_MARKER_WORD_PREFIXES = ["dolar", "doları", "euro", "avro"];

/** Currency markers found in `text`, in reading order - see detectTlColumnOffset. */
function findCurrencyMarkers(text: string): Array<"TL" | "FX"> {
  const markers: Array<"TL" | "FX"> = [];
  for (const rawToken of text.trim().split(/\s+/)) {
    const cleanToken = rawToken.replace(/[^a-zçğıöşü]/gi, "");
    if (!cleanToken) continue;
    if (TL_MARKER_WORDS.has(cleanToken)) {
      markers.push("TL");
    } else if (FX_MARKER_WORD_PREFIXES.some((w) => cleanToken.startsWith(w))) {
      markers.push("FX");
    }
  }
  return markers;
}

// How many consecutive lines detectTlColumnOffset's wide-window fallback
// joins into one candidate header before scanning it - see that function's
// doc comment for why a single line isn't always enough.
const CURRENCY_HEADER_WINDOW = 16;

/**
 * Some dual-currency reports group columns by currency across both periods
 * (e.g. penta/pgsus: TL-current, TL-previous, USD-current, USD-previous),
 * but others interleave currency within each period (e.g. eregl:
 * USD-current, TL-current, USD-previous, TL-previous). A fixed column
 * offset can't handle both, so this reads the report's own currency-unit
 * header row (e.g. "not bin abd doları bin tl bin abd doları bin tl") and
 * returns the negative (from-the-right) index of the *first* TL marker,
 * which is always the current-period TL column regardless of layout.
 *
 * Tries a single line first (windowSize 1) - this is the original,
 * narrowest match and stays exactly as strict as before for every report
 * that already worked this way, so it can never regress one. Only if that
 * finds nothing does it retry with a wider sliding window of consecutive
 * lines joined together: the currency-unit header is sometimes spread
 * across several lines instead of sitting on one - e.g. PDFBox's HTML
 * export can turn "31 Mart 2026 Bin TL 31 Aralık 2025 Bin TL 31 Mart 2026
 * Bin USD ..." into 8 separate lines, one date or unit per line. The exact
 * `markers.length === valueColumnCount` match below is what keeps a wide
 * window safe even then: unrelated content sliding into view essentially
 * never happens to contain exactly that many currency-unit words with both
 * TL and FX present.
 *
 * Returns null:
 * - the real header not found: it needs to have exactly one marker
 * per valueColumnCount
 * - the report is TL-only
 *
 * if you wanna see example issues:
 * - 2026Q1: brsan - the currency-unit header split across lines (PDFBox),
 *   and separately a false-positive single-line match against a footnote
 *   discussing exchange rates (pre-existing, not PDFBox-specific)
 */
function detectTlColumnOffset(
  lines: string[],
  valueColumnCount: number,
): number | null {
  for (const windowSize of [1, CURRENCY_HEADER_WINDOW]) {
    for (let start = 0; start < lines.length; start++) {
      const windowText = lines.slice(start, start + windowSize).join(" ");
      // escape boilerplate (tutarlar aksi belirtilmedikçe bin türk lirası
      // ("tl")) and prose footnotes discussing exchange rates (e.g. "...1
      // euro= 51,0098 tl) ... 31 aralık 2025 ... 1 euro = 50,2859 tl..." -
      // a real header row is just dates/units, never "=" or ";", which
      // only show up in that kind of sentence - see doc comment.
      if (/tutarlar|belirtil|[=;]/.test(windowText)) continue;

      const markers = findCurrencyMarkers(windowText);
      if (
        markers.length === valueColumnCount &&
        markers.includes("TL") &&
        markers.includes("FX")
      ) {
        return -(markers.length - markers.indexOf("TL"));
      }
    }
  }
  return null;
}

/**
 * Finds the negative column index (e.g. -2) that holds the TL figure,
 * used by the rest of the matching loop to extract value.
 *
 * Balance sheet and income statement rows can have a *different* number of
 * trailing value columns within the very same report - e.g. 2025Q2 ahgaz's
 * balance sheet has 2 (current/prior), but its income statement has 4
 * (6-month-current, 3-month-current, 6-month-prior, 3-month-prior), because
 * only the income statement breaks each period into cumulative + standalone
 * quarter figures. A single document-wide index can't fit both, so this is
 * called once per anchor row type (revenue vs. balance sheet) and the
 * result applied only to that anchor's own section(s).
 *
 * Within one anchor's columns, a currency split (e.g. pgsus/eregl: TL +
 * EUR/USD side by side) can further widen the column count on top of that;
 * detectTlColumnOffset locates the TL sub-column when that's the case.
 */
function detectValueColumnIndex(
  lines: string[],
  anchorLabels: Set<string>,
): number {
  const STANDARD_COLUMN_INDEX = -2; // 4-column layout: second from the right

  for (const line of lines) {
    const { label, tokens } = splitLabelAndTokens(line);
    if (!anchorLabels.has(normalizeText(label))) continue;

    // Detect last value token index from right-to-left
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

    const tlOffset = detectTlColumnOffset(lines, valueColumnCount);
    if (tlOffset !== null) return tlOffset;

    // Reports without a readable interleaved currency header (e.g. no
    // per-column "tl"/"avro" marker row at all) group same-currency columns
    // together with TL first (see detectTlColumnOffset's doc comment), so
    // the first trailing value column is the TL one regardless of how many
    // columns there are in total - unlike a hardcoded offset, this holds
    // whether the row has 4 columns (pgsus balance sheet) or 8 (pgsus
    // income statement, which adds a quarter/cumulative split on top of the
    // currency split).
    return -valueColumnCount;
  }

  return STANDARD_COLUMN_INDEX;
}

function buildRevenueRowLabels(sections: SectionsConfig): Set<string> {
  const schema = sections.revenue.keywordSchemas.find(
    (s) => s.chosenLabel === "hasılat",
  );
  return new Set((schema?.keyword ?? []).map(normalizeText));
}

/** Anchor for balance sheet rows - "nakit ve nakit benzerleri" is the first line item of every balance sheet and is a mandatory sectionStartKey, so it's always present and always carries a real value on its own row. */
function buildBalanceSheetRowLabels(sections: SectionsConfig): Set<string> {
  const schema = sections.currentAssets?.keywordSchemas.find(
    (s) => s.chosenLabel === "nakit ve nakit benzerleri",
  );
  return new Set((schema?.keyword ?? []).map(normalizeText));
}

/** Matches a "- Label ..." bullet/detail row, as opposed to a lone "-" standing in for a missing value in a value column. */
function isDetailLine(line: string): boolean {
  return /^-\s*[a-zçğıöşü]/i.test(line.trim());
}

/**
 * Reads one "-" detail row's value, starting at `lines[index]`. Normally
 * the value sits on that same line, but the row's label can spill onto the
 * next physical line first (e.g. 2026Q1 tavhl: "- gerçeğe uygun değer farkı
 * kar / zarara yansıtılan" continues on the next line). So if the row's own line has no value, this
 * peeks at exactly one following line for it - but only if that line isn't
 * itself a new "-" row, which would mean there's no wrapped value here at
 * all. Returns the value (null if never found) and how many lines the row
 * took up (1, or 2 if the value was on the wrapped continuation line).
 */
function readDetailRowValue(
  lines: string[],
  index: number,
  extractValueIndex: number,
): { value: string | null; lineCount: number } {
  const { tokens } = splitLabelAndTokens(lines[index]);
  const ownValue = tokens.at(extractValueIndex);
  if (isUsableValueToken(ownValue)) {
    return { value: ownValue, lineCount: 1 };
  }

  const nextLine = lines[index + 1];
  if (nextLine === undefined || !nextLine.trim() || isDetailLine(nextLine)) {
    return { value: null, lineCount: 1 };
  }

  const { tokens: wrappedTokens } = splitLabelAndTokens(nextLine);
  const wrappedValue = wrappedTokens.at(extractValueIndex);
  return isUsableValueToken(wrappedValue)
    ? { value: wrappedValue, lineCount: 2 }
    : { value: null, lineCount: 1 };
}

/**
 * Some reports leave a keyword's own row blank (label only, no value) and
 * break the figure down into sub-items directly below it instead. Those
 * sub-items' own labels are arbitrary per PDF, so sum every "-" detail row
 * that follows and use that as the parent keyword's value.
 *
 * The scan ends at the first line that isn't a "-" row (and isn't a
 * wrapped continuation already accounted for) - that's the next sibling
 * keyword/label, not a detail of this one.
 *
 * if you wanna see example issues:
 * - 2026Q1: froto - uzun vadeli borçlanmaların kısa vadeli kısımları
 * - 2026Q1: tavhl - finansal yatırımlar (a detail row's label wraps onto the next line)
 */
function sumFollowingDetailLines(
  lines: string[],
  startIndex: number,
  extractValueIndex: number,
): { total: number; detailLineCount: number; lastConsumedIndex: number } {
  let total = 0;
  let detailLineCount = 0;
  let lastConsumedIndex = startIndex - 1;

  let rowIndex = startIndex;
  while (rowIndex < lines.length) {
    const line = lines[rowIndex];
    if (!line.trim()) {
      rowIndex++;
      continue;
    }
    if (!isDetailLine(line)) break;

    const { value, lineCount } = readDetailRowValue(
      lines,
      rowIndex,
      extractValueIndex,
    );
    if (value !== null) {
      total += parseUsableValueToken(value);
      detailLineCount++;
    }
    lastConsumedIndex = rowIndex + lineCount - 1;
    rowIndex += lineCount;
  }

  return { total, detailLineCount, lastConsumedIndex };
}

/** Leading-whitespace width of a raw (untrimmed) line - used by blankSummedIndentedDetailChildren to tell an indented detail row from its parent. */
function indentDepth(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Some reports print a line-item's own total on one row, then restate that
 * same figure broken down into indented sub-rows directly below it - no "-"
 * prefix, just deeper leading whitespace than the parent (as opposed to the
 * "parent has no value, sum its detail rows" case sumFollowingDetailLines
 * handles). Left alone, those sub-rows can themselves accidentally match a
 * *different* configured keyword (e.g. "banka kredileri" as an alt spelling
 * of "kısa vadeli borçlanmalar", or "kiralama işlemlerinden kaynaklanan
 * yükümlülükler" as a spelling of the lease-liabilities label), corrupting
 * an unrelated label with what's actually just a breakdown of this row.
 *
 * Only called for `lines[parentIndex]` while inside a section whose
 * allowDetailSum is true - the same gating sumFollowingDetailLines
 * respects. Without it, this pattern also shows up in e.g. the revenue
 * section's net-income split ("dönem karı" -> "-kontrol gücü olmayan
 * paylar" + "-ana ortaklık payları"), where the split-out child row *is*
 * the correct value for its own configured keyword and must not be
 * blanked.
 *
 * Detects a run of immediately-following more-indented rows whose values
 * sum back to `lines[parentIndex]`'s own value, and blanks those rows out in
 * place (rather than removing them, so every other line's index / page-marker
 * position stays intact) so the keyword-matching loop skips over them
 * entirely.
 *
 * see example issues:
 * - koton: "kısa vadeli borçlanmalar" (two of its children -
 *   "uzun vadeli borçlanmaların kısa vadeli kısımları" and "kiralama
 *   işlemlerinden kaynaklanan yükümlülükler" - are themselves configured
 *   keywords for other labels)
 * - ekgyo: "uzun vadeli borçlanmaların kısa vadeli kısımları" (one child -
 *   "banka kredileri" - is itself a configured alt-keyword for "kısa vadeli
 *   borçlanmalar")
 */
function blankSummedIndentedDetailChildren(
  lines: string[],
  parentIndex: number,
  extractValueIndex: number,
): void {
  const parentLine = lines[parentIndex];
  const parentIndent = indentDepth(parentLine);
  const ownValue = splitLabelAndTokens(parentLine).tokens.at(extractValueIndex);
  if (!isUsableValueToken(ownValue)) return;

  let total = 0;
  let detailCount = 0;
  let j = parentIndex + 1;
  while (j < lines.length) {
    const detailLine = lines[j];
    if (!detailLine.trim()) {
      j++;
      continue;
    }
    if (indentDepth(detailLine) <= parentIndent) break;

    const detailValue =
      splitLabelAndTokens(detailLine).tokens.at(extractValueIndex);
    if (!isUsableValueToken(detailValue)) break;

    total += parseUsableValueToken(detailValue);
    detailCount++;
    j++;
  }

  if (detailCount > 0 && total === parseUsableValueToken(ownValue)) {
    for (let k = parentIndex + 1; k < j; k++) {
      if (lines[k].trim()) lines[k] = "";
    }
  }
}

/**
 * A label can be long and can wrap onto a second (or third) physical line before
 * any value appears. Tries concatenating consecutive lines' labels starting at
 * `startIndex` and returns how many lines matched (0 if it never does).
 */
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

    // A genuine wrapped label's intermediate line carries nothing but the
    // label text. If this line already has trailing tokens of its own
    // (dipnot/value columns), it's a complete, distinct row that just
    // happens to share a text prefix with the target - not a continuation -
    // so don't glue the next line's label onto it (see odine 2025Q1
    // "kontrol gücü olmayan paylar" / "ana ortaklık payları": two separate
    // sibling rows, not one wrapped label).
    const labelTokenCount = label.trim() ? label.trim().split(/\s+/).length : 0;
    if (tokens.length > labelTokenCount) break;
  }
  return 0;
}

/** Builds normalizedKey -> sectionName maps used to track which section the scan is currently inside. */
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

/** Walks every line, tracks which section we're currently inside and records the first matching value for each configured keyword. */
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
  // Keyed by sectionName_label_keyword to handle duplicate keywords across sections and labels
  const foundValues: Record<string, string | null> = {};
  // Keyed by sectionName_label_PREFIX::prefix - tracked separately
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

  // Which PDF page each resolved uniqueKey's value came from - keyed the
  // same way as foundValues/prefixFoundValues, so resolveValuesFromMatches
  // can look up the page for whichever uniqueKey actually wins instead of
  // this function guessing (it doesn't know the priority-selection rules).
  const foundValuePages: Record<string, number> = {};
  const prefixFoundValuePages: Record<string, number> = {};

  let currentSection = "";
  // How many "#page-end#" markers have been seen since currentSection last
  // became "equity" - see the equity->revenue gate below.
  let pageEndsSinceEquityEntry = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === "#page-end#" && currentSection === "equity") {
      pageEndsSinceEquityEntry++;
    }

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
      // Block only the equity -> revenue switch, and only while still on
      // the very same page equity's own content is on - not (as before)
      // "until every equity keyword has resolved". A long label that wraps
      // across two physical PDFBox lines can leave its last word alone on
      // its own line (e.g. "kar veya zararda yeniden sınıflandırılmayacak
      // birikmiş diğer kapsamlı" / "gelirler ..." - "diğer kapsamlı
      // gelirler", an equity-section other-comprehensive-income line,
      // split so "gelirler" lands by itself) - which can collide with
      // revenue's own bare "gelirler" sectionStartKey and trigger a
      // spurious early switch, well before equity's real content is done
      // (2024Q2 zrgyo: without this guard, that collision lets "net dönem
      // karı" - an unrelated equity roll-forward sub-line reached before
      // the switch - win "ana ortaklık payları" over the real income
      // statement's own "dönem karı" row that appears later). The real
      // income statement always starts on a later page than equity's own
      // table (they're never printed on the same page in this template),
      // so requiring at least one "#page-end#" since entering "equity"
      // blocks that same-page false trigger.
      const allowSwitch = !isEquityToRevenue || pageEndsSinceEquityEntry > 0;
      if (allowSwitch) {
        currentSection = targetSection;
        if (targetSection === "equity") pageEndsSinceEquityEntry = 0;
        logger.info(`###Section START: "${currentSection}" (${trimmed})`);
      }
    }

    // --- Section detection (end) ---
    const matchedEndKey = Object.keys(sectionEndKeyMap).find(
      (k) => normalizedLabel === normalizeText(k),
    );
    const foundSectionEnding =
      matchedEndKey !== undefined ? sectionEndKeyMap[matchedEndKey] : undefined;

    // --- Blank indented detail rows that just restate this row's own total,
    // so they can't later be mistaken for a standalone keyword row.
    if (
      currentSection &&
      sections[currentSection as keyof typeof sections]?.allowDetailSum
    ) {
      blankSummedIndentedDetailChildren(
        lines,
        lineIndex,
        getValueIndexForSection(currentSection),
      );
    }

    // --- Keyword matching ---
    for (const [sectionName, sectionDef] of Object.entries(sections)) {
      // Only match a section's keywords while we're inside that section.
      if (currentSection !== sectionName) {
        continue;
      }
      const extractValueIndex = getValueIndexForSection(sectionName);

      for (const schema of sectionDef.keywordSchemas) {
        // one line can belong to one label. if line matched break outer as well.
        let lineMatched = false;
        for (const key of schema.keyword) {
          const normalizedKey = normalizeText(key);
          const uniqueKey = `${sectionName}_${schema.chosenLabel}_${key}`;
          if (foundValues[uniqueKey] !== null) continue;

          // A keyword's label can itself wrap across lines before any value
          // appears - so this always goes through matchWrappedLabel rather
          // than a plain same-line equality check (wrapLineCount is 1 for
          // the common, non-wrapped case).
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

          // isValueToken guards against lines like "özkaynaklar 19" where the keyword is used as section and should be ignored
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
          } else {
            // Found keyword but no value on its own row - try summing its detail rows instead

            if (!sectionDef.allowDetailSum) break;

            const { total, detailLineCount, lastConsumedIndex } =
              sumFollowingDetailLines(
                lines,
                lastWrapLineIndex + 1,
                extractValueIndex,
              );

            // if conditions are not met, don't write a bogus "0", so a later line can still resolve it normally.
            if (detailLineCount > 0 && total !== 0) {
              const summedValue = formatSummedNumber(total);
              foundValues[uniqueKey] = summedValue;
              const matchedLine = `MATCHED [${key}] (section: "${currentSection}"): label="${label}" val="${summedValue}" (summed ${detailLineCount} detail row(s) below: "${trimmed}")`;
              logger.info(matchedLine);
              foundValuePages[uniqueKey] = pageNumberForLineIndex(
                lines,
                lastWrapLineIndex,
                startPage,
              );
              lineMatched = true;
              lineIndex = lastConsumedIndex;
              break;
            }
          }
        }
        if (lineMatched) break;
      }

      // --- Prefixed keyword matching ---
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
            const matchedLine = `MATCHED [${prefixedLabel}] (section: "${currentSection}"): label="${label}" val="${resolvedValue}" (full line: "${trimmed}")`;
            logger.info(matchedLine);
            prefixFoundValuePages[uniqueKey] = pageNumberForLineIndex(
              lines,
              lastWrapLineIndex,
              startPage,
            );
            lineIndex = lastWrapLineIndex;
            continue;
          }

          if (!sectionDef.allowDetailSum) continue;

          const { total, detailLineCount, lastConsumedIndex } =
            sumFollowingDetailLines(
              lines,
              lastWrapLineIndex + 1,
              extractValueIndex,
            );
          if (detailLineCount > 0 && total !== 0) {
            const summedValue = formatSummedNumber(total);
            prefixFoundValues[uniqueKey] = summedValue;
            const matchedLine = `MATCHED [${prefixedLabel}] (section: "${currentSection}"): label="${label}" val="${summedValue}" (summed ${detailLineCount} detail row(s) below: "${trimmed}")`;
            logger.info(matchedLine);
            prefixFoundValuePages[uniqueKey] = pageNumberForLineIndex(
              lines,
              lastWrapLineIndex,
              startPage,
            );
            lineIndex = lastConsumedIndex;
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

/**
 * For each configured chosenLabel, picks its first matched keyword's value.
 * If there is no matched keyword value, falls back to the sum of its
 * prefixed rows instead.
 *
 * Why fall back instead of always adding both? Reports use the prefixed
 * rows one of two ways:
 * 1. Some (2026Q1: selec, tcell) print the keyword's own row already
 *    holding the full total, with the prefixed rows underneath just
 *    re-stating that same total - adding those on top of the bare value
 *    would double-count it.
 * 2. Others (2026Q1: ttrak, ttkom) print the keyword's own row with no
 *    value at all, reporting the total only as the sum of the prefixed
 *    rows - there, adding them together is the only way to get the total.
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
  // Which PDF page(s) back each label's resolved value, for verify.html to
  // show next to the right screenshot instead of one long table above all
  // of them. A bare match has exactly one page; a summed prefix match can
  // span as many pages as it has prefixes (usually just one in practice).
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

/**
 * Hand-verified corrections for specific general-template PDFs whose
 * layout didn't parse cleanly through the normal keyword scan above - a
 * broken font with no ToUnicode mapping, a scanned image with no text
 * layer at all, or (paseu) a report that swaps this template's usual
 * labeling convention in a way no generic keyword rule can safely
 * accommodate without risking a wrong match elsewhere in the corpus (see
 * that entry's own comment) - none of these are something a keyword rule
 * could fix generically. Mutates `resolvedValues` in place.
 */
function applyManualCorrections(
  baseName: string,
  quarter: string,
  resolvedValues: Record<string, string>,
): void {
  // data extraction part for this pdf is either image or wrong encoding.
  if (baseName === "penta" && quarter === "2024Q4") {
    resolvedValues["nakit ve nakit benzerleri"] = "605.986.534";
    resolvedValues["finansal yatırımlar"] = "0";
    resolvedValues["duran finansal yatırımlar"] = "0";
    resolvedValues["kısa vadeli borçlanmalar"] = "24.589.275";
    resolvedValues["uzun vadeli borçlanmaların kısa vadeli kısımları"] = "0";
    resolvedValues["kısa dönem kira yükümlülükleri"] = "24.589.275";
    resolvedValues["uzun vadeli borçlanmalar"] = "53.216.099";
    resolvedValues["uzun dönem kira yükümlülükleri"] = "53.216.099";
    resolvedValues["ana ortaklığa ait özkaynaklar"] = "3.402.444.337";
    resolvedValues["toplam kaynaklar"] = "9.771.878.150";
    resolvedValues["hasılat"] = "23.939.917.137";
    resolvedValues["esas faaliyet karı"] = "788.058.568";
    resolvedValues["ana ortaklık payları"] = "339.818.960";
  }

  // This report's pdf structure is broken: it swaps the meaning of
  // "toplam kaynaklar" and "toplam yükümlülükler".
  if (baseName === "paseu" && quarter === "2024Q4") {
    resolvedValues["toplam kaynaklar"] = "2.969.016.083";
  }

  // this pdf is broken. it has no ToUnicode mapping.
  if (baseName === "bsoke" && quarter === "2025Q2") {
    resolvedValues["nakit ve nakit benzerleri"] = "2.613.490";
    resolvedValues["kısa vadeli borçlanmalar"] = "444.096";
    resolvedValues["uzun vadeli borçlanmaların kısa vadeli kısımları"] =
      "460.301";
    resolvedValues["uzun vadeli borçlanmalar"] = "1.842.382";
    resolvedValues["ana ortaklığa ait özkaynaklar"] = "11.547.941";
    resolvedValues["toplam kaynaklar"] = "15.489.463";
    resolvedValues["hasılat"] = "2.613.490";
    resolvedValues["esas faaliyet karı"] = "(77.912)";
    resolvedValues["ana ortaklık payları"] = "344.063";
  }

  /**
   * label line comes after value:
   * 2.211.953.801  1.919.620.101
   * toplam kaynaklar
   */
  if (baseName === "kfein" && quarter === "2025Q4") {
    resolvedValues["toplam kaynaklar"] = "2.211.953.801";
  }

  // the given pdf is image
  if (baseName === "kimmr" && quarter === "2025Q4") {
    resolvedValues["nakit ve nakit benzerleri"] = "1.460.923.163";
    resolvedValues["finansal yatırımlar"] = "608.882";
    resolvedValues["duran finansal yatırımlar"] = "0";
    resolvedValues["kısa vadeli borçlanmalar"] = "301.325.302";
    resolvedValues["uzun vadeli borçlanmaların kısa vadeli kısımları"] =
      "6.073.814";
    resolvedValues["kısa dönem kira yükümlülükleri"] = "269.893.744";
    resolvedValues["uzun vadeli borçlanmalar"] = "0";
    resolvedValues["uzun dönem kira yükümlülükleri"] = "1.555.031.699";
    resolvedValues["ana ortaklığa ait özkaynaklar"] = "4.377.841.509";
    resolvedValues["toplam kaynaklar"] = "9.011.978.714";
    resolvedValues["hasılat"] = "13.983.809.841";
    resolvedValues["esas faaliyet karı"] = "117.032.662";
    resolvedValues["ana ortaklık payları"] = "650.808.229";
  }

  // the given pdf is image
  if (baseName === "marbl" && quarter === "2025Q2") {
    resolvedValues["nakit ve nakit benzerleri"] = "60.001.656";
    resolvedValues["finansal yatırımlar"] = "0";
    resolvedValues["duran finansal yatırımlar"] = "0";
    resolvedValues["kısa vadeli borçlanmalar"] = "316.529.570";
    resolvedValues["uzun vadeli borçlanmaların kısa vadeli kısımları"] =
      "114.668.611";
    resolvedValues["uzun vadeli borçlanmalar"] = "371.206.380";
    resolvedValues["ana ortaklığa ait özkaynaklar"] = "2.444.443.836";
    resolvedValues["toplam kaynaklar"] = "4.084.072.806";
    resolvedValues["hasılat"] = "802.181.160";
    resolvedValues["esas faaliyet karı"] = "51.730.291";
    resolvedValues["ana ortaklık payları"] = "57.031.821";
  }
}

/** Writes the final per-label values as a two-column CSV. */
function writeDetailedCsv(
  outputCsv: string,
  resolvedValues: Record<string, string>,
  quarter: string,
): void {
  let csvOutput = `Kalem,${quarter}\n`;
  for (const sectionDef of Object.values(generalSections)) {
    for (const schema of sectionDef.keywordSchemas) {
      const value = stripThousandsSeparators(
        resolvedValues[schema.chosenLabel] ?? "0",
      );
      csvOutput += `${schema.chosenLabel},${value}\n`;
    }
  }
  fs.writeFileSync(outputCsv, csvOutput);
}

/** Processes one general-template PDF end to end: convert -> match -> resolve -> write CSV + verify assets. */
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
    `Starting basic processing for ${file} (${quarter}, pdfType=normal)`,
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

  const balanceSheetValueIndex = detectValueColumnIndex(
    lines,
    buildBalanceSheetRowLabels(generalSections),
  );
  const revenueValueIndex = detectValueColumnIndex(
    lines,
    buildRevenueRowLabels(generalSections),
  );
  // Revenue is the only section whose value columns come from the income
  // statement; every other configured section lives on the balance sheet.
  //
  // This resolves to the leftmost (current-year, cumulative year-to-date)
  // value column, same as every other section - not the standalone-quarter
  // figure. Reports order their other 3 columns (prior-year YTD,
  // current/prior standalone quarter) inconsistently between templates
  // (grouped by period-type vs. by year), but every report seen puts
  // current-year YTD first regardless. The standalone-quarter figure (YTD -
  // previous quarter's YTD) is derived downstream from these saved YTD
  // values when pushed to the db, not here.
  const getValueIndexForSection = (sectionName: string): number =>
    sectionName === "revenue" ? revenueValueIndex : balanceSheetValueIndex;
  const { sectionStartKeyMap, sectionEndKeyMap } =
    buildSectionKeyMaps(generalSections);
  const {
    foundValues,
    prefixFoundValues,
    foundValuePages,
    prefixFoundValuePages,
  } = matchKeywordsInLines(
    generalSections,
    lines,
    getValueIndexForSection,
    sectionStartKeyMap,
    sectionEndKeyMap,
    startPage,
  );

  const { resolvedValues, labelPages } = resolveValuesFromMatches(
    generalSections,
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

  applyManualCorrections(baseName, quarter, resolvedValues);
  printExtractionSummary(file, resolvedValues);

  writeDetailedCsv(outputCsv, resolvedValues, quarter);
  logger.info(`Detailed results saved to: ${outputCsv}`);
}
