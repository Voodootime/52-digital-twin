import DxfParser from 'dxf-parser';
import { createModule, LibreDwg, Dwg_File_Type } from '@mlightcad/libredwg-web';
import {
  FloorPlan,
  Room,
  CADLine,
  CADText,
  CADLayer,
  Point2D,
  HospitalZone,
  CleanlinessClass,
  CommonSubType
} from '../types/cad';

// Cached singleton instance of LibreDWG WebAssembly
let libreDwgInstancePromise: Promise<LibreDwg> | null = null;

async function getLibreDwgInstance(): Promise<LibreDwg> {
  if (!libreDwgInstancePromise) {
    libreDwgInstancePromise = (async () => {
      try {
        const wasmModule = await createModule({
          locateFile: (filename: string) =>
            filename.endsWith('.wasm') ? '/wasm/libredwg-web.wasm' : filename
        });
        return LibreDwg.createByWasmInstance(wasmModule);
      } catch (err) {
        libreDwgInstancePromise = null;
        throw err;
      }
    })();
  }
  return libreDwgInstancePromise;
}

/**
 * Tessellates a polygon that may contain corner radii (`point.radius > 0`)
 * or DXF/DWG arc bulges (`point.bulge !== 0`) into a smooth sequence of 2D points.
 */
export function tessellatePolygon(
  points: Point2D[],
  segmentsPerCurve = 14,
  isClosed = true
): Point2D[] {
  if (points.length < 2) return [...points];
  const n = points.length;
  const result: Point2D[] = [];

  for (let i = 0; i < n; i++) {
    const curr = points[i];
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];

    // 1. Handle corner fillet radius at vertex `curr` (only if closed or interior vertex)
    const r = curr.radius ?? 0;
    if (r > 0.05 && (isClosed || (i > 0 && i < n - 1)) && n >= 3) {
      const ux = prev.x - curr.x;
      const uy = prev.y - curr.y;
      const vx = next.x - curr.x;
      const vy = next.y - curr.y;
      const lenU = Math.hypot(ux, uy);
      const lenV = Math.hypot(vx, vy);

      if (lenU > 0.1 && lenV > 0.1) {
        const uHatX = ux / lenU;
        const uHatY = uy / lenU;
        const vHatX = vx / lenV;
        const vHatY = vy / lenV;

        const dot = Math.max(-1, Math.min(1, uHatX * vHatX + uHatY * vHatY));
        const alpha = Math.acos(dot);

        if (alpha > 0.1 && alpha < Math.PI - 0.1) {
          const halfAlpha = alpha / 2;
          const tanHalf = Math.tan(halfAlpha);
          const maxD = Math.min(lenU, lenV) * 0.45;
          const d = Math.min(r / tanHalf, maxD);
          const effR = d * tanHalf;

          // Tangent points on incoming and outgoing edges
          const t1x = curr.x + uHatX * d;
          const t1y = curr.y + uHatY * d;
          const t2x = curr.x + vHatX * d;
          const t2y = curr.y + vHatY * d;

          // Bisector direction to circle center
          const bx = uHatX + vHatX;
          const by = uHatY + vHatY;
          const bLen = Math.hypot(bx, by);

          if (bLen > 1e-5) {
            const distToCenter = effR / Math.sin(halfAlpha);
            const cx = curr.x + (bx / bLen) * distToCenter;
            const cy = curr.y + (by / bLen) * distToCenter;

            const startAngle = Math.atan2(t1y - cy, t1x - cx);
            const endAngle = Math.atan2(t2y - cy, t2x - cx);
            let sweep = endAngle - startAngle;
            if (sweep > Math.PI) sweep -= Math.PI * 2;
            if (sweep < -Math.PI) sweep += Math.PI * 2;

            for (let s = 0; s <= segmentsPerCurve; s++) {
              const theta = startAngle + (sweep * s) / segmentsPerCurve;
              result.push({
                x: Number((cx + effR * Math.cos(theta)).toFixed(3)),
                y: Number((cy + effR * Math.sin(theta)).toFixed(3))
              });
            }
          } else {
            result.push({ x: curr.x, y: curr.y });
          }
        } else {
          result.push({ x: curr.x, y: curr.y });
        }
      } else {
        result.push({ x: curr.x, y: curr.y });
      }
    } else {
      result.push({ x: curr.x, y: curr.y });
    }

    // 2. Handle curved wall segment (`bulge`) from `curr` to `next`
    const bulge = curr.bulge ?? 0;
    if (Math.abs(bulge) > 0.02 && (isClosed || i < n - 1)) {
      const dx = next.x - curr.x;
      const dy = next.y - curr.y;
      const chordLen = Math.hypot(dx, dy);

      if (chordLen > 0.1) {
        const theta = 4 * Math.atan(bulge);
        const radius = chordLen / (2 * Math.sin(Math.abs(theta) / 2));
        const mx = (curr.x + next.x) / 2;
        const my = (curr.y + next.y) / 2;
        const h = (chordLen / 2) * ((1 - bulge * bulge) / (2 * bulge));

        const nx = -dy / chordLen;
        const ny = dx / chordLen;
        const cx = mx + nx * h;
        const cy = my + ny * h;

        const startAngle = Math.atan2(curr.y - cy, curr.x - cx);
        for (let s = 1; s < segmentsPerCurve; s++) {
          const ang = startAngle + (theta * s) / segmentsPerCurve;
          result.push({
            x: Number((cx + radius * Math.cos(ang)).toFixed(3)),
            y: Number((cy + radius * Math.sin(ang)).toFixed(3))
          });
        }
      }
    }
  }

  return result;
}

/**
 * Checks if a polygon has any rounded corners or curved segments
 */
export function hasCurvedGeometry(points: Point2D[]): boolean {
  return points.some(
    p => (p.radius && p.radius > 0.05) || (p.bulge && Math.abs(p.bulge) > 0.02)
  );
}

// Shoelace formula for polygon area (in m²), accounting for rounded corners and curved walls
export function calculatePolygonArea(points: Point2D[]): number {
  if (points.length < 3) return 0;
  const pts = hasCurvedGeometry(points) ? tessellatePolygon(points, 16, true) : points;
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

// Polygon perimeter calculation (in m), accounting for rounded corners and curved walls
export function calculatePolygonPerimeter(points: Point2D[]): number {
  if (points.length < 2) return 0;
  const pts = hasCurvedGeometry(points) ? tessellatePolygon(points, 16, true) : points;
  let perimeter = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = pts[j].x - pts[i].x;
    const dy = pts[j].y - pts[i].y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  return perimeter;
}

// Compute geometric area-weighted centroid of polygon (accounting for curves)
export function calculatePolygonCenter(points: Point2D[]): Point2D {
  if (points.length === 0) return { x: 0, y: 0 };
  const pts = hasCurvedGeometry(points) ? tessellatePolygon(points, 14, true) : points;
  const n = pts.length;
  if (n < 3) {
    const xAvg = pts.reduce((s, p) => s + p.x, 0) / n;
    const yAvg = pts.reduce((s, p) => s + p.y, 0) / n;
    return { x: Number(xAvg.toFixed(2)), y: Number(yAvg.toFixed(2)) };
  }

  let signedArea = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < n; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % n];
    const cross = p0.x * p1.y - p1.x * p0.y;
    signedArea += cross;
    cx += (p0.x + p1.x) * cross;
    cy += (p0.y + p1.y) * cross;
  }

  signedArea *= 0.5;
  if (Math.abs(signedArea) < 1e-5) {
    const xAvg = pts.reduce((s, p) => s + p.x, 0) / n;
    const yAvg = pts.reduce((s, p) => s + p.y, 0) / n;
    return { x: Number(xAvg.toFixed(2)), y: Number(yAvg.toFixed(2)) };
  }

  return {
    x: Number((cx / (6 * signedArea)).toFixed(2)),
    y: Number((cy / (6 * signedArea)).toFixed(2))
  };
}

