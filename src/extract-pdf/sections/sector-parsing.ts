/**
 * Text-normalization quirks needed only by the bank (BDDK) and insurance
 * (SEDDK) templates - see ./bank and ./insurance for their keyword configs.
 * Kept as plain functions applied unconditionally to every report (not
 * gated by pdfType) rather than dispatched per-sector: each is a proven
 * no-op on the general CMB/BIST template's own vocabulary (documented
 * below), so gating them would only add pdfType-threading through
 * extract-financial-values.ts's low-level parsing helpers - which are
 * called on every line of every report regardless of sector - for zero
 * behavior difference. Grouped here instead of sitting anonymously among
 * that file's truly sector-agnostic helpers, so it's clear at a glance
 * which parsing rules exist only because of bank/insurance layouts.
 */

/**
 * A leading enumeration marker: a digit-group marker like "1-", "2-", "10-",
 * "1.1-", "1.1.1-"; a single-letter marker like "a-", "b-", "j-", "n-"; or a
 * roman-numeral marker like "ı.", "ıv.", "xxv.". Insurance-sector (SEDDK)
 * and bank-sector (BDDK) reports prefix every single line item with one of
 * these ("a- nakit ve nakit benzeri varlıklar", "1- kazanılmış primler ...",
 * "j- genel teknik bölüm dengesi ...", "ı. faiz gelirleri ...", "xxv. dönem
 * net karı/zararı ...").
 *
 * The digit form needs stripping from the label entirely: isConsistNumber's
 * loose digit-check treats a bare digit token as a number the same way it
 * would a real value, so without this, the label-boundary scan stops
 * dead at position 0 and the row's whole label collapses to just "1-" -
 * never matching any configured keyword.
 *
 * The letter and roman-numeral forms don't hit that bug (isConsistNumber
 * requires a digit, so the boundary scan already runs past them fine either
 * way) - but they're still stripped here, otherwise they stay glued onto
 * the front of the label ("j- genel teknik bölüm dengesi ...") and every
 * configured keyword for these rows would have to spell out its specific
 * enumeration marker too, which isn't stable to depend on (an unrelated
 * line item being added/removed by the regulator would shift every
 * subsequent marker).
 */
export function isEnumerationMarker(token: string): boolean {
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
 * so this never gets stripped by the loop that calls it - this handles the
 * glued case as a fallback, given only the label's first token (once
 * isEnumerationMarker's own loop has already run out).
 */
export function stripGluedLetterMarker(token: string): string {
  const match = token.match(GLUED_LETTER_MARKER_RE);
  return match ? match[1] : token;
}

/**
 * A single fragment of a trailing "(A-B)"/"(C+F+I)"-style formula recap:
 * only letters/digits/"+"/"-"/"–"/"…", optionally wrapped in one leading "("
 * and/or trailing ")". Matches both a whole recap rendered as one dense
 * token ("(c+f+ı)") and a single piece of one rendered with spaces around
 * its operator ("(ı", "+", "ıı)", or "(a", "–", "b)") - see
 * trimTrailingFormulaRecap. "…" covers a recap that elides a run of
 * referenced rows instead of spelling each one out (2026Q1 ktlev: "net
 * faaliyet k/z (v+…+vııı)"). "–" (en dash, not the ASCII hyphen "-") covers
 * insurers that render the subtraction operator as one (2025Q4 ansgr/anhyt:
 * "teknik bölüm dengesi- hayat dışı (a – b)").
 */
export function isFormulaFragment(token: string): boolean {
  return /^\(?[a-zçğıöşü0-9+\-–…]+\)?$/.test(token);
}

/**
 * Reports often restate a total's derivation in parens right after its
 * label and before its dipnot/value columns (tursg "genel teknik bölüm
 * dengesi (c+f+ı)", garan "net faaliyet kârı/zararı (vııı-ıx-x-xı-xıı)",
 * agesa "varlıklar toplamı (ı + ıı)" - note the spaces, splitting this one
 * into 3 tokens instead of 1). The letters inside are just references to
 * other rows on the same page (arbitrary per line, and liable to shift if
 * a component row is ever added/removed), not descriptive content, so
 * keyword configs shouldn't have to spell them out.
 *
 * Scans backward from the label's current last token for a run of
 * isFormulaFragment tokens, stopping at the one that opens the
 * parenthetical. Requires an internal "+"/"-" among them so a genuine
 * one-word parenthetical qualifier elsewhere in the general template's
 * keywords (e.g. "esas faaliyet karı veya (zararı)") is never mistaken for
 * one - a real recap always joins at least two row-references with an
 * operator, a bare qualifier never does. Returns the label's new last
 * index (unchanged if no recap is found).
 */
export function trimTrailingFormulaRecap(
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

/**
 * Bank-sector (BDDK) reports format numbers English-style - comma
 * thousands, dot decimals (e.g. "2,685,235,121") - instead of every other
 * report's Turkish convention (dot thousands, comma decimals, e.g.
 * "2.685.235.121") extract-financial-values.ts's number-parsing is otherwise
 * built entirely around. Rather than teach every token-parsing function a
 * second number format, normalize comma-grouped numbers to the Turkish dot
 * form once, right after extraction.
 *
 * Safe to run unconditionally on every report, not just banks': a genuine
 * Turkish-formatted report never has 3-digit comma groups (that's not how
 * "," is used in that convention - if anything it'd mark a decimal, which
 * this regex's exactly-3-digit requirement doesn't match), so this is a
 * no-op for them.
 */
export function normalizeCommaThousands(text: string): string {
  return text.replace(/\d{1,3}(,\d{3})+/g, (match) => match.replace(/,/g, "."));
}
