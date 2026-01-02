import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
