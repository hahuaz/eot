import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const formatNumber = ({
  num,
  maximumFractionDigits = 0,
  trim,
}: {
  num: number | null | undefined;
  maximumFractionDigits?: number;
  trim?: number;
}): string => {
  if (num == null) {
    return "";
  }

  if (trim) {
    num = num / trim;
  }

  const formatNum = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: maximumFractionDigits,
  }).format(num);

  return formatNum;
};
