/**
 * The forum's settings.
 *
 * Client-safe: no `process.env` reads and no imports that touch the database,
 * because the posting form needs the categories and the length limits.
 * Anything secret lives in lib/, read from the environment there.
 */

/**
 * Who may post.
 *
 * Hopkins hands out addresses on several domains and they are not
 * interchangeable: jh.edu and jhu.edu are the undergraduate-facing ones,
 * jhmi.edu is the medical institutions. All three are Hopkins, which is the
 * only thing this list is deciding.
 */
export const ALLOWED_EMAIL_DOMAINS = ["jh.edu", "jhu.edu", "jhmi.edu"] as const;

/**
 * Categories, chosen top-down rather than discovered.
 *
 * A forum with nobody on it cannot cluster its own topics, and letting posters
 * invent categories on day one produces forty of them. The model suggests one
 * of these at posting time and the poster can overrule it; when there is
 * enough traffic to see what people actually write about, revise this list
 * from the evidence rather than guessing again.
 */
export type ForumCategorySeed = {
    slug: string;
    name: string;
    description: string;
};

export const FORUM_CATEGORIES: ForumCategorySeed[] = [
    {
        slug: "academics",
        name: "Academics",
        description: "Courses, advising, registration, grading, and the libraries.",
    },
    {
        slug: "campus-life",
        name: "Campus life",
        description: "Housing, dining, transport, facilities, and everything around them.",
    },
    {
        slug: "money",
        name: "Money",
        description:
            "Club funding, the student activities fee, financial aid, and the cost of being here.",
    },
    {
        slug: "safety",
        name: "Safety and wellbeing",
        description: "Public safety, health services, accessibility, and mental health.",
    },
    {
        slug: "sga",
        name: "The SGA itself",
        description:
            "What the SGA is doing, what it should be doing, and how it runs. Elections go here.",
    },
    {
        slug: "other",
        name: "Anything else",
        description: "Things the categories above do not cover.",
    },
];

export const DEFAULT_CATEGORY_SLUG = "other";

export function categoryName(slug: string): string {
    return FORUM_CATEGORIES.find((category) => category.slug === slug)?.name ?? slug;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const TITLE_MAX_CHARS = 140;
export const TITLE_MIN_CHARS = 8;
export const BODY_MAX_CHARS = 8_000;
export const BODY_MIN_CHARS = 10;

/** How long a signed-in session lasts before the code has to be re-sent. */
export const SESSION_DAYS = 30;

/** How long an emailed code is good for. */
export const LOGIN_CODE_MINUTES = 15;

/** Wrong guesses before a code is burned, so a 6-digit code cannot be walked. */
export const LOGIN_CODE_MAX_ATTEMPTS = 5;

/**
 * Rate limits, as [requests, window in seconds].
 *
 * Set to stop flooding and nothing more. The point is that somebody cannot
 * post every ten seconds; it is not to make posting difficult, and every one
 * of these should be loose enough that an ordinary reader never sees it.
 */
export const RATE_LIMITS = {
    /** Asking for a sign-in code, per client. */
    login_request: [5, 60 * 60],
    /** Asking for a sign-in code, per address. Stops mail-bombing one person. */
    login_email: [4, 60 * 60],
    /** Submitting a code, per client. */
    login_verify: [12, 60 * 60],
    /** New threads. */
    post: [4, 60 * 60],
    post_daily: [12, 24 * 60 * 60],
    /** Replies, which should be freer than threads. */
    reply: [20, 60 * 60],
    reply_daily: [80, 24 * 60 * 60],
} as const satisfies Record<string, readonly [number, number]>;

export type RateLimitAction = keyof typeof RATE_LIMITS;
