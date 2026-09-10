import { createHmac } from "node:crypto";
import { headers } from "next/headers";

import { RATE_LIMITS, type RateLimitAction } from "@/config/forum";
import { prisma } from "@/lib/prisma";

/**
 * Rate limiting a forum where nobody has a name.
 *
 * The apparent conflict -- you cannot limit what you cannot identify -- is
 * only apparent. Limiting needs to answer "has this client already done this
 * four times in the last hour", which is a question about a counter. It does
 * not need to answer "who is this", and the two are separable if you are
 * careful about what you write down.
 *
 * So: the address is run through an HMAC together with the action and the
 * window it falls in, and only that digest is stored, against an integer.
 * Three properties follow, and they are the whole design.
 *
 *   1. No address is ever written to the database. Not encrypted, not
 *      truncated -- absent. A dump of RateBucket is a list of opaque strings
 *      and numbers.
 *   2. Nothing links a bucket to a post. ForumPost has no rate-limit column
 *      and RateBucket has no post column, so "which posts came from this
 *      address" is not a query that can be written, however much access you
 *      have.
 *   3. The salt is mixed with the UTC date, so the key for a given address
 *      changes every midnight. Even somebody who knows the secret and an
 *      address can only recompute today's keys, and rows are deleted when
 *      their window ends anyway.
 *
 * What this gives up is precision, and knowingly. Shared NAT on campus means
 * one building can share a bucket, and a determined person has a phone, a
 * VPN, and patience. That is the right trade: this exists to stop somebody
 * posting every ten seconds, not to make ban evasion impossible, and the
 * limits in config/forum.ts are set loose enough that a normal reader will
 * never meet one.
 */

/**
 * Truncated to a network rather than a host.
 *
 * A /24 or /64 is enough to stop flooding from one machine while making the
 * bucket a neighbourhood rather than a person -- which is the point, and also
 * why the limits are per-hour rather than per-minute.
 */
function coarsen(address: string): string {
    if (address.includes(":")) {
        // IPv6: the routing prefix, which is what a provider hands out.
        return address.split(":").slice(0, 4).join(":");
    }
    const octets = address.split(".");
    return octets.length === 4 ? `${octets[0]}.${octets[1]}.${octets[2]}.0` : address;
}

/**
 * The caller's address, as the proxy in front of us reports it.
 *
 * Never returned to application code and never stored: the only thing that
 * leaves this module is a digest.
 */
async function clientNetwork(): Promise<string> {
    const requestHeaders = await headers();

    // x-forwarded-for is a chain; the first entry is the original client.
    // Everything after it was added by a hop and is not the caller.
    const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
    const address = forwarded || requestHeaders.get("x-real-ip") || "";

    return address ? coarsen(address) : "unknown";
}

function secret(): string {
    const configured = process.env.RATE_LIMIT_SALT;
    if (configured) return configured;

    // Refusing to run would take the forum down over a missing environment
    // variable; running without one would make the digests guessable. A
    // per-process random value keeps limiting working within an instance and
    // fails loudly in the log rather than silently in the database.
    if (!warnedAboutSalt) {
        warnedAboutSalt = true;
        console.warn(
            "RATE_LIMIT_SALT is not set; using a per-process value. Rate limits will not be shared between instances or survive a restart.",
        );
    }
    return processSalt;
}

let warnedAboutSalt = false;
const processSalt = createHmac("sha256", "fallback").update(String(Math.random())).digest("hex");

/** UTC date, so the salt rotates daily and yesterday's keys stop meaning anything. */
function today(): string {
    return new Date().toISOString().slice(0, 10);
}

function bucketKey(action: string, subject: string, windowStart: number): string {
    return createHmac("sha256", `${secret()}:${today()}`)
        .update(`${action}\u0000${subject}\u0000${windowStart}`)
        .digest("hex");
}

export type RateVerdict = {
    allowed: boolean;
    /** Seconds until the window rolls over. Zero when allowed. */
    retryAfterSeconds: number;
};

const ALLOWED: RateVerdict = { allowed: true, retryAfterSeconds: 0 };

/**
 * Count one attempt at `action` and say whether it is allowed.
 *
 * `subject` overrides the caller's network as the thing being counted, for the
 * one limit that is per-address rather than per-client: mailing a sign-in code
 * to somebody else repeatedly is abuse of them, not of us, and the client
 * doing it may be different every time. Pass an already-hashed value.
 */
export async function consumeRateLimit(
    action: RateLimitAction,
    subject?: string,
): Promise<RateVerdict> {
    const [limit, windowSeconds] = RATE_LIMITS[action];

    const now = Date.now();
    const windowMs = windowSeconds * 1_000;
    // Fixed windows rather than a sliding log: one row per client per window,
    // and no history to keep. A burst at a boundary can reach twice the limit,
    // which for these numbers is not worth a second table to prevent.
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const expiresAt = new Date(windowStart + windowMs);

    const key = bucketKey(action, subject ?? (await clientNetwork()), windowStart);

    try {
        const bucket = await prisma.rateBucket.upsert({
            where: { key },
            create: {
                key,
                count: 1,
                windowStartedAt: new Date(windowStart),
                expiresAt,
            },
            update: { count: { increment: 1 } },
            select: { count: true },
        });

        if (bucket.count <= limit) return ALLOWED;

        return {
            allowed: false,
            retryAfterSeconds: Math.max(
                1,
                Math.ceil((windowStart + windowMs - now) / 1_000),
            ),
        };
    } catch (cause) {
        // Failing open. A database hiccup should not lock everybody out of
        // posting, and the consequence of the other choice -- an outage where
        // nobody can speak -- is worse than the consequence of this one.
        console.error("Rate limit check failed, allowing the request:", cause);
        return ALLOWED;
    }
}

/** Hash a value that should be counted but not stored, such as an address. */
export function rateSubject(value: string): string {
    return createHmac("sha256", `${secret()}:${today()}`)
        .update(value.trim().toLowerCase())
        .digest("hex");
}

// Spent buckets are deleted by pruneEphemeral in lib/prune.ts, which runs from
// a script and so cannot import this module's `next/headers` dependency.
