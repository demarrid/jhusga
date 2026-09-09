import { parseCsvLine } from "@/lib/csv";
import type { DirectoryGroup } from "@/lib/directory";

/**
 * Reading the SGA off the attendance sheet.
 *
 * "Official SGA Attendance Sheet (2026-2027)" is the one place that names
 * every seat in the association at once: the Executive Board, each class
 * council, the school and RSO senators, the caucus chairs, the Judiciary, the
 * Committee on Student Elections, and the Programming Councils. Minutes name
 * the officers and the email list names whoever happens to be on it; only this
 * sheet says which seat a person actually holds, which is why so many members
 * were otherwise landing in "Also listed".
 *
 * It is a tally sheet, not a roster, so the structure has to be inferred:
 *
 *   Class Councils        <- section, spans the page
 *   Senior Class          | Sophomore Class     <- seat, one per column block
 *   Tanisha Taneja Totals GBM CE                <- the person, and their
 *   Excused        #REF!  #REF!                    committees, as column
 *   Unexcused      #REF!  #REF!                    headings over the tallies
 *
 * The page is two column blocks side by side (A-E and H-L) with a gutter, and
 * the blocks do not stay in step: the Programming Councils begin in the right
 * block while the left is still working through the Judiciary. Each block is
 * therefore read as its own vertical stream. A section heading claims both
 * blocks only when the other block is blank on that row, which is precisely
 * when it is a heading for the whole page rather than for one column.
 *
 * Nothing here is a vote count or an absence: the tallies are deliberately not
 * read. Who sits where is public record; how often they missed a meeting is
 * the Senate's business, and publishing it from a spreadsheet that is riddled
 * with #REF! errors would be indefensible anyway.
 */

/** Column blocks, as [first, end) indices. Column F/G is the gutter. */
const BLOCKS: readonly (readonly [number, number])[] = [
    [0, 6],
    [7, 12],
];

/** The cell that marks a person's row, in the column after their name. */
const PERSON_MARKER = "totals";

/** Tally rows, which carry no membership information. */
const TALLY_ROWS = new Set(["excused", "unexcused"]);

/**
 * Column headings that are a meeting rather than a committee. GBM is the
 * Senate's general body meeting; Exec, PC and JC are the Executive Board, a
 * Programming Council and the Judiciary meeting as themselves.
 */
const MEETINGS = new Set(["gbm", "exec", "pc", "jc"]);

/**
 * The seven Standing Legislative Committees, by the abbreviation the sheet
 * uses. Names are the bylaws' own, shortened by dropping "Committee on".
 */
export const COMMITTEE_CODES: Record<string, string> = {
    aa: "Academic Affairs",
    ce: "Civic Engagement",
    fc: "Finance",
    finance: "Finance",
    hss: "Health, Safety, and Sustainability",
    ia: "Internal Affairs",
    cso: "Student Organizations",
    so: "Student Organizations",
    ss: "Student Services",
};

type Section =
    | "executive"
    | "senate"
    | "class-councils"
    | "school-representatives"
    | "rso"
    | "caucus-chairs"
    | "judiciary"
    | "cse"
    | "programming";

/** Headings that introduce a part of the association. */
const SECTION_HEADINGS: Record<string, Section> = {
    "executive branch": "executive",
    "executive board": "executive",
    senate: "senate",
    "class councils": "class-councils",
    "class council": "class-councils",
    "school representatives": "school-representatives",
    "academic senators": "school-representatives",
    "rso senators": "rso",
    "rso representatives": "rso",
    "caucus chairs": "caucus-chairs",
    caucuses: "caucus-chairs",
    judiciary: "judiciary",
    "judicial branch": "judiciary",
    "judiciary board": "judiciary",
    "committee on student elections (cse)": "cse",
    "committee on student elections": "cse",
    cse: "cse",
    "programming councils": "programming",
    "programming council": "programming",
};

/** Headings that are a seat rather than a section. */
const JUDICIAL_SEATS: Record<string, string> = {
    "chief justice": "Chief Justice",
    justice: "Justice",
    "associate justice": "Justice",
};

const CLASS_NAMES: Record<string, string> = {
    senior: "Senior Class",
    junior: "Junior Class",
    sophomore: "Sophomore Class",
    freshman: "Freshman Class",
    "first-year": "Freshman Class",
    "first year": "Freshman Class",
};

