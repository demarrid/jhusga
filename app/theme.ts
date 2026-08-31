export const HUE_BLUEJAY = 0.59;

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
    } catch (error: unknown) {
        console.error(`Couldn't conver hsv to hex: ${error}`)
    }

    return "#fffffff"
}
type ColorScale = Record<string | number, string>;

function computeColorSet(hue: number, mute: boolean): ColorScale {
  const saturation = (value: number) => mute ? 0 : value;

  return {
    DEFAULT: HSVtoHex(hue, saturation(0.75), 0.55),
    10: HSVtoHex(hue, saturation(0.15), 0.985),
    50: HSVtoHex(hue, saturation(0.25), 0.97),
    100: HSVtoHex(hue, saturation(0.35), 0.94),
    200: HSVtoHex(hue, saturation(0.45), 0.89),
    300: HSVtoHex(hue, saturation(0.55), 0.78),
    400: HSVtoHex(hue, saturation(0.65), 0.66),
    500: HSVtoHex(hue, saturation(0.75), 0.55),
    600: HSVtoHex(hue, saturation(0.78), 0.45),
    700: HSVtoHex(hue, saturation(0.80), 0.36),
    800: HSVtoHex(hue, saturation(0.82), 0.27),
    900: HSVtoHex(hue, saturation(0.84), 0.18),
    950: HSVtoHex(hue, saturation(0.86), 0.10),
  };
}

export function createTheme(primaryHue: number, secondaryHue: number, isDark: boolean) {
  const invert = !isDark;
  const isNeutral = primaryHue === 0;

  return {
    colors: {
      primary: computeColorSet(primaryHue, isNeutral),
      secondary: computeColorSet(secondaryHue, false),
      accent: computeColorSet(primaryHue, isNeutral),
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
      background: HSVtoHex(primaryHue, primaryHue === 0 ? 0.1 : 1, invert ? 0.95 : 0.05),
      focus: HSVtoHex(primaryHue, 0.6, invert ? 0.37 : 0.63),
      editorbackground: HSVtoHex(primaryHue, 0.08, invert ? 0.95 : 0.05),
    },
    layout: {
      radius: { small: "4px", medium: "6px", large: "8px" },
    },
  };
}