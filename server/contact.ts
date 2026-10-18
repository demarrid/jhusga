"use server";

import { unstable_cache } from "next/cache";
import { ARCHIVE_CACHE_TAG, DIRECTORY_CACHE_SECONDS } from "@/lib/archive-cache";

import { SESSION_NUMBER } from "@/config/session";
import {
    buildSessionDirectory,
    extractGroupInboxes,
    type DirectoryMember,
    type DirectorySource,
    type GroupInbox,
} from "@/lib/directory";
import { nameKey } from "@/lib/contributors";
import { prisma } from "@/lib/prisma";
import { demoModeEnabled } from "@/lib/data-mode";
import { demoDirectory } from "@/lib/demo-data";

export type ContactMember = DirectoryMember & {
    id: string | null;
};

export type ContactDirectory = {
    sessionNumber: number;
    members: ContactMember[];
    inboxes: GroupInbox[];
    sources: DirectorySource[];
};

const cachedContactDirectory = unstable_cache(
    loadContactDirectory,
    ["contact-directory-v1"],
    { tags: [ARCHIVE_CACHE_TAG], revalidate: DIRECTORY_CACHE_SECONDS },
);

export async function getContactDirectory(
    session: number = SESSION_NUMBER,
): Promise<ContactDirectory> {
    if (demoModeEnabled()) return demoDirectory();
    return cachedContactDirectory(session);
}

async function loadContactDirectory(session: number): Promise<ContactDirectory> {
    const documents = await prisma.document.findMany({
        where: { sessionNumber: session },
        select: {
            id: true,
            title: true,
            content: true,
            kind: true,
            folderPath: true,
            source: true,
            driveModifiedTime: true,
        },
    });

    const directory = buildSessionDirectory(documents);

    const affiliates = await prisma.hopkinsAffiliate.findMany({
        where: { nameKey: { in: directory.members.map((member) => nameKey(member.name)) } },
        select: { id: true, nameKey: true },
    });
    const ids = new Map(affiliates.map((row) => [row.nameKey, row.id]));

    return {
        sessionNumber: session,
        members: directory.members.map((member) => ({
            ...member,
            id: ids.get(nameKey(member.name)) ?? null,
        })),
        inboxes: extractGroupInboxes(documents),
        sources: directory.sources,
    };
}
