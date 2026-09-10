'use server'

import { revalidatePath } from "next/cache";

import {
    currentViewer,
    emailDomainAllowed,
    hashEmail,
    looksLikeEmail,
    normalizeEmail,
    requestLoginCode,
    signOut as endSession,
    verifyLoginCode,
    type ForumViewer,
} from "@/lib/login";
import { consumeRateLimit } from "@/lib/ratelimit";

/**
 * Signing in to post.
 *
 * Reading the forum needs none of this. A session is only ever required to
 * write, which is why every failure here is phrased as a delay rather than a
 * denial of access.
 */

export type AuthResult = { ok: boolean; error?: string; message?: string };

export async function getViewer(): Promise<ForumViewer | null> {
    return currentViewer();
}

export async function sendSignInCode(email: string): Promise<AuthResult> {
    const address = normalizeEmail(email);

    // Shape and domain are checked before either limit, so that a typo does
    // not burn one of the four codes an address gets in an hour.
    if (!looksLikeEmail(address)) {
        return { ok: false, error: "That does not look like an email address." };
    }
    if (!emailDomainAllowed(address)) {
        return {
            ok: false,
            error: "Posting is limited to Hopkins addresses (jh.edu, jhu.edu, jhmi.edu).",
        };
    }

    const byClient = await consumeRateLimit("login_request");
    if (!byClient.allowed) {
        return {
            ok: false,
            error: `Too many sign-in requests. Try again in ${minutes(byClient.retryAfterSeconds)}.`,
        };
    }

    // Also limited per address, and counted under a hash of it rather than the
    // address itself. Without this, one client rotating through addresses --
    // or many clients aimed at one -- turns this form into a way to fill
    // somebody's inbox.
    const byAddress = await consumeRateLimit("login_email", hashEmail(address));
    if (!byAddress.allowed) {
        return {
            ok: false,
            error: "A code has already been sent to that address recently. Check your inbox, including spam.",
        };
    }

    const result = await requestLoginCode(address);
    if (!result.ok) return { ok: false, error: result.error };

    return {
        ok: true,
        message: `A six-digit code is on its way to ${address}. It is good for fifteen minutes.`,
    };
}

export async function submitSignInCode(
    email: string,
    code: string,
): Promise<AuthResult> {
    const limit = await consumeRateLimit("login_verify");
    if (!limit.allowed) {
        return {
            ok: false,
            error: `Too many attempts. Try again in ${minutes(limit.retryAfterSeconds)}.`,
        };
    }

    const result = await verifyLoginCode(email, code);
    if (!result.ok) return { ok: false, error: result.error };

    revalidatePath("/discussion");

    return {
        ok: true,
        message: result.named
            ? `Signed in. You hold office (${result.named}), so you can choose to post under your name.`
            : "Signed in. Nothing you post will carry your name.",
    };
}

export async function signOut(): Promise<AuthResult> {
    await endSession();
    revalidatePath("/discussion");
    return { ok: true, message: "Signed out." };
}

function minutes(seconds: number): string {
    const value = Math.ceil(seconds / 60);
    return value <= 1 ? "a minute" : `${value} minutes`;
}
