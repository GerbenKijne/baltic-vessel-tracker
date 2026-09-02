// Thresholds match the design handoff (design_handoff_baltic_vessel_tracker/README.md):
// live <=2min, delayed 2-15min, stale 15min-6h, dark >6h. Operator-configurable on the
// server in principle (PRD SS7.2); hard-coded here until an admin settings API exists.
export const LIVE_MAX_MINUTES = 2;
export const DELAYED_MAX_MINUTES = 15;
export const STALE_MAX_MINUTES = 360;

export type Freshness = "live" | "delayed" | "stale" | "dark";

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  live: "Live",
  delayed: "Delayed",
  stale: "Stale",
  dark: "Dark",
};

export const FRESHNESS_THRESHOLD_LABEL: Record<Freshness, string> = {
  live: "≤ 2 min",
  delayed: "2–15 min",
  stale: "> 15 min",
  dark: "> 6 h",
};

export function freshnessForMinutes(minutesSinceObserved: number): Freshness {
  if (minutesSinceObserved <= LIVE_MAX_MINUTES) return "live";
  if (minutesSinceObserved <= DELAYED_MAX_MINUTES) return "delayed";
  if (minutesSinceObserved <= STALE_MAX_MINUTES) return "stale";
  return "dark";
}

export function freshnessForTime(reference: string | Date): Freshness {
  const minutes = (Date.now() - new Date(reference).getTime()) / 60_000;
  return freshnessForMinutes(minutes);
}

/** "2.4 min", "3 h 12 min", "1 d" -- matches the prototype's `ago()` formatting. */
export function formatAge(minutesSinceObserved: number): string {
  const m = minutesSinceObserved;
  if (m < 1) return `${Math.round(m * 60)} s`;
  if (m < 60) return `${m < 10 ? m.toFixed(1) : Math.round(m)} min`;
  const hours = Math.floor(m / 60);
  if (hours < 24) return `${hours} h ${Math.round(m % 60)} min`;
  return `${Math.floor(hours / 24)} d`;
}

export function formatAgeForTime(reference: string | Date): string {
  const minutes = (Date.now() - new Date(reference).getTime()) / 60_000;
  return formatAge(minutes);
}
