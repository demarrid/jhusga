/** The text-layer geometry returned by unpdf (in PDF points). */
export type PdfTextItem = {
    str: string;
    x: number;
    y: number;
    width: number;
    fontSize: number;
    hasEOL: boolean;
};

type Line = { items: PdfTextItem[]; text: string; x: number; y: number; size: number };

function linesFromItems(items: PdfTextItem[]): Line[] {
    const lines: Line[] = [];
    let current: PdfTextItem[] = [];
    const flush = () => {
        if (!current.length) return;
        const first = current[0];
        let text = "";
        let right = first.x;
        for (const item of current) {
            // PDF producers sometimes omit explicit space tokens.
            if (text && !/\s$/.test(text) && !/^\s/.test(item.str)
                && item.x - right > item.fontSize * 0.2) text += " ";
            text += item.str;
            right = item.x + item.width;
        }
        lines.push({ items: current, text: text.trim(), x: first.x, y: first.y, size: first.fontSize });
        current = [];
    };
    for (const item of items) {
        // Empty EOL tokens can describe the *next* line, so use geometry too.
        if (current.length && Math.abs(item.y - current[0].y) > 2) flush();
        if (item.str) current.push(item);
        if (item.hasEOL) flush();
    }
    flush();
    return lines.filter(line => line.text);
}

const BULLET = /^([•▪◦●○■‣⁃\-*+])\s+(\S.*)$/;

function marker(line: Line): { body: string; bodyX: number } | null {
    const match = BULLET.exec(line.text);
    const ink = line.items.filter(item => item.str.trim());
    // Word's hollow bullet is often exported as the letter "o". Require a
    // separate glyph and a hanging gap; ordinary prose beginning "o ..." stays.
    const hollow = ink[0]?.str === "o" && ink[1]
        && ink[1].x - (ink[0].x + ink[0].width) >= line.size * 0.5;
    if (!match && !hollow) return null;
    const body = match ? match[2] : line.text.replace(/^o\s+/, "");
    return { body, bodyX: ink[1]?.x ?? line.x + line.size * 1.5 };
}

/**
 * Recover bullet indentation before flattening the text layer. Keep the PDF's
 * reading order; sorting an entire page by coordinates would interleave columns.
 * Tables and arbitrary page design remain plain text.
 */
export function pdfItemsToText(pages: PdfTextItem[][]): string {
    const lines = pages.map(linesFromItems);
    return lines.map(page => {
        const positions: number[] = [];
        for (const line of page) {
            if (marker(line) && !positions.some(x => Math.abs(x - line.x) <= 3)) positions.push(line.x);
        }
        positions.sort((a, b) => a - b);
        const output: string[] = [];
        let previous: { bodyX: number; y: number; size: number } | null = null;
        for (const line of page) {
            const bullet = marker(line);
            if (bullet) {
                const depth = positions.findIndex(x => Math.abs(x - line.x) <= 3);
                output.push(`${"    ".repeat(Math.max(0, depth))}- ${bullet.body}`);
                previous = { bodyX: bullet.bodyX, y: line.y, size: line.size };
            } else if (previous && Math.abs(line.x - previous.bodyX) <= 3
                && previous.y - line.y > 0
                && previous.y - line.y <= Math.max(previous.size, line.size) * 2) {
                output[output.length - 1] += ` ${line.text}`;
                previous.y = line.y;
            } else {
                if (previous) output.push("");
                output.push(line.text);
                previous = null;
            }
        }
        return output.join("\n");
    }).join("\n\n");
}
