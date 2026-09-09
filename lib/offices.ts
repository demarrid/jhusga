/**
 * One name per office.
 *
 * The same seat is written three ways depending on which document is doing the
 * writing. The attendance sheet, which is organised by seat, says "WSE
 * Senator". The roster spreadsheet is organised by *person* and numbers the
 * rows it has to fill, so it says "WSE 1", "WSE 2", "WSE 3". Minutes say
 * neither. Recorded verbatim, one office becomes six, and the office filter on
 * the documents page offers "WSE 1", "WSE 4" and "WSE Senator" as though a
 * reader were meant to know the difference.
 *
 * The seat number is dropped rather than kept because it identifies nothing:
 * the school senators are not ranked, and which row of the roster a senator
 * was typed into is a fact about the spreadsheet.
 */

/** Schools and constituencies the roster numbers instead of naming. */
const NUMBERED_SEATS: Record<string, string> = {
    ksas: "KSAS Senator",
    wse: "WSE Senator",
    rso: "RSO Senator",
};

/** "Junior Class Senator 2" -- a named seat with a row number stuck on it. */
const TRAILING_SEAT_NUMBER = /^(.*\b(?:senator|justice|representative))\s*\d+$/i;

/** "WSE 4", "KSAS 1". */
const BARE_NUMBERED_SEAT = /^([A-Za-z]+)\s*\d+$/;

/**
 * A caucus chair, written by the roster as the caucus itself.
 *
 * A person is not a caucus, and the attendance sheet already writes the seat
 * out as "Black Caucus Chair"; left alone the two spellings are two offices.
 */
const CAUCUS = /caucus$/i;

function tidy(office: string): string {
    return office.replace(/\s+/g, " ").trim();
}

/**
 * The offices one roster cell names.
 *
 * More than one when a member holds two seats and the roster writes them into
 * a single cell -- "President of the Senate & Senior Class President" is two
 * offices, and as one string it is a third that nobody holds. Only "&" splits:
 * "Health, Safety and Sustainability" is one committee, and splitting on the
 * word "and" would take it apart.
 */
export function canonicalOffices(raw: string): string[] {
    const seen = new Set<string>();
    const offices: string[] = [];

    for (const part of tidy(raw).split(/\s*&\s*/)) {
        const office = canonicalOffice(part);
        if (!office) continue;
        const key = office.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        offices.push(office);
    }

    return offices;
}

/** The one name for a single office, or "" when the cell names none. */
export function canonicalOffice(raw: string): string {
    const office = tidy(raw);
    if (!office) return "";

    const bare = BARE_NUMBERED_SEAT.exec(office);
    if (bare) {
        const seat = NUMBERED_SEATS[bare[1]!.toLowerCase()];
        if (seat) return seat;
    }

    const numbered = TRAILING_SEAT_NUMBER.exec(office);
    if (numbered) return tidy(numbered[1]!);

    if (CAUCUS.test(office)) return `${office} Chair`;

    return office;
}
