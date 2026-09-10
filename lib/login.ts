import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import {
    ALLOWED_EMAIL_DOMAINS,
    LOGIN_CODE_MAX_ATTEMPTS,
    LOGIN_CODE_MINUTES,
    SESSION_DAYS,
} from "@/config/forum";
import { prisma } from "@/lib/prisma";
import { mailIsConfigured, sendMail } from "@/lib/resend";

/**
 * Proving somebody is at Hopkins without recording who.
 *
 * The forum needs two things that pull against each other: only Hopkins
 * undergraduates may post, and a post must not be traceable to the person who
 * wrote it. Both are satisfiable, because the first is a question asked once
 * and the second is a property of what is kept afterwards.
 *
 * The address is used and discarded. It is typed in, mailed a code, and
 * matched against an HMAC; the plaintext lives only in the request that
 * handles it, and what persists is a session row saying "somebody proved a
 * Hopkins address" and nothing more. There is no column on that row for who,
 * and no table anywhere joining a session to a post.
 *
 * The exception is deliberate and visible. Someone who holds office gets an
 * affiliate on their session, because a senator posting as a senator is
 * posting on the record -- and posting on the record is opt-in per post.
 */

const COOKIE_NAME = "sga_session";

function secret(): string {
    const configured = process.env.FORUM_SECRET;
    if (!configured) {
        throw new Error(
            "FORUM_SECRET is not set; generate one with `openssl rand -hex 32`",
        );
    }
    return configured;
}

/**
 * The email, as an HMAC.
 *
 * Keyed rather than a bare hash: an unkeyed digest of an address is reversible
 * by anyone willing to hash a student directory, which for a university with a
 * predictable address format is an afternoon's work.
 */
export function hashEmail(email: string): string {
    return createHmac("sha256", secret())
        .update(`email\u0000${normalizeEmail(email)}`)
        .digest("hex");
}

function hashToken(token: string): string {
    return createHmac("sha256", secret()).update(`token\u0000${token}`).digest("hex");
}

function hashCode(emailHash: string, code: string): string {
    return createHmac("sha256", secret()).update(`code\u0000${emailHash}\u0000${code}`).digest("hex");
}

export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

export function emailDomainAllowed(email: string): boolean {
    const domain = normalizeEmail(email).split("@")[1];
    if (!domain) return false;
    return (ALLOWED_EMAIL_DOMAINS as readonly string[]).includes(domain);
}

/** Cheap shape check; the code round-trip is what actually proves anything. */
export function looksLikeEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function moderatorEmails(): string[] {
    return (process.env.FORUM_MODERATOR_EMAILS ?? "")
        .split(",")
        .map((entry) => normalizeEmail(entry))
        .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

export type RequestCodeResult =
    | { ok: true }
    | { ok: false; error: string };

/**
 * Mail a sign-in code.
 *
 * Always reports success to the caller for an address on an allowed domain,
 * whether or not anything was sent. Telling somebody "no account exists" would
 * turn this form into a way to test whether a given person is on the forum,
 * which for an anonymous forum is the one thing it must not become.
 */
export async function requestLoginCode(email: string): Promise<RequestCodeResult> {
    const address = normalizeEmail(email);

    if (!looksLikeEmail(address)) {
        return { ok: false, error: "That does not look like an email address." };
    }

    if (!emailDomainAllowed(address)) {
        return {
            ok: false,
            error: `Posting is limited to Hopkins addresses (${ALLOWED_EMAIL_DOMAINS.join(", ")}).`,
        };
    }

    if (!mailIsConfigured()) {
        return {
            ok: false,
            error: "Sign-in is not configured on this deployment yet.",
        };
    }

    const emailHash = hashEmail(address);
    // Six digits, from a generator meant for this. Short enough to retype from
    // a phone; the attempt limit below is what makes the length sufficient.
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + LOGIN_CODE_MINUTES * 60_000);

    // One code in flight per address: requesting another should invalidate the
    // last, or a mailbox full of live codes becomes the weak point.
    await prisma.loginCode.deleteMany({ where: { emailHash } });
    await prisma.loginCode.create({
        data: { emailHash, codeHash: hashCode(emailHash, code), expiresAt },
    });

    try {
        await sendMail({
            to: address,
            subject: `${code} is your SGA discussion sign-in code`,
            text: [
                `Your sign-in code is ${code}.`,
                "",
                `It is good for ${LOGIN_CODE_MINUTES} minutes.`,
                "",
                "This code proves to the forum that somebody at Hopkins is signing in.",
                "It is not stored against anything you go on to post: your address is",
                "kept only as a one-way hash, and posts carry no author unless you",
                "hold office and choose to be named.",
                "",
                "If you did not ask for this, nothing has happened and you can ignore it.",
            ].join("\n"),
        });
    } catch (cause) {
        await prisma.loginCode.deleteMany({ where: { emailHash } });
        console.error("Could not send a sign-in code:", cause);
        return {
            ok: false,
            error: "The code could not be sent. Try again in a moment.",
        };
    }

    return { ok: true };
}

export type VerifyResult =
    | { ok: true; role: SessionRole; named: string | null }
    | { ok: false; error: string };

export type SessionRole = "member" | "officer" | "moderator";

/**
 * Check a code and open a session.
 *
 * The address is needed here to find the code and to decide whether this
 * person holds office. Neither use survives the function: what is written is a
 * session row whose only link to a person is the affiliate, and that is set
 * only for officeholders.
 */
