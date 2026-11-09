import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { MASTER_FOLDER_ID, MAX_LINK_ROUNDS } from "@/config/sga";
import {
    SYNC_ABANDON_AFTER_MS,
    SYNC_LEASE_MS,
    SYNC_MAX_ATTEMPTS,
    SYNC_SLICE_BUDGET_MS,
    SYNC_STALLED_AFTER_MS,
} from "@/config/sync";
import { administratorLookupsLeft, beginAdministratorLookupRun } from "@/lib/administrator-lookup";
import { recordAllDirectories } from "@/lib/directory";
import { type WalkedFile, walkFolder } from "@/lib/drive";
import { refreshRevisionAuthors, revisionOAuthConfigured } from "@/lib/drive-revisions";
import { applyManualNameAliases, pruneStaleAliases, resetNameResolverCache } from "@/lib/names";
import { prisma } from "@/lib/prisma";
import { rebuildPassages } from "@/lib/search";
import {
    type PendingLink,
    type SyncOptions,
    type SyncSummary,
    type SyncTrigger,
    emptySyncSummary,
    ingestFile,
    ingestPendingLink,
    ingestibleFromWalk,
    prepareLinkRound,
    rebuildReferences,
    recordDates,
    recordDriveAccounts,
    recordKinds,
    recordMeetings,
    recordSessions,
    recordTitles,
    refreshUnchangedFiles,
} from "@/lib/sync";

/**
 * A sync as a sequence of steps that survives being cut into pieces.
 *
 * The deployed functions stop at 60 seconds and a full pass over the master
 * folder takes two or three minutes, so no single invocation can do it. Each
 * invocation instead works the run for a slice of its time limit, writes a
 * checkpoint after every file or pass, and hands the run to the next
 * invocation. A slice the platform kills mid-file loses only that file's
 * work: the next one picks the run up from the last checkpoint.
 *
 * Everything a step needs from an earlier one lives on the SyncRun row --
 * the walk's file list, each step's cursor, the running counts -- because
 * the next slice is usually a different process.
 */

type RunState = {
    force: boolean;
    /** Sections, summaries and pruning. The routes do them; the CLI runs its own. */
    modelWork: boolean;
    summary: SyncSummary;
    /** Administrator searches left in this run's allowance; see lib/administrator-lookup.ts. */
    lookupsLeft: number;
    /** How many slices in a row have started `step` without getting any further. */
    attempt: { step: string; count: number };
    /** Files that never finished inside the time limit, passed over so the rest could land. */
    skipped: string[];
    ingest?: { pending: string[]; at: number };
    links?: {
        round: number;
        passedOver: string[];
        pending: PendingLink[] | null;
        at: number;
        /** Files this round ingested or found unchanged; none means no further round. */
        found: number;
    };
    revisionAuthors?: { at: number };
    passages?: { afterId: string | null };
};

export type Slice = {
    state: RunState;
    /** No new unit of work is started after this. */
    deadline: number;
    beforeDeadline(): boolean;
    /** The current unit has been tried by too many slices; skip it. Reading this clears it. */
    takeStuck(): boolean;
    files(): Promise<WalkedFile[]>;
    saveFiles(files: WalkedFile[]): Promise<void>;
    /** Persist progress after a unit of work. */
    checkpoint(): Promise<void>;
};

export type Step = {
    name: string;
    /** What a reader is told the sync is doing. */
    label: string;
    /**
     * Time to leave before the deadline for starting this step in a slice that
     * has already done other work. A step that cannot stop partway needs room
     * to finish; a step that checkpoints per file only needs room for one.
     */
    needsMs: number;
    modelWork?: boolean;
    /**
     * The step works through files and can pass over one that keeps outlasting
     * the function. Any other step that does so fails the run.
     */
    skippable?: boolean;
    /** True once the step is finished; false to be called again in the next slice. */
    run(slice: Slice): Promise<boolean>;
};

function syncOptions(state: RunState): SyncOptions {
    return { force: state.force };
}

