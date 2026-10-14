/** Optional OAuth access, exclusively for historical revisions. Public crawling
 * remains anonymous so capabilities still describe public edit permissions.
 */
import { docxToText } from "@/lib/office";
import { prisma } from "@/lib/prisma";
import { GOOGLE_DOC_MIME } from "@/lib/drive";

type Revision = {
    id: string;
    modifiedTime: string;
    lastModifyingUser?: { displayName?: string; emailAddress?: string };
    exportLinks?: Record<string, string>;
};
let cached: { token: string; expires: number } | undefined;
let refreshing: Promise<string> | undefined;

export function revisionOAuthConfigured(): boolean {
    const values = [process.env.GOOGLE_OAUTH_CLIENT_ID, process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        process.env.GOOGLE_OAUTH_REFRESH_TOKEN];
    if (values.some(Boolean) && !values.every(Boolean)) {
        throw new Error("Set all three GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN values");
    }
    return values.every(Boolean);
}

async function accessToken(): Promise<string> {
    if (!revisionOAuthConfigured()) throw new Error("Drive revision OAuth is not configured");
    if (cached && cached.expires > Date.now() + 60_000) return cached.token;
    if (refreshing) return refreshing;
    refreshing = (async () => {
        const response = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST", cache: "no-store", signal: AbortSignal.timeout(30_000),
            body: new URLSearchParams({ grant_type: "refresh_token",
                client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
                client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
                refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN! }),
        });
        if (!response.ok) throw new Error(`Drive OAuth refresh failed (${response.status}); check consent and refresh token`);
        const data = await response.json() as { access_token?: string; expires_in?: number };
        if (!data.access_token || !Number.isFinite(data.expires_in) || data.expires_in! <= 0) {
            throw new Error("Drive OAuth returned an invalid token response");
        }
        cached = { token: data.access_token, expires: Date.now() + data.expires_in! * 1000 };
        return cached.token;
    })();
    try { return await refreshing; } finally { refreshing = undefined; }
}

/** Export links are supplied by Google, but validate before attaching credentials.
 * Follow only Google export redirects; signed googleusercontent downloads
 * receive no bearer token.
 */
async function oauthFetch(url: string, attempt = 0, redirects = 0): Promise<Response> {
    const target = new URL(url);
    const signedDownload = target.hostname.endsWith(".googleusercontent.com");
    if (target.protocol !== "https:" || target.username || target.password || target.port ||
        (!signedDownload && !["www.googleapis.com", "docs.google.com", "drive.google.com"].includes(target.hostname))) {
        throw new Error("Untrusted Drive revision export URL");
    }
    const response = await fetch(url, { cache: "no-store", redirect: "manual",
        headers: signedDownload ? {} : { Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(30_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirects >= 5) throw new Error("Invalid Drive revision export redirect");
        return oauthFetch(new URL(location, target).toString(), attempt, redirects + 1);
    }
    if (response.status === 401 && attempt === 0 && !signedDownload) {
        cached = undefined;
        return oauthFetch(url, 1, redirects);
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
        return oauthFetch(url, attempt + 1, redirects);
    }
    return response;
}

export async function listDriveRevisions(fileId: string): Promise<Revision[]> {
    const revisions: Revision[] = [];
    const pages = new Set<string>();
    let pageToken = "";
    do {
        if (pages.has(pageToken)) throw new Error("Drive repeated a revision page token");
        pages.add(pageToken);
        const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/revisions`);
        url.searchParams.set("pageSize", "1000");
        url.searchParams.set("fields", "nextPageToken,revisions(id,modifiedTime,lastModifyingUser(displayName,emailAddress),exportLinks)");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const response = await oauthFetch(url.toString());
        if (!response.ok) throw new Error(`Drive revision list failed (${response.status})`);
        const data = await response.json() as { revisions?: Revision[]; nextPageToken?: string };
        for (const revision of data.revisions ?? []) {
            if (!revision.id || !revision.modifiedTime || !Number.isFinite(Date.parse(revision.modifiedTime))) {
                throw new Error("Drive returned an invalid revision");
            }
            revisions.push(revision);
        }
        pageToken = data.nextPageToken ?? "";
    } while (pageToken);
    return revisions;
}

export async function revisionText(revision: Revision): Promise<string | null> {
    const links = revision.exportLinks ?? {};
    const plain = links["text/plain"];
    const docx = links["application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    if (!plain && !docx) return null;
    const response = await oauthFetch(plain || docx);
    if ([403, 404, 410].includes(response.status)) return null;
    if (!response.ok) throw new Error(`Drive revision export failed (${response.status})`);
    // Preserve author metadata from the API; DOCX content itself has no history.
    return plain ? response.text() : docxToText(Buffer.from(await response.arrayBuffer()));
}

/** One atomic write per document; failed downloads retain the previous history.
 * Never overwrite publication or review state with a historical snapshot.
 */
export async function importRevisionAuthors(fileId?: string): Promise<{ imported: number; failed: number }> {
    if (!revisionOAuthConfigured()) throw new Error("Configure Drive revision OAuth first (see docs/drive-revisions.md)");
    const documents = await prisma.document.findMany({
        where: { mimeType: GOOGLE_DOC_MIME, meetingRole: "minutes", reviewState: "published",
            ...(fileId ? { driveFileId: fileId } : {}) },
        select: { id: true, driveFileId: true },
    });
    let imported = 0;
    let failed = 0;
    for (const document of documents) {
        try {
            const revisions = await listDriveRevisions(document.driveFileId);
            const stored = await prisma.driveRevision.findMany({ where: { documentId: document.id } });
            const existing = new Map(stored.map(revision => [revision.revisionId, revision]));
            const rows = [];
            for (const revision of revisions) {
                const old = existing.get(revision.id);
                const content = old?.modifiedAt.getTime() === Date.parse(revision.modifiedTime) && old.content !== null
                    ? old.content : await revisionText(revision);
                rows.push({ documentId: document.id, revisionId: revision.id,
                    modifiedAt: new Date(revision.modifiedTime), content,
                    editorName: revision.lastModifyingUser?.displayName?.trim() ?? "",
                    editorEmail: revision.lastModifyingUser?.emailAddress?.trim().toLowerCase() ?? "" });
            }
            await prisma.$transaction(rows.map(row => prisma.driveRevision.upsert({
                where: { documentId_revisionId: { documentId: row.documentId, revisionId: row.revisionId } },
                create: row, update: row,
            })));
            imported += rows.length;
            console.log(`Revisions imported for ${document.driveFileId}: ${rows.length}`);
        } catch (error) {
            failed += 1;
            console.error(`Revision import failed for ${document.driveFileId}:`, error instanceof Error ? error.message : "unknown error");
        }
    }
    return { imported, failed };
}
