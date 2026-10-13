/**
 * Checks that an uploaded workbook contributes every tab, not only sheet1,
 * and that the ZIP reader opens the archives real tools write.
 *
 * Drive's xlsx export streams: every entry is deflated with bit 3 set, the
 * local header's sizes are zero, and the real sizes are in a data
 * descriptor after the payload and in the central directory. The fixtures
 * here are written that way, because a reader that only walks local headers
 * passes a hand-built stored ZIP and opens no Drive export at all.
 */
import { deflateRawSync } from "node:zlib";
import { csvCellRanges, formatDelimited, parseCsvLine } from "../lib/csv";
import { docxToText, xlsxSheets, xlsxToText } from "../lib/office";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

/** A deflated ZIP laid out the way Drive's export lays one out. */
function encodeZip(files: Record<string, string>): Buffer {
    const local: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;

    for (const [name, text] of Object.entries(files)) {
        const fileName = Buffer.from(name);
        const data = deflateRawSync(Buffer.from(text));
        const size = Buffer.byteLength(text);

        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0);
        header.writeUInt16LE(0x0808, 6);
        header.writeUInt16LE(8, 8);
        header.writeUInt16LE(fileName.length, 26);

        // The CRC is left zero; the reader trusts the directory's sizes.
        const descriptor = Buffer.alloc(16);
        descriptor.writeUInt32LE(0x08074b50, 0);
        descriptor.writeUInt32LE(data.length, 8);
        descriptor.writeUInt32LE(size, 12);

        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(0x02014b50, 0);
        entry.writeUInt16LE(0x0808, 8);
        entry.writeUInt16LE(8, 10);
        entry.writeUInt32LE(data.length, 20);
        entry.writeUInt32LE(size, 24);
        entry.writeUInt16LE(fileName.length, 28);
        entry.writeUInt32LE(offset, 42);

        local.push(header, fileName, data, descriptor);
        central.push(entry, fileName);
        offset += 30 + fileName.length + data.length + 16;
    }

    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(central.length / 2, 8);
    end.writeUInt16LE(central.length / 2, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);

    return Buffer.concat([...local, directory, end]);
}

const RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const workbook = encodeZip({
    "[Content_Types].xml": "<Types/>",
    "xl/media/image1.png": "not really a png",
    "xl/workbook.xml":
        `<workbook xmlns:r="${RELS}"><workbookPr/><sheets>` +
        `<sheet state="visible" name="Roster" sheetId="1" r:id="rId1"/>` +
        `<sheet state="visible" name="Chart" sheetId="2" r:id="rId2"/>` +
        `<sheet state="hidden" name="Ways &amp; Means" sheetId="3" r:id="rId3"/>` +
        `<sheet state="visible" name="Blank" sheetId="4" r:id="rId4"/>` +
        `<sheet state="visible" name="Kinds" sheetId="5" r:id="rId5"/>` +
        `</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
        `<Relationships>` +
        `<Relationship Id="rId9" Type="${RELS}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId1" Type="${RELS}/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${RELS}/chartsheet" Target="chartsheets/sheet1.xml"/>` +
        `<Relationship Id="rId3" Type="${RELS}/worksheet" Target="/xl/worksheets/sheet3.xml"/>` +
        `<Relationship Id="rId4" Type="${RELS}/worksheet" Target="worksheets/sheet4.xml"/>` +
        `<Relationship Id="rId5" Type="${RELS}/worksheet" Target="./worksheets/sheet5.xml"/>` +
        `</Relationships>`,
    "xl/styles.xml":
        `<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="mmm&quot; &quot;d"/></numFmts>` +
        `<cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs>` +
        `<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/>` +
        `<xf numFmtId="164"><alignment wrapText="1"/></xf><xf numFmtId="2"/></cellXfs></styleSheet>`,
    "xl/sharedStrings.xml":
        `<sst>` +
        `<si><t>Ada</t></si>` +
        `<si><r><rPr><b/></rPr><t xml:space="preserve">Civic </t></r><r><t>Engagement</t></r></si>` +
        `<si><t>漢字</t><rPh sb="0" eb="2"><t>カンジ</t></rPh><phoneticPr fontId="1"/></si>` +
        `<si/>` +
        `<si><t/></si>` +
        `<si><t>after the empties</t></si>` +
        `<si><t>two&#10;lines, quoted "here"</t></si>` +
        `<si><t>Tom &amp;lt;3 &#x1F600;</t></si>` +
        `<si><t>carriage_x000D_return</t></si>` +
        `</sst>`,
    "xl/worksheets/sheet1.xml":
        `<worksheet><sheetData>` +
        `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>` +
        `<row r="2" spans="1:3"/>` +
        `<row r="3"><c r="A3" t="inlineStr"><is><t>Grace</t></is></c><c r="B3" s="1"/><c r="C3"><v>1.0</v></c></row>` +
        `</sheetData></worksheet>`,
    "xl/chartsheets/sheet1.xml": `<chartsheet/>`,
    "xl/worksheets/sheet2.xml":
        `<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>IGNORE ME</t></is></c></row></sheetData></worksheet>`,
    "xl/worksheets/sheet3.xml":
        `<worksheet><sheetData>` +
        `<row><c r="A1" t="inlineStr"><is><t>Coffee</t></is></c><c r="B1"><v>12</v></c></row>` +
        `</sheetData></worksheet>`,
    "xl/worksheets/sheet4.xml": `<worksheet><sheetData/></worksheet>`,
    "xl/worksheets/sheet5.xml":
        `<worksheet><sheetData>` +
        `<row r="1"><c r="A1" t="s"><v>2</v></c><c r="B1" t="s"><v>3</v></c><c r="C1" t="s"><v>4</v></c><c r="D1" t="s"><v>5</v></c></row>` +
        `<row r="2"><c r="A2" t="b"><v>1</v></c><c r="B2" t="e"><v>#N/A</v></c><c r="C2" t="str"><f>A1&amp;"!"</f><v>漢字!</v></c><c r="D2" s="1"><v>45398</v></c><c r="E2" s="2"><v>45398.5</v></c><c r="F2" s="3"><v>0.5</v></c></row>` +
        `<row r="3"><c r="A3" t="s"><v>6</v></c><c r="B3" t="s"><v>7</v></c><c r="C3" t="s"><v>8</v></c></row>` +
        `</sheetData></worksheet>`,
});

console.log("xlsxSheets");

const sheets = xlsxSheets(workbook);
check(
    "a Drive-style archive (data descriptors, zero local sizes) opens",
    sheets.length > 0,
    sheets,
);
check(
    "tabs follow the workbook, empty and hidden ones included, chart sheets left out",
    sheets.map((sheet) => sheet.name).join("|") === "Roster|Ways & Means|Blank|Kinds",
    sheets.map((sheet) => sheet.name),
);
check(
    "an omitted blank cell keeps the next value in its column",
    JSON.stringify(sheets[0]?.rows[0]) === JSON.stringify(["Ada", "", "Civic Engagement"]),
    sheets[0]?.rows[0],
);
check(
    "a self-closing row neither takes the next row nor leaves one behind",
    sheets[0]?.rows.length === 2 &&
        JSON.stringify(sheets[0].rows[1]) === JSON.stringify(["Grace", "", "1"]),
    sheets[0]?.rows,
);

const kinds = sheets[3]?.rows ?? [];
check(
    "phonetic runs are not part of the string",
    kinds[0]?.[0] === "漢字",
    kinds[0],
);
check(
    "`<si/>` and `<t/>` hold their index, so later strings stay aligned",
    kinds[0]?.[1] === "" && kinds[0]?.[2] === "" && kinds[0]?.[3] === "after the empties",
    kinds[0],
);
check(
    "booleans, errors, and cached formula results read as Drive prints them",
    kinds[1]?.slice(0, 3).join("|") === "TRUE|#N/A|漢字!",
    kinds[1],
);
check(
    "a date-formatted serial reads as a date, built-in or custom format",
    kinds[1]?.[3] === "4/16/2024" && kinds[1]?.[4] === "4/16/2024 12:00:00",
    kinds[1],
);
check(
    "a number that is not a date is not turned into one",
    kinds[1]?.[5] === "0.5",
    kinds[1],
);
check(
    "entities decode once, astral characters included",
    kinds[2]?.[1] === "Tom &lt;3 \u{1F600}",
    kinds[2],
);
check(
    "Excel's _x000D_ escape is a carriage return",
    kinds[2]?.[2] === "carriage\rreturn",
    JSON.stringify(kinds[2]?.[2]),
);

