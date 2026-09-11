/** True only when local fixture data is explicitly enabled. */
export function demoModeEnabled(): boolean {
    return process.env.JHUSGA_DATA_MODE === "demo";
}