/** Spellings of a caucus the sheet writes two ways. */
const CAUCUS_ALIASES: Record<string, string> = {
    fli: "First-Generation, Limited-Income",
    "fli caucus": "First-Generation, Limited-Income",
};

/**
 * A seat with nobody in it. The sheet keeps the row so the numbering stays
 * put, which is useful to it and meaningless here.
 */
const PLACEHOLDER_SEAT = /^(?:rso|senator|seat|caucus|justice)\s*\d*$/i;

export type AttendanceMember = {
    name: string;
    /** The seat held, e.g. "Senior Class Senator" or "Chief Justice". */
    position: string;
    group: DirectoryGroup;
    /** The block within the group, e.g. "Senior Class" or "KSAS". */
    subgroup: string | null;
    /** Standing committees, from the headings over this person's tallies. */
    committees: string[];
    /** The sheet row as read, so the claim can be checked against the source. */
    evidence: string;
};

type Seat = {
    position: string;
    group: DirectoryGroup;
    subgroup: string | null;
};

function normalise(text: string): string {
    return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Words a seat name keeps in lower case unless they lead it. */
const MINOR_WORDS = new Set(["and", "of", "the", "for", "in", "on", "to", "a", "an"]);

function titleCase(text: string): string {
    return text
        .split(/\s+/)
        .map((word, index) => {
            if (/^[A-Z]{2,}$/.test(word)) return word;
            const lower = word.toLowerCase();
            if (index > 0 && MINOR_WORDS.has(lower)) return lower;
            // Both halves of "Hispanic/Latinx" are names of the caucus.
            return lower.replace(/(^|[/])([a-z])/g, (_, prefix: string, letter: string) =>
                `${prefix}${letter.toUpperCase()}`,
            );
        })
        .join(" ");
}

/** "Speical Interest and Hobby" is how the sheet spells it. */
function fixSpelling(text: string): string {
    return text.replace(/\bspeical\b/gi, "Special");
}

function className(heading: string): string | null {
    const key = normalise(heading).replace(/\s*(?:class|council)s?\b.*$/, "");
    return CLASS_NAMES[key] ?? null;
}

/**
 * What a heading means, given the section it sits under. "Senior Class" is a
 * senate seat under Class Councils and a programming seat under Programming
 * Councils, so the section has to be carried down.
 */
function seatFor(section: Section | null, heading: string): Seat | null {
    const key = normalise(heading);
    const judicial = JUDICIAL_SEATS[key];
    if (judicial) {
        return { position: judicial, group: "judiciary", subgroup: null };
    }

    if (PLACEHOLDER_SEAT.test(key)) return null;

    switch (section) {
        case "class-councils": {
            const name = className(heading);
            return name
                ? { position: `${name} Senator`, group: "senate", subgroup: name }
                : null;
        }
        case "school-representatives": {
            const school = key.toUpperCase();
            if (school !== "KSAS" && school !== "WSE") return null;
            return {
                position: `${school} Senator`,
                group: "senate",
                subgroup: school,
            };
        }
        case "rso": {
            const name = fixSpelling(titleCase(heading));
            return {
                position: /senator$/i.test(name) ? name : `${name} Senator`,
                group: "senate",
                subgroup: "RSO",
            };
        }
        case "caucus-chairs": {
            const caucus =
                CAUCUS_ALIASES[key] ??
                titleCase(heading.replace(/\s*caucus\s*$/i, ""));
            return {
                position: `${caucus} Caucus Chair`,
                group: "caucus",
                subgroup: null,
            };
        }
        case "programming": {
            const name = className(heading);
            return name
                ? {
                    position: `${name} Programming Council`,
                    group: "programming",
                    subgroup: name,
                }
                : null;
        }
        default:
            return null;
    }
}

/** The seat for a section that lists people directly, with no headings. */
function defaultSeat(section: Section | null): Seat | null {
    switch (section) {
        case "executive":
            return { position: "Executive Board", group: "executive", subgroup: null };
        case "cse":
            return {
                position: "Committee on Student Elections",
                group: "cse",
                subgroup: null,
            };
        case "judiciary":
            return { position: "Justice", group: "judiciary", subgroup: null };
        default:
            return null;
    }
}

const ROLE_WORD =
    /\b(?:senator|senate|chair|committee|council|class|president|justice|caucus|totals|excused|unexcused|representative|programming|executive|branch|elections)\b/i;

/**
 * Whether a name cell holds a person rather than a repeated seat label. The
 * sheet sometimes writes the seat where the name goes ("Civic Engagement and
 * Service Senator"), and leaves an "X" where somebody resigned.
 */
function isPersonName(cell: string): boolean {
    const name = cell.trim();
    if (name.length < 3) return false;
    if (ROLE_WORD.test(name)) return false;
    if (/\d/.test(name)) return false;

    const words = name.split(/\s+/);
    if (words.length < 2 || words.length > 5) return false;

    return words.every((word) => /^[A-Za-z][A-Za-z'’.\-]*$/.test(word));
}

type BlockState = {
    section: Section | null;
    seat: Seat | null;
};

/**
 * Every person named on the sheet, with the seat they hold and the committees
 * they sit on. A person holding two seats appears twice.
 */
export function parseAttendanceSheet(csv: string): AttendanceMember[] {
    const rows = csv.split(/\r?\n/).map(parseCsvLine);
    const states: BlockState[] = BLOCKS.map(() => ({ section: null, seat: null }));
    const found: AttendanceMember[] = [];

    for (const row of rows) {
        const blocks = BLOCKS.map(([start, end]) =>
            row.slice(start, end).map((cell) => cell.trim()),
        );

        for (const [index, cells] of blocks.entries()) {
            const state = states[index]!;
            const first = cells[0] ?? "";
            if (!first) continue;
            if (TALLY_ROWS.has(normalise(first))) continue;

            if (normalise(cells[1] ?? "") === PERSON_MARKER) {
                const seat = state.seat ?? defaultSeat(state.section);
                if (!seat || !isPersonName(first)) continue;

                const committees = committeesFrom(cells.slice(2));
                found.push({
                    name: first.replace(/\s+/g, " ").trim(),
                    position: seat.position,
                    group: seat.group,
                    subgroup: seat.subgroup,
                    committees,
                    evidence: evidenceFor(seat, first, committees),
                });
                continue;
            }

            // A heading: everything after the name column is empty.
            if (cells.slice(1).some(Boolean)) continue;

            const section = SECTION_HEADINGS[normalise(first)];
            if (section) {
                state.section = section;
                state.seat = null;

                // A heading with the other block blank spans the page.
                const other = states[index === 0 ? 1 : 0]!;
                if (!blocks[index === 0 ? 1 : 0]!.some(Boolean)) {
                    other.section = section;
                    other.seat = null;
                }
                continue;
            }

            const seat = seatFor(state.section, first);
            if (seat) {
                state.seat = seat;
                if (seat.group === "judiciary") state.section = "judiciary";
            }
        }
    }

    return found;
}

function committeesFrom(cells: string[]): string[] {
    const committees: string[] = [];

    for (const cell of cells) {
        const key = normalise(cell);
        if (!key || MEETINGS.has(key)) continue;

        const committee = COMMITTEE_CODES[key];
        if (committee && !committees.includes(committee)) committees.push(committee);
    }

    return committees;
}

function evidenceFor(seat: Seat, name: string, committees: string[]): string {
    const tail = committees.length > 0 ? ` (${committees.join(", ")})` : "";
    return `${seat.position}: ${name.trim()}${tail}`;
}

/**
 * Whether a spreadsheet is an attendance sheet worth exporting.
 *
 * Copies are excluded: the archive holds "Copy of Official SGA Attendance
 * Sheet (2026-2027)" alongside the real one, and a stale duplicate of the
 * roster is worse than none.
 */
export function isAttendanceSheetName(name: string): boolean {
    if (/^\s*copy of\b/i.test(name)) return false;
    return /attendance/i.test(name);
}

/**
 * Whether a stored document is the attendance workbook rather than a document
 * about attendance -- the archive holds several of the latter, including the
 * policy in the bylaws. The tally marker is the giveaway.
 */
export function isAttendanceSheet(input: { title: string; content: string }): boolean {
    return isAttendanceSheetName(input.title) && /,\s*Totals\s*,/i.test(input.content);
}
