import type { Theme } from "./ThemeContext";

// Both styles are equally desaturated (same OpenFreeMap family, same
// glyphs/font server -- confirmed before switching, see the font-404
// lesson in project memory) so vessel marker colours stand out on either.
export function styleUrlForTheme(theme: Theme): string {
  return theme === "light"
    ? "https://tiles.openfreemap.org/styles/positron"
    : "https://tiles.openfreemap.org/styles/dark";
}
