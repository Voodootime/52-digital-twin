import { FloorPlan, Room, CADLine, CADText, WallSegment, HospitalBuilding, Point2D } from '../types/cad';
import { tessellatePolygon, hasCurvedGeometry, calculatePolygonArea, calculatePolygonPerimeter } from '../services/dxfParser';

export const DEFAULT_HOSPITAL_BUILDING: HospitalBuilding = {
  id: 'gkb_52_complex',
  name: 'Многопрофильный комплекс ГКБ № 52 (2 этап)',
  projectCode: 'ПИР/0166-30-ТХ.ГЧ',
  address: 'г. Москва, ул. Пехотная, д. 3',
  typicalFloorHeight: 3.6,
  structuralGrid: '6.0 × 6.0 м / 7.2 × 7.2 м'
};

// Helper to create rectangle polygon with optional corner radii
function createRectPolygon(
  x: number,
  y: number,
  w: number,
  h: number,
  cornerRadii?: [number, number, number, number],
  topBulge?: number
): Point2D[] {
  return [
    { x, y, radius: cornerRadii?.[0] },
    { x: x + w, y, radius: cornerRadii?.[1] },
    { x: x + w, y: y + h, radius: cornerRadii?.[2], bulge: topBulge },
    { x, y: y + h, radius: cornerRadii?.[3] }
  ];
}

// Generate CAD underlay lines for a room (including curved segments if polygon has curves)
function generateRoomCadLines(
  room: Room,
  hasDoor = true,
  doorSide: 'bottom' | 'top' | 'left' | 'right' = 'bottom',
  hasWindow = false
): CADLine[] {
  const lines: CADLine[] = [];
  const pts = room.polygon;
  const minX = Math.min(...pts.map(p => p.x));
  const maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y));
  const maxY = Math.max(...pts.map(p => p.y));
  const w = maxX - minX;
  const h = maxY - minY;
  const idPrefix = `cad_${room.id}`;

  if (hasCurvedGeometry(pts)) {
    const tess = tessellatePolygon(pts, 14, true);
    for (let i = 0; i < tess.length; i++) {
      const p1 = tess[i];
      const p2 = tess[(i + 1) % tess.length];
      lines.push({
        id: `${idPrefix}_seg_${i}`,
        start: p1,
        end: p2,
        layer: 'СТЕНЫ_ВНУТРЕННИЕ'
      });
    }
    return lines;
  }

  const dW = 1.0;

  // Left wall
  lines.push({
    id: `${idPrefix}_wl`,
    start: { x: minX, y: minY },
    end: { x: minX, y: minY + h },
    layer: 'СТЕНЫ_ВНУТРЕННИЕ'
  });

  // Right wall
  lines.push({
    id: `${idPrefix}_wr`,
    start: { x: minX + w, y: minY },
    end: { x: minX + w, y: minY + h },
    layer: 'СТЕНЫ_ВНУТРЕННИЕ'
  });

  // Top wall
  if (doorSide === 'top' && hasDoor) {
    const doorX = minX + (w - dW) / 2;
    lines.push(
      { id: `${idPrefix}_wt1`, start: { x: minX, y: minY + h }, end: { x: doorX, y: minY + h }, layer: 'СТЕНЫ_ВНУТРЕННИЕ' },
      { id: `${idPrefix}_wt2`, start: { x: doorX + dW, y: minY + h }, end: { x: minX + w, y: minY + h }, layer: 'СТЕНЫ_ВНУТРЕННИЕ' },
      { id: `${idPrefix}_d`, start: { x: doorX, y: minY + h }, end: { x: doorX, y: minY + h + dW * 0.8 }, layer: 'ДВЕРИ', color: '#64748b' }
    );
  } else {
    lines.push({
      id: `${idPrefix}_wt`,
      start: { x: minX, y: minY + h },
      end: { x: minX + w, y: minY + h },
      layer: 'СТЕНЫ_ВНУТРЕННИЕ'
    });
  }

  // Bottom wall
  if (doorSide === 'bottom' && hasDoor) {
    const doorX = minX + (w - dW) / 2;
    lines.push(
      { id: `${idPrefix}_wb1`, start: { x: minX, y: minY }, end: { x: doorX, y: minY }, layer: 'СТЕНЫ_ВНУТРЕННИЕ' },
      { id: `${idPrefix}_wb2`, start: { x: doorX + dW, y: minY }, end: { x: minX + w, y: minY }, layer: 'СТЕНЫ_ВНУТРЕННИЕ' },
      { id: `${idPrefix}_d`, start: { x: doorX, y: minY }, end: { x: doorX, y: minY - dW * 0.8 }, layer: 'ДВЕРИ', color: '#64748b' }
    );
  } else {
    lines.push({
      id: `${idPrefix}_wb`,
      start: { x: minX, y: minY },
      end: { x: minX + w, y: minY },
      layer: 'СТЕНЫ_ВНУТРЕННИЕ'
    });
  }

  if (hasWindow) {
    lines.push(
      { id: `${idPrefix}_win1`, start: { x: minX + w * 0.2, y: minY + h }, end: { x: minX + w * 0.8, y: minY + h }, layer: 'ОКНА', color: '#38bdf8' },
      { id: `${idPrefix}_win2`, start: { x: minX + w * 0.2, y: minY + h + 0.1 }, end: { x: minX + w * 0.8, y: minY + h + 0.1 }, layer: 'ОКНА', color: '#38bdf8' }
    );
  }

  return lines;
}