// Fast point-in-polygon check on already-tessellated vertices
function isPointInsideTessellatedPolygon(point: Point2D, pts: Point2D[]): boolean {
  let inside = false;
  const n = pts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;

    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Point-in-polygon raycasting algorithm (tessellates curved walls first)
export function isPointInsidePolygon(point: Point2D, polygon: Point2D[]): boolean {
  const pts = hasCurvedGeometry(polygon) ? tessellatePolygon(polygon, 12, true) : polygon;
  return isPointInsideTessellatedPolygon(point, pts);
}

// Zone & CommonSubType classification by room title / keyword (including GKB № 52 TX nomenclature)
export function classifyHospitalZone(name: string): {
  zone: HospitalZone;
  cleanliness: CleanlinessClass;
  commonSubType: CommonSubType;
} {
  const lower = name.toLowerCase();

  if (
    lower.includes('лестниц') ||
    lower.includes('лк-') ||
    lower.includes('лк ') ||
    lower.includes('stair') ||
    lower.includes('марш')
  ) {
    return { zone: 'vertical', cleanliness: 'conditional', commonSubType: 'staircase' };
  }
  if (
    lower.includes('лифт') ||
    lower.includes('elevator') ||
    lower.includes('шахт') ||
    lower.includes('подъемник')
  ) {
    return { zone: 'vertical', cleanliness: 'conditional', commonSubType: 'elevator' };
  }
  if (
    lower.includes('санузел') ||
    lower.includes('туалет') ||
    lower.includes('душ') ||
    lower.includes('уборн') ||
    lower.includes('мгн') ||
    lower.includes('санпропуск') ||
    lower.includes('куи') ||
    lower.includes('су ') ||
    lower.includes('wc')
  ) {
    return { zone: 'sanitary', cleanliness: 'dirty', commonSubType: 'restroom' };
  }
  if (
    lower.includes('холл') ||
    lower.includes('вестибюл') ||
    lower.includes('зал ожидан') ||
    lower.includes('атриум') ||
    lower.includes('ресепшн') ||
    lower.includes('триаж') ||
    lower.includes('экспедиц')
  ) {
    return { zone: 'circulation', cleanliness: 'conditional', commonSubType: 'hall' };
  }
  if (
    lower.includes('опер') ||
    lower.includes('surgery') ||
    lower.includes('наркоз') ||
    lower.includes('цитостат') ||
    lower.includes('асептич')
  ) {
    return { zone: 'surgery', cleanliness: 'sterile', commonSubType: 'standard' };
  }
  if (
    lower.includes('реаним') ||
    lower.includes('орит') ||
    lower.includes('интенсив') ||
    lower.includes('icu') ||
    lower.includes('противошок') ||
    lower.includes('диализ') ||
    lower.includes('кт ') ||
    lower.includes('томограф')
  ) {
    return { zone: 'icu', cleanliness: 'clean', commonSubType: 'standard' };
  }
  if (
    lower.includes('палат') ||
    lower.includes('ward') ||
    lower.includes('бокс') ||
    lower.includes('смотр') ||
    lower.includes('процедур')
  ) {
    return { zone: 'ward', cleanliness: 'conditional', commonSubType: 'standard' };
  }
  if (
    lower.includes('врач') ||
    lower.includes('ординатор') ||
    lower.includes('сестр') ||
    lower.includes('кабинет') ||
    lower.includes('лабор') ||
    lower.includes('пост') ||
    lower.includes('гардероб') ||
    lower.includes('персонал') ||
    lower.includes('рентген')
  ) {
    return { zone: 'staff', cleanliness: 'conditional', commonSubType: 'standard' };
  }
  if (
    lower.includes('коридор') ||
    lower.includes('проход') ||
    lower.includes('проезд') ||
    lower.includes('тамбур') ||
    lower.includes('corridor') ||
    lower.includes('галерея')
  ) {
    return { zone: 'circulation', cleanliness: 'conditional', commonSubType: 'hall' };
  }
  if (
    lower.includes('стерил') ||
    lower.includes('цсо') ||
    lower.includes('склад') ||
    lower.includes('кладов') ||
    lower.includes('сервер') ||
    lower.includes('техн') ||
    lower.includes('венткамер') ||
    lower.includes('итп') ||
    lower.includes('насосн') ||
    lower.includes('электрощит') ||
    lower.includes('компрессор') ||
    lower.includes('бельепровод') ||
    lower.includes('мойк') ||
    lower.includes('дезинфекц') ||
    lower.includes('антибиот') ||
    lower.includes('шлюз')
  ) {
    return { zone: 'utility', cleanliness: 'clean', commonSubType: 'standard' };
  }

  return { zone: 'circulation', cleanliness: 'conditional', commonSubType: 'standard' };
}

export interface ParseResult {
  floorPlan: FloorPlan;
  stats: {
    format: 'DXF' | 'DWG';
    cadVersion?: string;
    linesCount: number;
    polylinesCount: number;
    curvedWallsCount: number;
    textsCount: number;
    recognizedRoomsCount: number;
    totalArea: number;
    detectedScale: string;
  };
}

interface CandidatePolygon {
  points: Point2D[];
  tessPts: Point2D[];
  area: number;
  perimeter: number;
  center: Point2D;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  layer: string;
}

/**
 * Helper: Removes consecutive duplicate vertices closer than `eps`
 */
function deduplicatePolygonVertices(pts: Point2D[], eps = 0.02): Point2D[] {
  if (pts.length < 2) return pts;
  const out: Point2D[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1];
    if (Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y) >= eps) {
      out.push(pts[i]);
    }
  }
  if (
    out.length > 2 &&
    Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < eps
  ) {
    out.pop();
  }
  return out;
}

/**
 * Helper: Checks if a 2D point lies inside any already-recognized room (using AABB + raycast)
 */
function isPointInsideAnyRoom(
  pt: Point2D,
  roomsWithBounds: {
    room: Room;
    tessPts: Point2D[];
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  }[]
): boolean {
  for (let i = 0; i < roomsWithBounds.length; i++) {
    const rb = roomsWithBounds[i];
    if (
      pt.x >= rb.minX &&
      pt.x <= rb.maxX &&
      pt.y >= rb.minY &&
      pt.y <= rb.maxY &&
      isPointInsideTessellatedPolygon(pt, rb.tessPts)
    ) {
      return true;
    }
  }
  return false;
}

/**
/**
 * Reconstructs missing 3D rooms from 2D wall underlay (`cadLines`) and labels (`cadTexts`)
 * in uncovered regions of a floor plan (Stages 3 & 4: Text-Seeded Raycasting + Wall-Cell Detection),
 * enforcing coaxial alignment (`соосность`) with existing rooms and canonical structural wall axes.
 */
