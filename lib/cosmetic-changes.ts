/** Compare presentation without changing the source stored in version history.
 * Keep wording, numbers, links, strikethrough and ordinary punctuation exact.
 */
function cosmeticText(text: string): string {
    return text.split(/\r?\n/).map(line => {
        let value = line.trim()
            .replace(/\*\*|__/g, "")
            .replace(/(?<!\w)[*_]([^*_\n]+)[*_](?!\w)/g, "$1")
            .replace(/^(\d+(?:\.\d+)+)\.(?=\s)/, "$1");
        // Capitalization of the document masthead does not change a rule.
        if (/^(?:bylaws|constitution)\s+of\b/i.test(value) && value.length < 120 && !/[.!?;:]/.test(value)) {
            value = value.toLowerCase();
        }
        return value.replace(/[\t ]+/g, " ");
    }).filter(Boolean).join("\n");
}

export function isCosmeticChange(before: string, after: string): boolean {
    const baseline = cosmeticText(before);
    return baseline.length > 0 && baseline === cosmeticText(after);
}
