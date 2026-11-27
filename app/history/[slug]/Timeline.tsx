"use client";

import {
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type CSSProperties,
    type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from "react";

import {
    HISTORY_EVENT_KIND_LABELS,
    HISTORY_OUTCOME_LABELS,
    type HistoryDatePrecision,
    type HistoryEventKind,
    type HistoryOutcome,
    type HistoryThread,
} from "@/config/history";
import { sessionOrdinal } from "@/config/session";

import { layoutFlags, type Flag, type Measure } from "./flags";
import styles from "./Timeline.module.css";

export type TimelineEvent = {
    id: string;
    /** Epoch milliseconds. */
    start: number;
    end: number | null;
    precision: HistoryDatePrecision;
    dateLabel: string;
    title: string;
    /** At most four words, for a crowded stretch of the timeline. */
    label: string;
    /** Plain first paragraph of the prose, shown on the event's flag. */
    summary: string;
    thread: string;
    kind: HistoryEventKind;
    involvement: "sga" | "context";
    outcome: HistoryOutcome;
    weight: 1 | 2 | 3;
    /** Lowercased title, prose, and source titles, for the filter box. */
    searchText: string;
};

type Props = {
    events: TimelineEvent[];
    threads: HistoryThread[];
    /** Server-rendered event prose with source chips, keyed by event id. */
    details: Record<string, ReactNode>;
    initialEventId: string | null;
};

type View = { start: number; span: number };
type Domain = { start: number; end: number };

const DAY = 86_400_000;
const YEAR = 365.2425 * DAY;
const MONTH = YEAR / 12;
const MIN_SPAN = 60 * DAY;
const REVEAL_SPAN = 4 * YEAR;
const STAGE_HEIGHT = 470;
const COMPACT_STAGE_HEIGHT = 400;
/** The axis line's distance from the bottom of the track; tick labels sit below it. */
const AXIS_BOTTOM = 34;
/** Shortest pole, so even the lowest flag stands clear of the markers. */
const POLE_MIN = 14;
/** Room above the flags for the session labels. */
const TOP_PAD = 30;
const RUBBER_PX = 120;
const EASE_TAU_MS = 120;
const FRICTION = 0.93;
const VELOCITY_WINDOW_MS = 90;
const PANEL_COVER_PX = 396;
/** Must match the panel's breakpoint in Timeline.module.css. */
const WIDE_QUERY = "(min-width: 1100px)";
/** Must match the narrow-screen breakpoint in Timeline.module.css. */
const COMPACT_QUERY = "(max-width: 759px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Past a limit, movement shrinks toward `slack` and never reaches it. */
function softClamp(value: number, min: number, max: number, slack: number): number {
    const rubber = (over: number) => slack * (1 - 1 / (over / slack + 1));
    if (value < min) return min - rubber(min - value);
    if (value > max) return max + rubber(value - max);
    return value;
}

function mediaStore(query: string, fallback: boolean) {
    return {
        subscribe(onChange: () => void) {
            const media = window.matchMedia(query);
            media.addEventListener("change", onChange);
            return () => media.removeEventListener("change", onChange);
        },
        snapshot: () => window.matchMedia(query).matches,
        server: () => fallback,
    };
}

const wideStore = mediaStore(WIDE_QUERY, true);
const compactStore = mediaStore(COMPACT_QUERY, false);
const reducedMotionStore = mediaStore(REDUCED_MOTION_QUERY, false);

/**
 * Text widths for the flag layout, from the page's own font once it has
 * loaded. Before that, and on the server, a per-character estimate.
 */
function createMeasure(family: string | null): Measure {
    const cache = new Map<string, number>();
    const context = family ? document.createElement("canvas").getContext("2d") : null;
    return (text, font) => {
        const key = `${font}\u0000${text}`;
        let size = cache.get(key);
        if (size === undefined) {
            if (context) {
                context.font = `${font} ${family}`;
                size = context.measureText(text).width;
            } else {
                size = text.length * Number.parseFloat(font.split(" ")[1] ?? "12") * 0.56;
            }
            cache.set(key, size);
        }
        return size;
    };
}

/**
 * One-dimensional camera over time: exponential easing toward a target in
 * log-span space, inertial coasting with friction, and a rubber band past the
 * ends that snaps back. Lives outside React so a drag or a fling never waits
 * on a render; it reports each frame through `onChange`.
 */
function createCamera(domain: Domain, initial: View, focus: number | null, onChange: (view: View) => void) {
    const domainSpan = domain.end - domain.start;
    let raw = initial;
    let target: View | null = null;
    let velocity = 0;
    let coasting = false;
    let width = 1000;
    let cover = 0;
    let reduced = false;
    let frame: number | null = null;
    let last = 0;

    const clampSpan = (span: number) => clamp(span, Math.min(MIN_SPAN, domainSpan), domainSpan);
    const limits = (span: number) => {
        const minStart = domain.start;
        const maxStart = Math.max(minStart, domain.end - span + (cover * span) / width);
        return { minStart, maxStart };
    };
    const display = (view: View): View => {
        const { minStart, maxStart } = limits(view.span);
        return {
            start: softClamp(view.start, minStart, maxStart, (RUBBER_PX * view.span) / width),
            span: view.span,
        };
    };
    const settle = (view: View): View => {
        const span = clampSpan(view.span);
        const { minStart, maxStart } = limits(span);
        return { start: clamp(view.start, minStart, maxStart), span };
    };
    const emit = () => onChange(display(raw));
    /**
     * An event linked to by URL stays centred in the uncovered track while the
     * width and the panel's cover are still being measured, until the reader
     * moves the view themselves.
     */
    const centreFocus = () => {
        if (focus === null) return;
        raw = settle({ start: focus - (((width - cover) / 2) * raw.span) / width, span: raw.span });
    };

    const step = (now: number) => {
        const dt = clamp(now - last, 1, 64);
        last = now;
        let active = false;

        if (target) {
            const ease = 1 - Math.exp(-dt / EASE_TAU_MS);
            const span = Math.exp(Math.log(raw.span) + (Math.log(target.span) - Math.log(raw.span)) * ease);
            const center = raw.start + raw.span / 2;
            const goal = target.start + target.span / 2;
            const next = center + (goal - center) * ease;
            raw = { start: next - span / 2, span };
            if (Math.abs(goal - next) < span * 2e-4 && Math.abs(Math.log(target.span / span)) < 1e-3) {
                raw = target;
                target = null;
            } else {
                active = true;
            }
        } else if (coasting) {
            const msPerPx = raw.span / width;
            raw = { start: raw.start - velocity * dt * msPerPx, span: raw.span };
            const { minStart, maxStart } = limits(raw.span);
            const overPx = Math.max(0, minStart - raw.start, raw.start - maxStart) / msPerPx;
            let damping = Math.pow(FRICTION, dt / 16.67);
            if (overPx > 0) damping *= Math.pow(0.7, (dt / 16.67) * Math.min(1, overPx / RUBBER_PX));
            velocity *= damping;
            if (Math.abs(velocity) < 0.02) {
                coasting = false;
                const settled = settle(raw);
                if (settled.start !== raw.start) target = settled;
            }
            active = true;
        }

        emit();
        frame = active ? requestAnimationFrame(step) : null;
    };

    const kick = () => {
        if (frame !== null) return;
        last = performance.now();
        frame = requestAnimationFrame(step);
    };
    const halt = () => {
        target = null;
        coasting = false;
        velocity = 0;
        focus = null;
    };

    return {
        view: () => display(raw),
        domainSpan,
        clampSpan,
        setWidth(next: number) {
            width = Math.max(1, next);
            centreFocus();
            emit();
        },
        setCover(next: number) {
            if (next === cover) return;
            raw = display(raw);
            cover = next;
            if (focus !== null) {
                centreFocus();
                emit();
            } else if (!target && !coasting) {
                const settled = settle(raw);
                if (settled.start !== raw.start) this.animateTo(settled);
            }
        },
        setReducedMotion(next: boolean) {
            reduced = next;
        },
        hold() {
            halt();
        },
        jump(view: View) {
            halt();
            raw = settle(view);
            emit();
        },
        panBy(dx: number) {
            target = null;
            coasting = false;
            focus = null;
            raw = { start: raw.start - (dx * raw.span) / width, span: raw.span };
            emit();
        },
        zoomAt(x: number, factor: number, animate = false) {
            const from = target ?? display(raw);
            const span = clampSpan(from.span * factor);
            const anchor = from.start + (x / width) * from.span;
            const next = settle({ start: anchor - (x / width) * span, span });
            if (animate) this.animateTo(next);
            else this.jump(next);
        },
        animateTo(view: View) {
            raw = display(raw);
            coasting = false;
            focus = null;
            if (reduced) {
                this.jump(view);
                return;
            }
            target = settle(view);
            kick();
        },
        release(pxPerMs: number) {
            if (!reduced && Math.abs(pxPerMs) > 0.05) {
                velocity = clamp(pxPerMs, -6, 6);
                coasting = true;
                kick();
                return;
            }
            const settled = settle(raw);
            if (settled.start !== raw.start) this.animateTo(settled);
        },
        /** Bring a time into the uncovered part of the track, zooming in if far out. */
        reveal(time: number, zoom: boolean) {
            const current = target ?? display(raw);
            const span = zoom && current.span > REVEAL_SPAN ? clampSpan(REVEAL_SPAN) : current.span;
            const usable = width - cover;
            const x = ((time - current.start) / current.span) * width;
            if (span === current.span && x >= 56 && x <= usable - 56) return;
            this.animateTo({ start: time - ((usable / 2) * span) / width, span });
        },
        dispose() {
            if (frame !== null) cancelAnimationFrame(frame);
            frame = null;
        },
    };
}

type Camera = ReturnType<typeof createCamera>;

type Tick = { time: number; label: string; major: boolean };

function axisTicks(view: View, width: number): Tick[] {
    const pxPerMonth = width / (view.span / MONTH);
    const months = [1, 2, 3, 6, 12, 24, 60, 120].find((step) => pxPerMonth * step >= (step < 12 ? 54 : 46)) ?? 240;
    const end = view.start + view.span;
    const first = new Date(view.start);
    const ticks: Tick[] = [];

    if (months < 12) {
        let year = first.getUTCFullYear();
        let month = Math.floor(first.getUTCMonth() / months) * months;
        for (let guard = 0; guard < 400; guard += 1) {
            const time = Date.UTC(year, month, 1);
            if (time > end) break;
            if (time >= view.start) {
                ticks.push({ time, label: month === 0 ? String(year) : MONTH_NAMES[month]!, major: month === 0 });
            }
            month += months;
            if (month >= 12) {
                month -= 12;
                year += 1;
            }
        }
        return ticks;
    }

    const years = months / 12;
    for (let year = Math.floor(first.getUTCFullYear() / years) * years; ; year += years) {
        const time = Date.UTC(year, 0, 1);
        if (time > end) break;
        if (time >= view.start) ticks.push({ time, label: String(year), major: year % (years * 5) === 0 });
    }
    return ticks;
}

type Band = { year: number; from: number; to: number };

/** Academic years, June to June, which is how the SGA counts sessions. */
function sessionBands(view: View): Band[] {
    const end = view.start + view.span;
    const bands: Band[] = [];
    for (let year = new Date(view.start).getUTCFullYear() - 1; ; year += 1) {
        const from = Date.UTC(year, 5, 1);
        if (from > end) break;
        const to = Date.UTC(year + 1, 5, 1);
        if (to >= view.start) bands.push({ year, from, to });
    }
    return bands;
}

const markerRadius = (event: TimelineEvent) => (event.weight === 3 ? 7 : event.weight === 2 ? 5.5 : 4.5);

function histogram(events: TimelineEvent[], lanes: HistoryThread[], domain: Domain, bins: number) {
    const span = domain.end - domain.start;
    const laneIndex = new Map(lanes.map((thread, index) => [thread.id, index]));
    const counts = Array.from({ length: bins }, () => new Array<number>(lanes.length).fill(0));
    for (const event of events) {
        const lane = laneIndex.get(event.thread);
        if (lane === undefined) continue;
        const bin = clamp(Math.floor(((event.start - domain.start) / span) * bins), 0, bins - 1);
        counts[bin]![lane]! += 1;
    }
    const max = Math.max(1, ...counts.map((bin) => bin.reduce((sum, count) => sum + count, 0)));
    return { counts, max };
}

/** A tooltip over or under the element it describes, in track pixels. */
type Hover = { events: TimelineEvent[]; x: number; y: number; below: boolean };

type Drag = {
    pointers: Map<number, { x: number; y: number }>;
    downX: number;
    downY: number;
    moved: boolean;
    target: { eventId?: string; clusterKey?: string } | null;
    samples: { t: number; x: number }[];
    pinch: { distance: number; mid: number } | null;
};

type Brush = { mode: "move" | "left" | "right"; lastX: number; width: number };

export default function Timeline({ events, threads, details, initialEventId }: Props) {
    const rootRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const minimapRef = useRef<HTMLDivElement>(null);
    const cameraRef = useRef<Camera | null>(null);
    const dragRef = useRef<Drag | null>(null);
    const brushRef = useRef<Brush | null>(null);
    const engagedRef = useRef(false);
    const lastTapRef = useRef<{ t: number; x: number } | null>(null);
    const hintTimerRef = useRef<number | null>(null);

    const sorted = useMemo(
        () => [...events].sort((a, b) => a.start - b.start || b.weight - a.weight || a.id.localeCompare(b.id)),
        [events],
    );
    const domain = useMemo<Domain>(() => {
        const times = sorted.flatMap((event) => (event.end ? [event.start, event.end] : [event.start]));
        const min = Math.min(...times);
        const max = Math.max(...times);
        const pad = Math.max((max - min) * 0.04, 120 * DAY);
        return { start: min - pad, end: max + pad };
    }, [sorted]);
    const domainSpan = domain.end - domain.start;

    const [view, setView] = useState<View>(() => {
        const event = initialEventId ? sorted.find((item) => item.id === initialEventId) : undefined;
        if (!event) return { start: domain.start, span: domainSpan };
        const span = Math.min(domainSpan, REVEAL_SPAN);
        return { start: clamp(event.start - span * 0.3, domain.start, domain.end - span), span };
    });
    const initialViewRef = useRef(view);
    const [width, setWidth] = useState(1000);
    const [hiddenThreads, setHiddenThreads] = useState<ReadonlySet<string>>(() => new Set());
    const [query, setQuery] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(initialEventId);
    const [hover, setHover] = useState<Hover | null>(null);
    const [engaged, setEngaged] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [hint, setHint] = useState<string | null>("Drag to move through time. Click the timeline, then scroll to zoom.");

    const [fontFamily, setFontFamily] = useState<string | null>(null);
    const wide = useSyncExternalStore(wideStore.subscribe, wideStore.snapshot, wideStore.server);
    const compact = useSyncExternalStore(compactStore.subscribe, compactStore.snapshot, compactStore.server);
    const reducedMotion = useSyncExternalStore(
        reducedMotionStore.subscribe,
        reducedMotionStore.snapshot,
        reducedMotionStore.server,
    );

    const threadById = useMemo(() => new Map(threads.map((thread) => [thread.id, thread])), [threads]);
    const lanes = useMemo(() => threads.filter((thread) => !hiddenThreads.has(thread.id)), [threads, hiddenThreads]);
    const needle = query.trim().toLowerCase();
    const visible = useMemo(
        () =>
            sorted.filter(
                (event) => !hiddenThreads.has(event.thread) && (!needle || event.searchText.includes(needle)),
            ),
        [sorted, hiddenThreads, needle],
    );
    const selected = selectedId ? sorted.find((event) => event.id === selectedId) ?? null : null;
    const selectedIndex = selected ? visible.findIndex((event) => event.id === selected.id) : -1;
    const panelOpen = selected !== null;
    const cover = panelOpen && wide ? PANEL_COVER_PX : 0;
    const stageHeight = compact ? COMPACT_STAGE_HEIGHT : STAGE_HEIGHT;
    const measure = useMemo(() => createMeasure(fontFamily), [fontFamily]);
    const toX = (time: number) => ((time - view.start) / view.span) * width;
    const inView = useMemo(
        () =>
            visible.filter((event) => {
                const from = ((event.start - view.start) / view.span) * width;
                const to = event.end ? ((event.end - view.start) / view.span) * width : from;
                return to >= -40 && from <= width + 40;
            }),
        [visible, view, width],
    );
    const flags = useMemo(
        () =>
            layoutFlags({
                events: inView,
                toX: (time) => ((time - view.start) / view.span) * width,
                usable: width - cover,
                maxHeight: stageHeight - AXIS_BOTTOM - POLE_MIN - TOP_PAD,
                measure,
                compact,
            }),
        [inView, view, width, cover, stageHeight, measure, compact],
    );
    const ticks = useMemo(() => axisTicks(view, width), [view, width]);
    const bands = useMemo(() => sessionBands(view), [view]);
    const bins = clamp(Math.floor(width / 6), 24, 240);
    const density = useMemo(() => histogram(visible, lanes, domain, bins), [visible, lanes, domain, bins]);

    useEffect(() => {
        const track = trackRef.current;
        if (!track) return;
        const focus = initialEventId ? sorted.find((event) => event.id === initialEventId)?.start ?? null : null;
        // A moving view re-lays the flags, and a hovered one can vanish without a pointerleave.
        const camera = createCamera(domain, initialViewRef.current, focus, (next) => {
            setView(next);
            setHover(null);
        });
        cameraRef.current = camera;
        const observer = new ResizeObserver(([entry]) => {
            const next = entry?.contentRect.width ?? track.clientWidth;
            setWidth(next);
            camera.setWidth(next);
        });
        observer.observe(track);
        return () => {
            observer.disconnect();
            camera.dispose();
            cameraRef.current = null;
        };
    }, [domain, initialEventId, sorted]);

    useEffect(() => {
        cameraRef.current?.setReducedMotion(reducedMotion);
    }, [reducedMotion]);

    useEffect(() => {
        cameraRef.current?.setCover(cover);
    }, [cover]);

    useEffect(() => {
        // Flags are sized by measuring their text, so wait for the real font.
        let cancelled = false;
        const root = rootRef.current;
        if (!root) return;
        void document.fonts.ready.then(() => {
            if (!cancelled) setFontFamily(getComputedStyle(root).fontFamily);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        engagedRef.current = engaged;
    }, [engaged]);

    useEffect(() => {
        const url = new URL(window.location.href);
        if (selectedId) url.searchParams.set("event", selectedId);
        else url.searchParams.delete("event");
        window.history.replaceState(window.history.state, "", url);
    }, [selectedId]);

    useEffect(() => {
        if (!selectedId || wide) return;
        rootRef.current
            ?.querySelector("[data-timeline-panel]")
            ?.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
    }, [selectedId, wide, reducedMotion]);

    useEffect(() => {
        const timer = window.setTimeout(() => setHint(null), 6000);
        const onPointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setEngaged(false);
        };
        document.addEventListener("pointerdown", onPointerDown);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener("pointerdown", onPointerDown);
        };
    }, []);

    useEffect(() => {
        const track = trackRef.current;
        if (!track) return;
        const onWheel = (event: WheelEvent) => {
            const camera = cameraRef.current;
            if (!camera) return;
            const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? track.clientWidth : 1;
            const dx = event.deltaX * scale;
            const dy = event.deltaY * scale;
            const rect = track.getBoundingClientRect();

            if (event.shiftKey || Math.abs(dx) > Math.abs(dy)) {
                event.preventDefault();
                camera.panBy(-(event.shiftKey && dx === 0 ? dy : dx));
                return;
            }
            if (!(event.ctrlKey || event.metaKey || engagedRef.current)) {
                setHint("Click the timeline first, or hold Ctrl, to zoom with the scroll wheel.");
                if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
                hintTimerRef.current = window.setTimeout(() => setHint(null), 2200);
                return;
            }
            event.preventDefault();
            camera.zoomAt(event.clientX - rect.left, Math.exp(dy * (event.ctrlKey ? 0.01 : 0.0022)));
        };
        track.addEventListener("wheel", onWheel, { passive: false });
        return () => {
            track.removeEventListener("wheel", onWheel);
            if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
        };
    }, []);

    function select(event: TimelineEvent | null, options: { zoom?: boolean } = {}) {
        setSelectedId(event?.id ?? null);
        setHover(null);
        if (!event) return;
        cameraRef.current?.setCover(wide ? PANEL_COVER_PX : 0);
        cameraRef.current?.reveal(event.start, options.zoom ?? false);
    }

    function step(direction: 1 | -1) {
        if (visible.length === 0) return;
        if (selectedIndex >= 0) {
            const next = visible[selectedIndex + direction];
            if (next) select(next);
            return;
        }
        const center = view.start + view.span / 2;
        const after = visible.findIndex((event) => event.start >= center);
        const index = after === -1 ? visible.length - 1 : direction === 1 ? after : Math.max(0, after - 1);
        select(visible[index]!);
    }

    function zoomCluster(events: TimelineEvent[]) {
        const camera = cameraRef.current;
        if (!camera || events.length === 0) return;
        const from = Math.min(...events.map((event) => event.start));
        const to = Math.max(...events.map((event) => event.end ?? event.start));
        const current = camera.view();
        let span = camera.clampSpan(Math.max((to - from) * 1.8, MIN_SPAN));
        if (span > current.span * 0.7) span = camera.clampSpan(current.span * 0.35);
        camera.animateTo({ start: (from + to) / 2 - span / 2, span });
        setHover(null);
    }

    function zoomBy(factor: number) {
        cameraRef.current?.zoomAt(width / 2, factor, true);
    }

    function fit() {
        cameraRef.current?.animateTo({ start: domain.start, span: domainSpan });
    }

    function findCluster(key: string): TimelineEvent[] | undefined {
        return flags.find((flag) => flag.key === key)?.group.events;
    }

    /** Show a tooltip for `events` beside the element under the pointer. */
    function hoverOver(element: HTMLElement, events: TimelineEvent[], x?: number) {
        if (dragRef.current) return;
        const track = trackRef.current?.getBoundingClientRect();
        if (!track) return;
        const rect = element.getBoundingClientRect();
        const top = rect.top - track.top;
        const below = top < 150;
        setHover({
            events,
            x: x ?? rect.left - track.left + rect.width / 2,
            y: below ? rect.bottom - track.top + 6 : top - 6,
            below,
        });
    }

    function trackX(clientX: number) {
        return clientX - (trackRef.current?.getBoundingClientRect().left ?? 0);
    }

    function onTrackPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
        if (event.button !== 0) return;
        const camera = cameraRef.current;
        if (!camera) return;
        setEngaged(true);
        setHint(null);
        camera.hold();
        const drag = dragRef.current ?? {
            pointers: new Map(),
            downX: event.clientX,
            downY: event.clientY,
            moved: false,
            target: null,
            samples: [],
            pinch: null,
        };
        drag.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (drag.pointers.size === 1) {
            const hit = (event.target as Element).closest<HTMLElement>("[data-event-id],[data-cluster]");
            drag.target = hit
                ? { eventId: hit.dataset.eventId, clusterKey: hit.dataset.cluster }
                : null;
            drag.samples = [{ t: event.timeStamp, x: event.clientX }];
        } else {
            const [a, b] = [...drag.pointers.values()];
            if (a && b) {
                drag.pinch = { distance: Math.max(24, Math.abs(a.x - b.x)), mid: trackX((a.x + b.x) / 2) };
                drag.moved = true;
            }
        }
        dragRef.current = drag;
        event.currentTarget.setPointerCapture(event.pointerId);
    }

    function onTrackPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
        const drag = dragRef.current;
        const camera = cameraRef.current;
        const previous = drag?.pointers.get(event.pointerId);
        if (!drag || !camera || !previous) return;
        drag.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

        const [a, b] = [...drag.pointers.values()];
        if (drag.pinch && a && b) {
            const distance = Math.max(24, Math.abs(a.x - b.x));
            const mid = trackX((a.x + b.x) / 2);
            camera.panBy(mid - drag.pinch.mid);
            camera.zoomAt(mid, drag.pinch.distance / distance);
            drag.pinch = { distance, mid };
            return;
        }

        if (!drag.moved && Math.hypot(event.clientX - drag.downX, event.clientY - drag.downY) < 5) return;
        if (!drag.moved) {
            drag.moved = true;
            setDragging(true);
            setHover(null);
        }
        camera.panBy(event.clientX - previous.x);
        drag.samples.push({ t: event.timeStamp, x: event.clientX });
        while (drag.samples.length > 2 && event.timeStamp - drag.samples[0]!.t > VELOCITY_WINDOW_MS) {
            drag.samples.shift();
        }
    }

    function onTrackPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
        const drag = dragRef.current;
        const camera = cameraRef.current;
        if (!drag || !camera || !drag.pointers.has(event.pointerId)) return;
        drag.pointers.delete(event.pointerId);
        if (drag.pointers.size > 0) {
            // A pinch that loses a finger carries on as a pan from where the other one is.
            drag.pinch = null;
            drag.samples = [];
            return;
        }
        dragRef.current = null;
        setDragging(false);

        if (event.type === "pointercancel") {
            camera.release(0);
            return;
        }

        if (drag.moved) {
            const first = drag.samples[0];
            const last = drag.samples[drag.samples.length - 1];
            const fresh = last && event.timeStamp - last.t < 50;
            const elapsed = first && last ? last.t - first.t : 0;
            camera.release(fresh && first && last && elapsed > 8 ? (last.x - first.x) / elapsed : 0);
            return;
        }

        camera.release(0);
        if (drag.target?.eventId) {
            const hit = sorted.find((item) => item.id === drag.target?.eventId);
            if (hit) select(hit.id === selectedId ? null : hit);
            return;
        }
        if (drag.target?.clusterKey) {
            const cluster = findCluster(drag.target.clusterKey);
            if (cluster) zoomCluster(cluster);
            return;
        }

        const x = trackX(event.clientX);
        const tap = lastTapRef.current;
        if (tap && event.timeStamp - tap.t < 320 && Math.abs(tap.x - x) < 24) {
            lastTapRef.current = null;
            camera.zoomAt(x, 0.45, true);
            return;
        }
        lastTapRef.current = { t: event.timeStamp, x };
    }

    function onStageKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
        if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
        const handlers: Record<string, () => void> = {
            ArrowRight: () => step(1),
            ArrowLeft: () => step(-1),
            Home: () => visible[0] && select(visible[0], { zoom: true }),
            End: () => visible.at(-1) && select(visible.at(-1)!, { zoom: true }),
            "+": () => zoomBy(0.5),
            "=": () => zoomBy(0.5),
            "-": () => zoomBy(2),
            _: () => zoomBy(2),
            "0": fit,
            Escape: () => (selected ? select(null) : setEngaged(false)),
        };
        const handler = handlers[event.key];
        if (!handler) return;
        event.preventDefault();
        setEngaged(true);
        handler();
    }

    function minimapPoint(clientX: number) {
        const rect = minimapRef.current?.getBoundingClientRect() ?? { left: 0, width: 1 };
        return { x: clientX - rect.left, width: Math.max(1, rect.width) };
    }

    function onMinimapPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
        if (event.button !== 0) return;
        const camera = cameraRef.current;
        if (!camera) return;
        const { x, width: mapWidth } = minimapPoint(event.clientX);
        const current = camera.view();
        const left = ((current.start - domain.start) / domainSpan) * mapWidth;
        const right = left + (current.span / domainSpan) * mapWidth;
        let mode: Brush["mode"] = "move";
        if (Math.abs(x - left) <= 8) mode = "left";
        else if (Math.abs(x - right) <= 8) mode = "right";
        else if (x < left || x > right) {
            const time = domain.start + (x / mapWidth) * domainSpan;
            camera.jump({ start: time - current.span / 2, span: current.span });
        }
        brushRef.current = { mode, lastX: x, width: mapWidth };
        setEngaged(true);
        event.currentTarget.setPointerCapture(event.pointerId);
    }

    function onMinimapPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
        const brush = brushRef.current;
        const camera = cameraRef.current;
        if (!brush || !camera) return;
        const { x } = minimapPoint(event.clientX);
        const delta = ((x - brush.lastX) / brush.width) * domainSpan;
        brush.lastX = x;
        const current = camera.view();
        if (brush.mode === "move") {
            camera.jump({ start: current.start + delta, span: current.span });
        } else if (brush.mode === "left") {
            const end = current.start + current.span;
            const span = camera.clampSpan(current.span - delta);
            camera.jump({ start: end - span, span });
        } else {
            camera.jump({ start: current.start, span: camera.clampSpan(current.span + delta) });
        }
    }

    function onMinimapPointerUp() {
        brushRef.current = null;
    }

    const toPercent = (x: number) => `${(x / width) * 100}%`;
    const brushLeft = ((view.start - domain.start) / domainSpan) * 100;
    const brushWidth = (view.span / domainSpan) * 100;
    const minimapYears = useMemo(() => {
        const first = new Date(domain.start).getUTCFullYear() + 1;
        const last = new Date(domain.end).getUTCFullYear();
        const step = [1, 2, 5, 10, 20, 50].find((size) => (last - first) / size <= width / 80) ?? 100;
        const years: number[] = [];
        for (let year = Math.ceil(first / step) * step; year <= last; year += step) years.push(year);
        return years;
    }, [domain, width]);

    const hovered = hover?.events.length ? hover : null;
    const flagThread = (event: TimelineEvent) => threadById.get(event.thread)?.color;

    return (
        <div ref={rootRef} className={styles.timeline} data-engaged={engaged || undefined}>
            <div className={styles.toolbar}>
                <div className={styles.legend} role="group" aria-label="Show threads">
                    {threads.map((thread) => {
                        const on = !hiddenThreads.has(thread.id);
                        return (
                            <button
                                key={thread.id}
                                type="button"
                                className={styles.legendChip}
                                aria-pressed={on}
                                title={thread.description}
                                style={{ "--c": thread.color } as CSSProperties}
                                onClick={() =>
                                    setHiddenThreads((current) => {
                                        const next = new Set(current);
                                        if (next.has(thread.id)) next.delete(thread.id);
                                        else next.add(thread.id);
                                        return next;
                                    })
                                }
                            >
                                <span aria-hidden="true" />
                                {thread.label}
                            </button>
                        );
                    })}
                </div>
                <div className={styles.controls}>
                    <label className={styles.search}>
                        <span className={styles.srOnly}>Filter events</span>
                        <input
                            type="search"
                            placeholder="Filter events"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                        />
                    </label>
                    <span className={styles.count} aria-live="polite">
                        {visible.length === sorted.length
                            ? `${sorted.length} events`
                            : `${visible.length} of ${sorted.length}`}
                    </span>
                    <div className={styles.zoomButtons}>
                        <button type="button" onClick={() => zoomBy(2)} aria-label="Zoom out" title="Zoom out (−)">
                            −
                        </button>
                        <button type="button" onClick={() => zoomBy(0.5)} aria-label="Zoom in" title="Zoom in (+)">
                            +
                        </button>
                        <button type="button" onClick={fit} title="Show everything (0)">
                            All
                        </button>
                    </div>
                </div>
            </div>

            <div
                className={styles.stage}
                style={{ height: stageHeight }}
                tabIndex={0}
                role="group"
                aria-roledescription="timeline"
                aria-label="Timeline. Left and right arrows move between events, plus and minus zoom, 0 shows everything."
                onKeyDown={onStageKeyDown}
            >
                <div
                    ref={trackRef}
                    className={styles.track}
                    data-dragging={dragging || undefined}
                    onPointerDown={onTrackPointerDown}
                    onPointerMove={onTrackPointerMove}
                    onPointerUp={onTrackPointerUp}
                    onPointerCancel={onTrackPointerUp}
                >
                    {bands.map((band) => {
                        const from = ((band.from - view.start) / view.span) * width;
                        const to = ((band.to - view.start) / view.span) * width;
                        const visibleFrom = Math.max(from, 0);
                        const visibleTo = Math.min(to, width);
                        const room = visibleTo - visibleFrom;
                        const years = `${band.year}–${String(band.year + 1).slice(-2)}`;
                        const session = band.year - 1912;
                        return (
                            <div key={band.year}>
                                {to - from >= 36 && (
                                    <div
                                        className={styles.band}
                                        data-odd={band.year % 2 === 1 || undefined}
                                        style={{ left: toPercent(from), width: toPercent(to - from) }}
                                    />
                                )}
                                {room >= 58 && (
                                    <span
                                        className={styles.bandLabel}
                                        style={{ left: toPercent((visibleFrom + visibleTo) / 2) }}
                                    >
                                        {years}
                                        {room >= 150 && session > 0 && <small> · {sessionOrdinal(session)}</small>}
                                    </span>
                                )}
                            </div>
                        );
                    })}

                    {ticks.map((tick) => {
                        const x = ((tick.time - view.start) / view.span) * width;
                        return (
                            <div key={tick.time}>
                                <div
                                    className={styles.gridline}
                                    data-major={tick.major || undefined}
                                    style={{ left: toPercent(x), top: TOP_PAD - 6, bottom: AXIS_BOTTOM }}
                                />
                                <span className={styles.tick} data-major={tick.major || undefined} style={{ left: toPercent(x) }}>
                                    {tick.label}
                                </span>
                            </div>
                        );
                    })}

                    <div className={styles.axis} style={{ bottom: AXIS_BOTTOM }} aria-hidden="true" />

                    {flags.map((flag) => (
                        <FlagView
                            key={flag.key}
                            flag={flag}
                            selectedId={selectedId}
                            colorOf={flagThread}
                            onSelect={(event) => select(event.id === selectedId ? null : event)}
                            onZoom={zoomCluster}
                            onHover={hoverOver}
                            onLeave={() => setHover(null)}
                        />
                    ))}

                    {inView
                        .filter((event) => event.id !== selectedId)
                        .concat(inView.filter((event) => event.id === selectedId))
                        .map((event) => (
                            <AxisMarker
                                key={event.id}
                                event={event}
                                x={toX(event.start)}
                                endX={event.end ? toX(event.end) : null}
                                color={flagThread(event)}
                                selected={event.id === selectedId}
                                onActivate={() => select(event.id === selectedId ? null : event)}
                                onHover={(element) => (element ? hoverOver(element, [event]) : setHover(null))}
                            />
                        ))}

                    {lanes.length === 0 && <p className={styles.noLanes}>Turn on a thread above to see its events.</p>}

                    {hovered && !dragging && (
                        <div
                            className={styles.tooltip}
                            role="presentation"
                            data-below={hovered.below || undefined}
                            style={{ left: clamp(hovered.x - 140, 4, Math.max(4, width - 284)), top: hovered.y }}
                        >
                            {hovered.events.length === 1 ? (
                                <>
                                    <p className={styles.tooltipMeta}>
                                        {hovered.events[0]!.dateLabel} · {HISTORY_EVENT_KIND_LABELS[hovered.events[0]!.kind]}
                                    </p>
                                    <p className={styles.tooltipTitle}>{hovered.events[0]!.title}</p>
                                    {hovered.events[0]!.outcome && (
                                        <p className={styles.tooltipOutcome} data-outcome={hovered.events[0]!.outcome}>
                                            {HISTORY_OUTCOME_LABELS[hovered.events[0]!.outcome]}
                                        </p>
                                    )}
                                </>
                            ) : (
                                <>
                                    <p className={styles.tooltipMeta}>
                                        {hovered.events[0]!.dateLabel} – {hovered.events.at(-1)!.dateLabel}
                                    </p>
                                    <p className={styles.tooltipTitle}>{hovered.events.length} events · click to zoom in</p>
                                    <ul className={styles.tooltipList}>
                                        {hovered.events.slice(0, 4).map((event) => (
                                            <li key={event.id}>{event.title}</li>
                                        ))}
                                        {hovered.events.length > 4 && <li>and {hovered.events.length - 4} more</li>}
                                    </ul>
                                </>
                            )}
                        </div>
                    )}

                    {hint && (
                        <p className={styles.hint} aria-hidden="true">
                            {hint}
                        </p>
                    )}
                </div>

                {selected && wide && (
                    <EventPanel
                        event={selected}
                        thread={threadById.get(selected.thread)}
                        detail={details[selected.id]}
                        hasPrevious={selectedIndex > 0}
                        hasNext={selectedIndex >= 0 && selectedIndex < visible.length - 1}
                        onStep={step}
                        onClose={() => select(null)}
                    />
                )}
            </div>

            <div className={styles.minimapRow}>
                <span className={styles.minimapLabel}>Overview</span>
                <div
                    ref={minimapRef}
                    className={styles.minimap}
                    onPointerDown={onMinimapPointerDown}
                    onPointerMove={onMinimapPointerMove}
                    onPointerUp={onMinimapPointerUp}
                    onPointerCancel={onMinimapPointerUp}
                    aria-hidden="true"
                >
                    <svg viewBox={`0 0 ${bins} ${density.max}`} preserveAspectRatio="none">
                        {density.counts.map((bin, index) => {
                            let y = density.max;
                            return bin.map((count, lane) => {
                                if (count === 0) return null;
                                y -= count;
                                return (
                                    <rect
                                        key={`${index}:${lane}`}
                                        x={index + 0.12}
                                        y={y}
                                        width={0.76}
                                        height={count}
                                        fill={lanes[lane]!.color}
                                    />
                                );
                            });
                        })}
                    </svg>
                    {minimapYears.map((year) => (
                        <span
                            key={year}
                            className={styles.minimapYear}
                            style={{ left: `${((Date.UTC(year, 0, 1) - domain.start) / domainSpan) * 100}%` }}
                        >
                            {year}
                        </span>
                    ))}
                    <div
                        className={styles.brush}
                        style={{ left: `${clamp(brushLeft, -2, 100)}%`, width: `${clamp(brushWidth, 0, 100)}%` }}
                    />
                </div>
            </div>

            {selected && !wide && (
                <EventPanel
                    event={selected}
                    thread={threadById.get(selected.thread)}
                    detail={details[selected.id]}
                    hasPrevious={selectedIndex > 0}
                    hasNext={selectedIndex >= 0 && selectedIndex < visible.length - 1}
                    onStep={step}
                    onClose={() => select(null)}
                />
            )}

            <p className={styles.srOnly} aria-live="polite">
                {selected ? `${selected.title}, ${selected.dateLabel}` : ""}
            </p>
        </div>
    );
}