export function reconstructRoomsFromWallUnderlay(
  normalizedLines: CADLine[],
  normalizedTexts: CADText[],
  existingRooms: Room[],
  usedTexts: Set<string>,
  floorId: string,
  targetFloorNumber: number
): Room[] {
  const newlyRecognized: Room[] = [];

  // Build spatial bounds list for existing + newly added rooms
  const activeRoomsBounds = existingRooms.map(room => {
    const tessPts = hasCurvedGeometry(room.polygon)
      ? tessellatePolygon(room.polygon, 12, true)
      : room.polygon;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of tessPts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { room, tessPts, minX, maxX, minY, maxY };
  });

  // Extract axis-aligned wall segments (vertical & horizontal), excluding non-wall layers
  // (axes, dimensions, doors, windows, furniture, equipment, sanitary fixtures, hatches)
  const rawVWalls: { x: number; minY: number; maxY: number; len: number }[] = [];
  const rawHWalls: { y: number; minX: number; maxX: number; len: number }[] = [];

  const isNonWallLayer = (layerName: string): boolean => {
    const u = layerName.toUpperCase();
    return (
      u.includes('ОСИ') ||
      u.includes('AXIS') ||
      u.includes('GRID') ||
      u.includes('РАЗМЕР') ||
      u.includes('DIM') ||
      u.includes('FURN') ||
      u.includes('МЕБЕЛЬ') ||
      u.includes('ОБОРУД') ||
      u.includes('EQUIP') ||
      u.includes('ТЕХНОЛОГ') ||
      u.includes('САНТЕХ') ||
      u.includes('ДВЕР') ||
      u.includes('DOOR') ||
      u.includes('ОКН') ||
      u.includes('WIN') ||
      u.includes('TEXT') ||
      u.includes('ТЕКСТ') ||
      u.includes('STAMP') ||
      u.includes('ШТАМП')
    );
  };

  normalizedLines.forEach(line => {
    if (isNonWallLayer(line.layer)) return;

    const dx = Math.abs(line.end.x - line.start.x);
    const dy = Math.abs(line.end.y - line.start.y);
    const len = Math.hypot(dx, dy);
    // Ignore short interior fixture/symbol lines (< 0.75m) so raycasts don't stop on sinks/tables/columns
    if (len < 0.75) return;

    // Vertical wall segment
    if (dx <= Math.max(0.22, dy * 0.09)) {
      rawVWalls.push({
        x: (line.start.x + line.end.x) * 0.5,
        minY: Math.min(line.start.y, line.end.y),
        maxY: Math.max(line.start.y, line.end.y),
        len
      });
    }
    // Horizontal wall segment
    if (dy <= Math.max(0.22, dx * 0.09)) {
      rawHWalls.push({
        y: (line.start.y + line.end.y) * 0.5,
        minX: Math.min(line.start.x, line.end.x),
        maxX: Math.max(line.start.x, line.end.x),
        len
      });
    }
  });

  // Also feed already-recognized room edges into the wall network so reconstructed central rooms
  // align coaxially with the boundaries of neighboring recognized rooms!
  existingRooms.forEach(r => {
    const pts = r.polygon;
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      const dx = Math.abs(p2.x - p1.x);
      const dy = Math.abs(p2.y - p1.y);
      const len = Math.hypot(dx, dy);
      if (len < 0.8) continue;
      if (dx <= 0.15) {
        rawVWalls.push({
          x: (p1.x + p2.x) * 0.5,
          minY: Math.min(p1.y, p2.y),
          maxY: Math.max(p1.y, p2.y),
          len
        });
      } else if (dy <= 0.15) {
        rawHWalls.push({
          y: (p1.y + p2.y) * 0.5,
          minX: Math.min(p1.x, p2.x),
          maxX: Math.max(p1.x, p2.x),
          len
        });
      }
    }
  });

  if (rawVWalls.length < 2 || rawHWalls.length < 2) {
    return newlyRecognized;
  }

  // Cluster parallel wall lines (e.g. 120mm-250mm double-line partitions) into canonical coaxial wall axes
  // so rooms along the same corridor or structural grid share exact coaxial coordinates.
  const clusterWallCoords = (coordsWithWeights: { pos: number; weight: number }[], snapTol = 0.24): number[] => {
    if (coordsWithWeights.length === 0) return [];
    const sorted = [...coordsWithWeights].sort((a, b) => a.pos - b.pos);
    const clusters: { sumWeighted: number; sumWeight: number; center: number }[] = [];

    for (const item of sorted) {
      const last = clusters[clusters.length - 1];
      if (last && Math.abs(item.pos - last.center) <= snapTol) {
        last.sumWeighted += item.pos * item.weight;
        last.sumWeight += item.weight;
        last.center = last.sumWeighted / last.sumWeight;
      } else {
        clusters.push({
          sumWeighted: item.pos * item.weight,
          sumWeight: item.weight,
          center: item.pos
        });
      }
    }
    return clusters.map(c => Number(c.center.toFixed(2)));
  };

  const canonicalXAxes = clusterWallCoords(rawVWalls.map(w => ({ pos: w.x, weight: w.len })), 0.24);
  const canonicalYAxes = clusterWallCoords(rawHWalls.map(w => ({ pos: w.y, weight: w.len })), 0.24);

  const snapToAxis = (val: number, axes: number[], maxSnap = 0.26): number => {
    let best = val;
    let bestDist = maxSnap;
    for (let i = 0; i < axes.length; i++) {
      const d = Math.abs(val - axes[i]);
      if (d <= bestDist) {
        bestDist = d;
        best = axes[i];
      }
    }
    return Number(best.toFixed(2));
  };

  // Snap raw wall segments onto the canonical coaxial axes
  const vWalls = rawVWalls.map(vw => ({
    ...vw,
    x: snapToAxis(vw.x, canonicalXAxes)
  }));
  const hWalls = rawHWalls.map(hw => ({
    ...hw,
    y: snapToAxis(hw.y, canonicalYAxes)
  }));

  // Helper: Find enclosing wall rectangle around an uncovered point (cx, cy)
  const findEnclosingCell = (
    cx: number,
    cy: number,
    maxSearchDist: number,
    requireStrongWallCoverage: boolean
  ): { leftX: number; rightX: number; bottomY: number; topY: number } | null => {
    let bestLeftDist = maxSearchDist;
    let bestRightDist = maxSearchDist;
    let bestBottomDist = maxSearchDist;
    let bestTopDist = maxSearchDist;

    let foundLeft = false;
    let foundRight = false;
    let foundBottom = false;
    let foundTop = false;

    // Tolerance along ray for doorway openings (0.95m)
    const doorTol = 0.95;

    for (let i = 0; i < vWalls.length; i++) {
      const vw = vWalls[i];
      if (cy >= vw.minY - doorTol && cy <= vw.maxY + doorTol) {
        const dist = cx - vw.x;
        if (dist > 0.55 && dist < bestLeftDist) {
          bestLeftDist = dist;
          foundLeft = true;
        } else if (dist < -0.55 && -dist < bestRightDist) {
          bestRightDist = -dist;
          foundRight = true;
        }
      }
    }

    for (let i = 0; i < hWalls.length; i++) {
      const hw = hWalls[i];
      if (cx >= hw.minX - doorTol && cx <= hw.maxX + doorTol) {
        const dist = cy - hw.y;
        if (dist > 0.55 && dist < bestBottomDist) {
          bestBottomDist = dist;
          foundBottom = true;
        } else if (dist < -0.55 && -dist < bestTopDist) {
          bestTopDist = -dist;
          foundTop = true;
        }
      }
    }

    if (!foundLeft || !foundRight || !foundBottom || !foundTop) {
      return null;
    }

    const leftX = snapToAxis(cx - bestLeftDist, canonicalXAxes);
    const rightX = snapToAxis(cx + bestRightDist, canonicalXAxes);
    const bottomY = snapToAxis(cy - bestBottomDist, canonicalYAxes);
    const topY = snapToAxis(cy + bestTopDist, canonicalYAxes);

    const w = rightX - leftX;
    const h = topY - bottomY;
    const area = w * h;

    if (w < 1.3 || h < 1.3 || area < 2.0 || area > 1200) {
      return null;
    }

    // Check that the cell center and 4 inset quadrant points do not collide with existing rooms
    const midX = (leftX + rightX) * 0.5;
    const midY = (bottomY + topY) * 0.5;
    const testPts: Point2D[] = [
      { x: midX, y: midY },
      { x: leftX + w * 0.25, y: bottomY + h * 0.25 },
      { x: leftX + w * 0.75, y: bottomY + h * 0.25 },
      { x: leftX + w * 0.75, y: bottomY + h * 0.75 },
      { x: leftX + w * 0.25, y: bottomY + h * 0.75 }
    ];

    for (const tp of testPts) {
      if (isPointInsideAnyRoom(tp, activeRoomsBounds)) {
        return null;
      }
    }

    // Also ensure no existing room's center lies inside this new cell
    for (const rb of activeRoomsBounds) {
      if (
        rb.room.center.x > leftX + 0.2 &&
        rb.room.center.x < rightX - 0.2 &&
        rb.room.center.y > bottomY + 0.2 &&
        rb.room.center.y < topY - 0.2
      ) {
        return null;
      }
    }

    // Always verify minimum wall coverage on all 4 sides so a single small interior line
    // cannot create a misaligned fake boundary
    const edgeTol = 0.42;
    let leftCov = 0,
      rightCov = 0,
      bottomCov = 0,
      topCov = 0;

    for (const vw of vWalls) {
      const overlap = Math.max(0, Math.min(topY, vw.maxY) - Math.max(bottomY, vw.minY));
      if (overlap > 0) {
        if (Math.abs(vw.x - leftX) <= edgeTol) leftCov += overlap;
        if (Math.abs(vw.x - rightX) <= edgeTol) rightCov += overlap;
      }
    }
    for (const hw of hWalls) {
      const overlap = Math.max(0, Math.min(rightX, hw.maxX) - Math.max(leftX, hw.minX));
      if (overlap > 0) {
        if (Math.abs(hw.y - bottomY) <= edgeTol) bottomCov += overlap;
        if (Math.abs(hw.y - topY) <= edgeTol) topCov += overlap;
      }
    }

    const minRatio = requireStrongWallCoverage ? 0.42 : 0.28;
    if (
      leftCov < h * minRatio ||
      rightCov < h * minRatio ||
      bottomCov < w * minRatio ||
      topCov < w * minRatio
    ) {
      return null;
    }

    return { leftX, rightX, bottomY, topY };
  };

  let roomSeq = existingRooms.length + 1;

  const commitCellRoom = (cell: {
    leftX: number;
    rightX: number;
    bottomY: number;
    topY: number;
  }) => {
    const poly: Point2D[] = [
      { x: Number(cell.leftX.toFixed(2)), y: Number(cell.bottomY.toFixed(2)) },
      { x: Number(cell.rightX.toFixed(2)), y: Number(cell.bottomY.toFixed(2)) },
      { x: Number(cell.rightX.toFixed(2)), y: Number(cell.topY.toFixed(2)) },
      { x: Number(cell.leftX.toFixed(2)), y: Number(cell.topY.toFixed(2)) }
    ];

    // Collect any unused texts inside this cell
    const cellTexts: CADText[] = [];
    for (const t of normalizedTexts) {
      if (
        !usedTexts.has(t.id) &&
        t.position.x >= cell.leftX - 0.15 &&
        t.position.x <= cell.rightX + 0.15 &&
        t.position.y >= cell.bottomY - 0.15 &&
        t.position.y <= cell.topY + 0.15
      ) {
        cellTexts.push(t);
        usedTexts.add(t.id);
      }
    }

    const parsedLabel = parseRoomCodeAndNameFromTexts(
      cellTexts,
      targetFloorNumber,
      roomSeq
    );

    const w = cell.rightX - cell.leftX;
    const h = cell.topY - cell.bottomY;
    const aspect = Math.max(w, h) / Math.max(0.1, Math.min(w, h));
    const area = Number((w * h).toFixed(1));
    const perimeter = Number((2 * (w + h)).toFixed(1));

    let finalName = parsedLabel.roomName;
    if (!cellTexts.length && aspect >= 3.2 && area >= 14) {
      finalName = `Коридор / Холл №${parsedLabel.roomCode}`;
    }

    const { zone, cleanliness, commonSubType } = classifyHospitalZone(
      `${parsedLabel.roomCode} ${finalName}`
    );

    const newRoom: Room = {
      id: `rec_room_${Date.now()}_${roomSeq}`,
      code: parsedLabel.roomCode,
      name: finalName,
      zone,
      cleanliness,
      commonSubType,
      polygon: poly,
      area,
      perimeter,
      height: zone === 'surgery' || zone === 'icu' ? 3.4 : 3.2,
      center: {
        x: Number(((cell.leftX + cell.rightX) * 0.5).toFixed(2)),
        y: Number(((cell.bottomY + cell.topY) * 0.5).toFixed(2))
      },
      floorId,
      isAutoDetected: true
    };

    newlyRecognized.push(newRoom);
    activeRoomsBounds.push({
      room: newRoom,
      tessPts: poly,
      minX: cell.leftX,
      maxX: cell.rightX,
      minY: cell.bottomY,
      maxY: cell.topY
    });
    roomSeq++;
  };

  // Stage 3: Uncovered Text-Stamp Seeded Wall Raycasting
  // Cluster nearby unused text labels (within 1.8m) so multi-line room stamps (No + Name + Area) act as a single room seed
  const unusedTexts = normalizedTexts.filter(t => {
    if (usedTexts.has(t.id)) return false;
    const upperLayer = t.layer.toUpperCase();
    if (
      upperLayer.includes('ОСИ') ||
      upperLayer.includes('AXIS') ||
      upperLayer.includes('РАЗМЕР') ||
      upperLayer.includes('DIM')
    ) {
      return false;
    }
    const txt = t.text.trim();
    if (!txt) return false;
    // Skip single-character axis bubble markers
    if (txt.length === 1 && /^[А-ЯA-Z]$/i.test(txt)) return false;
    return !isPointInsideAnyRoom(t.position, activeRoomsBounds);
  });

  const visitedSeedIds = new Set<string>();
  for (let i = 0; i < unusedTexts.length; i++) {
    const seed = unusedTexts[i];
    if (visitedSeedIds.has(seed.id) || usedTexts.has(seed.id)) continue;

    // Group nearby texts belonging to the same room stamp
    const cluster: CADText[] = [seed];
    visitedSeedIds.add(seed.id);
    for (let j = i + 1; j < unusedTexts.length; j++) {
      const other = unusedTexts[j];
      if (!visitedSeedIds.has(other.id)) {
        if (
          Math.hypot(other.position.x - seed.position.x, other.position.y - seed.position.y) <=
          1.85
        ) {
          cluster.push(other);
          visitedSeedIds.add(other.id);
        }
      }
    }

    const avgX = cluster.reduce((s, c) => s + c.position.x, 0) / cluster.length;
    const avgY = cluster.reduce((s, c) => s + c.position.y, 0) / cluster.length;

    if (isPointInsideAnyRoom({ x: avgX, y: avgY }, activeRoomsBounds)) continue;

    const cell = findEnclosingCell(avgX, avgY, 28.0, false);
    if (cell) {
      commitCellRoom(cell);
    }
  }

  // Stage 4: Unlabeled Interior Wall-Cell Discovery (fills empty central zones bounded by walls even without text stamps)
  let minWallX = Infinity,
    maxWallX = -Infinity,
    minWallY = Infinity,
    maxWallY = -Infinity;
  vWalls.forEach(vw => {
    if (vw.x < minWallX) minWallX = vw.x;
    if (vw.x > maxWallX) maxWallX = vw.x;
  });
  hWalls.forEach(hw => {
    if (hw.y < minWallY) minWallY = hw.y;
    if (hw.y > maxWallY) maxWallY = hw.y;
  });

  if (isFinite(minWallX) && isFinite(minWallY)) {
    const spanX = maxWallX - minWallX;
    const spanY = maxWallY - minWallY;
    // Adaptive grid step (~2.2m to 3.5m) so scanning takes < 4ms even on 150m floors
    const stepX = Math.max(2.2, Math.min(3.6, spanX / 36));
    const stepY = Math.max(2.2, Math.min(3.6, spanY / 28));

    for (let gx = minWallX + stepX * 0.7; gx < maxWallX - stepX * 0.5; gx += stepX) {
      for (let gy = minWallY + stepY * 0.7; gy < maxWallY - stepY * 0.5; gy += stepY) {
        if (isPointInsideAnyRoom({ x: gx, y: gy }, activeRoomsBounds)) continue;
        const cell = findEnclosingCell(gx, gy, 24.0, true);
        if (cell) {
          commitCellRoom(cell);
        }
      }
    }
  }

  return newlyRecognized;
}

/**
 * Helper: Extracts room code and human-readable room name from a list of CADText labels inside a room
 */
