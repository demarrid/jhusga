/** Partial dates never become a fabricated calendar day. Anchors are for sorting only. */

const MONTHS = "January February March April May June July August September October November December".split(" ");

export function normalizedDateDay(value: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export function normalizedDateMonth(value: string): { year: number; month: number } | null {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (year < 1800 || year > 2100 || month < 1 || month > 12) return null;
    return { year, month };
}

export function normalizedDateLabel(value?: string | null): string | null {
    if (!value) return null;
    const range = /^(\d{4})\/(\d{4})$/.exec(value);
    if (range) return `${range[1]}\u2013${range[2]} session`;
    if (/^\d{4}$/.test(value)) return value;
    const month = normalizedDateMonth(value);
    if (month) return `${MONTHS[month.month - 1]} ${month.year}`;
    const day = normalizedDateDay(value);
    if (!day) return null;
    return day.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
}

/** Machine value for a <time> element. A session range uses its June start, which is the sort anchor. */
export function normalizedDateMachine(value?: string | null): string | null {
    if (!value) return null;
    const range = /^(\d{4})\/(\d{4})$/.exec(value);
    if (range) return `${range[1]}-06-01`;
    if (/^\d{4}$/.test(value) || normalizedDateMonth(value) || normalizedDateDay(value)) return value;
    return null;
}

export function normalizedDateNote(value?: string | null): string | null {
    if (!value) return null;
    if (/^\d{4}\/\d{4}$/.test(value)) return "Academic year; the exact day is unknown.";
    if (/^\d{4}$/.test(value)) return "Source establishes the year only; the exact day is unknown.";
    if (normalizedDateMonth(value)) return "Source establishes the month; the exact day is unknown.";
    return null;
}

export function normalizedDateSortAnchor(value?: string | null): Date | null {
    if (!value) return null;
    if (/^\d{4}$/.test(value)) return new Date(`${value}-01-01T12:00:00Z`);
    if (/^\d{4}\/\d{4}$/.test(value)) return new Date(`${value.slice(0, 4)}-06-01T12:00:00Z`);
    const month = normalizedDateMonth(value);
    if (month) return new Date(`${value}-01T12:00:00Z`);
    return normalizedDateDay(value);
}