/** Changed files, one at a time, after the unchanged ones are refreshed in bulk. */
async function ingestStep(slice: Slice): Promise<boolean> {
    const { state } = slice;
    const files = await slice.files();

    if (!state.ingest) {
        if (slice.takeStuck()) throw new Error("Refreshing unchanged files did not finish within the time limit");
        const docs = files.filter(ingestibleFromWalk);
        const unchanged = await refreshUnchangedFiles(docs, "walk", syncOptions(state), state.summary);
        state.ingest = { pending: docs.filter((file) => !unchanged.has(file.id)).map((file) => file.id), at: 0 };
        await slice.checkpoint();
    }

    const byId = new Map(files.map((file) => [file.id, file]));
    const cursor = state.ingest;

    while (cursor.at < cursor.pending.length) {
        if (!slice.beforeDeadline()) return false;
        const file = byId.get(cursor.pending[cursor.at]!);
        if (slice.takeStuck()) {
            state.skipped.push(file ? `${file.folderPath}/${file.name}` : cursor.pending[cursor.at]!);
        } else if (file) {
            await ingestFile(file, "walk", syncOptions(state), state.summary);
        }
        cursor.at += 1;
        await slice.checkpoint();
    }
    return true;
}

async function linksStep(slice: Slice): Promise<boolean> {
    const { state } = slice;
    state.links ??= { round: 0, passedOver: [], pending: null, at: 0, found: 0 };
    const links = state.links;

    for (;;) {
        if (links.pending === null) {
            if (!slice.beforeDeadline()) return false;
            if (slice.takeStuck()) throw new Error("Checking linked files did not finish within the time limit");
            const passedOver = new Set(links.passedOver);
            const round = await prepareLinkRound(passedOver, syncOptions(state), state.summary);
            links.passedOver = [...passedOver];
            links.pending = round.pending;
            links.at = 0;
            links.found = round.unchanged;
            state.summary.documentsLinkedIn += round.unchanged;
            await slice.checkpoint();
        }

        while (links.at < links.pending.length) {
            if (!slice.beforeDeadline()) return false;
            const link = links.pending[links.at]!;
            if (slice.takeStuck()) {
                state.skipped.push(link.file?.name ?? link.url);
            } else if (await ingestPendingLink(link, syncOptions(state), state.summary)) {
                links.found += 1;
                state.summary.documentsLinkedIn += 1;
            }
            links.at += 1;
            await slice.checkpoint();
        }

        // Nothing new arrived, so the next round would find the same targets.
        if (links.found === 0 || links.round + 1 >= MAX_LINK_ROUNDS) return true;
        links.round += 1;
        links.pending = null;
        await slice.checkpoint();
    }
}

/**
 * Classification must finish first: a new file does not have its minutes role
 * until recordMeetings runs. Never fetch history for an agenda, bill,
 * resolution, or an edit awaiting publication review.
 */
async function revisionAuthorsStep(slice: Slice): Promise<boolean> {
    const { state } = slice;
    const ids = [...new Set(state.summary.revisionAuthorFileIds)];
    state.revisionAuthors ??= { at: 0 };
    const cursor = state.revisionAuthors;
    const tally = (result: SyncSummary["revisionAuthors"]) => {
        state.summary.revisionAuthors.imported += result.imported;
        state.summary.revisionAuthors.failed += result.failed;
        state.summary.revisionAuthors.skipped += result.skipped;
    };

    let configured = false;
    try { configured = revisionOAuthConfigured(); } catch { /* refreshRevisionAuthors reports it */ }
    if (!configured) {
        // Answered without a network call, and said once rather than per file.
        tally(await refreshRevisionAuthors(ids.slice(cursor.at)));
        return true;
    }

    while (cursor.at < ids.length) {
        if (!slice.beforeDeadline()) return false;
        if (slice.takeStuck()) state.summary.revisionAuthors.failed += 1;
        else tally(await refreshRevisionAuthors([ids[cursor.at]!]));
        cursor.at += 1;
        await slice.checkpoint();
    }
    return true;
}

/**
 * Catches documents ingested before the search index existed, and any whose
 * passages were lost. Documents that already have them cost nothing here,
 * because they are not selected.
 */
async function passagesStep(slice: Slice): Promise<boolean> {
    const { state } = slice;
    state.passages ??= { afterId: null };
    const result = await rebuildPassages({ afterId: state.passages.afterId, deadline: slice.deadline });
    state.passages.afterId = result.lastId;
    if (result.complete) return true;
    await slice.checkpoint();
    return false;
}

