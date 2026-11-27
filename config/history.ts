/**
 * The topics under /history.
 *
 * A topic is a question asked of the whole archive -- "what has the SGA done
 * about X, and when" -- answered offline by lib/history.ts and stored. Adding a
 * topic is an entry here and a run of `npm run history -- <slug>`; nothing is
 * computed when a page is viewed.
 *
 * Kept free of server imports so the timeline can read thread labels and
 * colours on the client.
 */

export type HistoryThread = {
    id: string;
    label: string;
    /** What belongs in this thread, as the model is told it. */
    description: string;
    /** Lane colour. Must read against white at 4.5:1 when used for text. */
    color: string;
};

export type HistoryTopicDefinition = {
    slug: string;
    title: string;
    /** One or two sentences for the listing and the page header. Describes scope, not findings. */
    description: string;
    /** What the extraction is looking for, as the model is told it. */
    scope: string;
    /**
     * Case-insensitive phrases that make a document a candidate. Written in the
     * regex subset PostgreSQL and JavaScript agree on: literals, groups,
     * alternation, `?`, and character classes. Matched as whole words.
     */
    terms: string[];
    /** Case-sensitive whole words, for acronyms that are ordinary words in lower case. */
    acronyms: string[];
    /** Document kinds that match the terms but never record SGA activity. */
    excludeKinds: string[];
    threads: HistoryThread[];
    /** Extra extraction rules, after the shared ones. Leave out rather than empty. */
    extractionRules?: string[];
    /** Extra merge rules, after the shared ones. Leave out rather than empty. */
    mergeRules?: string[];
    /**
     * Replaces the shared rule on who a finding may name, which keeps to SGA
     * bodies and offices. Leave out to keep the shared rule.
     */
    peopleRule?: string;
    /**
     * House-style fixes applied to merged titles and prose, for wording the
     * merge keeps getting wrong despite a rule. `pattern` is a JavaScript
     * regular expression source, applied globally and case-sensitively.
     */
    styleFixes?: { pattern: string; replacement: string }[];
};

