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
