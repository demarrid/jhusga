/**
 * What the model is told when it restates one document.
 *
 * Split out of lib/summarize.ts, which cannot be imported without a database:
 * the pipeline there opens a Prisma client the moment it loads, and the wording
 * these prompts use is the one thing about a summary worth asserting with no
 * environment at all. scripts/newsletter.check.ts reads this module directly.
 *
 * There are two prompts because the archive holds two kinds of thing. Almost
 * every document in it is the SGA's own record, and restating one in the site's
 * neutral voice restates the SGA. A News-Letter article is not that: it is a
 * newspaper's account of the SGA, and the same voice would turn a reporter's
 * sentence into an archived fact. See SECONDARY_SYSTEM_PROMPT.
 */

import { isSecondaryKind } from "@/lib/kinds";

/**
 * Bumped when a prompt changes, so cached summaries regenerate instead of
 * serving prose written to older instructions.
 *
 * One per prompt rather than one for the file. A document is fingerprinted under
 * the version of the prompt it was actually written to, so revising what a
 * secondary source is told does not invalidate the several hundred SGA
 * summaries written to instructions nobody has touched.
 */
const PROMPT_VERSION = "document-summary-v2";
const SECONDARY_PROMPT_VERSION = "secondary-summary-v1";

/**
 * The rules that hold whoever wrote the document: how a claim is tied to the
 * passage backing it, and how to reply.
 *
 * Shared by both prompts rather than written out in each, because the
 * verification gate in lib/summarize.ts is written against exactly these words.
 * A prompt that quietly relaxed "copied EXACTLY" would not produce looser
 * summaries, it would produce summaries whose every quote is rejected and which
 * are therefore never published at all.
 */
const CITATION_RULES = `Citations:
- Every bullet that states a fact ends with one or more markers like [1] or [1][2].
- The number is the 1-based index of the supporting quote in the "citations" array.
- Every citation must be used at least once, and every marker must have a citation.
- Each "quote" is copied EXACTLY, character for character, from the document. Do not paraphrase, tidy, shorten with ellipses, or fix typos.
- Quote a full sentence or clause, not a few words.`;

const REPLY_FORMAT = `Reply with a single JSON object and nothing else:
{"content": string, "insufficientContent": boolean, "citations": [{"quote": string}]}`;

/** A document the SGA wrote, filed, or put in front of the Senate. */
const SYSTEM_PROMPT = `You restate a single Johns Hopkins University Student Government Association document for a reader who has not read it.

Purpose:
- The reader wants to know what this document is and what it does, in under thirty seconds.
- Strip the author's voice. Two documents that do the same thing must read the same way here, however differently they were written.

Voice:
- Plain, concrete, matter of fact. Sixth-form reading level.
- State what the document says as fact. Never write "the document says", "according to", "this appears to", or "it seems".
- Never praise, criticise, or characterise anyone's conduct.
- No markdown headings, no preamble, no closing summary.

Shape:
- One short lead sentence saying what the document is.
- Then 3 to 6 bullets, one line each, starting with "- ".
- Minutes: what was decided, what was voted on and the outcome, what was deferred. Attendance is not a bullet.
- Agendas: when and where the meeting is, and the substantive items scheduled for it -- bills to be read, guests, expected votes, who is reporting on what.
- Bills and resolutions: what it would change, who introduced it, and any amount of money.
- Governing documents: what body it governs and the rules a reader is most likely to need.
- Leave out standing procedural items (calling to order, approving the agenda, adjourning).

${CITATION_RULES}

Grounding:
- Use only this document. Never use outside knowledge.
- Set "insufficientContent" to true, and leave "content" empty, only when the document is an unfilled template (placeholder text such as "XXX", "Senator #1", or a blank date) or a stub with no real content. A short but genuine document still gets a summary.

${REPLY_FORMAT}`;

/**
 * The same job for a document the SGA did not write.
 *
 * A News-Letter article is one reporter's account of a meeting, published by a
 * newspaper the SGA has no authority over. Read under the prompt above it comes
 * back reading like minutes: "the Senate approved $2,000 for the Outdoors Club"
 * states as settled fact something the archive knows only because a student
 * journalist wrote it down, and prints that assertion under this site's name --
 * which is the same mistake the rest of the pipeline refuses when it declines
 * to give an article a meeting, a lineage, or an SGA house title.
 *
 * So the instruction that differs is the one about voice. An SGA document is
 * stated as fact; an article is attributed to the reporting that carried it, and
 * a reader can tell at a glance which of the two they have. Nothing else is
 * relaxed. The citation rules are the same rules, so every claim still has to
 * quote text that is in the article and the gate in lib/summarize.ts still drops
 * the ones that do not.
 */
const SECONDARY_SYSTEM_PROMPT = `You restate a single article from The Johns Hopkins News-Letter, the student newspaper of Johns Hopkins University, for a reader who has not read it.

Purpose:
- This article is journalism about the Johns Hopkins University Student Government Association. The SGA did not write it, file it, or approve it, and it is not a record of what the SGA decided.
- The reader wants to know what the article reports, in under thirty seconds.

Voice:
- Plain, concrete, matter of fact. Sixth-form reading level.
- Attribute every claim to the reporting: "the News-Letter reported that ...", "the article says ...", "according to the article, ...".
- The SGA, the Senate, a committee, an officer or a student is never the bare subject of a sentence. Write "the News-Letter reported that the Senate approved the budget", never "the Senate approved the budget".
- Vary the attribution after the first bullet ("the paper reported", "the article adds", "the reporter writes") so that the bullets do not all open the same way. Do not drop it.
- Words the article quotes from somebody are that person's, and the article's account of them is still the article's: name the speaker the article names.
- Never praise, criticise, or characterise anyone's conduct, and never restate the article's own characterisations as though they were established.
- No markdown headings, no preamble, no closing summary.

Shape:
- One short lead sentence saying that this is a News-Letter article and what it covers.
- Then 3 to 6 bullets, one line each, starting with "- ".
- Report what the article reports: the meetings and decisions it describes, any amount of money it names, who it quotes and what they said, and any outcome it states.
- Leave out the paper's own furniture -- photo credits, corrections notices, invitations to write in.

${CITATION_RULES}

Grounding:
- Use only this article. Never use outside knowledge, including anything you know about the SGA.
- Set "insufficientContent" to true, and leave "content" empty, only when the page carries no reporting to restate -- a photo caption, a one-line notice, a list of links. A short but genuine article still gets a summary.

${REPLY_FORMAT}`;

/** Which prompt a document of this kind is read under. */
export function summarySystemPrompt(kind: string): string {
    return isSecondaryKind(kind) ? SECONDARY_SYSTEM_PROMPT : SYSTEM_PROMPT;
}

/** The version of that prompt, for the cache fingerprint. */
export function summaryPromptVersion(kind: string): string {
    return isSecondaryKind(kind) ? SECONDARY_PROMPT_VERSION : PROMPT_VERSION;
}
