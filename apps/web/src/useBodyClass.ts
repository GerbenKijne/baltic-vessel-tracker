import { useEffect } from "react";

// Toggles a class on <body> for as long as `when` is true -- used to hide
// the icon nav rail (see `body.sheet-open` in styles.css) while a
// full-screen mobile sheet (Map's panels, a page's sidebar, Alerts' rule
// builder) covers the screen. Each page computes one combined boolean for
// "some sheet is open right now" and calls this once, rather than having
// two independent effects fight over the same class.
export function useBodyClassWhen(className: string, when: boolean): void {
  useEffect(() => {
    if (!when) return;
    document.body.classList.add(className);
    return () => document.body.classList.remove(className);
  }, [className, when]);
}
