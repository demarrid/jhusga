"use client";

import Link from "next/link";
import {
    useEffect,
    useRef,
    useState,
    useSyncExternalStore,
    type CSSProperties,
    type FocusEvent,
    type TransitionEvent,
} from "react";

import { ACTIVITY_CARD_LIMIT, type ActivityLane } from "@/lib/activity";

import styles from "./RecentCarousel.module.css";

/**
 * How long one lane stays before the next phrase starts upward.
 * The glide itself is the slow part; this is the rest between glides.
 */
const CYCLE_MS = 5_200;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Recent resolutions, meetings, and bills, over the hero.
 *
 * "Recent" stays put. The lane name, and the text inside each card, glide up
 * the way the ask field cycles its examples: a fixed window, the next line
 * waiting just below, then a snap back to the first once the copy has arrived.
 * The cards themselves do not change size.
 */
export default function RecentCarousel({ lanes }: { lanes: ActivityLane[] }) {
    const reducedMotion = usePrefersReducedMotion();
    const carousel = useRef<HTMLDivElement>(null);
    const [scrollStep, setScrollStep] = useState<number>();
    const [index, setIndex] = useState(0);
    const [animate, setAnimate] = useState(true);
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);

    const cycling = lanes.length > 1 && !reducedMotion;
    const slides = cycling ? [...lanes, lanes[0]!] : lanes;
    const running = !hovered && !focused && cycling;
    const paused = hovered || focused;
    const shownIndex = cycling ? Math.min(index, lanes.length) : 0;
    const slots = Math.min(
        ACTIVITY_CARD_LIMIT,
        Math.max(0, ...lanes.map((lane) => lane.cards.length)),
    );

    useEffect(() => {
        if (!running) return;

        const timer = window.setInterval(() => {
            setIndex((current) => current >= lanes.length ? 0 : current + 1);
        }, CYCLE_MS);

        return () => window.clearInterval(timer);
    }, [running, lanes.length]);

    // Window heights follow their actual font metrics. All tracks use the
    // largest window plus a small gap, so font edits cannot desynchronize them.
    useEffect(() => {
        const windows = carousel.current?.querySelectorAll<HTMLElement>("[data-cycle-window]");
        if (!windows?.length) return;
        const measure = () => setScrollStep(Math.ceil(Math.max(...Array.from(windows,
            window => window.getBoundingClientRect().height))) + 2);
        const observer = new ResizeObserver(measure);
        windows.forEach(window => observer.observe(window));
        measure();
        return () => observer.disconnect();
    }, [slots]);

    function finishLoop(event: TransitionEvent<HTMLUListElement>) {
        if (event.target !== event.currentTarget || event.propertyName !== "transform") return;
        if (!cycling || index !== lanes.length) return;

        setAnimate(false);
        setIndex(0);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => setAnimate(true));
        });
    }

    if (lanes.length === 0 || slots === 0) return null;

    const motion = animate ? styles.glide : `${styles.glide} ${styles.glideInstant}`;

    return (
        <div
            ref={carousel}
            className={styles.carousel}
            style={{ "--lane-index": shownIndex, "--shown": slots,
                "--scroll-step": scrollStep ? `${scrollStep}px` : undefined } as CSSProperties}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocusCapture={() => setFocused(true)}
            onBlurCapture={(event: FocusEvent<HTMLDivElement>) => {
                const next = event.relatedTarget;
                if (!(next instanceof Node) || !event.currentTarget.contains(next)) setFocused(false);
            }}
        >
            <div className={styles.plate} data-paused={paused || undefined}>
                <span className={styles.pauseIcon} aria-hidden="true">
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                        <rect x="4" y="3" width="3" height="10" rx="0.5" />
                        <rect x="9" y="3" width="3" height="10" rx="0.5" />
                    </svg>
                </span>
                <div className={styles.label}>
                    <span className={styles.recentWord}>Recent</span>
                    <span className={styles.currentLane}>
                        {slides[shownIndex]?.label}
                    </span>
                    <span className={styles.wordWindow} data-cycle-window aria-hidden="true">
                        <ul className={`${styles.wordTrack} ${motion}`} onTransitionEnd={finishLoop}>
                            {slides.map((lane, position) => (
                                <li key={`${lane.id}-${position}`}>{lane.label}</li>
                            ))}
                        </ul>
                    </span>
                </div>

                <div className={styles.slots}>
                    {Array.from({ length: slots }, (_, slot) => (
                        <Link
                            className={styles.cardFace}
                            key={slot}
                            href={slides[shownIndex]?.cards[slot]?.href ?? "#"}
                            aria-label={slides[shownIndex]?.cards[slot]?.title}
                            tabIndex={slides[shownIndex]?.cards[slot] ? 0 : -1}
                            aria-hidden={!slides[shownIndex]?.cards[slot]}
                            style={{visibility: slides[shownIndex]?.cards[slot] ? undefined : "hidden"}}
                        >
                            {(["status", "dateLabel", "title", "summary", "authors"] as const).map((field) => (
                                <span key={field} data-cycle-window className={`${styles.textWindow} ${styles[field]}`}>
                                    <span className={styles.currentLane}>
                                        {field === "authors" && paused
                                            ? slides[shownIndex]?.cards[slot]?.authorsWithPositions ?? slides[shownIndex]?.cards[slot]?.authors
                                            : slides[shownIndex]?.cards[slot]?.[field]}
                                    </span>
                                    <span className={`${styles.textTrack} ${motion}`} aria-hidden="true">
                                        {slides.map((lane, position) => (
                                            field === "authors" ? (
                                                <FittingCredit key={`${lane.id}-${position}`}
                                                    names={lane.cards[slot]?.authors ?? ""}
                                                    expanded={lane.cards[slot]?.authorsWithPositions}
                                                    paused={paused && position === shownIndex}
                                                    reducedMotion={reducedMotion} />
                                            ) : <span key={`${lane.id}-${position}`} className={styles.textLine}>
                                                {lane.cards[slot]?.[field] ?? ""}
                                            </span>
                                        ))}
                                    </span>
                                </span>
                            ))}
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}

/** Measure the actual font and card width; keep every name ahead of optional offices. */
function FittingCredit({ names, expanded, paused, reducedMotion }: {
    names: string; expanded?: string; paused: boolean; reducedMotion: boolean;
}) {
    const line = useRef<HTMLSpanElement>(null);
    const candidate = useRef<HTMLSpanElement>(null);
    const [width, setWidth] = useState({ available: 0, full: 0 });
    const fits = width.full > 0 && width.full <= width.available;
    const fullText = expanded || names;
    const scrolling = paused && !fits && width.full > 0 && !reducedMotion;

    useEffect(() => {
        const container = line.current;
        const measureText = candidate.current;
        if (!container || !measureText) return;
        let active = true;
        const measure = () => {
            if (active) {
                const next = { available: container.clientWidth, full: measureText.getBoundingClientRect().width };
                setWidth(previous => previous.available === next.available && previous.full === next.full ? previous : next);
            }
        };
        const observer = new ResizeObserver(measure);
        observer.observe(container);
        observer.observe(measureText);
        document.fonts.addEventListener("loadingdone", measure);
        void document.fonts.ready.then(measure);
        measure();
        return () => {
            active = false;
            observer.disconnect();
            document.fonts.removeEventListener("loadingdone", measure);
        };
    }, [fullText]);

    return (
        <span ref={line} className={`${styles.textLine} ${styles.creditLine}`} data-expanded={paused || undefined}
            style={{ "--credit-travel": `${width.full + 32}px`, "--credit-duration": `${Math.max(8, (width.full + 32) / 56)}s` } as CSSProperties}>
            <span className={styles.creditCompact}>{expanded && fits ? expanded : names}</span>
            <span className={`${styles.creditFull} ${scrolling ? styles.creditScrolling : ""}`}>
                <span className={styles.creditCopy}>{fullText}</span>
                {scrolling && <span className={styles.creditCopy}>{fullText}</span>}
            </span>
            <span ref={candidate} className={styles.creditMeasure}>{fullText}</span>
        </span>
    );
}

function usePrefersReducedMotion(): boolean {
    return useSyncExternalStore(subscribeToReducedMotion, readReducedMotion, () => false);
}

function subscribeToReducedMotion(onChange: () => void): () => void {
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
}

function readReducedMotion(): boolean {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
