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
