import type { DocumentKind } from "@/lib/kinds";

/** Stable recognition colors for the exact types in the document search filter.
 * Deliberately independent of the site's brand palette. Keep existing assignments
 * stable when adding types so repeat visitors can learn their colors.
 */
const DOCUMENT_KIND_COLORS: Record<DocumentKind, string> = {
    "minutes.executive": "#2563EB",
    "minutes.senate": "#E05232",
    "minutes.committee": "#009E73",
    "minutes.judicial": "#9333EA",
    "bill.senate_rules": "#D69B00",
    "bill.funding": "#DB2777",
    "bill.bylaws_amendment": "#00A6C7",
    "bill.constitution_amendment": "#7A4D28",
    "bill.bylaws_constitution_amendment": "#8A9A00",
    "bill.other": "#E88526",
    resolution: "#C62828",
    "guiding.constitution": "#172554",
    "guiding.bylaws": "#006B5E",
    "guiding.other": "#663399",
    "judicial.writ_of_certiorari": "#C05A98",
    "judicial.writ_of_mandamus": "#627B16",
    "judicial.writ": "#617CC5",
    "judicial.advisory_opinion": "#AD6500",
    "judicial.opinion": "#7F1D46",
    "judicial.order": "#397D9C",
    "judicial.complaint": "#B36B5E",
    "judicial.other": "#8070A6",
    attendance: "#54A82C",
    directory: "#27B8A8",
    tracker: "#BA8F42",
    presentation: "#E87D9D",
    template: "#8D8274",
    "newsletter.article": "#632E18",
    unknown: "#64748B",
};

export function documentKindColor(kind: string): string {
    return Object.hasOwn(DOCUMENT_KIND_COLORS, kind)
        ? DOCUMENT_KIND_COLORS[kind as DocumentKind]
        : DOCUMENT_KIND_COLORS.unknown;
}