function generateGridAxes(maxX: number, maxY: number): { lines: CADLine[]; texts: CADText[] } {
  const lines: CADLine[] = [];
  const texts: CADText[] = [];

  const xStep = 6;
  let axisNum = 1;
  for (let x = 0; x <= maxX; x += xStep) {
    lines.push({
      id: `axis_num_${axisNum}`,
      start: { x, y: -2.0 },
      end: { x, y: maxY + 2.0 },
      layer: 'ОСИ_КООРДИНАТНЫЕ',
      color: '#94a3b8'
    });
    texts.push({
      id: `axis_num_txt_${axisNum}`,
      text: `${axisNum}`,
      position: { x, y: -3.0 },
      height: 1.1,
      layer: 'ОСИ_КООРДИНАТНЫЕ'
    });
    axisNum++;
  }

  const yLabels = ['А', 'Б', 'В', 'Г', 'Д'];
  const yStep = 6;
  for (let i = 0; i * yStep <= maxY && i < yLabels.length; i++) {
    const y = i * yStep;
    lines.push({
      id: `axis_let_${yLabels[i]}`,
      start: { x: -2.0, y },
      end: { x: maxX + 2.0, y },
      layer: 'ОСИ_КООРДИНАТНЫЕ',
      color: '#94a3b8'
    });
    texts.push({
      id: `axis_let_txt_${yLabels[i]}`,
      text: yLabels[i],
      position: { x: -3.2, y },
      height: 1.1,
      layer: 'ОСИ_КООРДИНАТНЫЕ'
    });
  }

  return { lines, texts };
}

function buildFloorCadData(rooms: Room[], maxX: number, maxY: number, prefix: string): { lines: CADLine[]; texts: CADText[]; walls: WallSegment[] } {
  let lines: CADLine[] = [];
  const texts: CADText[] = [];
  const walls: WallSegment[] = [];

  const perimeter = [
    { start: { x: 1, y: 0 }, end: { x: maxX, y: 0 } },
    { start: { x: maxX, y: 0 }, end: { x: maxX, y: maxY } },
    { start: { x: maxX, y: maxY }, end: { x: 1, y: maxY } },
    { start: { x: 1, y: maxY }, end: { x: 1, y: 0 } }
  ];

  perimeter.forEach((p, idx) => {
    lines.push({
      id: `${prefix}_ext_wall_${idx}`,
      start: p.start,
      end: p.end,
      layer: 'СТЕНЫ_НЕСУЩИЕ',
      color: '#0f172a'
    });
    walls.push({
      id: `${prefix}_w_ext_${idx}`,
      start: p.start,
      end: p.end,
      thickness: 0.38,
      height: 3.5
    });
  });

  rooms.forEach(room => {
    const pts = room.polygon;
    const minY = Math.min(...pts.map(p => p.y));
    const maxRoomY = Math.max(...pts.map(p => p.y));

    const rLines = generateRoomCadLines(
      room,
      room.commonSubType !== 'hall',
      minY > 6 ? 'bottom' : 'top',
      maxRoomY > 19 || minY < 1
    );
    lines = lines.concat(rLines);

    texts.push({
      id: `txt_${room.id}`,
      text: `${room.code} ${room.name}\nS = ${room.area.toFixed(1)} м²`,
      position: room.center,
      height: 0.7,
      layer: 'ПОДПИСИ_ПОМЕЩЕНИЙ'
    });
  });

  const grid = generateGridAxes(maxX, maxY);
  lines = lines.concat(grid.lines);
  grid.texts.forEach(t => texts.push(t));

  return { lines, texts, walls };
}

