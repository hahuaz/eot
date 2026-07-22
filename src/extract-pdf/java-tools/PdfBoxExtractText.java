import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.tools.PDFText2HTML;

/**
 * Thin wrapper around PDFBox's own PDFText2HTML stripper (the same class
 * `pdfbox export:text -html` uses internally, so its HTML output shape -
 * page-break divs, entity encoding - is identical to what basic-extract.ts's
 * parsePdfBoxHtmlPages already parses) - the one thing it adds is calling
 * setAllSecurityToBeRemoved(true) before stripping.
 *
 * Some PDFs (2025Q2 rygyo, 2024Q1 doas) have permission flags disallowing
 * text extraction - a blank user password lets anyone open/view them, but a
 * real, unknown owner password would normally be needed to lift the "no
 * extraction" restriction. The `pdfbox export:text` CLI enforces that flag
 * as policy (unlike every other library this pipeline evaluated - see
 * docs/pdf-extraction-library-comparison.md - which all just ignore it,
 * since it isn't backed by real cryptographic strength) and has no flag to
 * override it. setAllSecurityToBeRemoved(true) is PDFBox's own documented
 * API for exactly this: once a document is successfully loaded (which
 * succeeds here - only the *user* password, blank, is actually needed to
 * decrypt the content stream), this clears the enforcement without needing
 * the real owner password. Note AccessPermission.canExtractContent() still
 * reports false afterwards - that's a quirk of the API, not a sign it
 * didn't work; the stripper below succeeds regardless.
 *
 * Compiled with `javac --release 8` so the committed .class file runs on
 * this project's existing Java 8 JRE dependency - no JDK required at
 * runtime, only to rebuild this file if it's ever changed.
 */
public class PdfBoxExtractText {
    public static void main(String[] args) throws Exception {
        if (args.length < 4) {
            System.err.println(
                "Usage: java PdfBoxExtractText <pdf_path> <output_html_path> <start_page> <end_page>"
            );
            System.exit(1);
        }

        File pdfFile = new File(args[0]);
        File outputFile = new File(args[1]);
        int startPage = Integer.parseInt(args[2]);
        int endPage = Integer.parseInt(args[3]);

        try (PDDocument document = Loader.loadPDF(pdfFile)) {
            if (document.isEncrypted()) {
                document.setAllSecurityToBeRemoved(true);
            }

            PDFText2HTML stripper = new PDFText2HTML();
            stripper.setStartPage(startPage);
            stripper.setEndPage(endPage);

            outputFile.getParentFile().mkdirs();
            try (Writer writer = new OutputStreamWriter(
                    new FileOutputStream(outputFile), StandardCharsets.UTF_8)) {
                stripper.writeText(document, writer);
            }
        }
    }
}
