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
            "constitutions and bylaws, structure and offices, elections and referendums, the " +
            "judiciary, and how its records were kept and published, as the archive records it.",
        scope:
            "Changes to the student government itself, including its predecessor the Student Council " +
            "(StuCo): adopting, rewriting, or amending its constitution and bylaws; creating, " +
            "renaming, merging, or abolishing its branches, bodies, offices, seats, and committees, " +
            "including the change of name to the Student Government Association; how its members " +
            "are elected, the election bodies and rules, turnout, and referendums on its own " +
            "governing documents or structure; the founding, powers, and landmark rulings of its " +
            "judiciary; and how it kept, published, and opened its minutes, legislation, meetings, " +
            "and records. Ordinary business the student government conducted -- funding a group, a " +
            "resolution on a campus issue, an event, a single routine election result -- belongs " +
            "only when the document says it changed how the student government is organized, " +
            "elected, or run.",
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
                    "Committee on Student Elections, election rules, turnout, and referendums on the " +
                    "student government's own documents or structure.",
                color: "#9a5b00",
            },
            {
                id: "judiciary",
                label: "Judiciary",
                description:
                    "The student government's judiciary: its founding and powers, changes to it, and " +
                    "rulings that interpreted or changed how the student government works.",
                color: "#6b3fa0",
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
                "filling vacancies, meeting times, or one officer's duties.",
            "Training slides, transition guides, briefings, and descriptions of how things already work " +
                "record no change. Include them only where they say something was created, changed, or ended.",
            "Weight 3 is only for a new or ratified constitution; the creation, renaming, or abolition of a " +
                "branch, body, or office; or a change to how members are elected. Other rule changes are 2 at most.",
            "Do not quote a passage that names a student in a disqualification, impeachment, removal, or " +
                "disciplinary matter; describe the body's action instead, or leave the finding out.",
        ],
        mergeRules: [
            "Copies and editions of the same governing document from one year, and the bill, minutes, and " +
                "reporting on the same change, are one event.",
            "Name each body as its findings do. The Student Council (StuCo), its Student Activities " +
                "Commission, and their offices are not the SGA: write \"SGA\" only where the findings do.",
            "For this topic, a finding is off-topic, and is left out, when it records only that something " +
                "was discussed, considered, or tabled with nothing proposed, adopted, created, or changed, or " +
                "when it concerns a group formed for one campus project rather than the student government's " +
                "own structure, elections, judiciary, or records. Leave its id out of every event's " +
                "\"findings\" list; never make an event, empty or otherwise, to hold findings you leave out.",
        ],
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