// ============================================================================
// ЭТАЖ 1 (Отм. 0.000): Приемно-диагностическое отделение и экстренная помощь
// (Лифтовой холл X: 17..23, ЛК-1 X: 23..28, ЛК-2 X: 42..47 синхронизированы со всеми этажами)
// ============================================================================
const floor1Rooms: Room[] = [
  {
    id: 'f1_r101',
    code: '101',
    name: 'Бокс приема реанимобилей скорой помощи (Тамбур-шлюз)',
    zone: 'utility',
    cleanliness: 'dirty',
    commonSubType: 'standard',
    polygon: createRectPolygon(2, 13.5, 11, 7, [1.5, 0, 0, 1.5]),
    area: 76.0,
    perimeter: 35.2,
    height: 3.6,
    center: { x: 7.5, y: 17 },
    floorId: 'floor_1',
    isAutoDetected: true
  },
  {
    id: 'f1_r102',
    code: '102',
    name: 'Экстренная противошоковая операционная (скругленные углы Кл. А)',
    zone: 'surgery',
    cleanliness: 'sterile',
    commonSubType: 'standard',
    polygon: createRectPolygon(13, 13.5, 9, 7, [1.0, 1.0, 1.0, 1.0]),
    area: 62.1,
    perimeter: 30.3,
    height: 3.5,
    center: { x: 17.5, y: 17 },
    floorId: 'floor_1',
    isAutoDetected: true
  },
  {
    id: 'f1_r103',
    code: '103',
    name: 'Кабинет мультиспиральной КТ (Томография)',
    zone: 'icu',
    cleanliness: 'clean',
    commonSubType: 'standard',
    polygon: createRectPolygon(22, 13.5, 8.5, 7),
    area: 59.5,
    perimeter: 31.0,
    height: 3.5,
    center: { x: 26.25, y: 17 },
    floorId: 'floor_1',
    isAutoDetected: true
  },
  {
    id: 'f1_r104',
    code: '104',
    name: 'Цифровой рентген-диагностический зал',
    zone: 'staff',
    cleanliness: 'clean',
    commonSubType: 'standard',
    polygon: createRectPolygon(30.5, 13.5, 8, 7),
    area: 56.0,
    perimeter: 30.0,
    height: 3.5,
    center: { x: 34.5, y: 17 },
    floorId: 'floor_1',
    isAutoDetected: true
  },
  {
    id: 'f1_r105',
    code: '105',
    name: 'Экспресс-лаборатория срочных анализов',
    zone: 'staff',
    cleanliness: 'clean',
    commonSubType: 'standard',
    polygon: createRectPolygon(38.5, 13.5, 8.5, 7),
    area: 59.5,
    perimeter: 31.0,
    height: 3.4,
    center: { x: 42.75, y: 17 },
    floorId: 'floor_1',
    isAutoDetected: true
  },
  {
    id: 'f1_r106',
    code: '106',
    name: 'Пост триаж-сортировки и дежурного врача',
    zone: 'staff',
    cleanliness: 'conditional',
    commonSubType: 'hall',
    polygon: createRectPolygon(2, 9.5, 11, 4, [0.8, 0.8, 0, 0]),
    area: 43.6,
    perimeter: 29.5,
    height: 3.2,
    center: { x: 7.5, y: 11.5 },
    floorId: 'floor_1',
    isAutoDetected: true
  },
  {
    id: 'f1_r107',
    code: '107',
    name: 'Смотровая терапевтическая и УЗИ',
    zone: 'ward',
    cleanliness: 'conditional',
    commonSubType: 'standard',
    polygon: createRectPolygon(13, 9.5, 9, 4),
    area: 36.0,
    perimeter: 26.0,
    height: 3.2,
    center: { x: 17.5, y: 11.5 },
    floorId: 'floor_1',
    isAutoDetected: true
  },
  {
    id: 'f1_r108',
    code: '108',
    name: 'Палата динамического наблюдения (6 коек)',
    zone: 'ward',
    cleanliness: 'conditional',
    commonSubType: 'standard',
    polygon: createRectPolygon(22, 9.5, 12, 4),
    area: 48.0,
    perimeter: 32.0,
    height: 3.2,
    center: { x: 28, y: 11.5 },
    floorId: 'floor_1',
    isAutoDetected: true
  },
  {
    id: 'f1_r109',
    code: '109',
    name: 'Мельцеровский инфекционный бокс со шлюзом',
    zone: 'ward',
    cleanliness: 'clean',
    commonSubType: 'standard',
    polygon: createRectPolygon(34, 9.5, 13, 4),
    area: 52.0,
    perimeter: 34.0,
    height: 3.2,
    center: { x: 40.5, y: 11.5 },
    floorId: 'floor_1',
    isAutoDetected: true
  },
  {
    id: 'f1_r110',
    code: '110',
    name: 'Главный распределительный холл и коридор 1-го этажа',
    zone: 'circulation',
    cleanliness: 'conditional',
    commonSubType: 'hall',
    polygon: createRectPolygon(2, 6.5, 45, 3),
    area: 135.0,
    perimeter: 96.0,
    height: 3.0,
    center: { x: 24.5, y: 8 },
    floorId: 'floor_1',
    isAutoDetected: true
  },
  {
    id: 'f1_r111',
    code: '111',
    name: 'Главный входной вестибюль с радиусным фасадом и ресепшн',
    zone: 'circulation',
    cleanliness: 'conditional',
    commonSubType: 'hall',
    polygon: [
      { x: 2, y: 0.5, radius: 1.5, bulge: -0.18 },
      { x: 17, y: 0.5, radius: 1.5 },
      { x: 17, y: 6.5 },
      { x: 2, y: 6.5 }
    ],
    area: 98.4,
    perimeter: 43.2,
    height: 3.5,
    center: { x: 9.5, y: 3.5 },
    floorId: 'floor_1',
    isAutoDetected: true
  },
  {
    id: 'f1_r112',
    code: '112',
    name: 'Больничный лифтовой холл (3 лифта, сквозная шахта)',
    zone: 'vertical',
    cleanliness: 'conditional',
    commonSubType: 'elevator',
    polygon: createRectPolygon(17, 0.5, 6, 6),
    area: 36.0,
    perimeter: 24.0,
    height: 3.5,
    center: { x: 20, y: 3.5 },
    floorId: 'floor_1',
    isAutoDetected: true
  },
  {
    id: 'f1_r113',
    code: '113',
    name: 'Эвакуационная лестничная клетка ЛК-1',
    zone: 'vertical',
    cleanliness: 'conditional',
    commonSubType: 'staircase',
    polygon: createRectPolygon(23, 0.5, 5, 6),
    area: 30.0,
    perimeter: 22.0,
    height: 3.5,
    center: { x: 25.5, y: 3.5 },
    floorId: 'floor_1',
    isAutoDetected: true
  },
  {
    id: 'f1_r114',
    code: '114',
    name: 'Санитарный блок и душевая приемного отделения',
    zone: 'sanitary',
    cleanliness: 'dirty',
    commonSubType: 'restroom',
    polygon: createRectPolygon(28, 0.5, 7, 6),
    area: 42.0,
    perimeter: 26.0,
    height: 3.0,
    center: { x: 31.5, y: 3.5 },
    floorId: 'floor_1',
    isAutoDetected: true
  },
  {
    id: 'f1_r115',
    code: '115',
    name: 'Санузел посетителей и комната МГН',
    zone: 'sanitary',
    cleanliness: 'dirty',
    commonSubType: 'restroom',
    polygon: createRectPolygon(35, 0.5, 7, 6),
    area: 42.0,
    perimeter: 26.0,
    height: 3.0,
    center: { x: 38.5, y: 3.5 },
    floorId: 'floor_1',
    isAutoDetected: true
  },
  {
    id: 'f1_r116',
    code: '116',
    name: 'Служебная лестничная клетка ЛК-2',
    zone: 'vertical',
    cleanliness: 'conditional',
    commonSubType: 'staircase',
    polygon: createRectPolygon(42, 0.5, 5, 6),
    area: 30.0,
    perimeter: 22.0,
    height: 3.5,
    center: { x: 44.5, y: 3.5 },
    floorId: 'floor_1',
    isAutoDetected: true
  }
];