/**
 * Regenerate any section whose sources changed, then restate documents whose
 * summary is missing or out of date. Model requests, retries included, are
 * aborted at the slice deadline; whatever is left stays queued for next time.
 */
async function modelStep(slice: Slice): Promise<boolean> {
    const { generateStaleSections } = await import("@/lib/generate");
    const { SUMMARY_RUN_BUDGET, summarizeStaleDocuments } = await import("@/lib/summarize");
    const { isAiQuotaExhausted } = await import("@/lib/ai");

    const sections = await generateStaleSections({ deadline: slice.deadline });
    for (const result of sections) {
        if (result.error) console.warn(`section: ${result.key} ${result.status} (${result.error})`);
    }
    if (sections.some((section) => isAiQuotaExhausted(section.error))) return true;

    const summaries = await summarizeStaleDocuments({
        limit: SUMMARY_RUN_BUDGET,
        deadline: slice.deadline,
        onResult: (result) => {
            if (result.error && result.status === "failed") console.warn(`summary: ${result.title} — ${result.error}`);
        },
    });
    console.log(`sync summaries: ${summaries.filter((result) => !result.skipped).length} written or attempted`);
    return true;
}

function once(work: (state: RunState) => Promise<unknown>): Step["run"] {
    return async ({ state }) => {
        await work(state);
        return true;
    };
}

/** Optional reviews: a missing table or provider leaves held edits held. */
function optional(name: string, work: (slice: Slice) => Promise<unknown>): Step["run"] {
    return async (slice) => {
        try {
            await work(slice);
        } catch (error) {
            console.warn(`${name} unavailable:`, error instanceof Error ? error.message : String(error));
        }
        return true;
    };
}

/**
 * In the order they have to run. Each whole-corpus pass needs every document
 * to exist before it can be right, and titles depend on the meeting keys.
 */
const STEPS: Step[] = [
    {
        name: "walk", label: "Reading the Drive folders", needsMs: 30_000,
        run: async (slice) => {
            const files = await walkFolder(MASTER_FOLDER_ID);
            slice.state.summary.filesSeen = files.length;
            await slice.saveFiles(files);
            return true;
        },
    },
    {
        // Confirmed alternate full names are permanent; inferred short-name
        // aliases can expire as the roster changes.
        name: "aliases", label: "Updating name aliases", needsMs: 10_000,
        run: once(async () => {
            await applyManualNameAliases();
            await pruneStaleAliases();
            resetNameResolverCache();
        }),
    },
    { name: "ingest", label: "Reading changed documents", needsMs: 15_000, skippable: true, run: ingestStep },
    { name: "links", label: "Following linked documents", needsMs: 15_000, skippable: true, run: linksStep },
    {
        // A past session's directory is rebuilt only when one of its documents
        // changed; `--force` rebuilds all.
        name: "directories", label: "Rebuilding directories", needsMs: 15_000,
        run: once((state) => recordAllDirectories(state.force ? {} : { pastSessions: state.summary.sessionsChanged })),
    },
    { name: "sessions", label: "Assigning sessions", needsMs: 10_000, run: once(() => recordSessions()) },
    {
        name: "meetings", label: "Pairing agendas and minutes", needsMs: 10_000,
        run: once(async (state) => { state.summary.meetingsPaired = (await recordMeetings()).paired; }),
    },
    {
        name: "dates", label: "Dating documents", needsMs: 10_000,
        run: once(async (state) => { state.summary.documentsDated = await recordDates(); }),
    },
    { name: "titles", label: "Naming documents", needsMs: 10_000, run: once(() => recordTitles()) },
    { name: "kinds", label: "Classifying documents", needsMs: 10_000, run: once(() => recordKinds()) },
    {
        // Revisit held governing edits after the full evidence corpus is present.
        name: "amendmentReview", label: "Reviewing held amendments", needsMs: 20_000,
        run: optional("Amendment review", async (slice) => {
            const { reviewGoverningChanges } = await import("@/lib/governing-review");
            const results = await reviewGoverningChanges({ deadline: slice.deadline });
            for (const result of results) console.log(`amendment: ${result.status} ${result.title} — ${result.reason}`);
        }),
    },
    {
        name: "administratorReview", label: "Checking administrator names", needsMs: 20_000,
        run: optional("Administrator review", async () => {
            const { revisitAdministratorMentions } = await import("@/lib/administrator-backfill");
            await revisitAdministratorMentions();
        }),
    },
    { name: "revisionAuthors", label: "Reading minutes authorship", needsMs: 15_000, skippable: true, run: revisionAuthorsStep },
    {
        name: "references", label: "Linking documents together", needsMs: 10_000,
        run: once(async (state) => { state.summary.referencesLinked = await rebuildReferences(); }),
    },
    {
        name: "driveAccounts", label: "Matching Drive accounts", needsMs: 10_000,
        run: once(async (state) => { state.summary.driveAccountsLinked = await recordDriveAccounts(); }),
    },
    { name: "passages", label: "Updating the search index", needsMs: 10_000, run: passagesStep },
    { name: "model", label: "Writing summaries", needsMs: 20_000, modelWork: true, run: modelStep },
    {
        // Expired sessions, sign-in codes and rate buckets.
        name: "prune", label: "Clearing expired records", needsMs: 5_000, modelWork: true,
        run: once(async () => {
            const { pruneEphemeral } = await import("@/lib/prune");
            await pruneEphemeral();
        }),
    },
];

