"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import styles from "./Select.module.css";

const subscribeToHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

export type SelectOption = { value: string; label: string; icon?: ReactNode; accessibleLabel?: string };

type SingleSelection = {
    multiple?: false;
    value: string;
    onChange: (value: string) => void;
    onReselect?: (value: string) => void;
};

/**
 * Several values at once. A plain click still picks just one option, as it
 * does in a single select; holding Ctrl (Cmd on a Mac, where Ctrl-click is a
 * right click) toggles an option and leaves the list open for the next.
 * Ctrl+Enter or Ctrl+Space does the same from the keyboard. An option whose
 * value is empty stands for "none chosen": it reads as selected when nothing
 * is, and choosing it clears the rest.
 */
type MultipleSelection = {
    multiple: true;
    value: readonly string[];
    onChange: (values: string[]) => void;
    onReselect?: never;
};

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
export default function Select(
    props: {
        name?: string;
        options: SelectOption[];
        id?: string;
        ariaLabel?: string;
        size?: "default" | "small";
        /** "inline" sits inside a sentence and reads as part of it. */
        variant?: "field" | "inline";
    } & (SingleSelection | MultipleSelection),
) {
    const { name, options, id, ariaLabel, size = "default", variant = "field" } = props;

    const generatedId = useId();
    const listId = `${generatedId}-list`;
    const triggerId = id ?? `${generatedId}-trigger`;

    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    const [open, setOpen] = useState(false);
    const scripted = useSyncExternalStore(subscribeToHydration, clientHydrated, serverHydrated);

    // A toggle is reported at once, but the owner's value may take a moment
    // to come back (the documents page navigates first). Until it does, the
    // list shows what was asked for, and a second toggle builds on that rather
    // than quietly undoing the first. Any new value from the owner wins.
    const valueKey = props.multiple ? JSON.stringify(props.value) : "";
    const [draft, setDraft] = useState<{ base: string; values: string[] } | null>(null);
    const chosen: readonly string[] = props.multiple
        ? draft && draft.base === valueKey
            ? draft.values
            : props.value
        : [];

    const isSelected = (option: SelectOption) =>
        props.multiple
            ? option.value === ""
                ? chosen.length === 0
                : chosen.includes(option.value)
            : option.value === props.value;

    const selectedIndex = options.findIndex(isSelected);
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

    function choose(values: string[]) {
        if (!props.multiple) return;
        // Kept in list order, so the same choice is always the same URL.
        const known = options.filter((option) => option.value && values.includes(option.value));
        const unknown = values.filter((value) => !options.some((option) => option.value === value));
        const next = [...known.map((option) => option.value), ...unknown];
        if (JSON.stringify(next) === JSON.stringify(chosen)) return;
        setDraft({ base: valueKey, values: next });
        props.onChange(next);
    }

    function commit(index: number) {
        const option = options[index];
        setOpen(false);
        triggerRef.current?.focus();
        if (!option) return;
        if (props.multiple) choose(option.value ? [option.value] : []);
        else if (option.value !== props.value) props.onChange(option.value);
        else props.onReselect?.(option.value);
    }

    /** The Ctrl/Cmd gesture: add or remove one option, and stay open. */
    function toggle(index: number) {
        const option = options[index];
        setActiveIndex(index);
        triggerRef.current?.focus();
        if (!option) return;
        if (!option.value) choose([]);
        else if (chosen.includes(option.value)) choose(chosen.filter((value) => value !== option.value));
        else choose([...chosen, option.value]);
    }

    const toggles = (event: React.MouseEvent | React.KeyboardEvent) =>
        Boolean(props.multiple) && (event.ctrlKey || event.metaKey);

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
                if (open && toggles(event)) toggle(activeIndex);
                else if (open) commit(activeIndex);
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

    const chosenOptions = props.multiple
        ? chosen.map(
              (value) =>
                  options.find((option) => option.value === value) ?? { value, label: value },
          )
        : [];

    function triggerValue(): ReactNode {
        if (props.multiple && chosenOptions.length > 1) return chosenOptions[0]!.label;
        const shown = props.multiple ? chosenOptions[0] : options[selectedIndex];
        if (shown) return <>{shown.label}{shown.icon}</>;
        if (props.multiple) return options.find((option) => !option.value)?.label ?? options[0]?.label ?? "";
        return props.value || options[0]?.label || "";
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
                // The trigger shortens several choices; hovering spells them out.
                title={
                    chosenOptions.length > 1
                        ? chosenOptions.map((option) => option.label).join(", ")
                        : undefined
                }
                className={styles.trigger}
                onClick={() =>
                    open ? setOpen(false) : openAt(Math.max(0, selectedIndex))
                }
                onKeyDown={onKeyDown}
            >
                <span className={styles.value}>{triggerValue()}</span>
                {chosenOptions.length > 1 && (
                    // Outside the truncated label, so a narrow field still
                    // shows that more than one value is chosen.
                    <span className={styles.more}>
                        +{chosenOptions.length - 1}
                        <span className={styles.hiddenLabel}> more</span>
                    </span>
                )}
                <span className={styles.arrow} aria-hidden="true" />
            </button>

            {open && (
                <ul
                    ref={listRef}
                    id={listId}
                    role="listbox"
                    aria-multiselectable={props.multiple || undefined}
                    className={styles.list}
                >
                    {options.map((option, index) => (
                        <li
                            key={option.value}
                            id={`${listId}-${index}`}
                            role="option"
                            aria-selected={isSelected(option)}
                            aria-label={option.accessibleLabel}
                            className={`${styles.option} ${
                                index === activeIndex ? styles.active : ""
                            }`}
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={(event) => (toggles(event) ? toggle(index) : commit(index))}
                        >
                            <span>{option.label}{option.icon}</span>
                            {isSelected(option) && (
                                <span className={styles.tick} aria-hidden="true" />
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {scripted ? (
                name ? (
                    props.multiple ? (
                        // One field per value, as a native multiple select submits.
                        chosen.map((value) => <input key={value} type="hidden" name={name} value={value} />)
                    ) : (
                        <input type="hidden" name={name} value={props.value} />
                    )
                ) : null
            ) : <select
                name={name}
                // Without JavaScript a filter takes one value; a list of several
                // from a shared link is shown by its first.
                value={props.multiple ? (props.value[0] ?? "") : props.value}
                aria-label={ariaLabel}
                className={styles.native}
                onChange={(event) =>
                    props.multiple ? choose(event.target.value ? [event.target.value] : []) : props.onChange(event.target.value)
                }
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
