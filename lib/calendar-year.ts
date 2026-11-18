/** Match the archive's century convention: 00–39 are 2000s, 40–99 are 1900s.
 * Explicit four-digit years are never shifted.
 */
export function expandCalendarYear(year: number): number {
    return year < 100 ? (year < 40 ? 2000 : 1900) + year : year;
}
