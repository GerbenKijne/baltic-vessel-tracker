import { formatAgeForTime, freshnessForTime, FRESHNESS_LABEL, type Freshness as FreshnessState } from "../freshness";

interface Props {
  time: string | Date;
  /** Suppress the word, showing only the dot (used in dense table cells). */
  noWord?: boolean;
  /** Append the mono age ("2.4 min") after the word. */
  showAge?: boolean;
}

/** Freshness is never colour-only (PRD SS7.3, design handoff "data-honesty
 * layer"): every indicator pairs the colour with a word and/or a glyph
 * shape, never colour alone. */
export function Freshness({ time, noWord, showAge }: Props) {
  const state: FreshnessState = freshnessForTime(time);
  return (
    <span className={`fx ${state}`}>
      <i />
      {!noWord && FRESHNESS_LABEL[state]}
      {showAge && <span className="mono fx-age">{formatAgeForTime(time)}</span>}
    </span>
  );
}