export const FINISHED_STEP = "done";

/** The step to work on at or after `name`, skipping model work the run does not do. */
function stepFrom(steps: Step[], name: string, state: RunState): Step | null {
    const start = steps.findIndex((step) => step.name === name);
    if (start < 0) return null;
    return steps.slice(start).find((step) => !step.modelWork || state.modelWork) ?? null;
}

function stepAfter(steps: Step[], step: Step, state: RunState): Step | null {
    const next = steps[steps.indexOf(step) + 1];
    return next ? stepFrom(steps, next.name, state) : null;
}

export function stepLabel(name: string): string {
    return STEPS.find((step) => step.name === name)?.label ?? "Syncing with Drive";
}

export function stepPosition(name: string): { index: number; total: number } {
    return { index: Math.max(0, STEPS.findIndex((step) => step.name === name)) + 1, total: STEPS.length };
}

function counts(summary: SyncSummary) {
    return {
        filesSeen: summary.filesSeen,
        documentsCreated: summary.documentsCreated,
        documentsUpdated: summary.documentsUpdated,
        documentsUnchanged: summary.documentsUnchanged,
        documentsArchived: summary.documentsArchived,
        annotationsOrphaned: summary.annotationsOrphaned,
        sectionsInvalidated: summary.sectionsInvalidated,
        contributorsLinked: summary.contributorsLinked,
        referencesLinked: summary.referencesLinked,
        meetingsPaired: summary.meetingsPaired,
    };
}

function json(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
}

/**
 * Create a run and return its id. The routes then work it with
 * `continueSyncRun`; the CLI with `syncMasterFolder`.
 *
 * Two triggers arriving together could each create one. The later of the two
 * stands down in favour of the earlier, whose id is returned instead.
 */
export async function startSyncRun(
    trigger: SyncTrigger,
    options: { force?: boolean; modelWork?: boolean; exclusive?: boolean; steps?: Step[] } = {},
): Promise<string> {
    const id = randomUUID();
    const state: RunState = {
        force: options.force ?? false,
        modelWork: options.modelWork ?? true,
        summary: emptySyncSummary(id),
        lookupsLeft: 4,
        attempt: { step: "", count: 0 },
        skipped: [],
    };
    const created = await prisma.syncRun.create({
        data: { id, status: "running", masterFolderId: MASTER_FOLDER_ID, trigger, step: (options.steps ?? STEPS)[0]!.name, state: json(state) },
        select: { startedAt: true },
    });

    if (options.exclusive === false) return id;

    const others = await prisma.syncRun.findMany({
        where: { status: "running", id: { not: id } },
        select: { id: true, startedAt: true },
    });
    const earlier = others.find((other) =>
        other.startedAt < created.startedAt ||
        (other.startedAt.getTime() === created.startedAt.getTime() && other.id < id));
    if (!earlier) return id;

    await prisma.syncRun.update({
        where: { id },
        data: { status: "error", error: "Another sync started first", finishedAt: new Date() },
    });
    return earlier.id;
}

