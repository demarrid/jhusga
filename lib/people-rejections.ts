import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export type PeopleRejection = { index: number; reason: string; candidate: unknown };
export const PEOPLE_REJECTION_LOG = path.join('.archive-local', 'people-rejections.jsonl');

/** Local diagnostics only. Never persist rejected candidates to Prisma or remote logs. */
export async function logPeopleRejections(context: { documentId?: string; title: string; chunk: number; model: string },
    rejections: PeopleRejection[], destination = PEOPLE_REJECTION_LOG) {
    if (!rejections.length) return;
    try {
        await mkdir(path.dirname(destination), { recursive: true });
        const timestamp = new Date().toISOString();
        await appendFile(destination, rejections.map(rejection => JSON.stringify({ timestamp, ...context, ...rejection })).join('\n') + '\n', { mode: 0o600 });
        console.warn(`Skipped ${rejections.length} invalid people entries; details saved to ${destination}`);
    } catch {
        // Read-only hosts must not turn an individual rejection into a document failure.
        console.warn(`Skipped ${rejections.length} invalid people entries; local rejection log could not be written.`);
    }
}
