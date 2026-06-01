interface DataPoint {
  rawDate: number;
  value: number;
}

interface ReturnAnalysis {
  startDate: string; // Current period start
  endDate: string; // Current period end
  yoyBaselineDate: string; // The date used as the 1-year baseline
  yoyDaysPassed: number; // Actual days passed since baseline
  yoyReturnPercent: number; // Compounded Annualized return based on days passed
}

const rawDataString = `date,value
1780272000000,45.91665
1780099200000,45.8714
1777507200000,45.14753
1774818000000,44.47558
1772236800000,43.95828
1769720400000,43.49919
1767052800000,42.95526
1764460800000,42.50604
1761782400000,42.04609
1759179600000,41.58173
1756501200000,41.14947
1753822800000,40.5851
1751230800000,39.78428
1748552400000,39.23605
1745960400000,38.4363
1743282000000,38
1740700800000,36.43
1738184400000,35.77
1735516800000,35.2`;

const MS_IN_DAY = 24 * 60 * 60 * 1000;
const DAYS_IN_YEAR = 365;
const DAYS_IN_MONTH = DAYS_IN_YEAR / 12;

/**
 * Finds the index of the data point closest to 1 year (365 days) prior to the current index.
 * If 1 year of history is not available, it returns 0 (the oldest available point).
 */
function getYoYBaselineIndex(
  dataPoints: DataPoint[],
  currentIndex: number,
): number {
  const currentPoint = dataPoints[currentIndex];
  const targetTime = currentPoint.rawDate - DAYS_IN_YEAR * MS_IN_DAY;

  if (targetTime <= dataPoints[0].rawDate) {
    return 0;
  }

  let bestIndex = 0;
  let minDiff = Infinity;

  for (let j = 0; j < currentIndex; j++) {
    const diff = Math.abs(dataPoints[j].rawDate - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      bestIndex = j;
    }
  }

  return bestIndex;
}

function analyzeMonthlyAndYoYReturns(csvData: string): ReturnAnalysis[] {
  const lines = csvData.trim().split("\n");
  const dataPoints: DataPoint[] = [];

  for (let i = 1; i < lines.length; i++) {
    const [dateStr, valueStr] = lines[i].split(",");
    if (dateStr && valueStr) {
      dataPoints.push({
        rawDate: parseInt(dateStr, 10),
        value: parseFloat(valueStr),
      });
    }
  }

  // Sort chronological (oldest to newest)
  dataPoints.sort((a, b) => a.rawDate - b.rawDate);

  const results: ReturnAnalysis[] = [];

  for (let i = 1; i < dataPoints.length; i++) {
    const prev = dataPoints[i - 1];
    const curr = dataPoints[i];

    // Align UTC day boundaries
    const prevEpochDay = Math.round(prev.rawDate / MS_IN_DAY);
    const currEpochDay = Math.round(curr.rawDate / MS_IN_DAY);

    const startDateStr = new Date(prevEpochDay * MS_IN_DAY)
      .toISOString()
      .split("T")[0];
    const endDateStr = new Date(currEpochDay * MS_IN_DAY)
      .toISOString()
      .split("T")[0];

    // YoY Calculations (with daysPassed-based compounding)
    const baselineIndex = getYoYBaselineIndex(dataPoints, i);
    const baselinePoint = dataPoints[baselineIndex];
    const baselineEpochDay = Math.round(baselinePoint.rawDate / MS_IN_DAY);
    const baselineDateStr = new Date(baselineEpochDay * MS_IN_DAY)
      .toISOString()
      .split("T")[0];

    const yoyDaysPassed = currEpochDay - baselineEpochDay;

    let compoundedYoYReturn = 0;
    if (yoyDaysPassed > 0) {
      const yoyValueRatio = curr.value / baselinePoint.value;
      // Standardize the return to a 365-day period (annualized)
      compoundedYoYReturn =
        Math.pow(yoyValueRatio, DAYS_IN_YEAR / yoyDaysPassed) - 1;
    }

    results.push({
      startDate: startDateStr,
      endDate: endDateStr,
      yoyBaselineDate: baselineDateStr,
      yoyDaysPassed: yoyDaysPassed,
      yoyReturnPercent: parseFloat(compoundedYoYReturn.toFixed(4)),
    });
  }

  return results;
}

const analysis = analyzeMonthlyAndYoYReturns(rawDataString);
console.table(analysis);