function AxisMarker({
    event,
    x,
    endX,
    color,
    selected,
    onActivate,
    onHover,
}: {
    event: TimelineEvent;
    x: number;
    endX: number | null;
    color: string | undefined;
    selected: boolean;
    onActivate: () => void;
    onHover: (element: HTMLElement | null) => void;
}) {
    const fuzzy = event.precision !== "day" && event.precision !== "month";
    const shape = event.kind === "legislation" ? "diamond" : event.kind === "funding" ? "square" : "circle";
    const radius = markerRadius(event);
    return (
        <>
            {endX !== null && (
                <div
                    className={styles.spanBar}
                    style={{ left: x, bottom: AXIS_BOTTOM, width: Math.max(2, endX - x), "--c": color } as CSSProperties}
                    aria-hidden="true"
                />
            )}
            <button
                type="button"
                tabIndex={-1}
                className={styles.marker}
                data-event-id={event.id}
                data-shape={shape}
                data-context={event.involvement === "context" || undefined}
                data-fuzzy={fuzzy || undefined}
                data-selected={selected || undefined}
                aria-pressed={selected}
                aria-label={`${event.title}, ${event.dateLabel}`}
                style={{ left: x, bottom: AXIS_BOTTOM, width: radius * 2, height: radius * 2, "--c": color } as CSSProperties}
                onClick={(click) => click.detail === 0 && onActivate()}
                onPointerEnter={(pointer) => onHover(pointer.currentTarget)}
                onPointerLeave={() => onHover(null)}
            />
        </>
    );
}

