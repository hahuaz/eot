import fs from "fs";
import Papa from "papaparse";

export const parseCSV = <T>({
  filePath,
  header = true,
  delimiter = ",",
}: {
  filePath: string;
  header?: boolean;
  delimiter?: string;
}): {
  data: T[];
  meta: Papa.ParseMeta;
} => {
  const fileContent = fs.readFileSync(filePath, "utf-8");
  const { data, errors, meta } = Papa.parse<T>(fileContent, {
    delimiter,
    header,
    skipEmptyLines: true,
    dynamicTyping: true,
  });
  if (errors.length > 0) {
    const errorMessages = errors.map((e) => e.message).join(", ");
    throw new Error(`Error parsing CSV at ${filePath}: ${errorMessages}`);
  }
  return { data, meta };
};

export const unparseCSV = <T>({
  data,
  filePath,
  header = true,
}: {
  data: T[];
  filePath: string;
  header?: boolean;
}): void => {
  const csv = Papa.unparse(data, {
    header,
    skipEmptyLines: true,
  });
  fs.writeFileSync(filePath, csv);
};

export function readJsonFile<T>(filePath: string): T {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch (error: unknown) {
    console.error(`Error reading or parsing JSON file at ${filePath}:`, error);
    throw error;
  }
}

/**
 * Updates a CSV file by either updating the most recent entry or adding a new entry.
 * Only checks the first entry (most recent) in the CSV file.
 */
export function updateCsvFile<T extends Record<string, unknown>>(
  filePath: string,
  newEntry: T,
  // e.g., "date". if newEntry.date matches the most recent entry's date, update that entry instead of adding a new one
  matchKey: keyof T,
) {
  if (fs.existsSync(filePath)) {
    const csvContent = parseCSV<T>({ filePath, header: true });
    const { data } = csvContent;
    const lastEntry = data[0];

    if (lastEntry && lastEntry[matchKey] === newEntry[matchKey]) {
      Object.assign(lastEntry, newEntry);
    } else {
      data.unshift(newEntry);
    }

    unparseCSV<T>({ data, filePath, header: true });
  } else {
    const data = [newEntry];
    unparseCSV<T>({ data, filePath, header: true });
  }
}
