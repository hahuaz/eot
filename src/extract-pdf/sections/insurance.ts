import { SectionsConfig } from "./types";

/**
 * Insurers (agesa, anhyt, ansgr, raysg, tursg, ...) file under SEDDK's own
 * chart of accounts - not a variant of the general CMB/BIST template (see
 * ./general), so this doesn't build on it at all: no "dönen varlıklar"/
 * "duran varlıklar" split, no "esas faaliyet karı" concept, cash/debt line
 * items untouched (not needed yet, so no currentAssets/noncurrentAssets/
 * shortDebts/longDebts keys here at all - they'd only ever match nothing).
 *
 * Every row below is its own self-contained start+keyword trigger (its own
 * text is both a sectionStartKey and the value it captures), rather than
 * relying on one section spanning multiple rows: an insurer's income
 * statement is spread across several PDF pages (hayat dışı / hayat /
 * emeklilik / teknik olmayan bölüm), each closed by its own "#page-end#"
 * well before the next one's row shows up, so a single section-start could
 * never span all of them anyway.
 *
 * Two report-format quirks these labels rely on being handled generically
 * in extract-financial-values.ts, not by anything sector-specific here:
 * numbered/lettered row markers ("1- kazanılmış primler ...", "j- genel
 * teknik bölüm dengesi ...") are stripped by isEnumerationMarker, and a
 * total's trailing "(c+f+ı)"-style derivation recap is stripped by
 * trimTrailingFormulaRecap.
 */
export const insuranceSections: SectionsConfig = {
  equity: {
    sectionStartKeys: [
      "özsermaye toplamı",
      "özsermaye ve yükümlülükler toplamı",
      // "toplam kaynaklar"'s total-liabilities+equity phrasing varies per
      // insurer (tursg: "özsermaye ve yükümlülükler toplamı", anhyt:
      // "yükümlülükler ve özsermaye toplamı", agesa: bare "yükümlülükler
      // toplamı") - but "varlıklar toplamı" (the balance sheet's *other*
      // total, equal to it by definition) is the one line every insurer
      // prints the same way, so it's the more reliable anchor.
      "varlıklar toplamı",
      // Net-income-for-the-period row within the equity roll-forward - see
      // the "ana ortaklık payları" schema below for why this section needs
      // it too.
      "dönem net karı/zararı",
      "dönem net karı",
      "dönem net kârı",
    ],
    // Each of the above is a single-row total, not the start of a
    // multi-row section - closing the section on the very same keys keeps
    // every row above independent of one another (see file doc comment).
    sectionEndKeys: [
      "özsermaye toplamı",
      "özsermaye ve yükümlülükler toplamı",
      "varlıklar toplamı",
      "dönem net karı/zararı",
      "dönem net karı",
      "dönem net kârı",
    ],
    allowDetailSum: false,
    keywordPrefixes: [],
    keywordSchemas: [
      {
        chosenLabel: "ana ortaklığa ait özkaynaklar",
        keyword: ["özsermaye toplamı"],
      },
      {
        chosenLabel: "toplam kaynaklar",
        keyword: ["özsermaye ve yükümlülükler toplamı", "varlıklar toplamı"],
      },
      {
        // Fallback source for "ana ortaklık payları" (see the schema of the
        // same name under revenue): some annual (year-end) reports never
        // restate net income within the income statement itself and only
        // ever state it once, as the equity roll-forward's current-period-
        // profit line (2025Q4 anhyt/ansgr/tursg - each spells it slightly
        // differently: "f-dönem net karı/zararı", "f-dönem net karı", "f-
        // dönem net kârı", with the marker sometimes glued directly onto
        // the word - see stripGluedLetterMarker). resolveValuesFromMatches
        // only uses this when revenue's own row never resolves, so reports
        // that DO restate it there (e.g. 2026Q1 agesa/tursg) are unaffected.
        chosenLabel: "ana ortaklık payları",
        keyword: ["dönem net karı/zararı", "dönem net karı", "dönem net kârı"],
      },
    ],
  },
  revenue: {
    sectionStartKeys: [
      "kazanılmış primler (reasürör payı düşülmüş olarak)",
      "genel teknik bölüm dengesi",
      "dönem net karı veya zararı",
      // Per-segment technical department balance rows - see
      // sumFallbackKeywords below. Self-contained start+keyword triggers
      // like everything else here, needed since the emeklilik segment has
      // no "kazanılmış primler" row of its own to already be inside
      // "revenue" by the time its balance row shows up.
      "teknik bölüm dengesi- hayat dışı",
      "teknik bölüm dengesi- hayat",
      "teknik bölüm dengesi- emeklilik",
    ],
    sectionEndKeys: ["#page-end#"],
    allowDetailSum: false,
    keywordPrefixes: [],
    keywordSchemas: [
      {
        chosenLabel: "hasılat",
        keyword: ["kazanılmış primler (reasürör payı düşülmüş olarak)"],
        // Premiums are reported per business segment (hayat dışı / hayat),
        // each its own repeat of this exact row - the segment header just
        // above it differs, but the row text itself doesn't, so this can't
        // be told apart via separate keyword synonyms. Summing every match
        // is what "hasılat" (total revenue) actually means here (see
        // KeywordSchema.sumAllMatches) - confirmed against 2026Q1 agesa
        // (both segments non-trivial) and anhyt (life segment ~13x the
        // non-life one, previously silently dropped).
        sumAllMatches: true,
      },
      {
        chosenLabel: "esas faaliyet karı",
        // sum of every technical department's balance (non-life + life +
        // pension) - the closest insurance-sector analog to operating
        // income.
        keyword: ["genel teknik bölüm dengesi"],
        // Some annual reports (2025Q4 anhyt/ansgr/tursg) never print this
        // combined line at all - only the three per-segment balances ("c-
        // teknik bölüm dengesi- hayat dışı (a-b)", "f- ...- hayat (d-e)",
        // "ı- ...- emeklilik (g-h)"), whose sum is exactly what "genel
        // teknik bölüm dengesi" would have stated. Only used as a fallback
        // (see KeywordSchema.sumFallbackKeywords) - reports that DO have
        // the combined line (2026Q1 agesa/tursg) use that instead.
        sumFallbackKeywords: [
          "teknik bölüm dengesi- hayat dışı",
          "teknik bölüm dengesi- hayat",
          "teknik bölüm dengesi- emeklilik",
        ],
      },
      {
        chosenLabel: "ana ortaklık payları",
        keyword: ["dönem net karı veya zararı", "dönem net kârı veya zararı"],
      },
    ],
  },
};
