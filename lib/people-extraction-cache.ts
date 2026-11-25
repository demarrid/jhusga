import { prisma } from './prisma';
import { extractDocumentPeople, parseExtractedPeople, peopleFingerprint, PEOPLE_VERSION, type PeopleDocument } from './people-extraction';

export async function documentPeople(documentId: string, document: PeopleDocument, extract = extractDocumentPeople) {
    const fingerprint = peopleFingerprint(document);
    const cached = await prisma.documentPeopleExtraction.findUnique({ where: { documentId } });
    if (cached?.fingerprint === fingerprint) {
        return { fingerprint, people: parseExtractedPeople({ people: cached.people }, document.content) };
    }
    const result = await extract(document);
    const data = { fingerprint, promptVersion: PEOPLE_VERSION, model: result.model, people: result.people, appliedAt: null };
    await prisma.documentPeopleExtraction.upsert({ where: { documentId }, create: { documentId, ...data }, update: data });
    return { fingerprint, people: result.people };
}
