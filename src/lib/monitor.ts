import path from "path";
import fs from "fs";

import playSound from "play-sound";

import { getLastLines } from "@repo/lib";

import type { ScrapeResult } from "@/types/index.js";

/**
 * Save the scraped data to local file and monitor for increasing state
 */
export async function monitor({
  scrapeResult,
  importantResources = [],
}: {
  scrapeResult: ScrapeResult;
  // importantResources is an array of resource names that should be always in increasing state
  importantResources?: string[];
}) {
  const scrapedDataDirPath = path.join(process.cwd(), "scraped-data");

  const importantResourceState = importantResources.reduce<
    Record<string, boolean>
  >((acc, resource) => {
    acc[resource] = false;
    return acc;
  }, {});

  for (const scrapeItem of scrapeResult) {
    // console.log(`${resource}: ${value}`);

    // 1. Save the scraped data to local file
    if (!fs.existsSync(scrapedDataDirPath)) {
      fs.mkdirSync(scrapedDataDirPath);
    }

    const resourceFilePath = `${scrapedDataDirPath}/${scrapeItem.resource}`;

    fs.appendFileSync(resourceFilePath, `${scrapeItem.value}\n`);

    const prices = await getLastLines(resourceFilePath, 60);

    const parsedPrices = prices.map((price) => parseFloat(price));

    const curResourceIncreasing = isPriceIncreasing({
      parsedPrices,
      resource: scrapeItem.resource,
    });

    // 2. if the resource is important, save the state and continue to other resources
    if (importantResources.includes(scrapeItem.resource)) {
      importantResourceState[scrapeItem.resource] = curResourceIncreasing;
      continue;
    }

    // 3. check if the important resources are in increasing state
    const importantResourcesIncreasing = Object.values(
      importantResourceState,
    ).every((isIncreasing) => isIncreasing);

    // 4. trigger the alarm if all important resources are increasing and current resource is increasing
    if (importantResourcesIncreasing && curResourceIncreasing) {
      fs.appendFileSync(
        path.join(scrapedDataDirPath, "alarm.txt"),
        `${scrapeItem.resource} is increasing, ${new Date().toLocaleString()}\n`,
      );
      triggerAlarm();
    }
  }
}

function isPriceIncreasing({
  parsedPrices: prices,
  resource,
}: {
  parsedPrices: number[];
  resource: string;
}) {
  if (!prices || prices.length < 60) {
    console.log(
      `Not enough prices to compare for ${resource} - ${prices.length}`,
    );
    return false;
  }

  // if 0th price is greater than the previous 59th price consider it as increasing
  // console.log({
  //   prices0: prices[0],
  //   prices59: prices[59],
  // });
  const isIncreasing = prices[0] > prices[59];

  if (isIncreasing) {
    return true;
  } else {
    return false;
  }
}

export function triggerAlarm() {
  const player = playSound();

  const soundPath = path.join(
    process.cwd(),
    "src",
    "assets",
    "notification.wav",
  );
  console.log("Playing sound:", soundPath);

  player.play(soundPath, (err) => {
    if (err) console.error("Error playing sound:", err);
  });
}
