/** Prefer the earliest source agenda; archive arrival breaks ties and fills missing dates. */
export function oldestAgenda<T extends { id: string; driveCreatedTime: Date | null; createdAt: Date }>(rows: T[]): T[] {
    return [...rows].sort((a, b) =>
        (a.driveCreatedTime ?? a.createdAt).getTime() - (b.driveCreatedTime ?? b.createdAt).getTime()
        || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
    ).slice(0, 1);
}
