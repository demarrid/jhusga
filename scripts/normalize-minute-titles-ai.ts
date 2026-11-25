import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { prisma } from '../lib/prisma';
import { generateJson } from '../lib/ai';
import { acceptedMinuteTitle, minuteTitleSourceHash, MINUTE_TITLE_PROMPT, validateMinuteTitle } from '../lib/minute-title-ai';

process.loadEnvFile(path.join(process.cwd(), '.env'));

async function main() {
    const args = process.argv.slice(2);
    let limit = Infinity, documentId: string | undefined;
    const apply = args.includes('--apply');
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--apply' || args[i] === '--cached-only') continue;
        if (args[i] === '--limit') {
            limit = Number(args[++i]);
            if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('--limit needs a positive integer');
        } else if (args[i] === '--document') {
            documentId = args[++i];
            if (!documentId || documentId.startsWith('--')) throw new Error('--document needs an ID');
        } else throw new Error(`Unknown option: ${args[i]}`);
    }
    if (args.includes('--cached-only')) limit = 0;
    const documents = await prisma.document.findMany({ where: { kind: { startsWith: 'minutes.' }, id: documentId },
        orderBy: { id: 'asc' }, select: { id: true, title: true, displayTitle: true, kind: true, folderPath: true,
            content: true, updatedAt: true, aiNormalizedTitle: true, aiTitleSourceHash: true } });
    if (documentId && !documents.length) throw new Error('Minutes document not found');
    // Reserve all current titles, including documents outside this batch.
    const corpus = await prisma.document.findMany({ select: { id: true, title: true, displayTitle: true } });
    const occupied = new Map<string, Set<string>>();
    const keyOf = (title: string) => title.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
    for (const document of corpus) for (const title of [document.title, document.displayTitle]) {
        const key = keyOf(title);
        if (key) occupied.set(key, new Set([...(occupied.get(key) ?? []), document.id]));
    }
    const directory = '.archive-local/minute-titles';
    await mkdir(directory, { recursive: true });
    const report: object[] = [];
    const changes: { document: typeof documents[number]; proposed: string; sourceHash: string }[] = [];
    let calls = 0, skipped = 0;
    for (const document of documents) {
        if (acceptedMinuteTitle(document)) { skipped++; continue; }
        const sourceHash = minuteTitleSourceHash(document);
        const cacheKey = createHash('sha256').update(JSON.stringify([sourceHash, MINUTE_TITLE_PROMPT,
            process.env.AI_PROVIDER ?? 'anthropic', process.env.AI_MODEL ?? 'default'])).digest('hex');
        const filename = path.join(directory, `${cacheKey}.json`);
        try {
            let raw: unknown;
            try { raw = JSON.parse(await readFile(filename, 'utf8')); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                if (calls >= limit) continue;
                calls++;
                // No silent truncation: an oversized input fails and remains retryable.
                const generated = await generateJson<unknown>({ system: MINUTE_TITLE_PROMPT,
                    user: JSON.stringify({ title: document.title, kind: document.kind, folderPath: document.folderPath, content: document.content }), maxTokens: 4096 });
                raw = generated.value;
                validateMinuteTitle(raw, document);
                await writeFile(filename, JSON.stringify(raw, null, 2), { mode: 0o600 });
            }
            const proposal = validateMinuteTitle(raw, document);
            if (!proposal.title) { report.push({ id: document.id, original: document.title, status: 'deferred', ...proposal }); continue; }
            const key = keyOf(proposal.title);
            if ([...(occupied.get(key) ?? [])].some(id => id !== document.id)) {
                // Neither proposal wins an ambiguous duplicate merely by processing order.
                for (let i = changes.length - 1; i >= 0; i--) {
                    if (keyOf(changes[i].proposed) !== key) continue;
                    const earlier = report.find(row => (row as { id?: string }).id === changes[i].document.id) as { status: string } | undefined;
                    if (earlier) earlier.status = 'collision';
                    changes.splice(i, 1);
                }
                report.push({ id: document.id, original: document.title, status: 'collision', ...proposal }); continue;
            }
            occupied.set(key, new Set([document.id]));
            changes.push({ document, proposed: proposal.title, sourceHash });
            report.push({ id: document.id, original: document.title, before: document.displayTitle, status: 'proposed', ...proposal });
        } catch (error) {
            const failure = { id: document.id, title: document.title, status: 'failed', reason: error instanceof Error ? error.message : String(error) };
            report.push(failure);
            await appendFile(path.join(directory, 'rejections.jsonl'), JSON.stringify({ timestamp: new Date().toISOString(), ...failure }) + '\n', { mode: 0o600 });
            console.error(`Deferred ${document.id}: ${failure.reason}`);
        }
    }
    const stamp = Date.now();
    await writeFile(path.join(directory, `preview-${stamp}.json`), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log({ modelCalls: calls, proposed: changes.length, skipped, deferred: report.length - changes.length, report: `${directory}/preview-${stamp}.json` });
    if (!apply || !changes.length) return;
    await writeFile(path.join(directory, `backup-${stamp}.json`), JSON.stringify(changes, null, 2), { mode: 0o600 });
    // One transaction per document: stale records do not undo other safe changes.
    for (const { document, proposed, sourceHash } of changes) {
        const result = await prisma.document.updateMany({ where: { id: document.id, updatedAt: document.updatedAt },
            data: { displayTitle: proposed, aiNormalizedTitle: proposed, aiTitleSourceHash: sourceHash } });
        console.log(`${result.count ? 'applied' : 'stale; skipped'} ${document.id}: ${proposed}`);
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
