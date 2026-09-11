"use client";

import { useEffect, useId, useRef, useState } from "react";

import styles from "./Select.module.css";

export type SelectOption = { value: string; label: string };

/**
 * A dropdown the site draws itself.
 *
 * A native select hands its list to the operating system, which renders it in
 * a typeface and weight that belong to no page in particular. The list here is
 * ordinary markup, so it reads like the rest of the archive.
 *
 * The real select is still underneath, laid over the trigger and invisible.
 * Until this component hydrates -- and permanently, where scripting is off --
 * that select is what a click reaches, which is what keeps the document
 * filters working as the plain GET form they are written to be.
 */
export default function Select({
    name,
    value,
    options,
    onChange,
    id,
    ariaLabel,
}: {
    name?: string;
    value: string;
    options: SelectOption[];
    onChange: (value: string) => void;
    id?: string;
    ariaLabel?: string;
}) {
    const generatedId = useId();
    const listId = `${generatedId}-list`;
    const triggerId = id ?? `${generatedId}-trigger`;

    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    const [open, setOpen] = useState(false);
    const [scripted, setScripted] = useState(false);

    const selectedIndex = options.findIndex((option) => option.value === value);
    const [activeIndex, setActiveIndex] = useState(Math.max(0, selectedIndex));

    useEffect(() => setScripted(true), []);

    useEffect(() => {
        setActiveIndex(Math.max(0, selectedIndex));
    }, [selectedIndex]);

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
        if (option && option.value !== value) onChange(option.value);
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
        <div ref={rootRef} className={styles.root}>
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
                        ? options[selectedIndex]?.label
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
                            className={`${styles.option} ${
                                index === activeIndex ? styles.active : ""
                            }`}
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={() => commit(index)}
                        >
                            <span>{option.label}</span>
                            {option.value === value && (
                                <span className={styles.tick} aria-hidden="true" />
                            )}
                        </li>
                    ))}
                </ul>
            )}

            <select
                name={name}
                value={value}
                tabIndex={scripted ? -1 : undefined}
                aria-hidden={scripted || undefined}
                className={`${styles.native} ${scripted ? styles.nativeInert : ""}`}
                onChange={(event) => onChange(event.target.value)}
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    );
}
