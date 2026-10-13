"use client";

import { useEffect, useRef, useState, type Ref } from "react";

import type { DocumentSection } from "@/lib/outline";
import styles from "@/app/documents/document-detail.module.css";

/**
 * The sections of the document open beside it, and which one is current.
 *
 * Current follows the page, not the last click. The heading that has reached
 * the reading line -- just under the sticky header, where a click lands -- is
 * the one in full; the rest stay faded so a long agenda is still scannable.
 *
 * Each entry is a plain `#section-...` link, so the outline works before the
 * script loads; the script adds the smooth scroll and the tracking.
 */
export default function DocumentOutline({ sections }: { sections: DocumentSection[] }) {
    const [active, setActive] = useState("");
    const rootRef = useRef<HTMLUListElement>(null);
    // A click names the section outright. Without this, a short section near
    // the foot of the page -- one that can never scroll up to the reading
    // line -- would hand "current" straight back to the one above it.
    const chosenRef = useRef<string | null>(null);

    const ids = flatten(sections);
    const key = ids.join(" ");

    useEffect(() => {
        const targets = key
            .split(" ")
            .map((id) => document.getElementById(id))
            .filter((node): node is HTMLElement => node !== null);
        if (targets.length === 0) return;

        let frame = 0;
        let line = readingLine(targets[0]!);

        function update() {
            frame = 0;
            const chosen = chosenRef.current;
            if (chosen) {
                setActive(chosen);
                return;
            }

            let next = "";
            for (const target of targets) {
                if (target.getBoundingClientRect().top <= line) next = target.id;
                else break;
            }

            // Above the first heading, it counts once it is well up the
            // screen; until then the reader is still on the preamble.
            if (!next && targets[0]!.getBoundingClientRect().top < window.innerHeight / 2) {
                next = targets[0]!.id;
            }

            // At the foot of the page the last sections cannot reach the line,
            // so the last one on screen is the one being read.
            const atBottom =
                window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
            if (atBottom) {
                for (const target of targets) {
                    if (target.getBoundingClientRect().top < window.innerHeight) next = target.id;
                }
            }

            setActive(next);
        }

        function schedule() {
            if (frame === 0) frame = requestAnimationFrame(update);
        }

        function release() {
            chosenRef.current = null;
            schedule();
        }

        function resize() {
            line = readingLine(targets[0]!);
            schedule();
        }

        update();
        window.addEventListener("scroll", schedule, { passive: true });
        window.addEventListener("resize", resize);
        // Only the reader's own scrolling ends a click's claim; the smooth
        // scroll the click started fires `scroll` events too. A pointer press
        // covers dragging the scrollbar.
        window.addEventListener("wheel", release, { passive: true });
        window.addEventListener("pointerdown", release);
        window.addEventListener("touchmove", release, { passive: true });
        window.addEventListener("keydown", release);
        return () => {
            window.removeEventListener("scroll", schedule);
            window.removeEventListener("resize", resize);
            window.removeEventListener("wheel", release);
            window.removeEventListener("pointerdown", release);
            window.removeEventListener("touchmove", release);
            window.removeEventListener("keydown", release);
            if (frame !== 0) cancelAnimationFrame(frame);
            chosenRef.current = null;
        };
    }, [key]);

    useEffect(() => {
        const link = active
            ? rootRef.current?.querySelector<HTMLElement>(`a[href="#${active}"]`)
            : null;
        if (link) keepInView(link, rootRef.current!);
    }, [active]);

    function choose(id: string) {
        const target = document.getElementById(id);
        if (!target) return false;
        chosenRef.current = id;
        setActive(id);
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        history.pushState(null, "", `#${id}`);
        return true;
    }

    return (
        <OutlineList
            listRef={rootRef}
            className={`${styles.outline} ${styles.outlineRoot}`}
            sections={sections}
            active={active}
            onChoose={choose}
        />
    );
}

function OutlineList({
    listRef,
    className = styles.outline,
    sections,
    active,
    onChoose,
}: {
    listRef?: Ref<HTMLUListElement>;
    className?: string;
    sections: DocumentSection[];
    active: string;
    onChoose: (id: string) => boolean;
}) {
    return (
        <ul ref={listRef} className={className}>
            {sections.map((section) =>
                section.group ? (
                    <li key={section.id} className={styles.outlineGroup}>
                        <span>{section.title}</span>
                        <OutlineList sections={section.children} active={active} onChoose={onChoose} />
                    </li>
                ) : (
                <li key={section.id}>
                    <a
                        href={`#${section.id}`}
                        aria-current={active === section.id ? "location" : undefined}
                        onClick={(event) => {
                            if (onChoose(section.id)) event.preventDefault();
                        }}
                    >
                        {section.title}
                    </a>
                    {section.children.length > 0 && (
                        <OutlineList sections={section.children} active={active} onChoose={onChoose} />
                    )}
                </li>
                ),
            )}
        </ul>
    );
}

function flatten(sections: DocumentSection[]): string[] {
    return sections.flatMap((section) => [
        ...(section.group ? [] : [section.id]),
        ...flatten(section.children),
    ]);
}

/**
 * Where a heading counts as reached: the scroll margin a click parks it at,
 * plus a little, so the heading a click just brought up is the current one
 * rather than the section it replaced.
 */
function readingLine(target: HTMLElement): number {
    const margin = parseFloat(getComputedStyle(target).scrollMarginTop);
    return (Number.isFinite(margin) ? margin : 112) + 24;
}

/**
 * Scrolls the sidebar, not the page, so the current entry stays in sight.
 *
 * Left alone when the reader has scrolled the sidebar away from the outline
 * to read something else in it.
 */
function keepInView(link: HTMLElement, outline: HTMLElement) {
    const scroller = scrollParent(outline);
    if (!scroller) return;

    const box = scroller.getBoundingClientRect();
    const area = outline.getBoundingClientRect();
    if (area.bottom < box.top || area.top > box.bottom) return;

    const item = link.getBoundingClientRect();
    const pad = 48;
    let delta = 0;
    if (item.top < box.top + pad) delta = item.top - box.top - pad;
    else if (item.bottom > box.bottom - pad) delta = item.bottom - box.bottom + pad;
    if (delta !== 0) scroller.scrollBy({ top: delta });
}

function scrollParent(node: HTMLElement): HTMLElement | null {
    for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
        const { overflowY } = getComputedStyle(parent);
        if ((overflowY === "auto" || overflowY === "scroll") && parent.scrollHeight > parent.clientHeight) {
            return parent;
        }
    }
    return null;
}
