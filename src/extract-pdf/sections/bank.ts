import { SectionsConfig } from "./types";

/**
 * Banks (garan, ykbnk, ...) file under BDDK's own chart of accounts - not a
 * variant of the general CMB/BIST template (see ./general), so this
 * doesn't build on it at all: no currentAssets/noncurrentAssets/
 * shortDebts/longDebts keys here, since cash/debt line items aren't
 * touched yet and would only ever match nothing.
 *
 * Two structural quirks beyond the vocabulary difference, both handled
 * outside this file (see extract-financial-values.ts) rather than here:
 *  - Balance-sheet rows (equity, total assets) carry 6 trailing value
 *    columns - TP (Turkish lira) | YP (foreign currency) | Toplam, doubled
 *    for current/prior period - not the usual 2 or 4, and there's no
 *    literal "tl"/"dolar"/"euro" header word for auto-detection to find
 *    (banks label these "tp"/"yp", not spelled-out currency names). See
 *    PDF_TYPE_CONFIGS's balanceSheetValueIndexOverride in ./index.
 *  - Every row is numbered with roman numerals ("ı.", "xxv.") rather than
 *    the general template's "a-"/"1-" markers, and every total restates its
 *    own derivation in a trailing parenthetical ("net faaliyet kârı/zararı
 *    (vııı-ıx-x-xı-xıı)") - both stripped generically by
 *    isEnumerationMarker/trimTrailingFormulaRecap, so the keywords below
 *    don't have to spell out which roman-numeral rows a given total
 *    happens to sum this quarter.
 */
export const bankSections: SectionsConfig = {
  equity: {
    sectionStartKeys: [
      "özkaynaklar",
      "varlıklar toplamı",
      "yükümlülükler toplamı",
    ],
    // Each of the above is a single-row total, not the start of a
    // multi-row section - closing the section on the very same keys keeps
    // every row above independent of one another.
    sectionEndKeys: [
      "özkaynaklar",
      "varlıklar toplamı",
      "yükümlülükler toplamı",
    ],
    allowDetailSum: false,
    keywordPrefixes: [],
    keywordSchemas: [
      {
        chosenLabel: "ana ortaklığa ait özkaynaklar",
        keyword: ["özkaynaklar"],
      },
      {
        // "yükümlülükler toplamı" here is genuinely the combined
        // liabilities+equity total (verified: equals both "varlıklar
        // toplamı" and özkaynaklar+every liability line summed), not just
        // liabilities alone - BDDK's own label for it, despite the name.
        chosenLabel: "toplam kaynaklar",
        keyword: ["varlıklar toplamı", "yükümlülükler toplamı"],
      },
    ],
  },
  revenue: {
    sectionStartKeys: [
      "faiz gelirleri",
      "net faaliyet kârı/zararı",
      "dönem net karı/zararı",
    ],
    sectionEndKeys: ["#page-end#"],
    allowDetailSum: false,
    keywordPrefixes: [],
    keywordSchemas: [
      {
        chosenLabel: "hasılat",
        keyword: ["faiz gelirleri"],
      },
      {
        chosenLabel: "esas faaliyet karı",
        keyword: ["net faaliyet kârı/zararı"],
      },
      {
        chosenLabel: "ana ortaklık payları",
        keyword: ["dönem net karı/zararı"],
      },
    ],
  },
};
