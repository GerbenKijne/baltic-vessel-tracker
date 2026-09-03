import type { WatchlistVessel } from "./api/watchlists";

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvField(value: string | null | undefined): string {
  const s = value ?? "";
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV takes MMSI, optional note -- round-trips with parseWatchlistCsv.
 * No IMO column: nothing in this app writes Vessel.imo yet, so exporting
 * a column nothing can ever populate would be more misleading than
 * useful. */
export function vesselsToCsv(vessels: WatchlistVessel[]): string {
  const header = "mmsi,name,note,added_at";
  const rows = vessels.map((v) =>
    [csvField(v.mmsi), csvField(v.name), csvField(v.note), csvField(v.added_at)].join(",")
  );
  return [header, ...rows].join("\n") + "\n";
}

export function vesselsToGeoJson(
  vessels: WatchlistVessel[]
): GeoJSON.FeatureCollection<GeoJSON.Geometry | null> {
  return {
    type: "FeatureCollection",
    features: vessels.map((v) => ({
      type: "Feature",
      geometry: v.lon != null && v.lat != null ? { type: "Point", coordinates: [v.lon, v.lat] } : null,
      properties: {
        mmsi: v.mmsi,
        name: v.name,
        note: v.note,
        added_at: v.added_at,
        observed_at: v.observed_at,
        received_at: v.received_at,
        freshness: v.freshness,
        sog_kn: v.sog_kn,
        cog_deg: v.cog_deg,
        heading_deg: v.heading_deg,
        nav_status: v.nav_status,
      },
    })),
  };
}

/** Minimal parser for our own export format (and simple hand-written
 * CSVs): a header row, then mmsi + optional note per line, with basic
 * double-quote handling so a note containing a comma round-trips. Not a
 * general-purpose CSV parser. */
export function parseWatchlistCsv(text: string): { mmsi: string; note?: string }[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  function splitLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current);
    return fields;
  }

  const header = splitLine(lines[0]).map((h) => h.trim().toLowerCase());
  const mmsiIndex = header.indexOf("mmsi");
  const noteIndex = header.indexOf("note");
  // No recognizable header -- assume the file is bare "mmsi,note" data
  // with no header row at all, rather than rejecting it outright.
  const dataLines = mmsiIndex === -1 ? lines : lines.slice(1);
  const effectiveMmsiIndex = mmsiIndex === -1 ? 0 : mmsiIndex;
  const effectiveNoteIndex = mmsiIndex === -1 ? 1 : noteIndex;

  const rows: { mmsi: string; note?: string }[] = [];
  for (const line of dataLines) {
    const fields = splitLine(line);
    const mmsi = fields[effectiveMmsiIndex]?.trim();
    if (!mmsi) continue;
    const note = effectiveNoteIndex >= 0 ? fields[effectiveNoteIndex]?.trim() : undefined;
    rows.push({ mmsi, note: note || undefined });
  }
  return rows;
}
