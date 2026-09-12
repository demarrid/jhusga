"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import DocumentSearch from "@/app/(components)/DocumentSearch";
import NaturalLanguageSearch from "@/app/(components)/NaturalLanguageSearch";

import styles from "./ArchiveSearch.module.css";

type ArchiveSearchProps = {
  initialMode: "find" | "ask";
  query?: string;
  kind?: string;
  person?: string;
  role?: string;
  office?: string;
  archive: boolean;
  kinds: { kind: string; count: number }[];
  people: { id: string; name: string; count: number }[];
  roles: { role: string; count: number }[];
  offices: { id: string; name: string; count: number }[];
};

/**
 * Houses both archive search behaviors in one compact surface. The panels stay
 * mounted so switching modes never discards a typed question or active filter.
 */
export default function ArchiveSearch(props: ArchiveSearchProps) {
  const { initialMode, ...documentSearchProps } = props;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const mode = initialMode;

  function selectMode(nextMode: "find" | "ask") {
    // The URL is the source of truth, so navigations and refreshes reopen the
    // correct panel without a second local state that can fall out of sync.
    const params = new URLSearchParams(searchParams.toString());
    params.set("mode", nextMode);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <section className={styles.panel} aria-labelledby="archive-search-heading">
      <header className={styles.header}>
        <div>
          <span>Public Record</span>
          <h2 id="archive-search-heading">Search the archive</h2>
        </div>

        <div className={styles.tabs} role="tablist" aria-label="Archive search mode">
          <button
            type="button"
            role="tab"
            id="ask-question-tab"
            aria-selected={mode === "ask"}
            aria-controls="ask-question-panel"
            onClick={() => selectMode("ask")}
          >
            Ask a question
          </button>
          <button
            type="button"
            role="tab"
            id="find-documents-tab"
            aria-selected={mode === "find"}
            aria-controls="find-documents-panel"
            onClick={() => selectMode("find")}
          >
            Find documents
          </button>
        </div>
      </header>

      <div
        role="tabpanel"
        id="find-documents-panel"
        aria-labelledby="find-documents-tab"
        hidden={mode !== "find"}
      >
        <DocumentSearch {...documentSearchProps} />
      </div>

      <div
        role="tabpanel"
        id="ask-question-panel"
        aria-labelledby="ask-question-tab"
        hidden={mode !== "ask"}
      >
        <NaturalLanguageSearch />
      </div>
    </section>
  );
}
