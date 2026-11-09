import { timingSafeEqual } from "node:crypto";

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is
 * set on the project. The sync's own hand-off between invocations sends the
 * same header, so one check covers the scheduler, the hand-off, and manual
 * curl invocations.
 */
export function hasCronSecret(request: Request): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret) return false;

    const provided = Buffer.from(request.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${secret}`);

    // Equal-length buffers are required by timingSafeEqual.
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(provided, expected);
}
