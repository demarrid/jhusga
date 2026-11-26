/**
 * The documents page's list filters (type, person, capacity, office) can each
 * hold several values, chosen by holding Ctrl or Cmd in the dropdown.
 *
 * They travel in the URL comma-separated in one parameter, so a single-value
 * link such as `/documents?person=<id>` reads exactly as it always has. None
 * of the values -- category slugs, role names, and database ids -- contains a
 * comma. A repeated parameter is read the same way.
 */
const SEPARATOR = ",";

/** The distinct values of a filter parameter, in the order given. */
export function parseFilterValues(value: string | readonly string[] | null | undefined): string[] {
    const raw = typeof value === "string" ? [value] : value ?? [];
    return [
        ...new Set(
            raw
                .flatMap((entry) => entry.split(SEPARATOR))
                .map((entry) => entry.trim())
                .filter(Boolean),
        ),
    ];
}

/** The parameter value for a set of filter values; empty clears the filter. */
export function joinFilterValues(values: readonly string[]): string {
    return values.join(SEPARATOR);
}
