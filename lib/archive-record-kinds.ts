import type { DocumentKind } from "@/lib/kinds";
import { toPlainText } from "@/lib/markdown";

/** Classify the form of an archived record, never its adoption or passage.
 * Titles, opening captions and the immediate filing context supply evidence;
 * unrelated mentions deeper in a document do not determine its category. */
export function classifyArchiveRecord(input: {
    name: string; folderPath: string; content?: string; displayTitle?: string; mimeType?: string;
}): DocumentKind | null {
    const title = input.name.toLowerCase().replace(/[_-]/g, " ");
    const path = input.folderPath.toLowerCase().replace(/[_-]/g, " ");
    const body = (input.content ?? "").split("\n").map(toPlainText).join("\n");
    const opening = body.slice(0, 1600).toLowerCase();
    const heading = opening.slice(0, 350);
    if (/judicia/.test(`${title} ${path}`)) return null;
    const titleAndHeading = `${title}\n${heading}`;
    if (/\bpersonal rewrite\b/.test(title)) return "working.document";
    if (/^image\//.test(input.mimeType ?? "") || /\.(?:png|jpe?g|heic|gif|webp)\b/.test(input.name.toLowerCase()) || /\b(?:portraits|pictures|photos)\b/.test(title)) return "media";
    if (/\btemplate\b|minutes framework/.test(title) || /\/(?:templates|templates and examples|templates\s+examples)$/.test(path)) return "template";
    if (/\bresume\d*\b|\bcv\b/.test(title) || /\/resume(?:s|~1)?$/.test(path)) return "resume";
    if (/\/(?:research|international research|philosophical research|university document compendium|\d+ reference materials)(?:\/[^/]+)?$/.test(path)) return "reference";
    // Formal bill captions are stronger than a generic event title or folder.
    if (/\bresolution\b/.test(title)) return null;
    const billCaption = opening.split("\n").find(line => /^(?:a |an )?(?:sga )?(?:event )?(?:funding )?(?:bill|act)\b|^amendment of/.test(line.trim())) ?? "";
    const bill = /\b(?:s\.?\s*bill|s[. -]b[. -]\d|sga[. -]b[. -]\d|(?:a|an)\s+(?:sga\s+)?(?:event\s+)?(?:funding\s+)?bill)\b/.test(opening)
        || /\bsga b \d|\bs b\.\d/.test(title);
    if (bill && !/minutes|agenda|meeting|\bideas\b/.test(title) && (billCaption || /\bsga b \d|\bs b\.\d/.test(title))) {
        if (/procedural rules|senate rules|standing rules|rules bill/.test(`${billCaption} ${title}`)) return "bill.senate_rules";
        if (/bylaws?/.test(billCaption) && /amend/.test(billCaption)) return /constitution/.test(billCaption) || /constitutional amendments? proposed in this bill/.test(opening) ? "bill.bylaws_constitution_amendment" : "bill.bylaws_amendment";
        if (/constitution/.test(billCaption) && /amend/.test(billCaption)) return "bill.constitution_amendment";
        if (/procedural rules|senate rules|standing rules/.test(opening)) return "bill.senate_rules";
        if (/funding|appropriation|budget/.test(title) || /funding bill|bill.{0,80}(?:fund|allocat|appropriat)|act to fund/.test(billCaption)) return "bill.funding";
        return "bill.other";
    }
    if (/\bbill\b|\bact\b|bylaws?|constitution/.test(title) && !/training|personal rewrite|highlights/.test(title)) return null;
    if (/attendance/.test(title) && !/guideline/.test(title)) return "attendance";
    if (/email list|contact list|contact sheet|directory/.test(title)) return "directory";
    if (/tracker/.test(title)) return "tracker";
    if (/sign\s?up|scheduling/.test(title)) return "schedule";
    if (/\b(?:invoice|receipt|quote\d*|purchase order|financial statement)\b/.test(title)) return "finance.record";
    if (/\b(?:budget|funding request|request for funding|request.*funds|fund request)\b/.test(title) && !/\bbill\b|\bact\b|resolution|amendment/.test(title)) return "finance.record";
    if (/\b(?:transition|handover)\b/.test(title) || /\/(?:transition documents|transition to \d+.*|executive board transition documents)(?:\/[^/]+)?$/.test(path)) return "transition";
    if (/\b(?:survey|questionnaire|feedback|responses)\b/.test(title) && !/report|analysis/.test(title)) return "survey";
    if (/\b(?:application|applications|evaluations?|registration submissions|re registration)\b/.test(title) || /student group applications|new group registration/.test(path)) return "application";
    if (/\b(?:report|findings|investigation summary|activity summary|summary of.*activities)\b/.test(title) && !/post meeting report/.test(title)) return "report";
    if (/\b(?:letter|email|memorandum|memos?|groupme message|solicitation)\b/.test(title) || /all school emails|monthly emails|confirmation emails/.test(path) || /^(?:from:|dear\b)/.test(heading.trim())) return "correspondence";
    if (/\b(?:statement|press release|op ed)\b/.test(title) && !/mission statement|financial statement/.test(title)) return "statement";
    if (/\b(?:calendar|schedule|timeline|itinerary|sign\s?ups?|timeslot|volunteering)\b/.test(title)) return "schedule";
    if (/\b(?:petition|referendum questions)\b/.test(title)) return "petition";
    if (/\b(?:handbook|handout|manual|guide|instructions|how to|faq|cheat sheet|flowchart|codebook|user guide|guidelines?|oaths? of office|duties|responsibilities|role description|tips for|polic(?:y|ies)|procedures|mission statement)\b/.test(title)) return "reference";
    if (/\b(?:links|address book|master list|list of (?:clubs|.*organizations|.*members)|members of|committee placements|committee memberships)\b/.test(title)) return "directory";
    if (/\b(?:task|to do|milestones|assignments|disciplinary marks|tracksheet|tracking|aggregate legislation data)\b/.test(title)) return "tracker";
    if (/\b(?:plan|planning|proposal|initiative|initiatives|ideas|aspirations|goals|objectives)\b/.test(title)) return "plan";
    // Meeting questions and personal interview notes aren't official committee minutes.
    if (/\bquestions?\b|discussion (?:points|topics)/.test(title)) return "notes.meeting";
    if (/meeting (?:with|w\/|witih)|call notes|phone call|coordination call|debrief/.test(title) || /miscellaneous meetings|administrator meetings/.test(path)) return "notes.meeting";
    const meeting = /minutes|mintues|\bagenda|\bmeeting|post meeting report|\bmtg\b|executive #\d/.test(titleAndHeading)
        || (/\/(?:agendas?\s*(?:and\s*)?minutes|(?:freshmen meeting |exec meeting |exec )?minutes|exec meetings|first semester|second semester)$/.test(path) && /^\d/.test(title));
    if (meeting) {
        if (/faculty senate|exec director/.test(title)) return "notes.meeting";
        if (/\bexec/.test(title)) return "minutes.executive";
        if (/senate|general body|\bgbm\b/.test(title) && !/\bcso\b/.test(title)) return "minutes.senate";
        if (/class council|class of 20\d\d|\bsocc\b|sophomoreclasscouncil|sophmore/.test(`${title} ${path}`)) return "minutes.class_council";
        if (/\bcmc\b|communications.{0,8}marketing|programming committee/.test(`${title} ${path}`)) return "minutes.committee";
        if (/committee|student org|academic affairs|health.{0,12}safety|sustainability|student services|civic engagement/.test(`${title} ${path}`) && !/demarri/.test(path)) return "minutes.committee";
        if (/\bexec/.test(`${title} ${path}`)) return "minutes.executive";
        if (/senate|general body|\bgbm\b/.test(`${title} ${path}`)) return "minutes.senate";
        return "minutes.other";
    }
    if (/\b(?:working doc|drafting doc|running doc|writeup|write up|notes|website changes|website update)\b/.test(title)) return "working.document";
    if (/\b(?:trivia|flyer|decor|scavenger hunt|food order|food and drink|icebreaker|workshop|training|teambuilding|event|formal|garden party|soph show|retreat|tabling|senior week|senior day)\b/.test(title)) return "event.material";
    if (/\belections?\b/.test(title)) return "election";
    return null;
}
