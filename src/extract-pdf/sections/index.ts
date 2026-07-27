import { generalSections } from "./general";
import { insuranceSections } from "./insurance";
import { bankSections } from "./bank";
import { financeSections } from "./finance";
import { SectionsConfig } from "./types";

export { generalSections, insuranceSections, bankSections, financeSections };
export type { SectionsConfig, SectionDef, KeywordSchema } from "./types";
export {
  isEnumerationMarker,
  stripGluedLetterMarker,
  isFormulaFragment,
  trimTrailingFormulaRecap,
  normalizeCommaThousands,
} from "./sector-parsing";

export interface PdfTypeConfig {
  sections: SectionsConfig;
  // Fixed value-column index to use for every non-revenue (balance-sheet-
  // derived) section, overriding the auto-detected one - see bankSections's
  // doc comment for why banks need this instead of relying on
  // detectValueColumnIndex.
  balanceSheetValueIndexOverride?: number;
}

// Keyed by stock_info.pdf_type (see src/db/schema.ts) - "normal" covers a
// null/missing row, i.e. every symbol that hasn't been tagged as a bank,
// insurer, or finance company.
const PDF_TYPE_CONFIGS: Record<
  "normal" | "bank" | "insurance" | "finance",
  PdfTypeConfig
> = {
  normal: { sections: generalSections },
  insurance: { sections: insuranceSections },
  bank: { sections: bankSections, balanceSheetValueIndexOverride: -4 },
  // Same 6-column TP/YP/Toplam balance-sheet layout as banks - see
  // financeSections's doc comment.
  finance: { sections: financeSections, balanceSheetValueIndexOverride: -4 },
};

export function getPdfTypeConfig(
  pdfType: string | null | undefined,
): PdfTypeConfig {
  if (pdfType === "bank" || pdfType === "insurance" || pdfType === "finance") {
    return PDF_TYPE_CONFIGS[pdfType];
  }
  return PDF_TYPE_CONFIGS.normal;
}