// ============================================================================
// ЭТАЖ 2 (Отм. +3.600): Хирургический блок и отделение реанимации (ОРИТ)
// ============================================================================
const floor2Rooms: Room[] = [
  {
    id: 'f2_r201',
    code: '201',
    name: 'Операционный блок №1 (Кардиохирургия, скругленные углы Кл. А)',
    zone: 'surgery',
    cleanliness: 'sterile',
    commonSubType: 'standard',
    polygon: createRectPolygon(2, 14, 7.5, 6.5, [1.0, 1.0, 1.0, 1.0]),
    area: 47.9,
    perimeter: 26.3,
    height: 3.4,
    center: { x: 5.75, y: 17.25 },
    floorId: 'floor_2',
    isAutoDetected: true
  },
  {
    id: 'f2_r202',
    code: '202',
    name: 'Предоперационная и наркозная №1',
    zone: 'surgery',
    cleanliness: 'clean',
    commonSubType: 'standard',
    polygon: createRectPolygon(2, 9.5, 7.5, 4.5),
    area: 33.7,
    perimeter: 24.0,
    height: 3.2,
    center: { x: 5.75, y: 11.75 },
    floorId: 'floor_2',
    isAutoDetected: true
  },
  {
    id: 'f2_r203',
    code: '203',
    name: 'Операционный блок №2 (Нейрохирургия, скругленные углы Кл. А)',
    zone: 'surgery',
    cleanliness: 'sterile',
    commonSubType: 'standard',
    polygon: createRectPolygon(9.5, 14, 7.5, 6.5, [1.0, 1.0, 1.0, 1.0]),
    area: 47.9,
    perimeter: 26.3,
    height: 3.4,
    center: { x: 13.25, y: 17.25 },
    floorId: 'floor_2',
    isAutoDetected: true
  },
  {
    id: 'f2_r204',
    code: '204',
    name: 'Предоперационная и стерильный шлюз №2',
    zone: 'surgery',
    cleanliness: 'clean',
    commonSubType: 'standard',
    polygon: createRectPolygon(9.5, 9.5, 7.5, 4.5),
    area: 33.7,
    perimeter: 24.0,
    height: 3.2,
    center: { x: 13.25, y: 11.75 },
    floorId: 'floor_2',
    isAutoDetected: true
  },
  {
    id: 'f2_r205',
    code: '205',
    name: 'Зал реанимации и интенсивной терапии (ОРИТ на 6 коек)',
    zone: 'icu',
    cleanliness: 'clean',
    commonSubType: 'standard',
    polygon: createRectPolygon(17, 14, 17, 6.5),
    area: 110.5,
    perimeter: 47.0,
    height: 3.4,
    center: { x: 25.5, y: 17.25 },
    floorId: 'floor_2',
    isAutoDetected: true
  },
  {
    id: 'f2_r206',
    code: '206',
    name: 'Центральный радиусный пост реаниматолога и мониторинг',
    zone: 'staff',
    cleanliness: 'clean',
    commonSubType: 'hall',
    polygon: createRectPolygon(17, 9.5, 11.5, 4.5, [1.2, 1.2, 0, 0]),
    area: 50.8,
    perimeter: 30.8,
    height: 3.2,
    center: { x: 22.75, y: 11.75 },
    floorId: 'floor_2',
    isAutoDetected: true
  },
  {
    id: 'f2_r207',
    code: '207',
    name: 'Процедурная интенсивной терапии',
    zone: 'icu',
    cleanliness: 'clean',
    commonSubType: 'standard',
    polygon: createRectPolygon(28.5, 9.5, 5.5, 4.5),
    area: 24.7,
    perimeter: 20.0,
    height: 3.2,
    center: { x: 31.25, y: 11.75 },
    floorId: 'floor_2',
    isAutoDetected: true
  },
  {
    id: 'f2_r208',
    code: '208',
    name: 'Послеоперационная палата №1 (2-местная)',
    zone: 'ward',
    cleanliness: 'conditional',
    commonSubType: 'standard',
    polygon: createRectPolygon(34, 14, 6.5, 6.5),
    area: 42.2,
    perimeter: 26.0,
    height: 3.2,
    center: { x: 37.25, y: 17.25 },
    floorId: 'floor_2',
    isAutoDetected: true
  },
  {
    id: 'f2_r209',
    code: '209',
    name: 'Послеоперационная палата №2 (2-местная)',
    zone: 'ward',
    cleanliness: 'conditional',
    commonSubType: 'standard',
    polygon: createRectPolygon(40.5, 14, 6.5, 6.5),
    area: 42.2,
    perimeter: 26.0,
    height: 3.2,
    center: { x: 43.75, y: 17.25 },
    floorId: 'floor_2',
    isAutoDetected: true
  },
  {
    id: 'f2_r210',
    code: '210',
    name: 'Ординаторская хирургов и консилиум-зал',
    zone: 'staff',
    cleanliness: 'conditional',
    commonSubType: 'standard',
    polygon: createRectPolygon(34, 9.5, 6.5, 4.5),
    area: 29.2,
    perimeter: 22.0,
    height: 3.2,
    center: { x: 37.25, y: 11.75 },
    floorId: 'floor_2',
    isAutoDetected: true
  },
  {
    id: 'f2_r211',
    code: '211',
    name: 'Кабинет зав. хирургическим отделением',
    zone: 'staff',
    cleanliness: 'conditional',
    commonSubType: 'standard',
    polygon: createRectPolygon(40.5, 9.5, 6.5, 4.5),
    area: 29.2,
    perimeter: 22.0,
    height: 3.2,
    center: { x: 43.75, y: 11.75 },
    floorId: 'floor_2',
    isAutoDetected: true
  },
  {
    id: 'f2_r212',
    code: '212',
    name: 'Стерильный распределительный коридор и холл оперблока',
    zone: 'circulation',
    cleanliness: 'clean',
    commonSubType: 'hall',
    polygon: createRectPolygon(2, 6.5, 45, 3),
    area: 135.0,
    perimeter: 96.0,
    height: 3.0,
    center: { x: 24.5, y: 8 },
    floorId: 'floor_2',
    isAutoDetected: true
  },
  {
    id: 'f2_r213',
    code: '213',
    name: 'Центральное стерилизационное отделение (ЦСО)',
    zone: 'utility',
    cleanliness: 'clean',
    commonSubType: 'standard',
    polygon: createRectPolygon(2, 0.5, 9, 6),
    area: 54.0,
    perimeter: 30.0,
    height: 3.2,
    center: { x: 6.5, y: 3.5 },
    floorId: 'floor_2',
    isAutoDetected: true
  },
  {
    id: 'f2_r214',
    code: '214',
    name: 'Санпропускник персонала и душевые оперблока',
    zone: 'sanitary',
    cleanliness: 'clean',
    commonSubType: 'restroom',
    polygon: createRectPolygon(11, 0.5, 6, 6),
    area: 36.0,
    perimeter: 24.0,
    height: 3.0,
    center: { x: 14, y: 3.5 },
    floorId: 'floor_2',
    isAutoDetected: true
  },
  {
    id: 'f2_r215',
    code: '215',
    name: 'Больничный лифтовой холл (3 лифта, сквозная шахта)',
    zone: 'vertical',
    cleanliness: 'conditional',
    commonSubType: 'elevator',
    polygon: createRectPolygon(17, 0.5, 6, 6),
    area: 36.0,
    perimeter: 24.0,
    height: 3.5,
    center: { x: 20, y: 3.5 },
    floorId: 'floor_2',
    isAutoDetected: true
  },
  {
    id: 'f2_r216',
    code: '216',
    name: 'Эвакуационная лестничная клетка ЛК-1',
    zone: 'vertical',
    cleanliness: 'conditional',
    commonSubType: 'staircase',
    polygon: createRectPolygon(23, 0.5, 5, 6),
    area: 30.0,
    perimeter: 22.0,
    height: 3.5,
    center: { x: 25.5, y: 3.5 },
    floorId: 'floor_2',
    isAutoDetected: true
  },
  {
    id: 'f2_r218',
    code: '218',
    name: 'Склад стерильных материалов и аппаратуры',
    zone: 'utility',
    cleanliness: 'sterile',
    commonSubType: 'standard',
    polygon: createRectPolygon(28, 0.5, 7, 6),
    area: 42.0,
    perimeter: 26.0,
    height: 3.2,
    center: { x: 31.5, y: 3.5 },
    floorId: 'floor_2',
    isAutoDetected: true
  },
  {
    id: 'f2_r219',
    code: '219',
    name: 'Санитарный узел отделения и МГН',
    zone: 'sanitary',
    cleanliness: 'dirty',
    commonSubType: 'restroom',
    polygon: createRectPolygon(35, 0.5, 7, 6),
    area: 42.0,
    perimeter: 26.0,
    height: 3.0,
    center: { x: 38.5, y: 3.5 },
    floorId: 'floor_2',
    isAutoDetected: true
  },
  {
    id: 'f2_r217',
    code: '217',
    name: 'Служебная лестничная клетка ЛК-2',
    zone: 'vertical',
    cleanliness: 'conditional',
    commonSubType: 'staircase',
    polygon: createRectPolygon(42, 0.5, 5, 6),
    area: 30.0,
    perimeter: 22.0,
    height: 3.5,
    center: { x: 44.5, y: 3.5 },
    floorId: 'floor_2',
    isAutoDetected: true
  }
];