function parseRoomCodeAndNameFromTexts(
  insideTexts: CADText[],
  targetFloorNumber: number,
  fallbackIndex: number
): { roomCode: string; roomName: string } {
  const defaultCode = String(targetFloorNumber * 100 + fallbackIndex);
  if (insideTexts.length === 0) {
    return { roomCode: defaultCode, roomName: `Помещение №${defaultCode}` };
  }

  // Separate pure area strings (e.g. "S=18.4", "24,5 м2", "18.2") from room codes and names
  const nonAreaTokens: string[] = [];
  let candidateCode: string | null = null;

  insideTexts.forEach(t => {
    const raw = t.text.trim();
    if (!raw) return;
    // Ignore pure area strings like "S=14.2" or "18,5 м2"
    if (/^S\s*=/i.test(raw) || /^[0-9]+[.,][0-9]+\s*(?:м2|м²|m2)?$/i.test(raw)) {
      return;
    }
    // Check if token is a standalone room number/stamp (e.g. "105", "1.14", "ЛК-1", "Б12")
    if (
      !candidateCode &&
      /^(?:ЛК|СУ|МГН|ЦСО|КУИ|ИТП|[А-ЯA-Z]?-?[0-9]{1,4}(?:[.\-/][0-9А-ЯA-Z]{1,3})?)$/i.test(raw)
    ) {
      candidateCode = raw;
      return;
    }
    nonAreaTokens.push(raw);
  });

  const combinedText = nonAreaTokens.join(' ').trim();
  let roomCode = candidateCode || defaultCode;
  let roomName =
    combinedText || (candidateCode ? `Помещение №${candidateCode}` : `Помещение №${defaultCode}`);

  if (!candidateCode && combinedText) {
    const codeMatch = combinedText.match(
      /^((?:ЛК|СУ|МГН|ЦСО|КУИ|ИТП|[0-9]{1,4})[А-Яа-яA-Za-z0-9.\-/]*)\s+(.+)$/i
    );
    if (codeMatch) {
      roomCode = codeMatch[1];
      roomName = codeMatch[2].trim();
    }
  }

  return { roomCode, roomName };
}

/**
 * Public utility to run the multi-stage wall underlay room recognizer on an already loaded FloorPlan
 */
export function reconstructMissingRoomsFromUnderlay(floorPlan: FloorPlan): {
  updatedPlan: FloorPlan;
  addedCount: number;
} {
  const usedTexts = new Set<string>();

  // Mark texts already inside existing rooms
  floorPlan.rooms.forEach(r => {
    const tess = hasCurvedGeometry(r.polygon)
      ? tessellatePolygon(r.polygon, 12, true)
      : r.polygon;
    floorPlan.cadTexts.forEach(t => {
      if (isPointInsideTessellatedPolygon(t.position, tess)) {
        usedTexts.add(t.id);
      }
    });
  });

  const addedRooms = reconstructRoomsFromWallUnderlay(
    floorPlan.cadLines,
    floorPlan.cadTexts,
    floorPlan.rooms,
    usedTexts,
    floorPlan.id,
    floorPlan.floorNumber
  );

  if (addedRooms.length === 0) {
    return { updatedPlan: floorPlan, addedCount: 0 };
  }

  return {
    updatedPlan: {
      ...floorPlan,
      rooms: [...floorPlan.rooms, ...addedRooms]
    },
    addedCount: addedRooms.length
  };
}

/**
 * Checks if a 2D planar CAD entity has a mirrored OCS extrusion normal (Z < -0.5).
 * In AutoCAD OCS, when extrusionDirection.z === -1, the entity's X axis is inverted (`x_wcs = -x_ocs`).
 */
function hasMirroredExtrusionZ(entity: any): boolean {
  const ez =
    entity?.extrusionDirection?.z ??
    entity?.extrusion?.z ??
    entity?.normal?.z ??
    1;
  return typeof ez === 'number' && ez < -0.5;
}

/**
 * Shared CAD Geometry & 4-Stage Hybrid Room Recognition Engine used by both DXF and DWG parsers.
 * Preserves exact coaxial alignment, OCS-to-WCS transformations, and North-Up orientation (`Y_cad` -> `-Z_3D`).
 */
