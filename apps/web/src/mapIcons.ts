// Marker geometry per the design handoff: colour carries freshness only;
// SHAPE carries movement state, so freshness is never the only encoding of
// vessel state either. Icons are drawn once as SDF alpha masks (plain
// filled/stroked shapes, not a true distance field -- an acceptable
// approximation at these sizes, same approach as the freshness dot/arrow
// icons from Phase 1) and tinted per-feature via icon-color.
//
// Shape: arrow (under way, oriented) / square (stopped or at anchor,
// sog < 0.5) / circle-with-dot (under way, orientation unknown).
// Fill style: solid (live/delayed) / hollow (stale) / dashed-hollow (dark).
export type MarkerShape = "arrow" | "square" | "circle";
export type MarkerFillStyle = "solid" | "hollow" | "dashed";

export const ICON_SIZE = 26;

function newCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  return { canvas, ctx };
}

function applyFillStyle(ctx: CanvasRenderingContext2D, style: MarkerFillStyle, lineWidth: number) {
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(style === "dashed" ? [2, 2] : []);
}

export function createArrowIcon(size: number, style: MarkerFillStyle): ImageData {
  const { ctx } = newCanvas(size);
  const cx = size / 2;
  ctx.fillStyle = "black";
  ctx.strokeStyle = "black";
  applyFillStyle(ctx, style, size > 16 ? 1.6 : 1.2);

  ctx.beginPath();
  // 4-point path with a notched tail (chevron), tip pointing "up" = 0deg
  // heading; icon-rotate handles the actual rotation to heading/COG.
  ctx.moveTo(cx, size * 0.06);
  ctx.lineTo(size * 0.82, size * 0.92);
  ctx.lineTo(cx, size * 0.72);
  ctx.lineTo(size * 0.18, size * 0.92);
  ctx.closePath();
  ctx.lineJoin = "round";

  if (style === "solid") ctx.fill();
  else ctx.stroke();

  return ctx.getImageData(0, 0, size, size);
}

export function createSquareIcon(size: number, style: MarkerFillStyle): ImageData {
  const { ctx } = newCanvas(size);
  ctx.fillStyle = "black";
  ctx.strokeStyle = "black";
  applyFillStyle(ctx, style, size > 16 ? 1.6 : 1.2);

  const half = size * 0.3;
  const cx = size / 2;
  const cy = size / 2;
  if (style === "solid") {
    ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
  } else {
    ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
  }
  return ctx.getImageData(0, 0, size, size);
}

export function createCircleIcon(size: number, style: MarkerFillStyle): ImageData {
  const { ctx } = newCanvas(size);
  const cx = size / 2;
  const cy = size / 2;
  ctx.fillStyle = "black";
  ctx.strokeStyle = "black";
  applyFillStyle(ctx, style, size > 16 ? 1.6 : 1.2);

  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.32, 0, Math.PI * 2);
  if (style === "solid") ctx.fill();
  else ctx.stroke();

  // Centre dot -- "the PRD's distinct unknown-orientation glyph" -- always
  // solid regardless of freshness fill style, so it stays legible hollow
  // or not.
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.08, 0, Math.PI * 2);
  ctx.fill();

  return ctx.getImageData(0, 0, size, size);
}

const SHAPE_BUILDERS: Record<MarkerShape, (size: number, style: MarkerFillStyle) => ImageData> = {
  arrow: createArrowIcon,
  square: createSquareIcon,
  circle: createCircleIcon,
};

export function iconId(shape: MarkerShape, style: MarkerFillStyle): string {
  return `vessel-${shape}-${style}`;
}

export function registerVesselIcons(
  map: { addImage: (id: string, image: ImageData, options: { sdf: boolean }) => void },
  size: number = ICON_SIZE
): void {
  const shapes: MarkerShape[] = ["arrow", "square", "circle"];
  const styles: MarkerFillStyle[] = ["solid", "hollow", "dashed"];
  for (const shape of shapes) {
    for (const style of styles) {
      map.addImage(iconId(shape, style), SHAPE_BUILDERS[shape](size, style), { sdf: true });
    }
  }
}

/** Selection ring: two concentric rings drawn as their own small icon,
 * layered as a separate symbol beneath the vessel icon at the selected
 * feature's position. */
export function createSelectionRingIcon(size: number): ImageData {
  const boxSize = Math.round(size * 2.4);
  const { ctx } = newCanvas(boxSize);
  const cx = boxSize / 2;
  const cy = boxSize / 2;
  ctx.strokeStyle = "black";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 1.15, 0, Math.PI * 2);
  ctx.stroke();
  return ctx.getImageData(0, 0, boxSize, boxSize);
}