export type ActiveRun = { id: string; startedAt: Date; heartbeatAt: Date; leaseUntil: Date | null };

export async function activeSyncRun(): Promise<ActiveRun | null> {
    return prisma.syncRun.findFirst({
        where: { status: "running" },
        orderBy: { startedAt: "asc" },
        select: { id: true, startedAt: true, heartbeatAt: true, leaseUntil: true },
    });
}

/** No invocation holds it and none has checkpointed lately: the hand-off was lost. */
export function isStalled(run: ActiveRun, now = Date.now()): boolean {
    const leased = run.leaseUntil !== null && run.leaseUntil.getTime() > now;
    return !leased && now - run.heartbeatAt.getTime() > SYNC_STALLED_AFTER_MS;
}

export function isAbandoned(run: ActiveRun, now = Date.now()): boolean {
    return isStalled(run, now) && now - run.heartbeatAt.getTime() > SYNC_ABANDON_AFTER_MS;
}

export async function abandonSyncRun(id: string): Promise<void> {
    await prisma.syncRun.updateMany({
        where: { id, status: "running" },
        data: {
            status: "error",
            error: "Stalled between invocations and was not resumed in time",
            finishedAt: new Date(),
            leaseUntil: null,
            files: Prisma.DbNull,
        },
    });
}

export type SliceOutcome = "finished" | "more" | "busy" | "failed";

/**
 * Work the run until the budget is spent or the run is done.
 *
 * "busy" means another invocation holds the run, which is how a duplicate
 * hand-off or a button press during a live slice is turned away.
 */
export async function runSyncSlice(
    runId: string,
    budgetMs = SYNC_SLICE_BUDGET_MS,
    steps: Step[] = STEPS,
): Promise<SliceOutcome> {
    const startedAt = Date.now();
    const deadline = startedAt + budgetMs;
    const leaseUntil = new Date(startedAt + (Number.isFinite(budgetMs) ? SYNC_LEASE_MS : 24 * 60 * 60_000));

    const claimed = await prisma.syncRun.updateMany({
        where: { id: runId, status: "running", OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date(startedAt) } }] },
        data: { leaseUntil, slices: { increment: 1 }, heartbeatAt: new Date() },
    });
    if (claimed.count === 0) return "busy";

    const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: runId }, select: { step: true, state: true } });
    const state = run.state as unknown as RunState;
    let step = stepFrom(steps, run.step, state);
    let files: WalkedFile[] | null = null;
    let stuck = false;

    beginAdministratorLookupRun(deadline, state.lookupsLeft);
    resetNameResolverCache();

    const save = (data: Prisma.SyncRunUpdateInput = {}) => {
        state.lookupsLeft = administratorLookupsLeft();
        return prisma.syncRun.update({
            where: { id: runId },
            data: { step: step?.name ?? FINISHED_STEP, state: json(state), heartbeatAt: new Date(), ...counts(state.summary), ...data },
            select: { id: true },
        });
    };

    const slice: Slice = {
        state,
        deadline,
        beforeDeadline: () => Date.now() < deadline,
        takeStuck: () => {
            const was = stuck;
            stuck = false;
            return was;
        },
        files: async () => {
            files ??= ((await prisma.syncRun.findUniqueOrThrow({ where: { id: runId }, select: { files: true } })).files ?? []) as unknown as WalkedFile[];
            return files;
        },
        saveFiles: async (walked) => {
            files = walked;
            await save({ files: json(walked) });
        },
        checkpoint: async () => {
            state.attempt.count = 0;
            stuck = false;
            await save();
        },
    };

    try {
        let first = true;
        while (step) {
            if (!first && deadline - Date.now() < step.needsMs) {
                await save({ leaseUntil: null });
                return "more";
            }
            first = false;

            state.attempt = state.attempt.step === step.name
                ? { step: step.name, count: state.attempt.count + 1 }
                : { step: step.name, count: 1 };
            stuck = state.attempt.count > SYNC_MAX_ATTEMPTS;
            if (stuck && !step.skippable) {
                throw new Error(`The ${step.name} step did not finish within the time limit after ${SYNC_MAX_ATTEMPTS} attempts`);
            }
            await save();

            const stepStarted = Date.now();
            let finished: boolean;
            try {
                finished = await step.run(slice);
            } finally {
                const spent = Date.now() - stepStarted;
                state.summary.timings[step.name] = (state.summary.timings[step.name] ?? 0) + spent;
                console.log(`sync phase ${step.name}: ${spent}ms`);
            }

            if (!finished) {
                await save({ leaseUntil: null });
                return "more";
            }
            step = stepAfter(steps, step, state);
            state.attempt = { step: step?.name ?? FINISHED_STEP, count: 0 };
            await save();
        }

        await save({
            status: "success",
            finishedAt: new Date(),
            leaseUntil: null,
            files: Prisma.DbNull,
            error: state.skipped.length
                ? `Skipped ${state.skipped.length} file(s) that did not finish within the time limit: ${state.skipped.join("; ").slice(0, 900)}`
                : null,
        });
        return "finished";
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        console.error(`Sync run ${runId} failed in ${step?.name ?? "finish"}:`, cause);
        await save({ status: "error", error: message, finishedAt: new Date(), leaseUntil: null, files: Prisma.DbNull });
        return "failed";
    }
}

