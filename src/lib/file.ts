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
    throw new Error(`Error parsing CSV at ${filePath}`);
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
  } catch (error: any) {
    console.error(`Error reading or parsing JSON file at ${filePath}:`, error);
    throw error;
  }
}
