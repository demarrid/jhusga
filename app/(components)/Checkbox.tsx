"use client";

import styles from "./Checkbox.module.css";

/**
 * A tick box drawn in the site's own hand.
 *
 * The native input is still the control -- kept in the layout, merely made
 * invisible -- so the label, the keyboard, and a form submitted without
 * scripting all behave exactly as they did before.
 */
export default function Checkbox({
    children,
    checked,
    defaultChecked,
    onChange,
    name,
    value,
}: {
    children: React.ReactNode;
    checked?: boolean;
    defaultChecked?: boolean;
    onChange: (checked: boolean) => void;
    name?: string;
    value?: string;
}) {
    return (
        <label className={styles.field}>
            <input
                type="checkbox"
                name={name}
                value={value}
                checked={checked}
                defaultChecked={defaultChecked}
                className={styles.input}
                onChange={(event) => onChange(event.target.checked)}
            />
            <span className={styles.box} aria-hidden="true">
                <svg viewBox="0 0 16 16" focusable="false">
                    <path
                        d="M3.2 8.4 6.4 11.6 12.8 4.8"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </span>
            <span className={styles.label}>{children}</span>
        </label>
    );
}
