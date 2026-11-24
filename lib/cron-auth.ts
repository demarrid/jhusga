import { timingSafeEqual } from "node:crypto";

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is
 * set on the project. The sync's own hand-off between invocations sends the
 * same header, so one check covers the scheduler, the hand-off, and manual
 * curl invocations.
 */
export function hasCronSecret(request: Request): boolean {
    const secret = process.env.CRON_SECRET;
    const authorization = request.headers.get("authorization") ?? "";
    const provided = Buffer.from(authorization);
    const expected = Buffer.from(`Bearer ${secret ?? ""}`);

    // Equal-length buffers are required by timingSafeEqual.
    const authorized = !!secret && provided.length === expected.length && timingSafeEqual(provided, expected);
    if (!authorized) {
        // Never log credentials, hashes, lengths, URLs, or request bodies.
        console.warn("Scheduled job authentication rejected", {
            reason: !secret ? "secret-missing" : !authorization ? "header-missing" :
                !authorization.startsWith("Bearer ") ? "scheme-mismatch" : "credential-mismatch",
            secretHasOuterWhitespace: !!secret && secret !== secret.trim(),
            deploymentCommit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "local",
        });
    }
    return authorized;
}