// ============================================================================
// ЭТАЖ 3 (Отм. +7.200): Палатное стационарное отделение с радиусным эркером и скругленным холлом
// ============================================================================
const floor3Rooms: Room[] = [
  {
    id: 'f3_r301',
    code: '301',
    name: 'Угловая палата повышенной комфортности №1 (Скругленный фасад R=2.0м)',
    zone: 'ward',
    cleanliness: 'conditional',
    commonSubType: 'standard',
    polygon: createRectPolygon(2, 9.5, 7.5, 11, [0, 0, 0, 2.2]),
    area: 81.4,
    perimeter: 35.8,
    height: 3.3,
    center: { x: 5.75, y: 15 },
    floorId: 'floor_3',
    isAutoDetected: true
  },
  {
    id: 'f3_r302',
    code: '302',
    name: 'Стационарная палата №2 (3-местная)',
    zone: 'ward',
    cleanliness: 'conditional',
    commonSubType: 'standard',
    polygon: createRectPolygon(9.5, 9.5, 7.5, 11),
    area: 82.5,
    perimeter: 37.0,
    height: 3.3,
    center: { x: 13.25, y: 15 },
    floorId: 'floor_3',
    isAutoDetected: true
  },
  {
    id: 'f3_r303',
    code: '303',
    name: 'Панорамный зал дневного пребывания и зимний сад (Дуговой эркер)',
    zone: 'circulation',
    cleanliness: 'conditional',
    commonSubType: 'hall',
    polygon: [
      { x: 17, y: 9.5, radius: 1.0 },
      { x: 32, y: 9.5, radius: 1.0 },
      { x: 32, y: 20.0, bulge: 0.25 },
      { x: 17, y: 20.0 }
    ],
    area: 176.8,
    perimeter: 53.4,
    height: 3.5,
    center: { x: 24.5, y: 15.2 },
    floorId: 'floor_3',
    isAutoDetected: true
  },
  {
    id: 'f3_r304',
    code: '304',
    name: 'Стационарная палата №3 (3-местная)',
    zone: 'ward',
    cleanliness: 'conditional',
    commonSubType: 'standard',
    polygon: createRectPolygon(32, 9.5, 7.5, 11),
    area: 82.5,
    perimeter: 37.0,
    height: 3.3,
    center: { x: 35.75, y: 15 },
    floorId: 'floor_3',
    isAutoDetected: true
  },
  {
    id: 'f3_r305',
    code: '305',
    name: 'Угловая палата повышенной комфортности №4 (Скругленный фасад R=2.0м)',
    zone: 'ward',
    cleanliness: 'conditional',
    commonSubType: 'standard',
    polygon: createRectPolygon(39.5, 9.5, 7.5, 11, [0, 0, 2.2, 0]),
    area: 81.4,
    perimeter: 35.8,
    height: 3.3,
    center: { x: 43.25, y: 15 },
    floorId: 'floor_3',
    isAutoDetected: true
  },
  {
    id: 'f3_r306',
    code: '306',
    name: 'Светлый коридор палатного отделения и пост медсестры',
    zone: 'circulation',
    cleanliness: 'conditional',
    commonSubType: 'hall',
    polygon: createRectPolygon(2, 6.5, 45, 3),
    area: 135.0,
    perimeter: 96.0,
    height: 3.0,
    center: { x: 24.5, y: 8 },
    floorId: 'floor_3',
    isAutoDetected: true
  },
  {
    id: 'f3_r307',
    code: '307',
    name: 'Процедурный и перевязочный кабинет стационара',
    zone: 'icu',
    cleanliness: 'clean',
    commonSubType: 'standard',
    polygon: createRectPolygon(2, 0.5, 9, 6),
    area: 54.0,
    perimeter: 30.0,
    height: 3.2,
    center: { x: 6.5, y: 3.5 },
    floorId: 'floor_3',
    isAutoDetected: true
  },
  {
    id: 'f3_r308',
    code: '308',
    name: 'Кабинет старшей медсестры и сестринская',
    zone: 'staff',
    cleanliness: 'conditional',
    commonSubType: 'standard',
    polygon: createRectPolygon(11, 0.5, 6, 6),
    area: 36.0,
    perimeter: 24.0,
    height: 3.2,
    center: { x: 14, y: 3.5 },
    floorId: 'floor_3',
    isAutoDetected: true
  },
  {
    id: 'f3_r309',
    code: '309',
    name: 'Больничный лифтовой холл (3 лифта, сквозная шахта)',
    zone: 'vertical',
    cleanliness: 'conditional',
    commonSubType: 'elevator',
    polygon: createRectPolygon(17, 0.5, 6, 6),
    area: 36.0,
    perimeter: 24.0,
    height: 3.5,
    center: { x: 20, y: 3.5 },
    floorId: 'floor_3',
    isAutoDetected: true
  },
  {
    id: 'f3_r310',
    code: '310',
    name: 'Эвакуационная лестничная клетка ЛК-1',
    zone: 'vertical',
    cleanliness: 'conditional',
    commonSubType: 'staircase',
    polygon: createRectPolygon(23, 0.5, 5, 6),
    area: 30.0,
    perimeter: 22.0,
    height: 3.5,
    center: { x: 25.5, y: 3.5 },
    floorId: 'floor_3',
    isAutoDetected: true
  },
  {
    id: 'f3_r311',
    code: '311',
    name: 'Буфетная и столовая для пациентов стационара',
    zone: 'utility',
    cleanliness: 'conditional',
    commonSubType: 'standard',
    polygon: createRectPolygon(28, 0.5, 7, 6),
    area: 42.0,
    perimeter: 26.0,
    height: 3.2,
    center: { x: 31.5, y: 3.5 },
    floorId: 'floor_3',
    isAutoDetected: true
  },
  {
    id: 'f3_r312',
    code: '312',
    name: 'Санитарно-гигиенический блок и душевые палат',
    zone: 'sanitary',
    cleanliness: 'dirty',
    commonSubType: 'restroom',
    polygon: createRectPolygon(35, 0.5, 7, 6),
    area: 42.0,
    perimeter: 26.0,
    height: 3.0,
    center: { x: 38.5, y: 3.5 },
    floorId: 'floor_3',
    isAutoDetected: true
  },
  {
    id: 'f3_r313',
    code: '313',
    name: 'Служебная лестничная клетка ЛК-2',
    zone: 'vertical',
    cleanliness: 'conditional',
    commonSubType: 'staircase',
    polygon: createRectPolygon(42, 0.5, 5, 6),
    area: 30.0,
    perimeter: 22.0,
    height: 3.5,
    center: { x: 44.5, y: 3.5 },
    floorId: 'floor_3',
    isAutoDetected: true
  }
];