function buildFloorPlanFromEntities(
  entities: any[],
  fileName: string,
  targetFloorNumber: number,
  targetElevation: number,
  format: 'DXF' | 'DWG',
  cadVersion?: string
): ParseResult {
  const rawCadLines: CADLine[] = [];
  const rawCadTexts: CADText[] = [];
  const layerCounts: Record<string, number> = {};
  let curvedWallsCount = 0;

  const rawPolylines: { points: Point2D[]; layer: string; explicitClosed: boolean }[] = [];

  entities.forEach((entity: any, index: number) => {
    if (!entity || entity.inPaperSpace || entity.type === 'VIEWPORT') return;
    const layer = String(entity.layer || '0');
    const upperLayer = layer.toUpperCase();
    // Skip non-geometric AutoCAD system layer DEFPOINTS
    if (upperLayer === 'DEFPOINTS') return;

    layerCounts[layer] = (layerCounts[layer] || 0) + 1;
    const flipOcsX = hasMirroredExtrusionZ(entity);

    if (entity.type === 'LINE') {
      // In AutoCAD, LINE endpoints are always stored in WCS
      const x1 = entity.startPoint?.x ?? entity.vertices?.[0]?.x ?? entity.start?.x ?? 0;
      const y1 = entity.startPoint?.y ?? entity.vertices?.[0]?.y ?? entity.start?.y ?? 0;
      const x2 = entity.endPoint?.x ?? entity.vertices?.[1]?.x ?? entity.end?.x ?? 0;
      const y2 = entity.endPoint?.y ?? entity.vertices?.[1]?.y ?? entity.end?.y ?? 0;

      if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
        return;
      }

      rawCadLines.push({
        id: `cad_line_${index}`,
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        layer
      });
    } else if (entity.type === 'MLINE' && Array.isArray(entity.vertices) && entity.vertices.length >= 2) {
      for (let i = 0; i < entity.vertices.length - 1; i++) {
        const v1 = entity.vertices[i]?.vertex || entity.vertices[i];
        const v2 = entity.vertices[i + 1]?.vertex || entity.vertices[i + 1];
        if (v1 && v2 && Number.isFinite(v1.x) && Number.isFinite(v1.y) && Number.isFinite(v2.x) && Number.isFinite(v2.y)) {
          rawCadLines.push({
            id: `cad_mline_${index}_${i}`,
            start: { x: v1.x, y: v1.y },
            end: { x: v2.x, y: v2.y },
            layer
          });
        }
      }
    } else if (
      entity.type === 'LWPOLYLINE' ||
      entity.type === 'POLYLINE' ||
      entity.type === 'POLYLINE2D' ||
      entity.type === 'POLYLINE3D'
    ) {
      const vertices = entity.vertices || [];
      if (vertices.length >= 2) {
        const polyPts: Point2D[] = [];
        for (let i = 0; i < vertices.length; i++) {
          const rawVx = vertices[i].x ?? vertices[i].point?.x ?? 0;
          const rawVy = vertices[i].y ?? vertices[i].point?.y ?? 0;
          if (!Number.isFinite(rawVx) || !Number.isFinite(rawVy)) continue;

          // Apply OCS-to-WCS X negation if entity has extrusionDirection.z === -1
          const vx = flipOcsX ? -rawVx : rawVx;
          const vy = rawVy;
          const rawBulge = vertices[i].bulge ?? 0;
          const vBulge = flipOcsX ? -rawBulge : rawBulge;
          if (Math.abs(vBulge) > 0.02) curvedWallsCount++;

          polyPts.push({
            x: vx,
            y: vy,
            bulge: Math.abs(vBulge) > 0.02 ? vBulge : undefined
          });
        }

        if (polyPts.length < 2) return;

        // Check explicit closed flag: 0x200 (512) in DWG LWPOLYLINE, 0x1 (1) in DXF / POLYLINE2D
        const flagVal =
          typeof entity.flag === 'number'
            ? entity.flag
            : typeof entity.flags === 'number'
            ? entity.flags
            : 0;
        const explicitClosed =
          Boolean(entity.shape || entity.closed || entity.isClosed) ||
          (flagVal & 0x200) !== 0 ||
          (flagVal & 0x1) !== 0;

        // Tessellate curved polyline segments for CAD underlay rendering
        const displayPts = hasCurvedGeometry(polyPts)
          ? tessellatePolygon(polyPts, 12, explicitClosed)
          : polyPts;

        for (let i = 0; i < displayPts.length - 1; i++) {
          rawCadLines.push({
            id: `cad_poly_${index}_${i}`,
            start: { x: displayPts[i].x, y: displayPts[i].y },
            end: { x: displayPts[i + 1].x, y: displayPts[i + 1].y },
            layer
          });
        }

        if (explicitClosed && displayPts.length >= 2) {
          rawCadLines.push({
            id: `cad_poly_${index}_close`,
            start: {
              x: displayPts[displayPts.length - 1].x,
              y: displayPts[displayPts.length - 1].y
            },
            end: { x: displayPts[0].x, y: displayPts[0].y },
            layer
          });
        }

        // Store all polylines with >= 3 vertices so closure tolerance can be evaluated in normalized meters
        if (polyPts.length >= 3) {
          rawPolylines.push({ points: polyPts, layer, explicitClosed });
        }
      }
    } else if (entity.type === 'HATCH' && Array.isArray(entity.boundaryPaths)) {
      // Extract closed room contours from HATCH boundary paths
      entity.boundaryPaths.forEach((path: any, pathIdx: number) => {
        if (Array.isArray(path?.vertices) && path.vertices.length >= 3) {
          const hatchPts: Point2D[] = [];
          path.vertices.forEach((v: any) => {
            const rawVx = v.x ?? v.point?.x ?? 0;
            const rawVy = v.y ?? v.point?.y ?? 0;
            if (!Number.isFinite(rawVx) || !Number.isFinite(rawVy)) return;
            const vx = flipOcsX ? -rawVx : rawVx;
            const vy = rawVy;
            const rawBulge = v.bulge ?? 0;
            const vBulge = flipOcsX ? -rawBulge : rawBulge;
            if (Math.abs(vBulge) > 0.02) curvedWallsCount++;
            hatchPts.push({
              x: vx,
              y: vy,
              bulge: Math.abs(vBulge) > 0.02 ? vBulge : undefined
            });
          });
          if (hatchPts.length >= 3) {
            rawPolylines.push({ points: hatchPts, layer, explicitClosed: true });
          }
        } else if (Array.isArray(path?.edges) && path.edges.length >= 3) {
          const edgePts: Point2D[] = [];
          path.edges.forEach((edge: any, eIdx: number) => {
            if (edge?.start && edge?.end && Number.isFinite(edge.start.x) && Number.isFinite(edge.start.y)) {
              const sx = flipOcsX ? -edge.start.x : edge.start.x;
              const sy = edge.start.y;
              const ex = flipOcsX ? -edge.end.x : edge.end.x;
              const ey = edge.end.y;
              edgePts.push({ x: sx, y: sy });
              rawCadLines.push({
                id: `cad_hatch_${index}_${pathIdx}_${eIdx}`,
                start: { x: sx, y: sy },
                end: { x: ex, y: ey },
                layer
              });
            }
          });
          if (edgePts.length >= 3) {
            rawPolylines.push({ points: edgePts, layer, explicitClosed: true });
          }
        }
      });
    } else if (entity.type === 'ARC' || entity.type === 'CIRCLE') {
      curvedWallsCount++;
      const rawCx = entity.center?.x ?? 0;
      const rawCy = entity.center?.y ?? 0;
      const r = entity.radius ?? 1;
      if (!Number.isFinite(rawCx) || !Number.isFinite(rawCy) || !Number.isFinite(r) || r <= 0) return;

      const cx = flipOcsX ? -rawCx : rawCx;
      const cy = rawCy;
      let startAngle = entity.type === 'ARC' ? (entity.startAngle ?? 0) : 0;
      let endAngle = entity.type === 'ARC' ? (entity.endAngle ?? Math.PI * 2) : Math.PI * 2;
      if (flipOcsX && entity.type === 'ARC') {
        const origStart = startAngle;
        startAngle = Math.PI - endAngle;
        endAngle = Math.PI - origStart;
      }
      if (endAngle <= startAngle) endAngle += Math.PI * 2;
      const steps = 18;
      const dTheta = (endAngle - startAngle) / steps;

      const circlePts: Point2D[] = [];
      for (let i = 0; i < steps; i++) {
        const a1 = startAngle + i * dTheta;
        const a2 = startAngle + (i + 1) * dTheta;
        const p1 = { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) };
        const p2 = { x: cx + r * Math.cos(a2), y: cy + r * Math.sin(a2) };
        circlePts.push(p1);
        rawCadLines.push({
          id: `cad_arc_${index}_${i}`,
          start: p1,
          end: p2,
          layer
        });
      }
      if (entity.type === 'CIRCLE' && circlePts.length >= 6) {
        rawPolylines.push({ points: circlePts, layer, explicitClosed: true });
      }
    } else if (
      entity.type === 'TEXT' ||
      entity.type === 'MTEXT' ||
      entity.type === 'ATTRIB'
    ) {
      // Safely unwrap DwgTextBase object when entity is an ATTRIB from @mlightcad/libredwg-web
      const textObj =
        typeof entity.text === 'object' && entity.text !== null ? entity.text : null;
      const rawTextStr =
        typeof entity.text === 'string'
          ? entity.text
          : typeof textObj?.text === 'string'
          ? textObj.text
          : typeof entity.mtext?.text === 'string'
          ? entity.mtext.text
          : typeof entity.string === 'string'
          ? entity.string
          : '';

      const cleaned = cleanCadText(rawTextStr);
      if (cleaned) {
        // In AutoCAD DWG/DXF, endPoint (alignment_pt, group 11/21) is ONLY valid when halign != 0 or valign != 0!
        const halign = textObj?.halign ?? entity.halign ?? 0;
        const valign = textObj?.valign ?? entity.valign ?? 0;
        const useAlignPt =
          (halign !== 0 || valign !== 0) &&
          (textObj?.endPoint || entity.endPoint || entity.alignmentPoint);

        const ptSource = useAlignPt
          ? textObj?.endPoint || entity.endPoint || entity.alignmentPoint
          : textObj?.startPoint ||
            entity.insertionPoint ||
            entity.startPoint ||
            entity.position ||
            textObj?.endPoint ||
            entity.endPoint;

        const rawTx = ptSource?.x ?? 0;
        const rawTy = ptSource?.y ?? 0;
        if (!Number.isFinite(rawTx) || !Number.isFinite(rawTy)) return;

        const tx = flipOcsX ? -rawTx : rawTx;
        const ty = rawTy;

        const rawHeight =
          textObj?.textHeight || entity.textHeight || entity.height || 1.0;

        rawCadTexts.push({
          id: `cad_txt_${index}`,
          text: cleaned,
          position: { x: tx, y: ty },
          height: typeof rawHeight === 'number' ? rawHeight : 1.0,
          layer
        });
      }
    }
  });

  // ============================================================================
  // ROBUST BUILDING FOOTPRINT BOUNDING BOX (Outlier & Sheet-Frame Rejection)
  // ============================================================================
  // Collect all structural coordinates to find the main building cluster and reject stray (0,0) points
  // or distant drawing borders/tables that would skew scale or shift coaxial alignment.
  const allX: number[] = [];
  const allY: number[] = [];
  rawCadLines.forEach(l => {
    const u = l.layer.toUpperCase();
    if (u.includes('РАМКА') || u.includes('ШТАМП') || u.includes('ФОРМАТ') || u.includes('BORDER')) {
      return;
    }
    allX.push(l.start.x, l.end.x);
    allY.push(l.start.y, l.end.y);
  });
  rawPolylines.forEach(p => {
    p.points.forEach(pt => {
      allX.push(pt.x);
      allY.push(pt.y);
    });
  });

  let minX = 0;
  let maxX = 48;
  let minY = 0;
  let maxY = 22;

  if (allX.length >= 4 && allY.length >= 4) {
    const sortedX = [...allX].sort((a, b) => a - b);
    const sortedY = [...allY].sort((a, b) => a - b);

    // Use 2nd and 98th percentiles to identify the core building footprint
    const p02X = sortedX[Math.floor(sortedX.length * 0.02)];
    const p98X = sortedX[Math.min(sortedX.length - 1, Math.floor(sortedX.length * 0.98))];
    const p02Y = sortedY[Math.floor(sortedY.length * 0.02)];
    const p98Y = sortedY[Math.min(sortedY.length - 1, Math.floor(sortedY.length * 0.98))];

    const coreSpanX = Math.max(1, p98X - p02X);
    const coreSpanY = Math.max(1, p98Y - p02Y);

    // Allow generous margin (55% of building span) around core footprint for protruding wings/ramps,
    // while clipping extreme outliers (e.g. a (0,0) point 300m away from the building)
    const validMinX = p02X - coreSpanX * 0.55;
    const validMaxX = p98X + coreSpanX * 0.55;
    const validMinY = p02Y - coreSpanY * 0.55;
    const validMaxY = p98Y + coreSpanY * 0.55;

    let bMinX = Infinity,
      bMaxX = -Infinity,
      bMinY = Infinity,
      bMaxY = -Infinity;

    for (let i = 0; i < allX.length; i++) {
      const x = allX[i];
      const y = allY[i];
      if (x >= validMinX && x <= validMaxX && y >= validMinY && y <= validMaxY) {
        if (x < bMinX) bMinX = x;
        if (x > bMaxX) bMaxX = x;
        if (y < bMinY) bMinY = y;
        if (y > bMaxY) bMaxY = y;
      }
    }

    if (isFinite(bMinX) && isFinite(bMinY)) {
      minX = bMinX;
      maxX = bMaxX;
      minY = bMinY;
      maxY = bMaxY;
    } else {
      minX = sortedX[0];
      maxX = sortedX[sortedX.length - 1];
      minY = sortedY[0];
      maxY = sortedY[sortedY.length - 1];
    }
  }

  // Filter out stray lines/polylines/texts that lie far outside the building footprint envelope
  const spanMarginX = Math.max(20, (maxX - minX) * 0.25);
  const spanMarginY = Math.max(20, (maxY - minY) * 0.25);
  const isInsideBuildingEnvelope = (x: number, y: number) =>
    x >= minX - spanMarginX &&
    x <= maxX + spanMarginX &&
    y >= minY - spanMarginY &&
    y <= maxY + spanMarginY;

  const cadLines = rawCadLines.filter(
    l => isInsideBuildingEnvelope(l.start.x, l.start.y) && isInsideBuildingEnvelope(l.end.x, l.end.y)
  );
  const cadTexts = rawCadTexts.filter(t => isInsideBuildingEnvelope(t.position.x, t.position.y));
  const filteredPolylines = rawPolylines.filter(p =>
    p.points.every(pt => isInsideBuildingEnvelope(pt.x, pt.y))
  );

  // Scale detection
  const rawSpanX = isFinite(maxX - minX) && maxX > minX ? maxX - minX : 48;
  const rawSpanY = isFinite(maxY - minY) && maxY > minY ? maxY - minY : 22;
  let scaleFactor = 1.0;
  let detectedScale = 'Метры (1:1)';

  if (rawSpanX > 500 || rawSpanY > 500) {
    scaleFactor = 0.001; // mm to meters
    detectedScale = 'Миллиметры (мм → м)';
  } else if (rawSpanX > 150 || rawSpanY > 150) {
    scaleFactor = 0.01; // cm to meters
    detectedScale = 'Сантиметры (см → м)';
  }

  const offsetX = isFinite(minX) ? minX : 0;
  const topY = isFinite(maxY) ? maxY : 22;

  // CRITICAL ORIENTATION FIX:
  // In AutoCAD, +X is Right (East) and +Y is Up (North).
  // In Three.js floor plan (XZ plane) and 2D Canvas, +X is Right (East) and +Z/+Y is Down (South).
  // Therefore `y_norm = (topY - y_cad) * scaleFactor` (and `bulge = -bulge`) preserves 1:1 North-Up orientation
  // without vertical mirror reflection!
  const normalizedLines: CADLine[] = cadLines.map(l => ({
    ...l,
    start: {
      x: Number(((l.start.x - offsetX) * scaleFactor).toFixed(2)),
      y: Number(((topY - l.start.y) * scaleFactor).toFixed(2))
    },
    end: {
      x: Number(((l.end.x - offsetX) * scaleFactor).toFixed(2)),
      y: Number(((topY - l.end.y) * scaleFactor).toFixed(2))
    }
  }));

  const normalizedTexts: CADText[] = cadTexts.map(t => ({
    ...t,
    position: {
      x: Number(((t.position.x - offsetX) * scaleFactor).toFixed(2)),
      y: Number(((topY - t.position.y) * scaleFactor).toFixed(2))
    },
    height: Math.max(0.5, Number((t.height * scaleFactor).toFixed(2)))
  }));

  const normalizedPolylines = filteredPolylines.map(p => ({
    layer: p.layer,
    explicitClosed: p.explicitClosed,
    points: deduplicatePolygonVertices(
      p.points.map(pt => ({
        x: Number(((pt.x - offsetX) * scaleFactor).toFixed(2)),
        y: Number(((topY - pt.y) * scaleFactor).toFixed(2)),
        radius: pt.radius ? Number((pt.radius * scaleFactor).toFixed(2)) : undefined,
        // Invert bulge sign because Y axis is reflected from CAD (+Y up) to Plan (+Y/+Z down)
        bulge: pt.bulge ? -pt.bulge : undefined
      }))
    )
  }));

  // ============================================================================
  // 4-STAGE HYBRID ROOM RECOGNITION ENGINE
  // ============================================================================
  const recognizedRooms: Room[] = [];
  const usedTexts = new Set<string>();
  const floorId = `imported_${format.toLowerCase()}_floor_${targetFloorNumber}_${Date.now()}`;

  // Prepare candidate polygons from Stage 1 (Closed & Nearly-Closed Polylines + Hatches)
  // and Stage 2 (Doorway-Interrupted Room Polylines where endpoint gap <= 1.25m)
  const candidates: CandidatePolygon[] = [];

  normalizedPolylines.forEach(poly => {
    if (poly.points.length < 3) return;
    const firstPt = poly.points[0];
    const lastPt = poly.points[poly.points.length - 1];
    const endGap = Math.hypot(firstPt.x - lastPt.x, firstPt.y - lastPt.y);
    const perimeter = calculatePolygonPerimeter(poly.points);

    // Closed if:
    // 1) Explicit closed flag in CAD, OR
    // 2) Endpoint snap gap <= 0.35m (35cm), OR
    // 3) Room wall polyline interrupted only by a single doorway (gap <= 1.25m and gap/perimeter <= 0.15)
    const isEffectivelyClosed =
      poly.explicitClosed ||
      (endGap <= 0.35 && perimeter >= 3.8) ||
      (poly.points.length >= 4 && endGap <= 1.25 && perimeter >= 6.5 && endGap / perimeter <= 0.15);

    if (!isEffectivelyClosed) return;

    const tessPts = hasCurvedGeometry(poly.points)
      ? tessellatePolygon(poly.points, 14, true)
      : poly.points;
    if (tessPts.length < 3) return;

    const area = calculatePolygonArea(tessPts);
    // Support sanitary/shaft rooms from 1.2 m² up to large central halls/corridors of 3500 m²
    if (area < 1.2 || area > 3500) return;

    let pMinX = Infinity,
      pMaxX = -Infinity,
      pMinY = Infinity,
      pMaxY = -Infinity;
    for (let i = 0; i < tessPts.length; i++) {
      const px = tessPts[i].x;
      const py = tessPts[i].y;
      if (px < pMinX) pMinX = px;
      if (px > pMaxX) pMaxX = px;
      if (py < pMinY) pMinY = py;
      if (py > pMaxY) pMaxY = py;
    }

    const w = pMaxX - pMinX;
    const h = pMaxY - pMinY;
    // Reject ultra-thin wall-thickness slivers (e.g. hatched wall thickness < 0.45m wide)
    if (Math.min(w, h) < 0.55) return;

    const center = calculatePolygonCenter(tessPts);
    candidates.push({
      points: poly.points,
      tessPts,
      area,
      perimeter,
      center,
      minX: pMinX,
      maxX: pMaxX,
      minY: pMinY,
      maxY: pMaxY,
      layer: poly.layer
    });
  });

  // Sort candidates from smallest area to largest area!
  // This guarantees individual rooms claim their internal text labels BEFORE any outer wing/floor contour.
  candidates.sort((a, b) => a.area - b.area);

  const acceptedBounds: {
    room: Room;
    tessPts: Point2D[];
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  }[] = [];

  candidates.forEach((cand, idx) => {
    // 1. Check if this candidate is a duplicate of an already-accepted room (e.g. double contour or hatch + polyline)
    let isDuplicate = false;
    let containedRoomsCount = 0;
    let containedRoomsAreaSum = 0;

    for (let i = 0; i < acceptedBounds.length; i++) {
      const existing = acceptedBounds[i];
      const areaRatio = cand.area / existing.room.area;

      // Duplicate check: similar area and centers close or inside each other
      if (areaRatio >= 0.72 && areaRatio <= 1.38) {
        const centerDist = Math.hypot(
          cand.center.x - existing.room.center.x,
          cand.center.y - existing.room.center.y
        );
        if (
          centerDist < 1.2 ||
          (cand.center.x >= existing.minX &&
            cand.center.x <= existing.maxX &&
            cand.center.y >= existing.minY &&
            cand.center.y <= existing.maxY &&
            isPointInsideTessellatedPolygon(cand.center, existing.tessPts))
        ) {
          isDuplicate = true;
          break;
        }
      }

      // Container check: does this larger polygon enclose already-accepted smaller rooms?
      if (
        existing.room.center.x >= cand.minX &&
        existing.room.center.x <= cand.maxX &&
        existing.room.center.y >= cand.minY &&
        existing.room.center.y <= cand.maxY &&
        isPointInsideTessellatedPolygon(existing.room.center, cand.tessPts)
      ) {
        containedRoomsCount++;
        containedRoomsAreaSum += existing.room.area;
      }
    }

    if (isDuplicate) return;

    // Reject outer building / wing / fire-compartment perimeter contours that wrap multiple rooms
    if (
      (containedRoomsCount >= 3 && containedRoomsAreaSum > cand.area * 0.25) ||
      (containedRoomsCount >= 1 && containedRoomsAreaSum > cand.area * 0.6)
    ) {
      return;
    }

    // Collect all unused text labels located inside this room contour
    const insideTexts: CADText[] = [];
    for (const t of normalizedTexts) {
      if (
        !usedTexts.has(t.id) &&
        t.position.x >= cand.minX &&
        t.position.x <= cand.maxX &&
        t.position.y >= cand.minY &&
        t.position.y <= cand.maxY &&
        isPointInsideTessellatedPolygon(t.position, cand.tessPts)
      ) {
        insideTexts.push(t);
        usedTexts.add(t.id);
      }
    }

    const { roomCode, roomName } = parseRoomCodeAndNameFromTexts(
      insideTexts,
      targetFloorNumber,
      recognizedRooms.length + 1
    );

    const { zone, cleanliness, commonSubType } = classifyHospitalZone(
      `${roomCode} ${roomName}`
    );

    const room: Room = {
      id: `rec_room_${Date.now()}_${idx + 1}`,
      code: roomCode,
      name: roomName,
      zone,
      cleanliness,
      commonSubType,
      polygon: cand.points,
      area: Number(cand.area.toFixed(1)),
      perimeter: Number(cand.perimeter.toFixed(1)),
      height: zone === 'surgery' || zone === 'icu' ? 3.4 : 3.2,
      center: cand.center,
      floorId,
      isAutoDetected: true
    };

    recognizedRooms.push(room);
    acceptedBounds.push({
      room,
      tessPts: cand.tessPts,
      minX: cand.minX,
      maxX: cand.maxX,
      minY: cand.minY,
      maxY: cand.maxY
    });
  });

  // Stages 3 & 4: Always run Hybrid Wall-Underlay Reconstruction to fill any central or wall-drawn rooms
  // that did not have closed polylines in Stage 1/2!
  const underlayRooms = reconstructRoomsFromWallUnderlay(
    normalizedLines,
    normalizedTexts,
    recognizedRooms,
    usedTexts,
    floorId,
    targetFloorNumber
  );
  recognizedRooms.push(...underlayRooms);

  const cadLayers: CADLayer[] = Object.entries(layerCounts).map(([name, count]) => ({
    name,
    color: '#334155',
    visible: true,
    count
  }));

  const finalWidth = Number((rawSpanX * scaleFactor).toFixed(1)) || 48;
  const finalLength = Number((rawSpanY * scaleFactor).toFixed(1)) || 22;

  const floorPlan: FloorPlan = {
    id: floorId,
    name: `${targetFloorNumber}-й Этаж: ${fileName.replace(/\.[^/.]+$/, '')}`,
    buildingName: 'Многопрофильный комплекс ГКБ № 52',
    floorNumber: targetFloorNumber,
    scale: 1.0,
    elevation: targetElevation,
    cadLines: normalizedLines,
    cadTexts: normalizedTexts,
    cadLayers,
    rooms: recognizedRooms,
    walls: [],
    dimensions: {
      width: Math.max(10, finalWidth),
      length: Math.max(10, finalLength)
    }
  };

  const totalArea = recognizedRooms.reduce((sum, r) => sum + r.area, 0);

  return {
    floorPlan,
    stats: {
      format,
      cadVersion,
      linesCount: normalizedLines.length,
      polylinesCount: normalizedPolylines.length,
      curvedWallsCount,
      textsCount: normalizedTexts.length,
      recognizedRoomsCount: recognizedRooms.length,
      totalArea: Number(totalArea.toFixed(1)),
      detectedScale
    }
  };
}

