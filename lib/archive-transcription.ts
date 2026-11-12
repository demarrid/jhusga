/** Deterministic cleanup of local OCR, without rewriting historical wording. */
export function cleanArchiveTranscription(scans: string[]): string {
    const marker = /^#{2,3}\s+(?:Page \d+|(?:Left|Right) page or column|Other visible text)\s*$/;
    const blocks = scans.flatMap(scan => scan.split(/\r?\n/).reduce<string[][]>((out, line) => {
        if (marker.test(line.trim())) out.push([]);
        else out[out.length - 1].push(line);
        return out;
    }, [[]]));
    const lines = blocks.flatMap(block => {
        const clean = block.map(line => line.trim()).filter(Boolean);
        // Printed folios at the end of an image/column are not list entries.
        while (clean.length && /^\d{1,3}$/.test(clean[clean.length - 1])) clean.pop();
        return clean;
    }).map(line => line
        .replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/，/g, ',')
        .replace(/([,;])(?=[A-Za-z])/g, '$1 ')
        .replace(/([A-Za-z]:)(?=[A-Za-z])/g, '$1 ')
        .replace(/([a-z]{2,}|\d)\.(?=[A-Z][a-z])/g, '$1. ')
        .replace(/\)(?=[A-Z][a-z])/g, ') ')
        .replace(/\)\.(?=[A-Z][a-z])/g, '). ')
        .replace(/([a-z])\((?='?\d{2}\))/g, '$1 (')
        .replace(/^\(([a-z])\)\s*/i, '($1) ')
        .replace(/^(\d{1,2}\.)\s*(?=[A-Za-z])/, '$1 ')
        .replace(/^(SEC(?:TION)?\.?)(?=\s*\d)/i, m => m.toUpperCase())
        .replace(/^(SECTION|SEC\.)\s*(\d+)\s*\.\s*/i, '$1 $2. ')
        .replace(/^ARTICLE\s*([IVXLCDM]+)(?=[.\s]|$)/i, 'ARTICLE $1')
        .trim());
    const paragraphs: string[] = [];
    let current = '';
    const flush = () => { if (current) paragraphs.push(current); current = ''; };
    const heading = (line: string) => line.length < 100 && /[A-Z]{3}/.test(line)
        && line === line.toUpperCase() && !/[a-z]/.test(line) && !/^\(?[\d]/.test(line);
    const item = (line: string) => /^(?:\([a-z0-9]+\)|\d{1,2}[.)]|[A-Z][.)])\s+/i.test(line);
    const section = (line: string) => /^(?:SECTION|SEC\.)\s*\d+[.\s]/i.test(line);
    const standalone = (line: string) => /^(?:Council Notes|Events|Council Subcommittees|prepared by\b)/.test(line)
        || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(line)
        || /^[A-Z][A-Za-z .'-]+,\s*(?:President|Vice-President|Treasurer|Secretary|Social Director)$/.test(line)
        || /^\d{4}\s*[-–]/.test(line)
        || /^[A-Z][A-Za-z .'-]+\s*\('?\d{2}\)$/.test(line);
    function join(left: string, right: string): string {
        const split = /([A-Za-z]+)-$/.exec(left);
        if (split && /^[a-z]/.test(right)) {
            // Keep established compound prefixes; remove typographic word wraps.
            return left.slice(0, -1) + (/^(?:co|ex|vice|non|self|by)$/i.test(split[1]) ? '-' : '') + right;
        }
        return left + ' ' + right;
    }
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (/^[*=_-]{3,}$/.test(line)) continue;
        if (/^\d{1,2}$/.test(line) && lines[i+1]) line += '.';
        if (/^(?:\([a-z]\)|[A-Z][.)]|\d{1,2}\.)$/i.test(line) && lines[i + 1]) line += ' ' + lines[++i];
        if (heading(line)) {
            flush();
            // ARTICLE + caption, or a caption wrapped across two printed lines.
            while (lines[i + 1] && heading(lines[i + 1]) && !/^(?:ARTICLE|SECTION|SEC\.)/.test(lines[i + 1])) line += ' — ' + lines[++i];
            paragraphs.push('## ' + line); continue;
        }
        if (/^\d{1,2}\/\d{1,2}[^A-Za-z]*:/.test(line)) { flush(); current=line; continue; }
        if (/:$/.test(line) && line.length<80) {
            if (current && !/[.!?:]$/.test(current) && !item(line)) current=join(current,line);
            else { flush(); current=line; }
            continue;
        }
        if (standalone(line)) { flush(); paragraphs.push(line); continue; }
        if (/^\d{1,2}\/\d{1,2}[^A-Za-z]*:/.test(line)) flush();
        if (item(line) || section(line) || (/:$/.test(current) && !/^\d{1,2}\//.test(current)) || (/[.!?]$/.test(current) && /^[A-Z][a-z]/.test(line))) flush();
        current = current ? join(current, line) : line;
    }
    flush();
    return paragraphs.join('\n\n');
}

export function archiveDocumentContent(scans: string[], sources: {name: string; url: string}[]): string {
    return cleanArchiveTranscription(scans.map((scan,i) => reviewedArchiveText[sources[i]?.url.match(/\/d\/([^/]+)/)?.[1] ?? ''] ?? scan)) + '\n\n## Sources\n\n'
        + sources.map(s => `[${s.name}](${s.url})`).join(' · ');
}

// Compared directly with the local originals on 2026-11-12. The cover photo
// includes a DIFFERENT constitution behind the booklet; it is not this text.
// The first inside page likewise picked up isolated words from the background.
const reviewedArchiveText: Record<string,string> = {
    '1NLL76AHW809268d2oJxo-39nZJllmYpL': `Constitution of the Student Council of the Johns Hopkins University
HOMEWOOD, BALTIMORE, MARYLAND`,
    '1ifBzV8phYievzHJ-a7H8mvrhaV1M2tEy': `Constitution of the Student Council
ARTICLE I.
NAME
The name of this body shall be the Student Council of the Johns Hopkins University.
ARTICLE II.
OBJECT
The objects of this body shall be:
(a) To serve as a medium between faculty and students.
(b) To correlate the various University activities, promoting co-operation of all parties in all matters affecting the welfare of the University.
(c) To uphold and promote the Johns Hopkins Honor System.
ARTICLE III.
MEMBERSHIP
SECTION 1. The Student Council shall consist of:
(a) The President of the Student Council (hereinafter designated as the President) a Senior.
(b) The President of the Senior Class, member ex-officio, a Senior.
(c) The President of the Athletic Board, member ex-officio, a Senior.`,
};
