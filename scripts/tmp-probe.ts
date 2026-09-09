import { getFile } from "../lib/drive";

const IDS = [
    "1DU7jS0mTcWwKQX34t7pEOFHOPR19Ss--o-yHKT_kwTE",
    "1TdzOat46owSUaMDZxx811A5-0RVe1PrizAkX6FWoz6Y",
];

async function main() {
    for (const id of IDS) {
        try {
            const file = await getFile(id);
            console.log(id, file ? JSON.stringify({ name: file.name, mime: file.mimeType, created: file.createdTime }) : "null (404/403)");
        } catch (error) {
            console.log(id, "ERROR", error instanceof Error ? error.message : error);
        }
    }
}

main();