/** One flag: its pole down to the axis, a bracket under a group, and the box. */
function FlagView({
    flag,
    selectedId,
    colorOf,
    onSelect,
    onZoom,
    onHover,
    onLeave,
}: {
    flag: Flag<TimelineEvent>;
    selectedId: string | null;
    colorOf: (event: TimelineEvent) => string | undefined;
    onSelect: (event: TimelineEvent) => void;
    onZoom: (events: TimelineEvent[]) => void;
    onHover: (element: HTMLElement, events: TimelineEvent[], x?: number) => void;
    onLeave: () => void;
}) {
    const { group } = flag;
    const single = flag.type === "event" ? flag.event : null;
    const color = single ? colorOf(single) : undefined;
    const bottom = AXIS_BOTTOM + POLE_MIN + flag.y;
    const box = { left: flag.left, bottom, width: flag.width, height: flag.height, "--c": color } as CSSProperties;
    const first = group.events[0]!;
    const last = group.events.at(-1)!;
    const range = first.dateLabel === last.dateLabel ? first.dateLabel : `${first.dateLabel} – ${last.dateLabel}`;
    const zoomLabel = `${group.events.length} events, ${range}. Zoom in.`;

    let body: ReactNode;
    if (flag.type === "event") {
        const event = flag.event;
        body =
            flag.mode === "tag" ? (
                <button
                    type="button"
                    tabIndex={-1}
                    className={styles.flag}
                    data-mode="tag"
                    data-event-id={event.id}
                    data-context={event.involvement === "context" || undefined}
                    data-selected={event.id === selectedId || undefined}
                    aria-label={`${event.title}, ${event.dateLabel}`}
                    style={box}
                    onClick={(click) => click.detail === 0 && onSelect(event)}
                    onPointerEnter={(pointer) => onHover(pointer.currentTarget, [event], flag.poleX)}
                    onPointerLeave={onLeave}
                >
                    {event.label}
                </button>
            ) : (
                <button
                    type="button"
                    tabIndex={-1}
                    className={styles.flag}
                    data-mode={flag.mode}
                    data-event-id={event.id}
                    data-context={event.involvement === "context" || undefined}
                    data-selected={event.id === selectedId || undefined}
                    aria-label={`${event.title}, ${event.dateLabel}`}
                    style={box}
                    onClick={(click) => click.detail === 0 && onSelect(event)}
                >
                    <span className={styles.flagMeta}>
                        {event.dateLabel}
                        {event.outcome && (
                            <span data-outcome={event.outcome}> · {HISTORY_OUTCOME_LABELS[event.outcome]}</span>
                        )}
                    </span>
                    <span className={styles.flagTitle} style={{ WebkitLineClamp: flag.titleLines }}>
                        {event.title}
                    </span>
                    {flag.descLines > 0 && (
                        <span className={styles.flagDesc} style={{ WebkitLineClamp: flag.descLines }}>
                            {event.summary}
                        </span>
                    )}
                </button>
            );
    } else if (flag.type === "list") {
        body = (
            <div className={styles.flag} data-mode={flag.mode} style={box}>
                <button
                    type="button"
                    tabIndex={-1}
                    className={styles.flagMeta}
                    data-cluster={flag.key}
                    aria-label={zoomLabel}
                    onClick={(click) => click.detail === 0 && onZoom(group.events)}
                >
                    {range} · {group.events.length}
                </button>
                <ul className={styles.flagList}>
                    {flag.shown.map((event) => (
                        <li key={event.id} style={{ "--c": colorOf(event) } as CSSProperties}>
                            <button
                                type="button"
                                tabIndex={-1}
                                data-event-id={event.id}
                                data-selected={event.id === selectedId || undefined}
                                aria-label={`${event.title}, ${event.dateLabel}`}
                                onClick={(click) => click.detail === 0 && onSelect(event)}
                                onPointerEnter={(pointer) => onHover(pointer.currentTarget, [event])}
                                onPointerLeave={onLeave}
                            >
                                {flag.mode === "titles" ? event.title : event.label}
                            </button>
                        </li>
                    ))}
                    {flag.more > 0 && (
                        <li className={styles.flagMore}>
                            <button
                                type="button"
                                tabIndex={-1}
                                data-cluster={flag.key}
                                aria-label={zoomLabel}
                                onClick={(click) => click.detail === 0 && onZoom(group.events)}
                            >
                                +{flag.more} more
                            </button>
                        </li>
                    )}
                </ul>
            </div>
        );
    } else {
        body = (
            <button
                type="button"
                tabIndex={-1}
                className={styles.flag}
                data-mode="count"
                data-cluster={flag.key}
                aria-label={zoomLabel}
                style={box}
                onClick={(click) => click.detail === 0 && onZoom(group.events)}
                onPointerEnter={(pointer) => onHover(pointer.currentTarget, group.events, flag.poleX)}
                onPointerLeave={onLeave}
            >
                {group.events.length} events
            </button>
        );
    }

    return (
        <>
            {!single && group.x1 - group.x0 > 2 && (
                <div
                    className={styles.flagBracket}
                    style={{ left: group.x0, width: group.x1 - group.x0, bottom: AXIS_BOTTOM + 10 }}
                    aria-hidden="true"
                />
            )}
            <div
                className={styles.flagPole}
                data-group={!single || undefined}
                style={{ left: flag.poleX, bottom: AXIS_BOTTOM, height: POLE_MIN + flag.y, "--c": color } as CSSProperties}
                aria-hidden="true"
            />
            {body}
        </>
    );
}