/**
 * Transforms a 2D point from Block local coordinates to parent space, accounting for:
 * - Block `basePoint`
 * - Child entity OCS mirror (`childFlipOcsX`)
 * - INSERT scale (`scaleX`, `scaleY`), rotation (`rotationRad`), and insertion point (`ins`)
 * - INSERT OCS mirror (`insertFlipOcsX`, when INSERT has `extrusionDirection.z === -1`)
 */
function transformBlockPoint(
  pt: { x: number; y: number },
  basePt: { x: number; y: number },
  ins: { x: number; y: number },
  scaleX: number,
  scaleY: number,
  rotationRad: number,
  insertFlipOcsX = false,
  childFlipOcsX = false
): { x: number; y: number } {
  const localX = childFlipOcsX ? -pt.x : pt.x;
  const localY = pt.y;
  const dx = (localX - (basePt.x || 0)) * scaleX;
  const dy = (localY - (basePt.y || 0)) * scaleY;
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  const ocsX = ins.x + dx * cos - dy * sin;
  const ocsY = ins.y + dx * sin + dy * cos;
  return {
    x: insertFlipOcsX ? -ocsX : ocsX,
    y: ocsY
  };
}

/**
 * Recursively expands INSERT blocks for both DWG and DXF files (up to depth 5),
 * preserving nested architectural blocks, dynamic blocks (*U...), OCS mirrors, and ATTRIB stamps.
 */
