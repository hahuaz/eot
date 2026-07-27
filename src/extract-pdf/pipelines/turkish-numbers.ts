/**
 * Pure Turkish-number-format primitives - dot thousands-separators, comma
 * decimals, parenthesized negatives. Zero sector-specific logic: every
 * function here behaves identically regardless of which pdfType's pipeline
 * calls it, so unlike the label/marker parsing (which each pipeline owns a
 * full copy of - see pipelines/general.ts's doc comment for why), these are
 * shared as-is.
 */

export function isConsistNumber(token: string): boolean {
  const clean = token
    .replace(/\(/g, "")
    .replace(/\)/g, "")
    .replace(/-/g, "")
    .replace(/—/g, "")
    .replace(/\./g, "")
    .replace(/,/g, "")
    .replace(/%/g, "")
    .trim();

  // Using /\d/.test(clean) checks if there is at least one digit present
  return !!clean && /\d/.test(clean);
}

/**
 * A complete Turkish-formatted number: one leading group of 1-3 digits, then
 * zero or more dot-separated groups of exactly 3 digits (e.g. "38.327.850",
 * "7.605", "605"), optionally wrapped in a *matched* pair of parens for
 * negatives (e.g. "(1.234)"). The parens must both be present or both be
 * absent - unlike a naive `\(?...\)?`, this doesn't also match a lone
 * unbalanced fragment like "(100 .280.688)" (which mergeSplitNumberTokens relies on
 * failing, so it knows to glue it onto the next split-off fragment).
 */
const COMPLETE_NUMBER_RE = /^(?:-?\d{1,3}(\.\d{3})*|\(-?\d{1,3}(\.\d{3})*\))$/;

/**
 * A bare, dot-less 1-3 digit token (e.g. "9", "1") already matches
 * COMPLETE_NUMBER_RE on its own - that's how a real small value like "605"
 * looks - so mergeTwoPieceSplitNumber's primary check never fires for it,
 * and a split like "9" + "26.546.816" (real value: "926.546.816") is left
 * as two tokens even though "26.546.816" *also* already looks like a
 * perfectly valid number by itself. There's no way to tell those two
 * readings apart from the token text alone.
 *
 * The tie can't be broken by "is the previous token numeric" - a row can
 * carry more than one bare footnote reference before its real values start
 * (e.g. 2024Q1 cimsa: "hasılat  2  22  5.323.692  4.798.491", two dipnot
 * numbers "2" and "22" both sitting before the real value; merging "22"
 * into "5.323.692" would wreck this already-correct row exactly the way
 * this fix is meant to prevent). What's actually safe to key on is whether
 * a genuine multi-group value - something with a dot, i.e. >= 1000 - has
 * already appeared earlier in the row: footnote references never follow a
 * real value (they only ever precede it), so a bare short token seen after
 * one has no legitimate reason to be its own standalone column in this
 * domain (every real figure here runs into the millions/billions) and is
 * fair game to glue onto the next token despite "looking" complete alone.
 *
 * if you wanna see example issues:
 * - 2024Q3: ttrak - esas faaliyet karı, ana ortaklık payları
 */
function isBareDigitMidRun(
  token: string,
  hasSeenGroupedValue: boolean,
): boolean {
  return (
    hasSeenGroupedValue &&
    !token.includes(".") &&
    COMPLETE_NUMBER_RE.test(token)
  );
}

// Every report here has at least this many real trailing value columns
// (current + prior period) - see mergeTwoPieceSplitNumber's use below.
const MIN_TRAILING_VALUE_COLUMNS = 2;

/** How many tokens, counting from the end, are already complete/valid numbers on their own - i.e. how many trailing value columns a row has without merging anything. */
function countTrailingCompleteNumbers(tokens: string[]): number {
  let count = 0;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (!COMPLETE_NUMBER_RE.test(tokens[i])) break;
    count++;
  }
  return count;
}

/**
 * `trailingCompleteCount` is countTrailingCompleteNumbers over every token
 * after `next` - passed in rather than computed here since the caller
 * already has the full row's tokens and this needs to stay a pure
 * token+token+flag decision.
 *
 * A bank/insurance dipnot reference ("4.9", "5.2.13") fails
 * COMPLETE_NUMBER_RE the exact same way a genuinely broken split-number
 * fragment does (that's the whole primary-candidate check below), so shape
 * alone can't tell "footnote index" from "value cut short mid-group" apart
 * - e.g. 2026Q1 ykbnk's "dönem net karı/zararı" row, whose dipnot ref "4.9"
 * otherwise concatenates with the real value "20.294.752" into a
 * plausible-looking but wrong "4.920.294.752". What does distinguish them:
 * merging is only ever *needed* to reach MIN_TRAILING_VALUE_COLUMNS - if
 * the tokens after this candidate already provide that many complete
 * numbers on their own (ykbnk: "20.294.752"/"11.418.148", 2 already), this
 * one isn't a fragment to repair. isBareDigitMidRun candidates are exempt
 * from this - that path already requires hasSeenGroupedValue, a narrower,
 * separately-verified condition (see its own doc comment, e.g. 2024Q3
 * ttrak/cimsa) that predates and isn't about this specific ambiguity.
 */
function mergeTwoPieceSplitNumber(
  token: string,
  next: string,
  hasSeenGroupedValue: boolean,
  trailingCompleteCount: number,
): string | null {
  if (!isConsistNumber(token) || !isConsistNumber(next)) return null;

  const isBareDigitCandidate = isBareDigitMidRun(token, hasSeenGroupedValue);
  const isPrimaryCandidate = !COMPLETE_NUMBER_RE.test(token);
  if (!isPrimaryCandidate && !isBareDigitCandidate) return null;
  if (
    isPrimaryCandidate &&
    trailingCompleteCount >= MIN_TRAILING_VALUE_COLUMNS
  ) {
    return null;
  }

  return COMPLETE_NUMBER_RE.test(token + next) ? token + next : null;
}