/**
 * Work one slice, then hand the run to a fresh invocation if there is more.
 *
 * The hand-off is a request to this deployment's own continue route, which
 * answers at once and does its slice after responding. If the request is lost,
 * the run stalls at its last checkpoint until the button or the cron resumes it.
 */
export async function continueSyncRun(runId: string, origin: string): Promise<SliceOutcome> {
    const outcome = await runSyncSlice(runId);
    if (outcome !== "more") return outcome;

    const secret = process.env.CRON_SECRET;
    if (!secret) {
        // Nothing to authenticate the hand-off with. That is local development,
        // which has no function time limit either, so carry on here.
        return continueSyncRun(runId, origin);
    }

    try {
        const response = await fetch(new URL("/api/sync/continue", origin), {
            method: "POST",
            headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
            body: JSON.stringify({ runId }),
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) console.error(`Sync hand-off for ${runId} was refused: ${response.status}`);
    } catch (cause) {
        console.error(`Sync hand-off for ${runId} failed:`, cause instanceof Error ? cause.message : String(cause));
    }
    return outcome;
}

/**
 * The whole run in this process, for the CLI, which has no time limit. The
 * sections, summaries and News-Letter it runs itself afterwards.
 */
export async function syncMasterFolder(
    options: { trigger?: SyncTrigger; force?: boolean } = {},
): Promise<SyncSummary> {
    const runId = await startSyncRun(options.trigger ?? "manual", {
        force: options.force,
        modelWork: false,
        exclusive: false,
    });

    let outcome: SliceOutcome;
    do {
        outcome = await runSyncSlice(runId, Number.POSITIVE_INFINITY);
    } while (outcome === "more");

    const run = await prisma.syncRun.findUniqueOrThrow({ where: { id: runId }, select: { status: true, error: true, state: true } });
    if (run.status !== "success") throw new Error(run.error ?? `Sync run ${runId} ended as ${run.status}`);
    return (run.state as unknown as RunState).summary;
}

export type SyncRunStatus = {
    runId: string;
    status: string;
    step: string;
    label: string;
    stalled: boolean;
    documentsChanged: number;
    error: string | null;
};

export async function syncRunStatus(runId?: string): Promise<SyncRunStatus | null> {
    const run = await prisma.syncRun.findFirst({
        where: runId ? { id: runId } : {},
        orderBy: { startedAt: "desc" },
        select: {
            id: true, status: true, step: true, error: true, startedAt: true,
            heartbeatAt: true, leaseUntil: true, documentsCreated: true, documentsUpdated: true,
        },
    });
    if (!run) return null;
    return {
        runId: run.id,
        status: run.status,
        step: run.step,
        label: stepLabel(run.step),
        stalled: run.status === "running" && isStalled(run),
        documentsChanged: run.documentsCreated + run.documentsUpdated,
        error: run.error,
    };
}
