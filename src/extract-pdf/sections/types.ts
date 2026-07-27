export interface KeywordSchema {
  chosenLabel: string;
  keyword: string[];
  /**
   * Insurers report premiums per business segment (hayat dışı / hayat),
   * each under its own repeat of the same "kazanılmış primler ..." row
   * text - so the value that belongs to "hasılat" is the sum of every
   * occurrence, not just the first (see insurance.ts's "hasılat" schema).
   * Default (unset/false) keeps the normal first-match-wins behavior every
   * other schema relies on.
   */
  sumAllMatches?: boolean;
  /**
   * Fallback keyword list, summed together, used only when nothing in
   * `keyword` resolves to a value. For insurers whose annual report never
   * states a single combined total (e.g. "genel teknik bölüm dengesi") and
   * instead only prints one row per business segment - see insurance.ts's
   * "esas faaliyet karı" schema. Tracked as one shared accumulator across
   * every entry (not per-entry first-match-wins like `keyword`), since the
   * point is to add every segment's row together, whichever of them the
   * report happens to have a nonzero value for.
   */
  sumFallbackKeywords?: string[];
}

export interface SectionDef {
  sectionStartKeys: string[];
  sectionEndKeys: string[];
  /**
   * For some reports, we can't detect section start because they don't
   * include headers, etc. Thus we utilize nextSection chaining, if current
   * section end is detected.
   */
  nextSection?: string;
  /**
   * Whether a keyword's own row is allowed to resolve by summing its detail
   * rows when it carries no value (see sumFollowingDetailLines).
   */
  allowDetailSum: boolean;
  /**
   * Some reports split a debt line into "İlişkili taraflardan <keyword>"
   * rows. We include those rows in our calculations but we don't want to
   * produce separate output keys, which makes verification harder. So we
   * introduced keywordPrefixes.
   */
  keywordPrefixes: string[];
  keywordSchemas: KeywordSchema[];
}

export type SectionsConfig = Record<string, SectionDef>;
