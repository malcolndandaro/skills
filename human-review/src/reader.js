/**
 * Reading settings for rendered Markdown. The server renders a page with
 * them, so it never flashes the defaults first, and the SDK applies changes
 * live. Every variant is declared in the Markdown stylesheet; anything not
 * listed here is ignored.
 */
export const READER_VALUES = Object.freeze({
  width: ["narrow", "medium", "wide", "full"],
  size: ["s", "m", "l", "xl"],
  font: ["sans", "serif"],
  theme: ["light", "sepia", "dark"],
});

/** The valid settings in a plain object or URLSearchParams, as { name: value }. */
export function readerSettings(input) {
  const read = input && typeof input.get === "function" ? (name) => input.get(name) : (name) => input && input[name];
  const settings = {};
  for (const [name, allowed] of Object.entries(READER_VALUES)) {
    const value = String(read(name) ?? "");
    if (allowed.includes(value)) settings[name] = value;
  }
  return settings;
}