export const HISTORY_TOPICS: HistoryTopicDefinition[] = [
    {
        slug: "sexual-violence",
        title: "Sexual Violence",
        description:
            "What the SGA has done about sexual violence on campus: legislation, funding, " +
            "programming, statements, and its work with the university on policy and support, " +
            "as the archive records it.",
        scope:
            "Efforts involving the SGA on sexual assault, sexual harassment and misconduct, " +
            "dating and relationship violence, stalking, Title IX, consent and bystander " +
            "education, survivor support, and the university offices and policies that handle " +
            "them. A development outside the SGA (a university policy change, a survey, an " +
            "incident) belongs only when this document ties it to the SGA's work.",
        terms: [
            "sexual (assault|violence|misconduct|harassment|harrassment|abuse|exploitation)",
            "title ix",
            "rape",
            "(dating|domestic|relationship|interpersonal|intimate partner|gender[- ]based) violence",
            "stalking",
            "(affirmative|sexual) consent",
            "consent (education|culture|workshop|workshops|training)",
            "survivors?",
            "bystander (intervention|training)",
            "office of institutional equity",
            "take back the night",
            "denim day",
            "it['’]?s on us",
        ],
        acronyms: ["SARU", "PAVE", "OIE"],
        // Bylaws editions repeat one clause in dozens of copies (the amendment
        // bill is the record of a change), reference files are other schools'
        // and readings, and survey and application responses are personal
        // statements rather than SGA activity.
        excludeKinds: [
            "resume",
            "directory",
            "template",
            "application",
            "survey",
            "attendance",
            "reference",
            "collection",
            "guiding.bylaws",
            "guiding.constitution",
            "guiding.other",
        ],
        threads: [
            {
                id: "policy",
                label: "Policy and Title IX",
                description:
                    "University and SGA policy on sexual misconduct: Title IX, reporting and " +
                    "investigation processes, the Office of Institutional Equity, and changes the SGA asked for.",
                color: "#7a3e9d",
            },
            {
                id: "support",
                label: "Survivor support",
                description:
                    "Resources for survivors: advocates, counseling, hotlines, SARU, PAVE, " +
                    "and funding or staffing for them.",
                color: "#1f6f78",
            },
            {
                id: "prevention",
                label: "Prevention and education",
                description:
                    "Consent and bystander education, orientation programming, awareness " +
                    "campaigns, and events.",
                color: "#2f6db3",
            },
            {
                id: "accountability",
                label: "Accountability and data",
                description:
                    "Climate surveys, reports, requests for data or transparency, and " +
                    "accountability for organisations or the university.",
                color: "#b4532a",
            },
            {
                id: "advocacy",
                label: "Statements and advocacy",
                description:
                    "Resolutions, open letters, statements, and public advocacy by the SGA " +
                    "that do not fit a narrower thread.",
                color: "#a3315a",
            },
        ],
    },
    {
        slug: "sga",
        title: "The SGA Itself",
        description:
            "How the SGA and its predecessor, the Student Council, have changed as an institution: " +
            "constitutions and bylaws, structure and offices, who led it and how they were elected, " +
            "impeached, or removed, the judiciary and its cases, and how its records were kept and " +
            "published, as the archive records it.",
        scope:
            "Changes to the student government itself, including its predecessor the Student Council " +
            "(StuCo): adopting, rewriting, or amending its constitution and bylaws; creating, " +
            "renaming, merging, or abolishing its branches, bodies, offices, seats, and committees, " +
            "including the change of name to the Student Government Association; how its members " +
            "are elected, the election bodies and rules, turnout, and referendums on its own " +
            "governing documents or structure; who held its offices -- the results of executive " +
            "and class-president elections, and the appointment or confirmation of Senate leaders, " +
            "committee and commission chairs, and justices; impeachments, removals, recalls, " +
            "disqualifications, and resignations of its officers; the founding, powers, cases, and " +
            "rulings of its judiciary, including writs of certiorari and mandamus; and how it kept, " +
            "published, and opened its minutes, legislation, meetings, and records. Ordinary business " +
            "the student government conducted -- funding a group, a resolution on a campus issue, an " +
            "event -- belongs only when the document says it changed how the student government is " +
            "organized, elected, led, or run.",
        terms: [
            "(new|proposed|revised|amended|old|previous|current) constitutions?",
            "constitution(al)? (amendment|amendments|convention|referendum|reform|revision|revisions|rewrite|change|changes|overhaul)",
            "amend(ing|ed|s)? the constitution",
            "(ratify|ratified|ratifies|ratification of) the (new )?constitution",
            "(bylaws?|by-laws?) (amendment|amendments|revision|revisions|rewrite|overhaul|reform|review)",
            "(amend|amending|amended|rewrite|rewrote|rewriting|revise|revising|revised) the (bylaws?|by-laws?)",
            "referend(um|a|ums)",
            "(restructure|restructured|restructuring|reorganize|reorganized|reorganization) (of )?(the )?(sga|stuco|student council|student government|senate|executive board|judiciary|class councils?)",
            "committee on student elections",
            "board of elections",
            "voter turnout",
            "separation of powers",
            "(sga|stuco|student council|student government) judiciary",
            "(renamed|rename|renaming|name change)",
            "(sga|stuco|student council|student government)['’]?s? history",
            "history of (the )?(sga|stuco|student council|student government)",
            "(new|first|inaugural) (sga|stuco|student council) (judiciary|senate|constitution|website)",
            "student council (constitution|charter|elections?|reform|reorganization|restructuring|bylaws|was (founded|formed|created|established|dissolved|replaced))",
            "(founding|founded|formation|creation|establishment|dissolution) of (the )?(sga|stuco|student council|student government|senate|judiciary|class councils?)",
            "(publish|publishes|published|publishing|post|posts|posted|posting|upload|uploaded) (the |its |our |all )?(meeting )?minutes",
            "(sga|stuco|student council) (website|archive|archives)",
            "impeach(ed|es|ing|ment|ments)?",
            "certiorari",
            "mandamus",
            "chief justice",
            "(resign|resigned|resigns|resignation|resignations)",
            "removed from office",
            "recall (election|petition)",
            "(exec|executive|executive board|sga|stuco|student council|class) elections?",
            "election results",
            "(president|vice president|treasurer|secretary)[- ]elect",
            "(sworn in|inaugurated|took office)",
            "(confirmed|confirmation of|appointed|appointment of|nominated|nomination of) (as |to |the )*(chair|co-chair|chief justice|justices?|director|treasurer|secretary)",
        ],
        acronyms: [],
        // Constitutions stay in: each edition records the structure at its
        // date. Bylaws editions repeat one clause in dozens of copies, so the
        // amendment bills are the record of those changes.
        excludeKinds: [
            "resume",
            "directory",
            "template",
            "application",
            "survey",
            "attendance",
            "reference",
            "collection",
            "guiding.bylaws",
            "guiding.other",
        ],
        threads: [
            {
                id: "governing",
                label: "Constitution and bylaws",
                description:
                    "Governing documents: new constitutions, rewrites, amendments to the constitution " +
                    "or bylaws, ratification, and review of them.",
                color: "#1f4e8c",
            },
            {
                id: "structure",
                label: "Structure and offices",
                description:
                    "Branches, bodies, offices, seats, class councils, and committees being created, " +
                    "renamed, merged, or abolished, including the Student Council becoming the SGA.",
                color: "#2e7d4f",
            },
            {
                id: "elections",
                label: "Elections and referendums",
                description:
                    "How members are elected: election bodies such as the Board of Elections and the " +
                    "Committee on Student Elections, election rules, turnout, disputes and " +
                    "disqualifications, who won executive and class-president elections, and " +
                    "referendums on the student government's own documents or structure.",
                color: "#9a5b00",
            },
            {
                id: "judiciary",
                label: "Judiciary",
                description:
                    "The student government's judiciary: its founding and powers, changes to it, and " +
                    "its cases and rulings, including writs of certiorari and mandamus, named by caption.",
                color: "#6b3fa0",
            },
            {
                id: "officers",
                label: "Officers and leadership",
                description:
                    "Who held office outside an election: appointments and confirmations of Senate " +
                    "leaders, chairs, directors, and justices; impeachments, removals, recalls, and " +
                    "resignations; and firsts among officeholders.",
                color: "#1f6f78",
            },
            {
                id: "records",
                label: "Records and openness",
                description:
                    "Keeping and publishing minutes, legislation, and records; websites and archives; " +
                    "open meetings and other transparency measures, and anything institutional that " +
                    "fits no narrower thread.",
                color: "#a3315a",
            },
        ],
        // A constitution or rules bill read clause by clause buries the few
        // changes that matter; the sample produced a dozen findings apiece.
        extractionRules: [
            "A governing document -- a constitution, bylaws, election rules, or a session's rules bill -- is " +
                "one record of the structure at its date, not a list of things that happened. Report its " +
                "adoption, ratification, or proposal, and at most three features that define the structure " +
                "(the branches and bodies it sets up, how members are chosen, how it is amended). Never " +
                "report it clause by clause.",
            "A bill or amendment that changes a governing document is one finding for the change it makes, " +
                "and one more only for a second, unrelated change.",
            "Routine procedure is not a finding: attendance and absences, agenda deadlines, device use, " +
                "meeting times, or a description of an office's duties.",
            "Training slides, transition guides, briefings, and descriptions of how things already work " +
                "record no change. Include them only where they say something was created, changed, or ended.",
            "Weight 3 is only for a new or ratified constitution; the creation, renaming, or abolition of a " +
                "branch, body, or office; or a change to how members are elected. Other rule changes are 2 at most.",
            "Record who held office. An election result names each winner with the office won, and the " +
                "vote or turnout when given. Appointments or confirmations made together are one finding " +
                "naming each person and office. An impeachment, removal, recall, disqualification, or " +
                "resignation names the officer and office, the official action, its stated grounds, and " +
                "the vote when given. A Judiciary case is named by its caption, with what it decided.",
            "Weight 3 is also right for an executive-election result, a first impeachment or removal of " +
                "an office, and a Judiciary ruling that changed how the student government works; a routine " +
                "appointment is weight 1.",
        ],
        mergeRules: [
            "Copies and editions of the same governing document from one year, and the bill, minutes, and " +
                "reporting on the same change, are one event.",
            "An officer announcing a resignation or departure from an office or from the student government " +
                "is an Officers and leadership event, never a mere discussion.",
            "One election and its results, one nomination and its confirmation, and one impeachment with " +
                "its trial and outcome are each one event. Titles name the person with the office, either " +
                "office first (\"Executive President Jane Doe resigns\", \"Chief Justice Jane Doe sworn in\") " +
                "or the person taking it, using the office title the findings give.",
            "A title for someone taking an office reads \"<office they already held> <full name> elected as " +
                "<full title of the new office>\" -- \"Chair of the Committee on Finance Peter Tarpley elected " +
                "as Vice President of the Senate\", \"Religious and Spiritual Life RSO Senator Cole " +
                "Liazos-Coffey elected as Chair of the Committee on Internal Affairs\" -- \"elected as\" when " +
                "the Senate or the students voted on candidates for it, even a single candidate the records " +
                "say was confirmed; \"confirmed as\" when the Senate approved someone an officer nominated; " +
                "\"appointed as\" when an officer named them without a vote; never \"selected\". The office already held is the highest they held " +
                "on that date (an executive or Senate office, then a committee chair, then their Senate seat), " +
                "never the office being taken; leave it out only when nothing given supplies one. The new " +
                "office takes its full title, never a short form such as \"Finance Chair\" or \"IA Chair\".",
            "Every person named in a title or in prose carries the office they held then, before the name: " +
                "\"Finance Chair Peter Tarpley introduced\", \"Internal Affairs appoints Religious and Spiritual " +
                "Life RSO Senator Cole Liazos-Coffey vice chair\", \"Sophomore Class President Veda Kommineni " +
                "appointed CSAC representative\", \"Senior Class Senator Peter Jackson\". Take the office from the " +
                "findings, or else from the lines and roster titles about people given after them. A senator " +
                "carries their seat -- \"Sophomore Class Senator Kevin Xu\", \"KSAS Senator Boyi Chen\", " +
                "\"Transfer Students Caucus Senator Lauryn Carr\" -- never \"Senator\" alone when anything given " +
                "names the seat; a senator who also chairs a committee may be named by either. Always use the " +
                "full name given there, never a first name or nickname alone (\"Director of Communications " +
                "Johnalys Ferrer\", not \"Jo\"); a person whose line repeats a finding's quote is the one that " +
                "finding means. Name a person without an office, or by first name, only when nothing given " +
                "supplies more; never guess.",
            "Use the full office title of the time: for an officer the constitution defines, its title as " +
                "listed after the findings, in that exact form (\"Student Body Treasurer Amy Xu\", never " +
                "\"Treasurer Amy Xu\" or \"SGA Treasurer Amy Xu\"; \"President of the Senate Nasreen Naqvi\", " +
                "never \"Senate President\"); otherwise the title as the documents give it, where \"Chair of the " +
                "Committee on Finance\" may shorten only to \"Finance Chair\", and only for an office already " +
                "held. Pick the office held on the event's date, since offices change within a year. A person " +
                "taking a new office keeps the one they already held: \"Vice President of the Senate Shreemann " +
                "Patel confirmed as Senate Parliamentarian\", never \"Shreemann Patel confirmed parliamentarian\".",
            "Office titles and the names of bodies are proper names: capitalize them as the records of the " +
                "time do, in titles and prose alike, even inside a sentence-case title, and an office the " +
                "findings mention without a holder takes its official title too -- \"General events role " +
                "proposed for Chair of Programming\", never \"for programming chair\"; \"Internal Affairs\", " +
                "\"the Committee on Student Elections\", \"the Senate\".",
            "A finding that only lists who held offices at the time -- a roster, an agenda or minutes header, " +
                "a signature block, the officers who presided -- records no change and is off-topic.",
            "Never say who signed a bill or resolution: the Signatures of Enactment and Signatures of " +
                "Ceremony printed on legislation are a formality, not an action. A finding that reports them " +
                "is off-topic, and no title or prose names the signers. Who introduced, authored, or sponsored " +
                "legislation may be named.",
            "Say what a governing document changed, not what it contains. An amendment's or edition's event " +
                "names each change its findings give, concretely and in its own clause -- \"The Senate amended " +
                "the bylaws to eliminate the Director of Research, make the Director of Communications an " +
                "elected office, let the Senate approve Committee on Student Elections members during an " +
                "election season, end post-election meet-and-greets, and elect Class Programming Council " +
                "members class-wide\" -- never a list of areas it touched (\"amended the executive structure, " +
                "election procedures, and bylaws\") or \"was amended\" alone. The title names the main change " +
                "when there is one (\"Constitution replaces caucus chairs with Caucus Senators\"). Only an " +
                "edition whose findings merely describe its contents gets one sentence naming it and when it " +
                "was adopted or amended; do not restate its branches, election administration, or open-records " +
                "rules, and do not add them to an event about an amendment either -- such an edition only " +
                "supports that the amendment took effect. The exception is a Student Council constitution from " +
                "before 2000, where one sentence on the structure it set up is kept, since few other records of " +
                "that structure survive.",
            "An amendment's text, the committee and Senate votes on it, the minutes passing it, and the " +
                "edition that took it in are one event, even when the bill's own copy is dated only by year.",
            "Name each body as its findings do, in titles and prose alike. The Student Council (StuCo), " +
                "its Student Activities Commission, and their offices are not the SGA: write \"SGA\" only where " +
                "a finding's summary does. A Student Council constitution is titled as one -- \"Student Council " +
                "constitution adopted\", never \"Constitution defines SGA governance\". Bodies inside the SGA " +
                "go by their own names: \"the Senate adopted\", \"Executive Branch meetings\", never \"the SGA " +
                "Senate\" or \"SGA executive meetings\".",
            "For this topic, a finding is off-topic, and is left out, when it records only that something " +
                "was discussed, considered, or tabled with nothing proposed, adopted, created, or changed; " +
                "when it comes from a personal draft, working notes, or a working document (as its document " +
                "title or kind shows) and records nothing the Senate, a committee, or an officer actually did; " +
                "or when it concerns a group formed for one campus project rather than the student government's " +
                "own structure, elections, judiciary, or records. Leave its id out of every event's " +
                "\"findings\" list; never make an event, empty or otherwise, to hold findings you leave out.",
        ],
        peopleRule:
            "Name students as the document does when they act in a Student Council or SGA office or " +
            "election: candidates and winners, officers, chairs, justices, and the parties to a Judiciary " +
            "case by its caption, always with the office. In impeachments, removals, recalls, censures, " +
            "disciplinary marks, disqualifications, Judiciary complaints, and other accusations about how " +
            "someone carried out an SGA or Student Council role, name both the accused and those who brought " +
            "the accusation, with the official action, the stated grounds, and the vote when given; write an " +
            "accusation as an accusation, never as an established fact. The one exception: never name or " +
            "identify a survivor, complainant, or accused person in a matter of sexual misconduct, " +
            "harassment, or violence, or describe the details of such a case; if no quote can avoid that, " +
            "leave the finding out.",
        styleFixes: [
            // Bodies inside the SGA go by their own names; a document title such as
            // "112th SGA Senate Meeting" is left alone.
            { pattern: "\\bSGA Senate\\b(?! [Mm]eeting)", replacement: "Senate" },
        ],
    },
];

