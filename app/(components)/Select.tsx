"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import styles from "./Select.module.css";

const subscribeToHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

export type SelectOption = { value: string; label: string; icon?: ReactNode; accessibleLabel?: string };

/**
 * A dropdown the site draws itself.
 *
 * A native select hands its list to the operating system, which renders it in
 * a typeface and weight that belong to no page in particular. The list here is
 * ordinary markup, so it reads like the rest of the archive.
 *
 * Before hydration, an invisible native select overlays the trigger so the
 * search filters still submit as a plain GET form without JavaScript. After
 * hydration, only the styled control remains; a hidden input carries its
 * value for form submission without a second copy of the selected label.
 */
export default function Select({
    name,
    value,
    options,
    onChange,
    onReselect,
    id,
    ariaLabel,
    size = "default",
    variant = "field",
}: {
    name?: string;
    value: string;
    options: SelectOption[];
    onChange: (value: string) => void;
    onReselect?: (value: string) => void;
    id?: string;
    ariaLabel?: string;
    size?: "default" | "small";
    /** "inline" sits inside a sentence and reads as part of it. */
    variant?: "field" | "inline";
}) {
    const generatedId = useId();
    const listId = `${generatedId}-list`;
    const triggerId = id ?? `${generatedId}-trigger`;

    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    const [open, setOpen] = useState(false);
    const scripted = useSyncExternalStore(subscribeToHydration, clientHydrated, serverHydrated);

    const selectedIndex = options.findIndex((option) => option.value === value);
    const [activeIndex, setActiveIndex] = useState(Math.max(0, selectedIndex));

    useEffect(() => {
        if (!open) return;

        function onPointerDown(event: PointerEvent) {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        }

        window.addEventListener("pointerdown", onPointerDown);
        return () => window.removeEventListener("pointerdown", onPointerDown);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
    }, [open, activeIndex]);

    function openAt(index: number) {
        setActiveIndex(index);
        setOpen(true);
    }

    function commit(index: number) {
        const option = options[index];
        setOpen(false);
        triggerRef.current?.focus();
        if (option) {
            if (option.value !== value) onChange(option.value);
            else onReselect?.(option.value);
        }
    }

    function onKeyDown(event: React.KeyboardEvent) {
        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                if (!open) openAt(Math.max(0, selectedIndex));
                else setActiveIndex(Math.min(options.length - 1, activeIndex + 1));
                break;
            case "ArrowUp":
                event.preventDefault();
                if (!open) openAt(Math.max(0, selectedIndex));
                else setActiveIndex(Math.max(0, activeIndex - 1));
                break;
            case "Home":
                if (open) {
                    event.preventDefault();
                    setActiveIndex(0);
                }
                break;
            case "End":
                if (open) {
                    event.preventDefault();
                    setActiveIndex(options.length - 1);
                }
                break;
            case "Enter":
            case " ":
                event.preventDefault();
                if (open) commit(activeIndex);
                else openAt(Math.max(0, selectedIndex));
                break;
            case "Escape":
                if (open) {
                    event.preventDefault();
                    setOpen(false);
                }
                break;
            case "Tab":
                setOpen(false);
                break;
        }
    }

    return (
        <div ref={rootRef} className={`${styles.root} ${size === "small" ? styles.small : ""} ${variant === "inline" ? styles.inline : ""}`}>
            <button
                ref={triggerRef}
                type="button"
                id={triggerId}
                role="combobox"
                aria-controls={listId}
                aria-expanded={open}
                aria-haspopup="listbox"
                aria-label={ariaLabel}
                aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
                className={styles.trigger}
                onClick={() =>
                    open ? setOpen(false) : openAt(Math.max(0, selectedIndex))
                }
                onKeyDown={onKeyDown}
            >
                <span className={styles.value}>
                    {selectedIndex >= 0
                        ? <>{options[selectedIndex]?.label}{options[selectedIndex]?.icon}</>
                        : value || options[0]?.label || ""}
                </span>
                <span className={styles.arrow} aria-hidden="true" />
            </button>

            {open && (
                <ul ref={listRef} id={listId} role="listbox" className={styles.list}>
                    {options.map((option, index) => (
                        <li
                            key={option.value}
                            id={`${listId}-${index}`}
                            role="option"
                            aria-selected={option.value === value}
                            aria-label={option.accessibleLabel}
                            className={`${styles.option} ${
                                index === activeIndex ? styles.active : ""
                            }`}
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={() => commit(index)}
                        >
                            <span>{option.label}{option.icon}</span>
                            {option.value === value && (
                                <span className={styles.tick} aria-hidden="true" />
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {scripted ? (
                name ? <input type="hidden" name={name} value={value} /> : null
            ) : <select
                name={name}
                value={value}
                aria-label={ariaLabel}
                className={styles.native}
                onChange={(event) => onChange(event.target.value)}
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>}
        </div>
    );
}
