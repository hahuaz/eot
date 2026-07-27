import { SectionsConfig } from "./types";

/**
 * BDDK-regulated "finansman şirketi" companies (factoring / leasing /
 * consumer-finance / savings-finance firms - e.g. ktlev, a savings-finance
 * company) file under their own chart of accounts - not a variant of ./bank
 * despite sharing the same regulator: different line-item vocabulary
 * entirely ("esas faaliyet gelirleri" instead of "faiz gelirleri", "net
 * faaliyet k/z" instead of "net faaliyet kârı/zararı", "varlık toplamı"/
 * "yükümlülük toplamı" instead of "varlıklar toplamı"/"yükümlülükler
 * toplamı" - singular vs. plural, so these don't even normalize to the same
 * string). So this doesn't build on bank.ts at all, same reasoning as
 * bank/insurance not building on ./general.
 *
 * Shares two of bank.ts's structural quirks, both handled the same way
 * outside this file (see extract-financial-values.ts):
 *  - Balance-sheet rows (equity, total assets) carry the same 6 trailing
 *    TP | YP | Toplam × current/prior columns as banks - see
 *    PDF_TYPE_CONFIGS's balanceSheetValueIndexOverride in ./index.
 *  - Every row is numbered with roman numerals ("ı.", "xıv."), and totals
 *    restate their own derivation in a trailing parenthetical ("dönem net
 *    karı/zararı (xv+xx)") - both stripped generically by
 *    isEnumerationMarker/trimTrailingFormulaRecap.
 */
export const financeSections: SectionsConfig = {
  equity: {
    sectionStartKeys: ["özkaynaklar", "varlık toplamı", "yükümlülük toplamı"],
    // Each of the above is a single-row total, not the start of a
    // multi-row section - closing the section on the very same keys keeps
    // every row above independent of one another.
    sectionEndKeys: ["özkaynaklar", "varlık toplamı", "yükümlülük toplamı"],
    allowDetailSum: false,
    keywordPrefixes: [],
    keywordSchemas: [
      {
        chosenLabel: "ana ortaklığa ait özkaynaklar",
        keyword: ["özkaynaklar"],
      },
      {
        // "yükümlülük toplamı" here is genuinely the combined
        // liabilities+equity total (verified against 2026Q1 ktlev: equals
        // "varlık toplamı" exactly, 56.679.474.844), same as banks' own
        // "yükümlülükler toplamı" - see bank.ts's note on this.
        chosenLabel: "toplam kaynaklar",
        keyword: ["varlık toplamı", "yükümlülük toplamı"],
      },
    ],
  },
  revenue: {
    sectionStartKeys: [
      "esas faaliyet gelirleri",
      "net faaliyet k/z",
      "ana ortaklığa ait kar/zarar",
    ],
    sectionEndKeys: ["#page-end#"],
    allowDetailSum: false,
    keywordPrefixes: [],
    keywordSchemas: [
      {
        chosenLabel: "hasılat",
        keyword: ["esas faaliyet gelirleri"],
      },
      {
        // The operating-result line that already nets in funding costs,
        // opex, other operating income/expense and provisions (2026Q1
        // ktlev: "ıx. net faaliyet k/z (v+…+vııı)") - the closest analog to
        // "esas faaliyet karı", same reasoning as bank.ts choosing "net
        // faaliyet kârı/zararı" over the earlier, narrower "brüt faaliyet
        // k/z" subtotal.
        chosenLabel: "esas faaliyet karı",
        keyword: ["net faaliyet k/z"],
      },
      {
        chosenLabel: "ana ortaklık payları",
        // Plain, unnumbered row directly under "dönem net karı/zararı"
        // (the consolidated total including non-controlling interest) -
        // "ana ortaklığa ait kar/zarar" is specifically the parent-only
        // split-out (2026Q1 ktlev: 3.361.411.828, matching equity's own
        // "dönem net kâr veya zararı" line exactly).
        keyword: ["ana ortaklığa ait kar/zarar"],
      },
    ],
  },
};
