function HSVtoHex(h: number, s: number, l: number) {
    h *= 360;
    s *= 100;
    try {
        const a = s * Math.min(l, 1 - l) / 100;
        const f = (n: number) => {
            const k = (n + h / 30) % 12;
            const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * color).toString(16).padStart(2, '0'); 
        };
        return `#${f(0)}${f(8)}${f(4)}`;
    } catch (error: any) {
        console.error(`Couldn't conver hsv to hex: ${error}`)
    }

    return "#fffffff"
}

function calculateValue(progress: number) {
    const min = 0.2;
    const max = 0.8;
    const x = 4 * (progress - .5)
    const result = min + (max - min) * (1 / (1 + Math.pow(Math.E, (-x))))

    return result;
}

const HUE_BLUEJAY = 0.59

function createTheme(primaryHue: number, secondaryHue: number, isDark: boolean) {
    const isNeutral = primaryHue === 0;

    const invert = !isDark;
    function computeColorSet(hue: number, mute: boolean) {
        const result = {
            DEFAULT: HSVtoHex(hue, mute ? 0 : 0.75, isDark ? (1 - 0.45) : 0.45)
        } as any

        result[10] = HSVtoHex(hue, mute ? 0 : .90, isDark ? (1 - 0.87) : .87)
        result[50] = HSVtoHex(hue, mute ? 0 : .90, isDark ? (1 - 0.75) : .75)
        result[100] = HSVtoHex(hue, mute ? 0 : .90, isDark ? (1 - 0.69) : .69)
        result[200] = HSVtoHex(hue, mute ? 0 : .90, isDark ? (1 - 0.66) : .66)
        result[300] = HSVtoHex(hue, mute ? 0 : .94, isDark ? (1 - 0.62) : .62)
        result[400] = HSVtoHex(hue, mute ? 0 : .95, isDark ? (1 - 0.55) : .55)
        result[500] = HSVtoHex(hue, mute ? 0 : .93, isDark ? (1 - 0.40) : .40)
        result[600] = HSVtoHex(hue, mute ? 0 : .95, isDark ? (1 - 0.29) : .29)
        result[700] = HSVtoHex(hue, mute ? 0 : .97, isDark ? (1 - 0.18) : .18)
        result[800] = HSVtoHex(hue, mute ? 0 : .97, isDark ? (1 - 0.14) : .14)
        result[900] = HSVtoHex(hue, mute ? 0 : .91, isDark ? (1 - 0.07) : .07)

        return result;
    }

    const theme = {
        extend: isDark ? 'dark' : 'light',
        colors: {
            primary: computeColorSet(primaryHue, isNeutral),
            secondary: computeColorSet(secondaryHue, false),
            accent: isNeutral ? computeColorSet(primaryHue, true) : computeColorSet(primaryHue, false),
            editorbackground: HSVtoHex(primaryHue, 0.08, isDark ? (1 - 0.05) : 0.05),
            foreground: isDark ? {
                50: "#FCFCFC",
                100: "#EFEFEF",
                200: "#DFDFDF",
                300: "#C8C8C8",
                400: "#B5B5B5",
                500: "#9E9E9E",
                600: "#838383",
                700: "#676767",
                800: "#555555",
                900: "#343434",
                950: "#151515",
                1000: "#080808",
                DEFAULT: '#ffffff'
            } : {
                50: "#1B1B1B",
                100: "#3A3A3A",
                200: "#373737",
                300: "#505050",
                400: "#6E6E6E",
                500: "#7B7B7B",
                600: "#999797",
                700: "#B0B0B0",
                800: "#C3C3C3",
                900: "#E4E2E2",
                950: "#F3F3F3",
                1000: "#F8F8F8",
                DEFAULT: '#000000'
            },
            background: HSVtoHex(primaryHue, primaryHue === 0 ? 0.1 : 1, invert ? (1 - 0.05) : 0.05),
            focus: HSVtoHex(primaryHue, 0.6, isDark ? (1 - 0.63) : 0.63),
        },
        layout: {
            disabledOpacity: "0.3",
            radius: {
                small: "4px",
                medium: "6px",
                large: "8px",
            },
            borderWidth: {
                small: "1px",
                medium: "2px",
                large: "3px",
            },
        },
    }
    return theme
}

const { nextui } = require('@nextui-org/react')

module.exports = {
    content: [
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
        "./node_modules/@nextui-org/theme/dist/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            borderRadius: {
                lg: 'var(--radius)',
                md: 'calc(var(--radius) - 2px)',
                sm: 'calc(var(--radius) - 4px)'
            },
            colors: {
                background: {
                    DEFAULT: 'hsl(var(--nextui-background, var(--background)) / <alpha-value>)'
                },
                foreground: {
                    DEFAULT: 'hsl(var(--nextui-foreground, var(--foreground)) / <alpha-value>)'
                },
                card: {
                    DEFAULT: 'hsl(var(--nextui-content1, var(--card)) / <alpha-value>)',
                    foreground: 'hsl(var(--nextui-content1-foreground, var(--card-foreground)) / <alpha-value>)'
                },
                popover: {
                    DEFAULT: 'hsl(var(--nextui-content1, var(--popover)) / <alpha-value>)',
                    foreground: 'hsl(var(--nextui-content1-foreground, var(--popover-foreground)) / <alpha-value>)'
                },
                primary: {
                    DEFAULT: 'hsl(var(--nextui-primary, var(--primary)) / <alpha-value>)',
                    foreground: 'hsl(var(--nextui-primary-foreground, var(--primary-foreground)) / <alpha-value>)'
                },
                secondary: {
                    DEFAULT: 'hsl(var(--nextui-secondary, var(--secondary)) / <alpha-value>)',
                    foreground: 'hsl(var(--nextui-secondary-foreground, var(--secondary-foreground)) / <alpha-value>)'
                },
                muted: {
                    DEFAULT: 'hsl(var(--nextui-content2, var(--muted)) / <alpha-value>)',
                    foreground: 'hsl(var(--nextui-content2-foreground, var(--muted-foreground)) / <alpha-value>)'
                },
                accent: {
                    DEFAULT: 'hsl(var(--nextui-default, var(--accent)) / <alpha-value>)',
                    foreground: 'hsl(var(--nextui-default-foreground, var(--accent-foreground)) / <alpha-value>)'
                },
                destructive: {
                    DEFAULT: 'hsl(var(--nextui-danger, var(--destructive)) / <alpha-value>)',
                    foreground: 'hsl(var(--nextui-danger-foreground, var(--destructive-foreground)) / <alpha-value>)'
                },
                border: 'hsl(var(--nextui-default-200, var(--border)) / <alpha-value>)',
                input: 'hsl(var(--nextui-default-200, var(--input)) / <alpha-value>)',
                ring: 'hsl(var(--nextui-focus, var(--ring)) / <alpha-value>)',
                chart: {
                    '1': 'hsl(var(--chart-1))',
                    '2': 'hsl(var(--chart-2))',
                    '3': 'hsl(var(--chart-3))',
                    '4': 'hsl(var(--chart-4))',
                    '5': 'hsl(var(--chart-5))'
                }
            }
        }
    },
    darkMode: ["class", "class"],
    plugins: [nextui({
        prefix: "nextui",
        addCommonColors: false,
        defaultTheme: "light",
        defaultExtendTheme: "light",
        layout: {},
        themes: {
            light: createTheme(HUE_BLUEJAY, HUE_BLUEJAY + 0.1, false),
            dark: createTheme(HUE_BLUEJAY, HUE_BLUEJAY + 0.1, true),
        },
    }), ,
    ]
}