console.log("\nxlsxToText");

const text = xlsxToText(workbook) ?? "";
check(
    "the first tab is unmarked and comes first",
    text.startsWith("Ada\t\tCivic Engagement\nGrace\t\t1\n"),
    JSON.stringify(text),
);
check(
    "a later tab is indexed under its name",
    text.includes("\fWays & Means\nCoffee\t12"),
    JSON.stringify(text),
);
check(
    "an empty tab adds no marker",
    !text.includes("\fBlank"),
    JSON.stringify(text),
);
check(
    "a worksheet the workbook does not list is not indexed",
    !text.includes("IGNORE ME"),
);
check(
    "a line break inside a cell does not start a new row",
    text.includes("\ntwo lines, quoted \"here\"\tTom"),
    JSON.stringify(text),
);

const blankFirst = encodeZip({
    "xl/workbook.xml":
        `<workbook xmlns:r="${RELS}"><sheets>` +
        `<sheet name="Cover" sheetId="1" r:id="rId1"/><sheet name="Data" sheetId="2" r:id="rId2"/>` +
        `</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
        `<Relationships>` +
        `<Relationship Id="rId1" Type="${RELS}/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${RELS}/worksheet" Target="worksheets/sheet2.xml"/>` +
        `</Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" s="0"/></row></sheetData></worksheet>`,
    "xl/worksheets/sheet2.xml":
        `<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Ada</t></is></c></row></sheetData></worksheet>`,
});
check(
    "a workbook whose first tab is blank starts at the next one, unmarked",
    xlsxToText(blankFirst) === "Ada",
    xlsxToText(blankFirst),
);
check(
    "an empty buffer yields no text",
    xlsxToText(Buffer.alloc(0)) === null,
);
check(
    "a truncated archive yields no text rather than throwing",
    xlsxToText(workbook.subarray(0, workbook.length - 30)) === null,
);

console.log("\ndocxToText");

const docx = encodeZip({
    "word/media/image1.png": "not really a png",
    "word/document.xml":
        `<w:document><w:body>` +
        `<w:p><w:r><w:t>A Bill</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve"> to Fund </w:t></w:r><w:r><w:t>Coffee</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Section 1</w:t></w:r></w:p>` +
        `</w:body></w:document>`,
});
check(
    "a Word file written with data descriptors still opens",
    docxToText(docx) === "A Bill to Fund Coffee\nSection 1",
    docxToText(docx),
);

console.log("\nformatDelimited");

const awkward = [["Ways, Means", 'a "quoted" word', "line one\nline two", "tab\there", "feed\fhere"]];
const csv = formatDelimited(awkward, ",");
check(
    "a comma row stays on one line and parses back to its cells",
    !csv.includes("\n") &&
        JSON.stringify(parseCsvLine(csv)) ===
            JSON.stringify(["Ways, Means", 'a "quoted" word', "line one line two", "tab\there", "feed here"]),
    csv,
);
check(
    "the renderer's cell ranges agree with the parser",
    csvCellRanges(csv, 0, ",")
        .map((ranges) => ranges.map((range) => csv.slice(range.start, range.end)).join(""))
        .join("|") === parseCsvLine(csv).join("|"),
    csvCellRanges(csv, 0, ","),
);
const tsv = formatDelimited(awkward, "\t");
check(
    "a tab row stays on one line with one cell per column",
    !tsv.includes("\n") && !tsv.includes("\f") && tsv.split("\t").length === 5,
    JSON.stringify(tsv),
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