/** A genuine multi-group Turkish-formatted value (has a "." group, unlike a bare dipnot reference number). */
function isGroupedNumber(token: string): boolean {
  return token.includes(".") && COMPLETE_NUMBER_RE.test(token);
}

/**
 * Some PDFs split a number into 3+ runs where every fragment but the last is
 * a bare 1-3 digit group (e.g. "1" + "6" + ".753.182.070" instead of
 * "16.753.182.070"). Unlike the two-piece case above, a bare short digit
 * group is itself a valid COMPLETE_NUMBER_RE match (that's how a real value
 * like "605" looks), so mergeTwoPieceSplitNumber's "first fragment must fail
 * on its own" check never fires and each fragment is kept as its own token.
 *
 * The reliable signal here is the *last* fragment: a real, standalone value
 * never starts with ".", so a token doing that can only be the tail of a
 * thousands-grouped number whose leading digits got split off before it.
 * Once we see that, every immediately preceding bare-digit (no dot) token is
 * necessarily part of the same broken number - a legitimate column never
 * sits directly adjacent to one with zero separating label text - so they
 * all get pulled back in, however many there are.
 *
 * if you wanna see example issues:
 * - 2024Q3: ttrak - nakit ve nakit benzerleri, toplam kaynaklar
 */
function absorbLeadingDigitFragments(
  merged: string[],
  continuationToken: string,
): string {
  let combined = continuationToken;
  while (merged.length > 0 && /^\d{1,3}$/.test(merged[merged.length - 1])) {
    combined = merged.pop() + combined;
  }
  return combined;
}

/** Glues split-off number fragments back together - see isBareDigitMidRun/absorbLeadingDigitFragments's doc comments for the two distinct split patterns this handles. */
export function mergeSplitNumberTokens(tokens: string[]): string[] {
  const merged: string[] = [];
  let hasSeenGroupedValue = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens[i + 1];

    const twoPieceMerge =
      next !== undefined &&
      mergeTwoPieceSplitNumber(
        token,
        next,
        hasSeenGroupedValue,
        countTrailingCompleteNumbers(tokens.slice(i + 1)),
      );
    if (twoPieceMerge) {
      merged.push(twoPieceMerge);
      hasSeenGroupedValue ||= isGroupedNumber(twoPieceMerge);
      i++;
      continue;
    }

    if (/^\.\d/.test(token)) {
      const combined = absorbLeadingDigitFragments(merged, token);
      merged.push(combined);
      hasSeenGroupedValue ||= isGroupedNumber(combined);
      continue;
    }

    merged.push(token);
    hasSeenGroupedValue ||= isGroupedNumber(token);
  }
  return merged;
}

/** A real thousands-grouped value token (not a dipnot reference, not label text). */
export function isValueToken(token: string): boolean {
  const cleanToken = token.trim();
  if (!cleanToken) return false;
  // If it contains any alphabetic characters, it's not a value token
  if (/[a-zA-ZığüşöçİĞÜŞÖÇ]/.test(cleanToken)) return false;

  // if it contains comma "," it's not value token
  if (cleanToken.includes(",")) return false;

  // if it doesn't contain "." it's not value token
  if (!cleanToken.includes(".")) return false;

  // A dipnot sub-reference (e.g. "24.1") also has no letters/comma and
  // contains a dot, but isn't a real thousands-grouped number - its
  // trailing group isn't exactly 3 digits. Require the real format so
  // these don't get miscounted as value columns (see 2025q2 cvkmd
  // "hasılat 24.1 ..." throwing off the whole revenue section's column
  // index and starving every later row of a match).
  if (!COMPLETE_NUMBER_RE.test(cleanToken)) return false;

  return true;
}

/** Parses a Turkish-formatted number token (e.g. "18.068.564", "(1.234)") into a plain integer. */
export function parseTurkishNumber(token: string): number {
  const trimmed = token.trim();
  const isNegative = trimmed.startsWith("(") || trimmed.startsWith("-");
  const digits = trimmed.replace(/\D/g, "");
  const n = parseInt(digits, 10) || 0;
  return isNegative ? -n : n;
}

/** Formats a plain integer back into Turkish thousands-separated form (e.g. 18068564 -> "18.068.564") to match the format of directly-matched values. */
export function formatSummedNumber(n: number): string {
  return n.toLocaleString("tr-TR");
}

/** A lone "-" (or em-dash) standing in a value column means "no figure for this period" - a real, resolved zero, not a missing/wrapped value. */
export function isZeroPlaceholder(token: string): boolean {
  return token.trim() === "-" || token.trim() === "—";
}

/** A usable value token: either a real number, or a "-" standing in for a real (zero) figure. */
export function isUsableValueToken(token: string | undefined): token is string {
  return !!token && (isZeroPlaceholder(token) || isValueToken(token));
}

/** Parses a usable value token to a number - a zero placeholder ("-") is 0, everything else goes through parseTurkishNumber. */
export function parseUsableValueToken(token: string): number {
  return isZeroPlaceholder(token) ? 0 : parseTurkishNumber(token);
}

/** Turkish thousands separator is "." (e.g. "345.599.501") - drop it so the saved value is a plain number. */
export function stripThousandsSeparators(value: string): string {
  return value.replace(/\./g, "");
}
