import { AUTHORITATIVE_KINDS, type DocumentKind } from "@/lib/kinds";

/**
 * The registry of generated slots.
 *
 * A page asks for a section by `key` and renders whatever is cached. Adding a
 * slot to a page means adding an entry here; nothing calls a model at request
 * time.
 */

export type SectionStatus = "empty" | "fresh" | "stale" | "failed";

export type SectionDefinition = {
    key: string;
    /** Human label, for the admin/regeneration surface. */
    label: string;
    /** What the model is asked to answer from the source documents. */
    question: string;
    /** Only documents of these kinds are offered as evidence. */
    sourceKinds: DocumentKind[];
};

/** Every slot on the About page describes the SGA as it is currently constituted. */
function about(key: string, label: string, question: string): SectionDefinition {
    return {
        key: `about.${key}`,
        label: `About / ${label}`,
        question,
        sourceKinds: AUTHORITATIVE_KINDS,
    };
}

/**
 * Structural questions are answered only from authoritative documents. Minutes
 * record what was discussed, not what was adopted, so citing them for "what is
 * the president's role" would present a proposal as though it were binding.
 *
 * There is one slot per position rather than one per branch because a reader
 * arriving from the contact page wants the seat they clicked, and because a
 * question narrow enough to name an office gets an answer that quotes the
 * clause defining it instead of summarising a whole article.
 */
export const SECTION_DEFINITIONS: SectionDefinition[] = [
    about(
        "overview",
        "What the SGA is",
        "What is the Student Government Association, who does it represent, and what are its branches and bodies?",
    ),

    about(
        "executive.overview",
        "Executive Branch overview",
        "What is the Executive Branch of the SGA, and which positions make it up?",
    ),
    about(
        "executive.president",
        "Student Body President",
        "What are the powers, duties, and term of the Student Body President?",
    ),
    about(
        "executive.vice_president",
        "Student Body Vice President",
        "What are the powers and duties of the Student Body Vice President?",
    ),
    about(
        "executive.secretary",
        "Secretary",
        "What are the duties of the Secretary of the SGA?",
    ),
    about(
        "executive.treasurer",
        "Treasurer",
        "What are the duties of the Treasurer of the SGA, including their role on the Committee on Finance?",
    ),
    about(
        "executive.communications",
        "Director of Communications",
        "What are the duties of the Director of Communications?",
    ),
    about(
        "executive.programming",
        "Student Body Chair of Programming",
        "What are the duties of the Student Body Chair of Programming, and how do they oversee the Programming Councils?",
    ),

    about(
        "legislative.overview",
        "Legislative Branch overview",
        "How is the Legislative Branch (the Senate) composed, and what are its powers?",
    ),
    about(
        "legislative.president_of_senate",
        "President of the Senate",
        "Who presides over the Senate, and what are the duties of the President of the Senate?",
    ),
    about(
        "legislative.class_senators",
        "Class Senators and Class Presidents",
        "How many Class Senators does each graduating class elect, what is the Class President's role among them, and what do Class Senators do?",
    ),
    about(
        "legislative.academic_senators",
        "KSAS and WSE Senators",
        "How many Academic Senators represent the Krieger School of Arts and Sciences and the Whiting School of Engineering, and what do they do?",
    ),
    about(
        "legislative.rso_senators",
        "Student Organization Senators",
        "How many Student Organization (RSO) Senators are there, which categories of student organizations do they represent, and what do they do?",
    ),
    about(
        "legislative.caucuses",
        "Caucuses and Caucus Chairs",
        "What is an SGA caucus, which caucuses currently exist, and how are Caucus Chairs chosen and what do they do?",
    ),
    about(
        "legislative.committees",
        "Standing committees",
        "What standing committees exist, and what is each committee responsible for?",
    ),
    about(
        "legislative.committee_chairs",
        "Committee chairs",
        "How are committee chairs selected, and what are a committee chair's responsibilities?",
    ),

    about(
        "judicial.overview",
        "Judicial Branch",
        "What is the Judicial Branch, how is it composed, and what is its jurisdiction?",
    ),
    about(
        "judicial.chief_justice",
        "Chief Justice",
        "What are the duties of the Chief Justice of the SGA Judiciary?",
    ),
    about(
        "judicial.justices",
        "Justices",
        "How are the Justices of the SGA Judiciary appointed, for how long do they serve, and what do they do?",
    ),

    about(
        "cse.overview",
        "Committee on Student Elections",
        "What is the Committee on Student Elections (CSE), how is it composed, and what is it responsible for?",
    ),

    about(
        "programming.overview",
        "Programming Councils",
        "What are the Class Programming Councils, who sits on each one, and what are they responsible for?",
    ),
];

export function sectionDefinition(key: string): SectionDefinition | undefined {
    return SECTION_DEFINITIONS.find((definition) => definition.key === key);
}

export const SECTION_KEYS = SECTION_DEFINITIONS.map(
    (definition) => definition.key,
);
