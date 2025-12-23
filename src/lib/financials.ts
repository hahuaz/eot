import { Inflation } from "@shared/types";
import { LAST_DATE } from "@/lib/dates";
import { calcRealRate } from "@/lib/utils";

export const getTaxByRegion = ({
  region,
}: {
  region: string;
}): {
  withholdingTax: number;
  dividendTax: number;
} => {
  switch (region) {
    case "tr":
      return {
        withholdingTax: 0.175,
        dividendTax: 0.15,
      };
    case "us":
      return {
        withholdingTax: 0.24,
        dividendTax: 0.2,
      };
    default:
      throw new Error(`Region ${region} not supported for tax calculation`);
  }
};

export const getLiveTtmNightlyYield = ({
  inflation,
}: {
  inflation: Inflation[];
}): number | null => {
  // TODO: get prices dynamically
  // ttm bgp price on 2024/9/30
  const previousTtmBGPPrice = 2.946158;
  // live TTM BGP price (includes up-to-date price, not just between 2024/9/30 and 2025/9/30)
  const liveTtmBGPPrice = 5.008617;
  const nominalBGPYield =
    (liveTtmBGPPrice - previousTtmBGPPrice) / previousTtmBGPPrice;

  const netBGPYield =
    nominalBGPYield * (1 - getTaxByRegion({ region: "tr" }).withholdingTax);

  const ttmInflation = inflation?.find((item) => item.date === LAST_DATE)?.yoy;
  if (ttmInflation == null) {
    throw new Error(`Inflation data not found for date ${LAST_DATE}`);
  }
  const ttmNightlyYield = calcRealRate({
    nominalRate: netBGPYield,
    inflationRate: ttmInflation,
  });

  return ttmNightlyYield;
};
