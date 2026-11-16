/** Recover a plain-text slide deck's headings from its own agenda.
 * All ranges address the unchanged source, including PDF hard wraps.
 * Require repeated agenda labels so ordinary prose/minutes keep their parser.
 */
type PresentationHeading = { start: number; end: number; title: string; textStart?: number };

export function presentationSections(content: string): PresentationHeading[] {
    const agenda = /(?:^|\n\n)AGENDA\n([^]*?)(?=\n\n|$)/.exec(content);
    if (!agenda || /^\s*[#|]/m.test(content)) return [];
    const bodyStart = agenda.index + agenda[0].length;
    const labels = agenda[1].split('\n').map(line => line.trim()).filter(line => /[a-z]/i.test(line) && line.length >= 8);
    const headings: PresentationHeading[] = [];
    let repeated = 0;
    for (const label of labels) {
        const pattern = label.split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[ \\t\\n]+');
        const matches = [...content.matchAll(new RegExp(`^${pattern}(?: cont\\.)?$`, 'gmi'))].filter(match => match.index >= bodyStart);
        if (matches.length) repeated++;
        for (const match of matches) {
            // Some slide producers put a title last in PDF reading order.
            // Move it above its own paragraph, retaining original text ranges.
            const paragraphStart = content.lastIndexOf('\n\n', match.index - 1) + 2;
            const start = Math.max(bodyStart, paragraphStart);
            headings.push({ start, textStart: match.index, end: match.index + match[0].length, title: match[0].replace(/\s+/g, ' ') });
        }
    }
    if (repeated < 3) return [];
    // Full numbered questions, including wrapped second lines and subquestions.
    for (const match of content.matchAll(/^\d+[a-z]?\. [^\n]+(?:\n[^\n]+){0,2}/gm)) {
        if (match.index < bodyStart) continue;
        const question = /^([^]*?\?+(?:[^\S\n]*\([^\n]*\))?)(?=\n|$)/.exec(match[0]);
        if (question) headings.push({ start: match.index, end: match.index + question[1].length, title: question[1].replace(/\s+/g, ' ') });
    }
    // A short title directly before bullets is also an authored slide heading.
    for (const match of content.matchAll(/(?:^|\n\n)((?!- )[^\n]+(?:\n(?!- )[^\n]+){0,2})\n(?=- )/g)) {
        const title = match[1];
        const start = match.index + match[0].indexOf(title);
        if (start < bodyStart || title.length > 120 || /[:.!?]$/.test(title) || headings.some(h => h.start <= start && h.end > start)) continue;
        headings.push({ start, end: start + title.length, title: title.replace(/\s+/g, ' ') });
    }
    const summary = /^IN SUMMARY$/m.exec(content);
    if (summary) headings.push({ start: summary.index, end: summary.index + summary[0].length, title: 'IN SUMMARY' });
    return headings.sort((a, b) => a.start - b.start).filter((heading, index, all) => index === 0 || heading.start >= all[index - 1].end);
}