function expandEntitiesWithBlocks(
  rootEntities: any[],
  blockMap: Map<string, { entities: any[]; basePoint: { x: number; y: number } }>,
  rotationInDegrees: boolean
): any[] {
  const flattenedEntities: any[] = [];

  const pushEntity = (ent: any, depth: number) => {
    if (!ent || depth > 5 || ent.inPaperSpace || ent.type === 'VIEWPORT') return;

    if (ent.type === 'INSERT') {
      // 1. Extract ATTRIB room stamps attached to the INSERT
      // Note: In AutoCAD DWG/DXF, ATTRIB entities on an INSERT already store their coordinates in WCS/OCS of ModelSpace!
      if (Array.isArray(ent.attribs)) {
        ent.attribs.forEach((attr: any) => {
          if (attr?.text || attr?.mtext) {
            flattenedEntities.push({
              ...attr,
              type: 'ATTRIB',
              layer: attr.layer && attr.layer !== '0' ? attr.layer : ent.layer || '0',
              insertionPoint:
                attr.insertionPoint ||
                attr.startPoint ||
                ent.insertionPoint ||
                ent.position
            });
          }
        });
      }

      // 2. Expand geometry inside referenced block (skip only *D dimension blocks)
      const blockName = String(ent.name || '');
      const blk = blockMap.get(blockName);
      if (blk && !blockName.startsWith('*D')) {
        const ins = ent.insertionPoint || ent.position || { x: 0, y: 0 };
        const basePt = blk.basePoint || { x: 0, y: 0 };
        const sx = ent.xScale ?? 1;
        const sy = ent.yScale ?? 1;
        const rawRot = ent.rotation ?? 0;
        const rotRad = rotationInDegrees ? (rawRot * Math.PI) / 180 : rawRot;
        const insertFlipOcsX = hasMirroredExtrusionZ(ent);
        const totalMirrorSign = (sx * sy < 0 ? -1 : 1) * (insertFlipOcsX ? -1 : 1);

        blk.entities.forEach((child: any) => {
          if (!child) return;
          const childLayer =
            !child.layer || child.layer === '0' ? ent.layer || '0' : child.layer;
          const childFlipOcsX = hasMirroredExtrusionZ(child);
          const effectiveBulgeSign = totalMirrorSign * (childFlipOcsX ? -1 : 1);

          if (child.type === 'LINE') {
            const p1 = child.startPoint || child.vertices?.[0] || child.start;
            const p2 = child.endPoint || child.vertices?.[1] || child.end;
            if (p1 && p2) {
              flattenedEntities.push({
                ...child,
                layer: childLayer,
                extrusionDirection: { x: 0, y: 0, z: 1 },
                startPoint: transformBlockPoint(p1, basePt, ins, sx, sy, rotRad, insertFlipOcsX, false),
                endPoint: transformBlockPoint(p2, basePt, ins, sx, sy, rotRad, insertFlipOcsX, false)
              });
            }
          } else if (
            (child.type === 'LWPOLYLINE' ||
              child.type === 'POLYLINE' ||
              child.type === 'POLYLINE2D') &&
            Array.isArray(child.vertices)
          ) {
            flattenedEntities.push({
              ...child,
              layer: childLayer,
              extrusionDirection: { x: 0, y: 0, z: 1 },
              vertices: child.vertices.map((v: any) => {
                const vPt = v.point || v;
                const tPt = transformBlockPoint(
                  vPt,
                  basePt,
                  ins,
                  sx,
                  sy,
                  rotRad,
                  insertFlipOcsX,
                  childFlipOcsX
                );
                return {
                  ...v,
                  x: tPt.x,
                  y: tPt.y,
                  bulge: v.bulge ? v.bulge * effectiveBulgeSign : undefined
                };
              })
            });
          } else if (child.type === 'ARC' || child.type === 'CIRCLE') {
            // Convert block-local ARC/CIRCLE by transforming sample points directly so mirror + rotation + non-uniform scale are 100% exact
            const cPt = child.center || { x: 0, y: 0 };
            const r = child.radius ?? 1;
            let sAng = child.type === 'ARC' ? (child.startAngle ?? 0) : 0;
            let eAng = child.type === 'ARC' ? (child.endAngle ?? Math.PI * 2) : Math.PI * 2;
            if (eAng <= sAng) eAng += Math.PI * 2;
            const steps = 16;
            const dTheta = (eAng - sAng) / steps;
            const arcVerts: any[] = [];
            for (let i = 0; i <= steps; i++) {
              const a = sAng + i * dTheta;
              const localPt = { x: cPt.x + r * Math.cos(a), y: cPt.y + r * Math.sin(a) };
              const tPt = transformBlockPoint(
                localPt,
                basePt,
                ins,
                sx,
                sy,
                rotRad,
                insertFlipOcsX,
                childFlipOcsX
              );
              arcVerts.push({ x: tPt.x, y: tPt.y });
            }
            flattenedEntities.push({
              type: 'LWPOLYLINE',
              layer: childLayer,
              closed: child.type === 'CIRCLE',
              extrusionDirection: { x: 0, y: 0, z: 1 },
              vertices: child.type === 'CIRCLE' ? arcVerts.slice(0, -1) : arcVerts
            });
          } else if (child.type === 'HATCH' && Array.isArray(child.boundaryPaths)) {
            flattenedEntities.push({
              ...child,
              layer: childLayer,
              extrusionDirection: { x: 0, y: 0, z: 1 },
              boundaryPaths: child.boundaryPaths.map((bp: any) => ({
                ...bp,
                vertices: Array.isArray(bp.vertices)
                  ? bp.vertices.map((v: any) => {
                      const tPt = transformBlockPoint(
                        v,
                        basePt,
                        ins,
                        sx,
                        sy,
                        rotRad,
                        insertFlipOcsX,
                        childFlipOcsX
                      );
                      return {
                        ...v,
                        x: tPt.x,
                        y: tPt.y,
                        bulge: v.bulge ? v.bulge * effectiveBulgeSign : undefined
                      };
                    })
                  : undefined,
                edges: Array.isArray(bp.edges)
                  ? bp.edges.map((e: any) =>
                      e?.start && e?.end
                        ? {
                            ...e,
                            start: transformBlockPoint(
                              e.start,
                              basePt,
                              ins,
                              sx,
                              sy,
                              rotRad,
                              insertFlipOcsX,
                              childFlipOcsX
                            ),
                            end: transformBlockPoint(
                              e.end,
                              basePt,
                              ins,
                              sx,
                              sy,
                              rotRad,
                              insertFlipOcsX,
                              childFlipOcsX
                            )
                          }
                        : e
                    )
                  : undefined
              }))
            });
          } else if (
            child.type === 'TEXT' ||
            child.type === 'MTEXT' ||
            child.type === 'ATTRIB'
          ) {
            const textObj =
              typeof child.text === 'object' && child.text !== null ? child.text : null;
            const halign = textObj?.halign ?? child.halign ?? 0;
            const valign = textObj?.valign ?? child.valign ?? 0;
            const useAlign =
              (halign !== 0 || valign !== 0) &&
              (textObj?.endPoint || child.endPoint || child.alignmentPoint);
            const rawPt = useAlign
              ? textObj?.endPoint || child.endPoint || child.alignmentPoint
              : textObj?.startPoint ||
                child.insertionPoint ||
                child.startPoint ||
                child.position || { x: 0, y: 0 };
            const tPt = transformBlockPoint(
              rawPt,
              basePt,
              ins,
              sx,
              sy,
              rotRad,
              insertFlipOcsX,
              childFlipOcsX
            );
            flattenedEntities.push({
              ...child,
              layer: childLayer,
              extrusionDirection: { x: 0, y: 0, z: 1 },
              startPoint: tPt,
              insertionPoint: tPt,
              position: tPt,
              text: textObj ? { ...textObj, startPoint: tPt, endPoint: tPt } : child.text
            });
          } else if (child.type === 'INSERT') {
            const childIns = child.insertionPoint || child.position || { x: 0, y: 0 };
            const tIns = transformBlockPoint(
              childIns,
              basePt,
              ins,
              sx,
              sy,
              rotRad,
              insertFlipOcsX,
              childFlipOcsX
            );
            const childRot = child.rotation ?? 0;
            const parentRotInChildUnits = rotationInDegrees ? rawRot : rotRad;
            pushEntity(
              {
                ...child,
                layer: childLayer,
                extrusionDirection: { x: 0, y: 0, z: 1 },
                insertionPoint: tIns,
                position: tIns,
                xScale: (child.xScale ?? 1) * sx * (insertFlipOcsX ? -1 : 1) * (childFlipOcsX ? -1 : 1),
                yScale: (child.yScale ?? 1) * sy,
                rotation: parentRotInChildUnits + childRot * totalMirrorSign
              },
              depth + 1
            );
          }
        });
      }
      return;
    }

    flattenedEntities.push(ent);
  };

  rootEntities.forEach(ent => pushEntity(ent, 0));
  return flattenedEntities;
}

/**
 * Main DXF text parser with CAD entity extraction, block expansion, bulge/arc curve detection & 4-stage room recognition
 */
export function parseDXFContent(
  dxfText: string,
  fileName: string,
  targetFloorNumber = 1,
  targetElevation = 0
): ParseResult {
  let parsedDxf: any = null;

  try {
    const parser = new DxfParser();
    parsedDxf = parser.parseSync(dxfText);
  } catch (err) {
    console.warn('DxfParser fallback lexer running:', err);
    parsedDxf = fallbackDxfLexer(dxfText);
  }

  const blockMap = new Map<
    string,
    { entities: any[]; basePoint: { x: number; y: number } }
  >();
  if (parsedDxf?.blocks && typeof parsedDxf.blocks === 'object') {
    Object.values(parsedDxf.blocks).forEach((blk: any) => {
      if (blk?.name && Array.isArray(blk.entities) && blk.entities.length > 0) {
        blockMap.set(blk.name, {
          entities: blk.entities,
          basePoint: blk.position || { x: 0, y: 0 }
        });
      }
    });
  }

  // Filter out PaperSpace entities so sheet frames at (0,0) never distort ModelSpace coordinates
  const rawEntities = (parsedDxf?.entities || []).filter(
    (e: any) => !e?.inPaperSpace && e?.type !== 'VIEWPORT'
  );
  const flattenedEntities = expandEntitiesWithBlocks(rawEntities, blockMap, true);
  const acadVer = parsedDxf?.header?.$ACADVER || 'DXF ASCII';

  return buildFloorPlanFromEntities(
    flattenedEntities,
    fileName,
    targetFloorNumber,
    targetElevation,
    'DXF',
    String(acadVer)
  );
}

/**
 * Native Binary AutoCAD DWG Parser powered by GNU LibreDWG WebAssembly (`@mlightcad/libredwg-web`).
 * Extracts strictly ModelSpace entities (excluding PaperSpace layouts), recursive block INSERTs,
 * attributes, hatches, polylines, lines, arcs, and texts.
 */
