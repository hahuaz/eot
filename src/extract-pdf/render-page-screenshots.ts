import fs from "fs";
import path from "path";
import * as mupdf from "mupdf";

// Matches the resolution used elsewhere isn't a concern here - this is only
// for human eyeballing in verify.md, so a middling resolution keeps file
// size reasonable while staying legible.
const RESOLUTION = 150;
const SCALE = RESOLUTION / 72;

/**
 * Renders each of `pageNumbers` (1-indexed) from `pdfPath` to
 * "<symbol>-p<page_number>.png" under `outputDir`. Skips any page whose PNG
 * already exists, so re-running the pipeline doesn't re-render pages that
 * haven't changed.
 */
export function renderPageScreenshots(
  pdfPath: string,
  outputDir: string,
  symbol: string,
  pageNumbers: number[],
): void {
  fs.mkdirSync(outputDir, { recursive: true });

  const missingPages = pageNumbers.filter(
    (pageNumber) =>
      !fs.existsSync(path.join(outputDir, `${symbol}-p${pageNumber}.png`)),
  );
  if (missingPages.length === 0) return;

  const doc = mupdf.Document.openDocument(pdfPath);
  const pageCount = doc.countPages();
  const matrix = mupdf.Matrix.scale(SCALE, SCALE);

  for (const pageNumber of missingPages) {
    if (pageNumber < 1 || pageNumber > pageCount) {
      console.error(
        `Page ${pageNumber} out of range for ${pdfPath} (${pageCount} pages)`,
      );
      continue;
    }

    const page = doc.loadPage(pageNumber - 1);
    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
    const outputPath = path.join(outputDir, `${symbol}-p${pageNumber}.png`);
    fs.writeFileSync(outputPath, pixmap.asPNG());
    console.log(`Saved ${outputPath}`);
  }
}
