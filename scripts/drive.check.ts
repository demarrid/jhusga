/**
 * Checks that a PDF's text layer becomes the same kind of stored string a
 * Google Doc export does, so a judiciary opinion filed as a PDF is readable
 * and citable.
 */
import { extractPdfText, isPdfFile } from "../lib/drive";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

/**
 * A one-page PDF whose only content is `phrase`, using Helvetica so PDF.js
 * can extract it. Offsets in the xref table are computed rather than
 * guessed, or the fixture would be a file that only looks like a PDF.
 */
function encodeMinimalPdf(phrase: string): Uint8Array {
    const escaped = phrase.replace(/\\/g, "\\\\").replace(/[()]/g, "\\$&");
    const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
    const objects = [
        "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
        `4 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`,
        "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    ];

    let body = "%PDF-1.4\n";
    const offsets = [0];
    for (const object of objects) {
        offsets.push(body.length);
        body += object;
    }

    const xrefStart = body.length;
    let xref = `xref\n0 6\n0000000000 65535 f \n`;
    for (let i = 1; i <= 5; i++) {
        xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    body += xref;
    body += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
    return new TextEncoder().encode(body);
}

console.log("isPdfFile");
check(
    "Drive's PDF mime type is a PDF",
    isPdfFile({ mimeType: "application/pdf", name: "Opinion" }),
);
check(
    "a .pdf filename is a PDF even when Drive called it a generic binary",
    isPdfFile({ mimeType: "application/octet-stream", name: "Opinion.pdf" }),
);
check(
    "a Google Doc is not treated as a PDF",
    !isPdfFile({
        mimeType: "application/vnd.google-apps.document",
        name: "Minutes",
    }),
);

console.log("\nextractPdfText");

const phrase = "The Judiciary grants the petition.";

async function main() {
    const extracted = await extractPdfText(encodeMinimalPdf(phrase));
    check(
        "the words on the page survive extraction",
        extracted.includes("The Judiciary grants the petition"),
        extracted,
    );
    check(
        "an empty buffer yields no text",
        (await extractPdfText(new Uint8Array())) === "",
    );

    console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
    process.exitCode = failures === 0 ? 0 : 1;
}

main();
