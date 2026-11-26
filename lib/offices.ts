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

    // "Fraternity & Sorority Life Senator" is one seat: a one-word side of the
    // "&" is part of a name, not an office of its own.
    const parts = tidy(raw).split(/\s*&\s*/);
    const split = parts.every((part) => part.includes(" ")) ? parts : [tidy(raw)];

    for (const part of split) {
        const office = canonicalOffice(part);
        if (!office) continue;
        const key = office.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        offices.push(office);
    }

    return offices;
}

/**
 * One seat, several names. The 114th roster writes a caucus or constituency
 * seat as the constituency ("Disabled Students"), as a short title ("Disability
 * Senator") and in full ("Disabled Students Caucus Senator"), and the same
 * senator holds all three. Each spelling here was checked against who holds
 * it; the name kept is the one with the most holders.
 */
const OFFICE_SPELLINGS: Record<string, string> = {
    "advocacy and activism": "Activism and Advocacy Senator",
    "advocacy and activism senator": "Activism and Advocacy Senator",
    "advocacy and awareness senator": "Activism and Advocacy Senator",
    "arts senator": "Performing and Visual Arts Senator",
    "performing and visual arts": "Performing and Visual Arts Senator",
    "black senator": "Black and African-Origin Students Caucus Senator",
    "black and african-origin students": "Black and African-Origin Students Caucus Senator",
    "civic engagement and service": "Civic Engagement and Service Senator",
    "community service senator": "Civic Engagement and Service Senator",
    "cultural identity": "Cultural Identity Senator",
    "cultural and identity senator": "Cultural Identity Senator",
    "director of communication": "Director of Communications",
    "disability senator": "Disabled Students Caucus Senator",
    "disabled students": "Disabled Students Caucus Senator",
    "first-generation limited income senator": "First-Generation Limited Income Students Caucus Senator",
    "first-generation limited income students": "First-Generation Limited Income Students Caucus Senator",
    "first-generation, limited-income caucus representative": "First-Generation Limited Income Students Caucus Senator",
    "first-generation, limited-income caucus chair": "First-Generation, Limited-Income Caucus Chair",
    "first-generation, limited-income caucus": "First-Generation, Limited-Income Caucus Chair",
    "hispanic/latine students": "Hispanic/Latine Students Caucus Senator",
    "hispanic/latinx senator": "Hispanic/Latine Students Caucus Senator",
    "lgbtq+ students caucus senator": "LGBTQIA+ Students Caucus Senator",
    "religious and spiritual life": "Religious and Spiritual Life Senator",
    "senate parliamentarian (vice president of the senate)": "Senate Parliamentarian",
    "special interest and hobby": "Special Interest and Hobby Senator",
    "student athlete senator": "Student Athletes Caucus Senator",
    "student athletes": "Student Athletes Caucus Senator",
    "vice student body president": "Student Body Vice President",
    "women and gender minority senator": "Women and Gender Minority-Identifying Students Caucus Senator",
    "women and gender minority-identifying students": "Women and Gender Minority-Identifying Students Caucus Senator",
};

/**
 * Cells that are not an office at all: "?", a person's address from a column
 * the roster shifted, or "Caucus Senator" with the caucus left in another cell.
 */
function notAnOffice(office: string): boolean {
    return !/[a-z]{2}/i.test(office) || office.includes("@") || /^caucus senator$/i.test(office);
}

/** The one name for a single office, or "" when the cell names none. */
export function canonicalOffice(raw: string): string {
    const office = tidy(raw);
    if (!office || notAnOffice(office)) return "";

    const spelled = OFFICE_SPELLINGS[office.toLowerCase()];
    if (spelled) return spelled;

    const bare = BARE_NUMBERED_SEAT.exec(office);
    if (bare) {
        const seat = NUMBERED_SEATS[bare[1]!.toLowerCase()];
        if (seat) return seat;
    }

    const numbered = TRAILING_SEAT_NUMBER.exec(office);
    if (numbered) return tidy(numbered[1]!);

    if (CAUCUS.test(office)) return OFFICE_SPELLINGS[`${office} chair`.toLowerCase()] ?? `${office} Chair`;

    return office;
}
