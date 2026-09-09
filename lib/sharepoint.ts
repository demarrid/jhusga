/**
 * Read-only access to files shared as SharePoint / OneDrive links.
 *
 * SGA agendas paste Microsoft sharing URLs next to Drive ones -- the
 * Treasurer's report lives in a personal OneDrive, not the master folder.
 * Graph's `/shares` API can resolve those URLs the same way a browser does:
 * anonymous "anyone with the link" shares need no token, and organisation
 * links need an app registered in the JHU tenant (see .env.example).
 *
 * A file Graph will not serve is left unresolved, the way a private Drive
 * bill is. The sharing URL stays in the document; the reader still has it.
 */

import { docxToText, xlsxToText } from "@/lib/office";

const WORD_MIME =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const EXCEL_MIME =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const LEGACY_WORD = "application/msword";

export const SHAREPOINT_FILE_PREFIX = "sharepoint:";

export type SharePointKind = "word" | "excel" | "powerpoint" | "folder" | "other";

export type SharePointFile = {
    /** Stable id, `sharepoint:` plus the sharing token. */
    id: string;
    name: string;
    mimeType: string;
    createdTime: string | null;
    modifiedTime: string | null;
    webViewLink: string;
    ownerName: string | null;
    lastEditorName: string | null;
    kind: SharePointKind;
};

function unescapeUrl(url: string): string {
    return url.replace(/\\([^A-Za-z0-9])/g, "$1");
}

function decodeSharingUrl(url: string): string {
    try {
        return decodeURIComponent(unescapeUrl(url));
    } catch {
        return unescapeUrl(url);
    }
}

/** Graph's sharing token: `u!` plus unpadded base64url of the URL. */
export function encodeShareId(url: string): string {
    return (
        "u!" +
        Buffer.from(decodeSharingUrl(url), "utf8")
            .toString("base64")
            .replace(/=+$/, "")
            .replace(/\//g, "_")
            .replace(/\+/g, "-")
    );
}

/**
 * The sharing-link type marker, `:w:` Word, `:x:` Excel, `:f:` a folder.
 *
 * Folders are never documents, the same rule as Drive folder links.
 */
export function sharePointKind(url: string): SharePointKind {
    const match = /\/:([a-z]):\//i.exec(decodeSharingUrl(url));
    switch (match?.[1]?.toLowerCase()) {
        case "w":
            return "word";
        case "x":
            return "excel";
        case "p":
            return "powerpoint";
        case "f":
            return "folder";
        default:
            return "other";
    }
}

/**
 * The token that identifies the share, independent of `?e=` which rotates.
 *
 * That token is the archive key. Two links to the same file with different
 * redeem parameters are still one document.
 */
export function sharingToken(url: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(decodeSharingUrl(url.split("#")[0] ?? url));
    } catch {
        return null;
    }

    if (!/\.sharepoint\.com$/i.test(parsed.hostname)) return null;

    const fromQuery =
        parsed.searchParams.get("share") ?? parsed.searchParams.get("s");
    if (fromQuery && fromQuery.length >= 16) return fromQuery;

    const parts = parsed.pathname.split("/").filter(Boolean);
    const last = parts.at(-1);
    if (
        last &&
        last.length >= 16 &&
        /^[a-zA-Z0-9_-]+$/.test(last) &&
        !last.includes(".")
    ) {
        return last;
    }

    return null;
}

export function sharePointFileId(url: string): string | null {
    const token = sharingToken(url);
    return token ? `${SHAREPOINT_FILE_PREFIX}${token}` : null;
}

export function isSharePointFileId(fileId: string): boolean {
    return fileId.startsWith(SHAREPOINT_FILE_PREFIX);
}

let cachedToken: { value: string | null; fetchedAt: number } | null = null;
const TOKEN_TTL_MS = 50 * 60 * 1000;

