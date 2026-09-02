export const SOURCE_LABEL: Record<string, string> = {
  simulator: "Simulator",
  aisstream: "AISStream",
  barentswatch: "BarentsWatch",
  aishub: "AISHub",
  local: "Local receiver",
  licensed_se: "Licensed Sweden",
};

export const SOURCE_SHORT: Record<string, string> = {
  simulator: "SIM",
  aisstream: "AIS",
  barentswatch: "BW",
  aishub: "HUB",
  local: "RX",
  licensed_se: "SE",
};

export function sourceLabel(source: string | null): string {
  if (!source) return "Unknown";
  return SOURCE_LABEL[source] ?? source;
}

export function sourceShort(source: string): string {
  return SOURCE_SHORT[source] ?? source.slice(0, 3).toUpperCase();
}

/** Derived, not server-reported: worker/main.py always writes state
 * "connected" (it doesn't yet compute degraded/down itself), so "degraded"
 * here means "no message in longer than this" -- an honest client-side
 * approximation, not the source's own health classification. */
export const SOURCE_DEGRADED_AFTER_MINUTES = 5;

export function isSourceDegraded(lastMessageAt: string | null): boolean {
  if (!lastMessageAt) return true;
  const minutes = (Date.now() - new Date(lastMessageAt).getTime()) / 60_000;
  return minutes > SOURCE_DEGRADED_AFTER_MINUTES;
}
