/**
 * One CSV row into cells.
 *
 * Sheets exported from Drive are the only CSV this site reads, so this handles
 * exactly what Drive emits: comma separators and doubled quotes inside quoted
 * cells ("First-Generation, Limited-Income").
 */
export function parseCsvLine(line: string): string[] {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index]!;
        if (char === '"') {
            if (inQuotes && line[index + 1] === '"') {
                current += '"';
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (char === "," && !inQuotes) {
            cells.push(current.trim());
            current = "";
            continue;
        }
        current += char;
    }
    cells.push(current.trim());
    return cells;
}