// Normalize exact curved areas on sample rooms
[floor1Rooms, floor2Rooms, floor3Rooms].forEach(roomList => {
  roomList.forEach(r => {
    if (hasCurvedGeometry(r.polygon)) {
      r.area = Number(calculatePolygonArea(r.polygon).toFixed(1));
      r.perimeter = Number(calculatePolygonPerimeter(r.polygon).toFixed(1));
    }
  });
});

const f1Data = buildFloorCadData(floor1Rooms, 48, 21.5, 'f1');
const f2Data = buildFloorCadData(floor2Rooms, 48, 21.5, 'f2');
const f3Data = buildFloorCadData(floor3Rooms, 48, 21.5, 'f3');

export const SAMPLE_FLOOR_1: FloorPlan = {
  id: 'floor_1',
  name: '1-й Этаж: Приемно-диагностическое отделение и Скорая помощь',
  buildingName: DEFAULT_HOSPITAL_BUILDING.name,
  floorNumber: 1,
  scale: 1.0,
  elevation: 0.0,
  cadLines: f1Data.lines,
  cadTexts: f1Data.texts,
  cadLayers: [
    { name: 'СТЕНЫ_НЕСУЩИЕ', color: '#0f172a', visible: true, count: 4 },
    { name: 'СТЕНЫ_ВНУТРЕННИЕ', color: '#475569', visible: true, count: 64 },
    { name: 'ДВЕРИ', color: '#64748b', visible: true, count: 15 },
    { name: 'ОКНА', color: '#38bdf8', visible: true, count: 14 },
    { name: 'ОСИ_КООРДИНАТНЫЕ', color: '#94a3b8', visible: true, count: 13 },
    { name: 'ПОДПИСИ_ПОМЕЩЕНИЙ', color: '#1e293b', visible: true, count: 16 }
  ],
  rooms: floor1Rooms,
  walls: f1Data.walls,
  dimensions: {
    width: 48,
    length: 21.5
  }
};

