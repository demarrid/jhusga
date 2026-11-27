/**
 * Which newlines in a paragraph are a PDF's line wraps rather than breaks the
 * author typed.
 *
 * Minutes pasted from a PDF keep every line the PDF printed, so a paragraph
 * arrives as sixty-character lines ending mid-sentence. The viewer shows a
 * typed break as a break, and in a narrower column each of those lines wraps
 * again: a full line, then "SGA" or "should" alone under it, all the way down.
 *
 * A newline is treated as a wrap, and shown as a space, when:
 *   - the next line continues a sentence (starts lowercase) after a line long
 *     enough to have been wrapped, or
 *   - the paragraph is set at a fixed width, the line before is near full,
 *     and it either stops mid-sentence or the next line's first word would
 *     not have fit on it -- which is why it wrapped.
 * A next line that opens with an item marker ("ii.", "b)", "3.2.1"), a bullet
 * or a "Label:", and a line ending in a colon, are always real breaks.
 *
 * Returns the text with those newlines replaced one-for-one by spaces, so
 * every offset into it (citations, anchors) is unchanged.
 */
export function reflowHardWraps(text: string): string {
    if (!text.includes("\n")) return text;
    const lines = text.split("\n");
    if (lines.length < 2) return text;

    // The width the PDF set the paragraph at: its longest line. It counts only
    // when most lines run close to it -- a title over two short lines is as
    // long as its longest line too, but nothing in it wrapped.
    const widths = lines.slice(0, -1).map((line) => line.trimEnd().length);
    const width = Math.max(...widths);
    const full = widths.filter((length) => length >= width * 0.85).length;
    const wrapped = lines.length >= 3 && width >= 40 && width <= 110 && full >= 2 && full * 2 >= widths.length;

    let out = lines[0]!;
    for (let index = 1; index < lines.length; index += 1) {
        const before = lines[index - 1]!.trimEnd();
        const next = lines[index]!;
        out += (isWrap(before, next, wrapped ? width : null) ? " " : "\n") + next;
    }
    return out;
}

/**
 * The same, over a paragraph's runs. A wrap can fall between two runs, so the
 * decision is made on their joined text, and each newline becomes one space:
 * every run keeps its length, and its citation offsets with it.
 */
export function reflowRuns<Run extends { text: string }>(runs: Run[]): Run[] {
    const text = runs.map((run) => run.text).join("");
    const flowed = reflowHardWraps(text);
    if (flowed === text) return runs;
    let position = 0;
    return runs.map((run) => {
        const piece = flowed.slice(position, position + run.text.length);
        position += run.text.length;
        return piece === run.text ? run : { ...run, text: piece };
    });
}

// "b.", "iv.", "12)", "3.2.1.4": a letter, a roman numeral, a number or a
// bylaw clause. Not any short word -- "only." ending a wrapped sentence is
// not item "only".
const ITEM_MARKER = /^\s*(?:(?:[a-z]|[ivxlc]{1,6}|\d{1,3})[.)]|\d{1,3}(?:\.\d{1,3})+\.?)\s/i;
// A bullet, heading, quote or table row, or a form's "Phone Number:" label.
const LINE_START = /^\s*(?:[-*+•●▪◦○■□–>#|]|\*\*[^*\n]{1,40}:\*\*|[A-Z][\w ]{0,30}:\s)/;

function isWrap(before: string, next: string, width: number | null): boolean {
    const after = next.trimStart();
    if (!before || !after) return false;
    if (ITEM_MARKER.test(after) || LINE_START.test(after) || /^https?:\/\//.test(after)) return false;
    // A table of contents: "The Poster Policy ........ 6", one entry a line.
    if (/\.{4,}|…{2,}/.test(before) || /\.{4,}|…{2,}/.test(after)) return false;
    if (/[:;]$/.test(before)) return false;

    // 40: a letterhead's "Student Government Association / of" is shorter.
    if (/^[a-z]/.test(after) && before.length >= 40) return true;

    if (width === null || before.length < width * 0.75) return false;
    // In a paragraph set at a fixed width, a near-full line that stops
    // mid-sentence ("at the Great Hall in / Levering") wrapped. The PDF's font
    // is proportional, so counting characters alone misses some of these.
    if (!/[.!?)"”’]$/.test(before)) return true;
    const firstWord = after.split(/\s/, 1)[0]!;
    return before.length + 1 + firstWord.length > width;
}