function EventPanel({
    event,
    thread,
    detail,
    hasPrevious,
    hasNext,
    onStep,
    onClose,
}: {
    event: TimelineEvent;
    thread: HistoryThread | undefined;
    detail: ReactNode;
    hasPrevious: boolean;
    hasNext: boolean;
    onStep: (direction: 1 | -1) => void;
    onClose: () => void;
}) {
    return (
        <aside
            key={event.id}
            data-timeline-panel
            className={styles.panel}
            aria-labelledby={`timeline-panel-${event.id}`}
            style={{ "--c": thread?.color } as CSSProperties}
        >
            <div className={styles.panelHead}>
                <p className={styles.panelMeta}>
                    <span>{event.dateLabel}</span>
                    {thread && <span className={styles.panelThread}>{thread.label}</span>}
                </p>
                <button type="button" className={styles.panelClose} onClick={onClose} aria-label="Close">
                    ×
                </button>
            </div>
            <p className={styles.panelTags}>
                <span>{HISTORY_EVENT_KIND_LABELS[event.kind]}</span>
                {event.outcome && (
                    <span className={styles.panelOutcome} data-outcome={event.outcome}>
                        {HISTORY_OUTCOME_LABELS[event.outcome]}
                    </span>
                )}
                {event.involvement === "context" && <span className={styles.panelContext}>Context</span>}
            </p>
            <h3 id={`timeline-panel-${event.id}`} className={styles.panelTitle}>
                {event.title}
            </h3>
            <div className={styles.panelBody}>{detail}</div>
            <div className={styles.panelNav}>
                <button type="button" onClick={() => onStep(-1)} disabled={!hasPrevious}>
                    ← Earlier
                </button>
                <a href={`#event-${event.id}`}>In the record</a>
                <button type="button" onClick={() => onStep(1)} disabled={!hasNext}>
                    Later →
                </button>
            </div>
        </aside>
    );
}
