/**
 * Comparing a stored Word import with a fresh conversion of the same bytes,
 * when the stored copy has lost its formatting.
 *
 * The archive importer (scripts/archive-native.py) read a .docx as plain
 * paragraphs: no bold, list numbers or hyperlinks. docxToMarkdown keeps all
 * of that. When the two hold the same words, the fresh conversion is a
 * formatting-only upgrade, and citations can be moved onto it.
 */

/** The text with Markdown syntax and all whitespace removed, and where each kept character came from. */
export function formattingFreeText(markdown: string): { text: string; map: number[] } {
    const removed = new Uint8Array(markdown.length);
    const drop = (start: number, end: number) => removed.fill(1, start, end);
    // A link keeps its label: "[" and "](url)" go.
    for (const link of markdown.matchAll(/(?<!\\)\[((?:\\.|[^\]\\])*)\]\((?:[^()\s]|\([^()]*\))*\)/g)) {
        drop(link.index!, link.index! + 1);
        drop(link.index! + 1 + link[1].length, link.index! + link[0].length);
    }
    for (const marker of markdown.matchAll(/^[ \t]*(?:#{1,6}[ \t]|\d+\.[ \t]|[-*+][ \t])/gm)) drop(marker.index!, marker.index! + marker[0].length);
    for (const tag of markdown.matchAll(/<br\s*\/?>/gi)) drop(tag.index!, tag.index! + tag[0].length);
    for (const escape of markdown.matchAll(/\\(?=.)/g)) drop(escape.index!, escape.index! + 1);
    let text = "";
    const map: number[] = [];
    for (let index = 0; index < markdown.length; index++) {
        const char = markdown[index]!;
        if (removed[index] || /\s|[*_|]/.test(char)) continue;
        text += char;
        map.push(index);
    }
    return { text, map };
}

/** The body before an archive record's "## Sources" footer, and the footer itself. */
export function splitSources(content: string): { body: string; sources: string } {
    const at = content.search(/\n+## Sources\n/);
    return at < 0 ? { body: content, sources: "" } : { body: content.slice(0, at), sources: content.slice(at).replace(/^\n+/, "") };
}

/** Whether `fresh` only adds formatting to `stored`: the same words, character for character. */
export function sameWords(stored: string, fresh: string): boolean {
    const text = formattingFreeText(stored).text;
    return text.length > 0 && text === formattingFreeText(fresh).text;
}

/**
 * Where a quote cited in the plain copy now sits in the formatted one, as
 * the exact slice of `content` to cite, and that slice's start offset.
 *
 * A quote that occurs once is unambiguous. One that repeats (an agenda
 * restated in an addendum) needs `from`: the old text and the citation's
 * offset in it, which say the citation was, say, the first of two copies;
 * the same copy is taken in the new text when both hold the same number.
 */
export function relocateQuote(content: string, quote: string,
    from?: { content: string; startOffset: number }): { quote: string; startOffset: number } | null {
    const needle = formattingFreeText(quote).text;
    if (!needle) return null;
    const haystack = formattingFreeText(content);
    const positions = occurrences(haystack.text, needle);
    let at = positions.length === 1 ? positions[0] : undefined;
    if (positions.length > 1 && from) {
        const old = formattingFreeText(from.content);
        const before = occurrences(old.text, needle);
        const which = before.findIndex(position => old.map[position] === from.startOffset);
        if (before.length === positions.length && which >= 0) at = positions[which];
    }
    if (at === undefined) return null;
    let start = haystack.map[at]!;
    let end = haystack.map[at + needle.length - 1]! + 1;
    // Take a link's or emphasis's closing syntax with its last word, so the
    // cited slice renders as it does in the document.
    const closing = /^(?:\*{1,3}|_{1,3}|\]\((?:[^()\s]|\([^()]*\))*\)|\\\])*/.exec(content.slice(end))![0];
    end += closing.length;
    // An opening "[" or emphasis marker directly before the first word belongs to it too.
    const opening = /(?:\[|\*{1,3}|_{1,3}|\\\[)*$/.exec(content.slice(0, start))![0];
    start -= opening.length;
    return { quote: content.slice(start, end), startOffset: start };
}

function occurrences(text: string, needle: string): number[] {
    const found: number[] = [];
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) found.push(at);
    return found;
}
