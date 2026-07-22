import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats a date as YYYY-MM-DD. Unlike the locale-dependent default of
 * `toLocaleDateString()`, this ordering is unambiguous and sorts correctly as plain text.
 */
export function formatDate(date: number | Date): string {
  return new Date(date).toLocaleDateString("en-CA");
}

export const formatNumber = ({
  num,
  digits = 0,
  trim,
}: {
  num: number | null | undefined | "N/A";
  digits?: number;
  trim?: number;
}): string => {
  if (num === "N/A") {
    return "N/A";
  }

  if (num == null || num == undefined) {
    return "";
  }

  if (typeof num !== "number") {
    throw new Error(
      `Invalid input for formatNumber: expected a number, nullish or 'N/A', but received ${typeof num}`,
    );
  }

  if (trim) {
    num = num / trim;
  }

  const formatNum = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(num);

  return formatNum;
};

const ABBREVIATIONS: Array<{ threshold: number; suffix: string }> = [
  { threshold: 1_000_000_000_000, suffix: "T" },
  { threshold: 1_000_000_000, suffix: "B" },
  { threshold: 1_000_000, suffix: "M" },
  { threshold: 1_000, suffix: "K" },
];

/**
 * Abbreviates a large number the way tradingview.com does (e.g.
 * 42603202000 -> "42.6B", not the full "42,603,202,000") - separate from
 * formatNumber (used as-is by ratios/multiples/growth %, and by the
 * original, non-v2 page) since only large absolute monetary figures (v2's
 * balance-sheet/income-statement/enterprise-value rows) should ever get
 * abbreviated this way.
 */
export const formatAbbreviatedNumber = ({
  num,
  digits = 1,
}: {
  num: number | null | undefined | "N/A";
  digits?: number;
}): string => {
  if (num === "N/A") return "N/A";
  if (num == null) return "";
  if (typeof num !== "number") {
    throw new Error(
      `Invalid input for formatAbbreviatedNumber: expected a number, nullish or 'N/A', but received ${typeof num}`,
    );
  }

  const abs = Math.abs(num);
  const match = ABBREVIATIONS.find(({ threshold }) => abs >= threshold);
  if (!match) return formatNumber({ num, digits: 0 });

  const sign = num < 0 ? "-" : "";
  return `${sign}${(abs / match.threshold).toFixed(digits)}${match.suffix}`;
};