export async function parseDWGContent(
  buffer: ArrayBuffer,
  fileName: string,
  targetFloorNumber = 1,
  targetElevation = 0
): Promise<ParseResult> {
  // Check if file is actually an ASCII DXF saved with a .dwg extension
  const headerBytes = new Uint8Array(buffer.slice(0, 32));
  const headerAscii = String.fromCharCode(...headerBytes.slice(0, 16)).trim();
  if (headerAscii.startsWith('0') && headerAscii.includes('SECTION')) {
    const text = new TextDecoder('utf-8').decode(buffer);
    return parseDXFContent(text, fileName, targetFloorNumber, targetElevation);
  }

  const versionHeader = String.fromCharCode(...headerBytes.slice(0, 6));
  const versionsMap: Record<string, string> = {
    AC1032: 'AutoCAD 2018–2024 (AC1032)',
    AC1027: 'AutoCAD 2013–2017 (AC1027)',
    AC1024: 'AutoCAD 2010–2012 (AC1024)',
    AC1021: 'AutoCAD 2007–2009 (AC1021)',
    AC1018: 'AutoCAD 2004–2006 (AC1018)',
    AC1015: 'AutoCAD 2000–2002 (AC1015)',
    AC1014: 'AutoCAD R14 (AC1014)',
    AC1012: 'AutoCAD R13 (AC1012)'
  };
  const detectedVersion = versionsMap[versionHeader] || `DWG (${versionHeader})`;

  const libredwg = await getLibreDwgInstance();
  let dwgDataPtr: number | undefined;

  try {
    dwgDataPtr = libredwg.dwg_read_data(buffer, Dwg_File_Type.DWG);
    if (!dwgDataPtr) {
      throw new Error(`Не удалось декодировать бинарную структуру ${detectedVersion}`);
    }

    const db = libredwg.convert(dwgDataPtr);

    // Build block lookup map for expanding INSERT entities (including nested & dynamic blocks)
    const blockMap = new Map<
      string,
      { entities: any[]; basePoint: { x: number; y: number } }
    >();
    const blockEntries = db.tables?.BLOCK_RECORD?.entries || [];
    let modelSpaceEntities: any[] = [];

    blockEntries.forEach((blk: any) => {
      if (blk?.name && Array.isArray(blk.entities) && blk.entities.length > 0) {
        blockMap.set(blk.name, {
          entities: blk.entities,
          basePoint: blk.basePoint || { x: 0, y: 0 }
        });
        // Extract strictly from *Model_Space block record so *Paper_Space layout borders/viewports
        // (which @mlightcad/libredwg-web also pushes into db.entities) never pollute ModelSpace coordinates!
        if (/^\*model_space/i.test(blk.name)) {
          modelSpaceEntities = modelSpaceEntities.concat(blk.entities);
        }
      }
    });

    const rootEntities: any[] =
      modelSpaceEntities.length > 0
        ? modelSpaceEntities
        : (db.entities || []).filter((e: any) => !e?.inPaperSpace && e?.type !== 'VIEWPORT');

    const flattenedEntities = expandEntitiesWithBlocks(rootEntities, blockMap, false);

    return buildFloorPlanFromEntities(
      flattenedEntities,
      fileName,
      targetFloorNumber,
      targetElevation,
      'DWG',
      detectedVersion
    );
  } finally {
    if (dwgDataPtr) {
      libredwg.dwg_free(dwgDataPtr);
    }
  }
}

// Fallback regex-based DXF lexer with bulge (group code 42) support
function fallbackDxfLexer(content: string) {
  const lines = content.split(/\r?\n/);
  const entities: any[] = [];
  let inEntities = false;
  let currentEntity: any = null;

  for (let i = 0; i < lines.length; i++) {
    const code = lines[i].trim();
    const val = lines[i + 1]?.trim() || '';

    if (code === '2' && val === 'ENTITIES') {
      inEntities = true;
      i++;
      continue;
    }
    if (inEntities && code === '0' && val === 'ENDSEC') {
      if (currentEntity) entities.push(currentEntity);
      break;
    }

    if (inEntities && code === '0') {
      if (currentEntity) entities.push(currentEntity);
      currentEntity = { type: val, vertices: [] };
      i++;
      continue;
    }

    if (inEntities && currentEntity) {
      if (code === '8') {
        currentEntity.layer = val;
      } else if (code === '1') {
        currentEntity.text = val;
      } else if (code === '70') {
        const flag = parseInt(val, 10);
        if (flag & 1) currentEntity.shape = true;
      } else if (code === '10') {
        if (currentEntity.type === 'LWPOLYLINE' || currentEntity.type === 'POLYLINE') {
          currentEntity.vertices.push({ x: parseFloat(val), y: 0, bulge: 0 });
        } else {
          currentEntity.start = currentEntity.start || {};
          currentEntity.start.x = parseFloat(val);
        }
      } else if (code === '20') {
        if (currentEntity.type === 'LWPOLYLINE' || currentEntity.type === 'POLYLINE') {
          const lastV = currentEntity.vertices[currentEntity.vertices.length - 1];
          if (lastV) lastV.y = parseFloat(val);
        } else {
          currentEntity.start = currentEntity.start || {};
          currentEntity.start.y = parseFloat(val);
        }
      } else if (code === '42') {
        if (currentEntity.type === 'LWPOLYLINE' || currentEntity.type === 'POLYLINE') {
          const lastV = currentEntity.vertices[currentEntity.vertices.length - 1];
          if (lastV) lastV.bulge = parseFloat(val);
        }
      } else if (code === '11') {
        currentEntity.end = currentEntity.end || {};
        currentEntity.end.x = parseFloat(val);
      } else if (code === '21') {
        currentEntity.end = currentEntity.end || {};
        currentEntity.end.y = parseFloat(val);
      }
    }
  }

  return { entities };
}

function cleanCadText(raw: string): string {
  return raw
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\P/g, ' ')
    .replace(/\\[Ff][^;\\]*?(?:\|[^;\\]*)*;/g, '')
    .replace(/\\[A-Za-z0-9]+;?/g, '')
    .replace(/\{|\}/g, '')
    .replace(/%%[A-Za-z0-9]/g, '')
    .trim();
}

/**
 * Converts a polygon with vertex fillet radii (`radius > 0`) into standard DXF LWPOLYLINE
 * vertices where each rounded corner becomes a tangent-to-tangent arc with exact DXF `bulge`.
 */
function expandFilletRadiiToDxfBulgeVertices(points: Point2D[]): Point2D[] {
  const n = points.length;
  if (n < 3) return points;
  const out: Point2D[] = [];

  for (let i = 0; i < n; i++) {
    const curr = points[i];
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const r = curr.radius ?? 0;

    if (r > 0.05) {
      const ux = prev.x - curr.x;
      const uy = prev.y - curr.y;
      const vx = next.x - curr.x;
      const vy = next.y - curr.y;
      const lenU = Math.hypot(ux, uy);
      const lenV = Math.hypot(vx, vy);

      if (lenU > 0.1 && lenV > 0.1) {
        const uHatX = ux / lenU;
        const uHatY = uy / lenU;
        const vHatX = vx / lenV;
        const vHatY = vy / lenV;
        const dot = Math.max(-1, Math.min(1, uHatX * vHatX + uHatY * vHatY));
        const alpha = Math.acos(dot);

        if (alpha > 0.1 && alpha < Math.PI - 0.1) {
          const halfAlpha = alpha / 2;
          const tanHalf = Math.tan(halfAlpha);
          const d = Math.min(r / tanHalf, Math.min(lenU, lenV) * 0.45);
          const t1x = curr.x + uHatX * d;
          const t1y = curr.y + uHatY * d;
          const t2x = curr.x + vHatX * d;
          const t2y = curr.y + vHatY * d;

          // Cross product determines turn direction (CCW > 0, CW < 0)
          const cross = -uHatX * vHatY - -uHatY * vHatX;
          const sweep = (Math.PI - alpha) * (cross >= 0 ? 1 : -1);
          const filletBulge = Math.tan(sweep / 4);

          out.push({
            x: Number(t1x.toFixed(3)),
            y: Number(t1y.toFixed(3)),
            bulge: Number(filletBulge.toFixed(4))
          });
          out.push({
            x: Number(t2x.toFixed(3)),
            y: Number(t2y.toFixed(3)),
            bulge: curr.bulge
          });
          continue;
        }
      }
    }

    out.push({
      x: curr.x,
      y: curr.y,
      bulge: curr.bulge
    });
  }

  return out;
}

/**
 * Exports a FloorPlan (including curved walls/bulges and corner fillets) to an authentic ASCII DXF string,
 * converting Plan Y (`+Y` South/Down) back to AutoCAD Y (`+Y` North/Up) for lossless round-trip orientation.
 */
export function exportFloorPlanToDXF(floorPlan: FloorPlan): string {
  const maxL = floorPlan.dimensions.length || 22;
  const lines: string[] = [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$ACADVER',
    '1',
    'AC1015',
    '9',
    '$INSUNITS',
    '70',
    '6', // 6 = Meters
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'TABLES',
    '0',
    'TABLE',
    '2',
    'LAYER',
    '70',
    String(floorPlan.cadLayers.length)
  ];

  floorPlan.cadLayers.forEach(l => {
    lines.push('0', 'LAYER', '2', l.name, '70', '0', '62', '7', '6', 'CONTINUOUS');
  });

  lines.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');

  // Export CAD lines (converting Y back to AutoCAD North-Up)
  floorPlan.cadLines.forEach(l => {
    lines.push(
      '0',
      'LINE',
      '8',
      l.layer,
      '10',
      l.start.x.toFixed(3),
      '20',
      (maxL - l.start.y).toFixed(3),
      '30',
      '0.000',
      '11',
      l.end.x.toFixed(3),
      '21',
      (maxL - l.end.y).toFixed(3),
      '31',
      '0.000'
    );
  });

  // Export closed room polylines (converting corner radii to true DXF bulge arcs and inverting Y/bulge to CAD North-Up)
  floorPlan.rooms.forEach(r => {
    const dxfVertices = expandFilletRadiiToDxfBulgeVertices(r.polygon);
    lines.push(
      '0',
      'LWPOLYLINE',
      '8',
      'ПОМЕЩЕНИЯ_КОНТУРЫ',
      '90',
      String(dxfVertices.length),
      '70',
      '1' // Closed
    );
    dxfVertices.forEach(pt => {
      lines.push('10', pt.x.toFixed(3), '20', (maxL - pt.y).toFixed(3));
      if (pt.bulge) {
        lines.push('42', (-pt.bulge).toFixed(4));
      }
    });

    // Export room text label
    lines.push(
      '0',
      'TEXT',
      '8',
      'ПОДПИСИ_ПОМЕЩЕНИЙ',
      '10',
      r.center.x.toFixed(3),
      '20',
      (maxL - r.center.y).toFixed(3),
      '30',
      '0.000',
      '40',
      '0.8',
      '1',
      `${r.code} ${r.name}`
    );
  });

  lines.push('0', 'ENDSEC', '0', 'EOF');

  return lines.join('\n');
}