export type ReviewedFinding = {
    documentId: string;
    /** Finds the extracted finding to correct; when none matches, `quote` adds one. */
    quotePattern: RegExp;
    /** Verbatim from the document, so an added finding can be anchored and cited. */
    quote: string;
    summary: string;
    thread: string;
    kind: HistoryEventKind;
    weight: 1 | 2 | 3;
    /** Why, for whoever reads this next. */
    reason: string;
};

/**
 * Findings a maintainer has reviewed against the source. Applied at merge time,
 * so they outlive re-extraction, which would otherwise repeat the misreading.
 */
export const REVIEWED_FINDINGS: ReviewedFinding[] = [
    {
        documentId: "58442442-9ef8-486e-897b-4d0ca731310a",
        // Extraction quotes either the tally or the announcement after it.
        quotePattern: /alli in favor of peter\? 22|supermajority wins it is peter/,
        quote: "alli in favor of peter? 22",
        summary: "The Senate elected Chair of the Committee on Finance Peter Tarpley as Vice President of the Senate by a supermajority hand vote, with 22 votes.",
        thread: "officers",
        kind: "policy",
        weight: 2,
        reason: "Demarri's 11/3/26 notes record the Vice President of the Senate vote (\"for vpots we have cole, isaac, kevin\"), not a Finance Chair selection: Peter was already Chair of Finance (\"i'm peter, chair of finance\"). MINUTES 11 records the same tally (\"Petter: 22\"), and the 11/17 roster lists \"Peter Tarpley, Vice President of the Senate, Chair of Finance & RSO Senator\".",
    },
    {
        documentId: "4c0c38ff-f5ec-4b2c-b547-5f2e30dca92e",
        quotePattern: /Petter: 22/,
        quote: "Petter: 22",
        summary: "The Senate elected Chair of the Committee on Finance Peter Tarpley as Vice President of the Senate with 22 votes; the minutes spell his name \"Petter\".",
        thread: "officers",
        kind: "policy",
        weight: 2,
        reason: "The minutes' vote line misspells Peter; the discussion before it names Peter, and later agendas name Peter Tarpley Vice President of the Senate.",
    },
    {
        documentId: "58442442-9ef8-486e-897b-4d0ca731310a",
        quotePattern: /cole is the chair of ia/,
        quote: "ok with that, supermajority, cole is the chair of ia",
        summary: "The Senate elected Religious and Spiritual Life RSO Senator Cole Liazos-Coffey, the only candidate, as Chair of the Committee on Internal Affairs by supermajority.",
        thread: "officers",
        kind: "policy",
        weight: 2,
        reason: "The notes call it \"voting for the chair of ia\" with Cole the only candidate; he was then Religious and Spiritual Life Senator (SAAC Funding Bill, Bill Voting Records) and Vice Chair of Internal Affairs, and Demarri asked for the title in this form on 11/27/26.",
    },
    {
        documentId: "4c0c38ff-f5ec-4b2c-b547-5f2e30dca92e",
        quotePattern: /Confirmed unanimously/,
        quote: "Confirmed unanimously",
        summary: "The Senate unanimously elected Religious and Spiritual Life RSO Senator Cole Liazos-Coffey as Chair of the Committee on Internal Affairs.",
        thread: "officers",
        kind: "policy",
        weight: 2,
        reason: "MINUTES 11 records the same vote as \"Voting for chair of IA ... Confirmed unanimously\"; it is the 11/3 election, not a separate confirmation.",
    },
    {
        documentId: "26a7e82c-1763-4dcf-9d33-4a004963b169",
        quotePattern: /appointing Jo as DoC/,
        quote: "Voting for appointing Jo as DoC was passed in favor.",
        summary: "The Senate approved Student Body President Vishnu Dontu's appointment of Johnalys Ferrer as Director of Communications.",
        thread: "officers",
        kind: "policy",
        weight: 1,
        reason: "The minutes say \"President Vishnu introduced Johnalyse. Jo presented her past visual works\", and the 10/28/25 agenda lists \"Director of Communications - Johnalys Ferrer\".",
    },
    {
        documentId: "26a7e82c-1763-4dcf-9d33-4a004963b169",
        quotePattern: /appointing Jason as DoR/,
        quote: "The voting for appointing Jason as DoR was passed in favor.",
        summary: "The Senate approved Student Body President Vishnu Dontu's reappointment of Jason Shumsky as Director of Research.",
        thread: "officers",
        kind: "policy",
        weight: 1,
        reason: "The parser credits this line to Jason Yu, then a Sophomore Class Senator, but the Director of Research was Jason Shumsky: every 2023-24 agenda lists \"Director of Research - Director Jason Shumsky\", the 4/23/24 minutes record his reappointment (\"He served in this position in the last SGA, too\"), and the 2025-2026 attendance sheet lists him among the executives.",
    },
];

export function historyTopic(slug: string): HistoryTopicDefinition | undefined {
    return HISTORY_TOPICS.find((topic) => topic.slug === slug);
}

/** What the SGA did, which sets the marker's shape. */
export const HISTORY_EVENT_KINDS = [
    "legislation",
    "funding",
    "programming",
    "statement",
    "discussion",
    "policy",
    "report",
] as const;

export type HistoryEventKind = (typeof HISTORY_EVENT_KINDS)[number];

export const HISTORY_EVENT_KIND_LABELS: Record<HistoryEventKind, string> = {
    legislation: "Legislation",
    funding: "Funding",
    programming: "Programming",
    statement: "Statement",
    discussion: "Discussion",
    policy: "Policy change",
    report: "Report or survey",
};

export type HistoryOutcome = "" | "passed" | "not_passed" | "inconclusive" | "unrecorded";

export const HISTORY_OUTCOME_LABELS: Record<Exclude<HistoryOutcome, "">, string> = {
    passed: "Passed",
    not_passed: "Did not pass",
    inconclusive: "Outcome inconclusive",
    unrecorded: "No recorded vote",
};

export type HistoryDatePrecision = "day" | "month" | "year" | "session" | "approximate";
