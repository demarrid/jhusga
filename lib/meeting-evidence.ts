import { toPlainText } from "@/lib/markdown";

const NAME = String.raw`(?:(?:Dr\.|Pres\.|President|Dean|Provost|Professor)\s+)?[A-Z][A-Za-z’'-]+(?:\s+[A-Z][A-Za-z’'-]+){0,2}`;
const NARRATIVE = new RegExp(`^(${NAME}(?:\\s+and\\s+${NAME})?)\\s+(?:also\\s+)?(thinks?|proposed|expressed|noted|responded|stated|reported|asked|suggested|explained|agreed|said|talked about)\\s+(.+)`);

/** Only direct, line-leading attributions: never a name inside another person's quote. */
export function narrativeSpeakers(raw: string): string[] {
    const line = toPlainText(raw).replace(/^\s*(?:\d+[.)]\s*|[-*]\s*)/, "").trim();
    const match = NARRATIVE.exec(line);
    if (!match) return [];
    return match[1]!.split(/\s+and\s+/).map(name => name.replace(/^(?:Dr\.|Pres\.|President|Dean|Provost|Professor)\s+/, ""));
}

/** Repeated recorded discussion outweighs an agenda filename. Empty templates do not. */
export function hasRecordedDiscussion(content: string): boolean {
    const lines = content.split(/\r?\n/);
    if (lines.filter(line => narrativeSpeakers(line).length > 0).length >= 3) return true;
    const labels = new Set<string>();
    for (const raw of lines) {
        const line = toPlainText(raw).replace(/^\s*(?:\d+[.)]\s*|[-*]\s*)/, "").trim();
        const match = /^([A-Za-z’'-]+)(?:\s*\([^)]*\))?:\s+(.+)/.exec(line);
        if (match && match[2]!.split(/\s+/).length >= 6 && !/^(?:date|time|location|venue|agenda|minutes|purpose|present|absent|excused|participants|discussion|updates?|reports?|introductions|note|notes|action|motion|vote|result|next|planners|second|seconds)$/i.test(match[1]!)) labels.add(match[1]!.toLowerCase());
    }
    const turns = labels.size;
    return turns >= 3 || (turns >= 1 && lines.some(line => /^minutes:?$/i.test(toPlainText(line).trim())));
}