async function graphToken(): Promise<string | null> {
    const preset = process.env.MICROSOFT_GRAPH_TOKEN?.trim();
    if (preset) return preset;

    if (cachedToken && Date.now() - cachedToken.fetchedAt < TOKEN_TTL_MS) {
        return cachedToken.value;
    }

    const tenant = process.env.MICROSOFT_TENANT_ID?.trim();
    const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
    const secret = process.env.MICROSOFT_CLIENT_SECRET?.trim();
    if (!tenant || !clientId || !secret) {
        cachedToken = { value: null, fetchedAt: Date.now() };
        return null;
    }

    const response = await fetch(
        `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
        {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: secret,
                grant_type: "client_credentials",
                scope: "https://graph.microsoft.com/.default",
            }),
            cache: "no-store",
        },
    );

    if (!response.ok) {
        cachedToken = { value: null, fetchedAt: Date.now() };
        return null;
    }

    const payload = (await response.json()) as { access_token?: string };
    const token = payload.access_token ?? null;
    cachedToken = { value: token, fetchedAt: Date.now() };
    return token;
}

type GraphUser = { displayName?: string };

type GraphItem = {
    name?: string;
    file?: { mimeType?: string };
    createdDateTime?: string;
    lastModifiedDateTime?: string;
    webUrl?: string;
    createdBy?: { user?: GraphUser };
    lastModifiedBy?: { user?: GraphUser };
};

function displayName(actor: { user?: GraphUser } | undefined): string | null {
    return actor?.user?.displayName ?? null;
}

async function graphFetch(path: string, attempt = 0): Promise<Response> {
    const token = await graphToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`https://graph.microsoft.com/v1.0/${path}`, {
        headers,
        cache: "no-store",
    });

    const retriable = response.status === 429 || response.status >= 500;
    if (retriable && attempt < 4) {
        const backoffMs = 500 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        return graphFetch(path, attempt + 1);
    }

    return response;
}

function mimeFor(kind: SharePointKind, reported: string | undefined): string {
    if (reported) return reported;
    if (kind === "word") return WORD_MIME;
    if (kind === "excel") return EXCEL_MIME;
    return "application/octet-stream";
}

/**
 * Metadata for a sharing URL, or null when Graph will not serve it.
 *
 * 401/403/404 are ordinary: the link is organisation-only and we have no
 * token, or the file was taken down. None of those fail a sync.
 */
export async function getSharePointFile(url: string): Promise<SharePointFile | null> {
    const kind = sharePointKind(url);
    if (kind === "folder") return null;

    const fileId = sharePointFileId(url);
    if (!fileId) return null;

    const shareId = encodeShareId(url);
    const response = await graphFetch(
        `shares/${encodeURIComponent(shareId)}/driveItem`,
    );

    if (response.status === 401 || response.status === 403 || response.status === 404) {
        return null;
    }
    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
            `Graph shares ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
        );
    }

    const item = (await response.json()) as GraphItem;
    if (!item.name) return null;

    const mimeType = mimeFor(kind, item.file?.mimeType);
    if (
        mimeType !== WORD_MIME &&
        mimeType !== EXCEL_MIME &&
        mimeType !== LEGACY_WORD &&
        kind !== "word" &&
        kind !== "excel"
    ) {
        return null;
    }

    return {
        id: fileId,
        name: item.name,
        mimeType,
        createdTime: item.createdDateTime ?? null,
        modifiedTime: item.lastModifiedDateTime ?? null,
        webViewLink: item.webUrl ?? decodeSharingUrl(url),
        ownerName: displayName(item.createdBy),
        lastEditorName: displayName(item.lastModifiedBy),
        kind: kind === "other" ? (mimeType === EXCEL_MIME ? "excel" : "word") : kind,
    };
}

/**
 * The file's text, or null when it cannot be flattened.
 *
 * Word becomes paragraphs; a spreadsheet becomes tab-separated rows. A
 * PowerPoint or a legacy .doc is skipped -- there is nothing here a citation
 * could honestly point at.
 */
export async function exportSharePointAsText(
    file: SharePointFile,
    sharingUrl: string,
): Promise<string | null> {
    const shareId = encodeShareId(sharingUrl);
    const response = await graphFetch(
        `shares/${encodeURIComponent(shareId)}/driveItem/content`,
    );

    if (response.status === 401 || response.status === 403 || response.status === 404) {
        return null;
    }
    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
            `Graph content ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
        );
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (file.mimeType === EXCEL_MIME || file.kind === "excel") {
        return xlsxToText(buffer);
    }
    if (file.mimeType === WORD_MIME || file.kind === "word") {
        return docxToText(buffer);
    }

    return null;
}