export const SAMPLE_FLOOR_2: FloorPlan = {
  id: 'floor_2',
  name: '2-й Этаж: Хирургический блок и Реанимация (ОРИТ)',
  buildingName: DEFAULT_HOSPITAL_BUILDING.name,
  floorNumber: 2,
  scale: 1.0,
  elevation: 3.6,
  cadLines: f2Data.lines,
  cadTexts: f2Data.texts,
  cadLayers: [
    { name: 'СТЕНЫ_НЕСУЩИЕ', color: '#0f172a', visible: true, count: 4 },
    { name: 'СТЕНЫ_ВНУТРЕННИЕ', color: '#475569', visible: true, count: 76 },
    { name: 'ДВЕРИ', color: '#64748b', visible: true, count: 18 },
    { name: 'ОКНА', color: '#38bdf8', visible: true, count: 14 },
    { name: 'ОСИ_КООРДИНАТНЫЕ', color: '#94a3b8', visible: true, count: 13 },
    { name: 'ПОДПИСИ_ПОМЕЩЕНИЙ', color: '#1e293b', visible: true, count: 19 }
  ],
  rooms: floor2Rooms,
  walls: f2Data.walls,
  dimensions: {
    width: 48,
    length: 21.5
  }
};

export const SAMPLE_FLOOR_3: FloorPlan = {
  id: 'floor_3',
  name: '3-й Этаж: Стационарное палатное отделение и Эркер-холл',
  buildingName: DEFAULT_HOSPITAL_BUILDING.name,
  floorNumber: 3,
  scale: 1.0,
  elevation: 7.2,
  cadLines: f3Data.lines,
  cadTexts: f3Data.texts,
  cadLayers: [
    { name: 'СТЕНЫ_НЕСУЩИЕ', color: '#0f172a', visible: true, count: 4 },
    { name: 'СТЕНЫ_ВНУТРЕННИЕ', color: '#475569', visible: true, count: 68 },
    { name: 'ДВЕРИ', color: '#64748b', visible: true, count: 13 },
    { name: 'ОКНА', color: '#38bdf8', visible: true, count: 12 },
    { name: 'ОСИ_КООРДИНАТНЫЕ', color: '#94a3b8', visible: true, count: 13 },
    { name: 'ПОДПИСИ_ПОМЕЩЕНИЙ', color: '#1e293b', visible: true, count: 13 }
  ],
  rooms: floor3Rooms,
  walls: f3Data.walls,
  dimensions: {
    width: 48,
    length: 21.5
  }
};

export const ALL_BUILDING_FLOORS: FloorPlan[] = [
  SAMPLE_FLOOR_1,
  SAMPLE_FLOOR_2,
  SAMPLE_FLOOR_3
];