export async function verifyLoginCode(
    email: string,
    code: string,
): Promise<VerifyResult> {
    const address = normalizeEmail(email);
    const emailHash = hashEmail(address);
    const wrong = { ok: false as const, error: "That code is wrong or has expired." };

    const record = await prisma.loginCode.findFirst({
        where: { emailHash, consumedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
    });

    if (!record) return wrong;

    if (record.attempts >= LOGIN_CODE_MAX_ATTEMPTS) {
        await prisma.loginCode.delete({ where: { id: record.id } });
        return {
            ok: false,
            error: "Too many wrong attempts. Ask for a new code.",
        };
    }

    const provided = hashCode(emailHash, code.trim());
    const expected = record.codeHash;
    const matches =
        provided.length === expected.length &&
        timingSafeEqual(Buffer.from(provided), Buffer.from(expected));

    if (!matches) {
        await prisma.loginCode.update({
            where: { id: record.id },
            data: { attempts: { increment: 1 } },
        });
        return wrong;
    }

    // Used once. Deleted rather than marked, because the row's only purpose is
    // spent and keeping it would keep an address hash for no reason.
    await prisma.loginCode.delete({ where: { id: record.id } });

    const office = await officeFor(address);
    const role: SessionRole = moderatorEmails().includes(address)
        ? "moderator"
        : office
            ? "officer"
            : "member";

    const token = randomBytes(32).toString("base64url");

    await prisma.forumSession.create({
        data: {
            tokenHash: hashToken(token),
            expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60_000),
            role,
            hopkinsAffiliateId: office?.affiliateId ?? null,
        },
    });

    const store = await cookies();
    store.set(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: SESSION_DAYS * 24 * 60 * 60,
    });

    return { ok: true, role, named: office?.label ?? null };
}

/**
 * The office this address currently holds, if any.
 *
 * Read from the contact directory the sync builds out of the SGA's own
 * published lists, so "who is a senator" is answered by the same documents the
 * rest of the site cites rather than by a list maintained here.
 */
async function officeFor(
    address: string,
): Promise<{ affiliateId: string; label: string } | null> {
    const affiliate = await prisma.hopkinsAffiliate.findUnique({
        where: { email: address },
        select: {
            id: true,
            hopkinsRelationships: {
                where: {
                    endedAt: null,
                    hopkinsCategory: { type: { in: ["position", "committee_role"] } },
                },
                select: { hopkinsCategory: { select: { name: true, type: true } } },
            },
        },
    });

    if (!affiliate || affiliate.hopkinsRelationships.length === 0) return null;

    // A position outranks a committee role: "Senator" is the thing a reader
    // needs to know, and "Chair of Academic Affairs" is the detail.
    const held = affiliate.hopkinsRelationships;
    const position =
        held.find((row) => row.hopkinsCategory.type === "position") ?? held[0]!;

    return { affiliateId: affiliate.id, label: position.hopkinsCategory.name };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type ForumViewer = {
    id: string;
    role: SessionRole;
    /** Set only for officeholders, who may choose to post under their name. */
    affiliateId: string | null;
    affiliateName: string | null;
    officeLabel: string | null;
};

/**
 * Who is asking, to the extent the site knows.
 *
 * For a member this returns a role and nothing else, which is all that is
 * stored. Returns null when there is no valid session; pages use that to
 * decide whether to show a posting form, never to decide what to show of the
 * forum itself, which is readable by anyone.
 */
export async function currentViewer(): Promise<ForumViewer | null> {
    const store = await cookies();
    const token = store.get(COOKIE_NAME)?.value;
    if (!token) return null;

    const session = await prisma.forumSession.findUnique({
        where: { tokenHash: hashToken(token) },
        select: {
            id: true,
            role: true,
            expiresAt: true,
            hopkinsAffiliate: {
                select: {
                    id: true,
                    name: true,
                    hopkinsRelationships: {
                        where: {
                            endedAt: null,
                            hopkinsCategory: { type: "position" },
                        },
                        select: { hopkinsCategory: { select: { name: true } } },
                        take: 1,
                    },
                },
            },
        },
    });

    if (!session) return null;

    if (session.expiresAt.getTime() < Date.now()) {
        await prisma.forumSession.delete({ where: { id: session.id } }).catch(() => {});
        return null;
    }

    const role: SessionRole =
        session.role === "moderator" || session.role === "officer"
            ? session.role
            : "member";

    return {
        id: session.id,
        role,
        affiliateId: session.hopkinsAffiliate?.id ?? null,
        affiliateName: session.hopkinsAffiliate?.name ?? null,
        officeLabel:
            session.hopkinsAffiliate?.hopkinsRelationships[0]?.hopkinsCategory.name ?? null,
    };
}

export async function signOut(): Promise<void> {
    const store = await cookies();
    const token = store.get(COOKIE_NAME)?.value;

    if (token) {
        await prisma.forumSession
            .delete({ where: { tokenHash: hashToken(token) } })
            .catch(() => {});
    }

    store.delete(COOKIE_NAME);
}

// There is deliberately nothing here for deleting your own post.
//
// An earlier draft handed the posting browser a per-post secret so it could
// withdraw what it wrote. That is a worse rule than it looks: on an anonymous
// forum, self-deletion is an attack. Post something defamatory, let it be
// read, delete it, and no record survives that it was ever said -- and the
// people it was said about have nothing to point at.
//
// So a post is permanent once made. Anything can still come down, but only
// through a moderator, which puts it in the public log with a reason next to
// it. That costs somebody the ability to take back a sentence they regret,
// and buys a record nobody can quietly edit.

// Expired sessions and codes are deleted by pruneEphemeral in lib/prune.ts,
// which lives there rather than here because this module needs a request and
// that one must run from a script.
