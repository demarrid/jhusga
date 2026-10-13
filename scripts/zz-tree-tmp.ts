import { readFileSync } from "node:fs";
import { renderDocument, runsText, type Block } from "@/lib/render";
const content = readFileSync(process.argv[2]!, "utf8");
const out: string[] = [];
const walk = (blocks: Block[], pad: string) => {
  for (const b of blocks) {
    if (b.kind === "heading") out.push(`${pad}H${b.level}${b.marker ? " [" + b.marker + "]" : ""}${b.ruled ? " ruled" : ""}${b.sectionId ? " #" : ""} ${runsText(b.runs).slice(0, 70)}`);
    else if (b.kind === "paragraph") out.push(`${pad}P${b.sectionId ? " #" : ""} ${JSON.stringify(runsText(b.runs).slice(0, 70))}`);
    else if (b.kind === "list") {
      out.push(`${pad}${b.agenda ? "AGENDA" : b.ordered ? "OL" : "UL"}${b.numbering ? "(" + b.numbering + ")" : ""} start=${b.start}`);
      for (const it of b.items) { out.push(`${pad}  - v=${it.value ?? ""}${it.sectionId ? " #" : ""} ${runsText(it.runs).slice(0, 60)}`); walk(it.blocks, pad + "      "); }
    } else if (b.kind === "quote") { out.push(pad + "QUOTE"); walk(b.blocks, pad + "  "); }
    else out.push(pad + b.kind.toUpperCase());
  }
};
walk(renderDocument(content, []), "");
console.log(out.slice(0, Number(process.argv[3] ?? 200)).join("\n"));
