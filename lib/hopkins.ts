/**
 * Vocabulary for people and what they are at the university.
 *
 * Stored as plain strings on HopkinsCategory.type and
 * HopkinsAffiliate.enrollmentStatus rather than Postgres enums, so that adding
 * a category type does not require a migration. These tuples are the
 * canonical lists.
 */

export const HOPKINS_CATEGORY_TYPES = [
    /** An SGA office: Student Body President, Executive Treasurer. */
    "position",
    /** A role within a committee: Chair of the Committee on Academic Affairs. */
    "committee_role",
    /** A school or division: WSE, KSAS, Peabody. */
    "division",
    /** Undergraduate, graduate. */
    "level",
    /** A class year: Class of 2028. */
    "cohort",
    "other",
] as const;

export type HopkinsCategoryType = (typeof HOPKINS_CATEGORY_TYPES)[number];

export function isHopkinsCategoryType(
    value: string,
): value is HopkinsCategoryType {
    return (HOPKINS_CATEGORY_TYPES as readonly string[]).includes(value);
}

export const ENROLLMENT_STATUSES = [
    "full_time",
    "part_time",
    /** Transferred in from another institution. */
    "transfer",
    /** Taking classes without being in a degree programme. */
    "non_degree",
    "unknown",
] as const;

export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export function isEnrollmentStatus(value: string): value is EnrollmentStatus {
    return (ENROLLMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Categories that confer authority and therefore turn over. Relationships to
 * these should always carry a startedAt, so that "who holds this now" and "who
 * held it then" are both answerable.
 */
export const TERM_BOUND_CATEGORY_TYPES: HopkinsCategoryType[] = [
    "position",
    "committee_role",
];
