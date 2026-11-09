export type HospitalZone = 
  | 'surgery'        // Операционный блок (Стерильная зона)
  | 'icu'            // Реанимация и интенсивная терапия (ОРИТ)
  | 'ward'           // Палатное отделение
  | 'staff'          // Ординаторские, кабинеты врачей, сестринские
  | 'circulation'    // Коридоры, холлы, залы ожидания, вестибюли
  | 'vertical'       // Лифты, лестничные клетки
  | 'utility'        // Технические, стерилизационные, шлюзы
  | 'sanitary';      // Санузлы, туалеты, душевые, дезбарьеры

export type CleanlinessClass = 
  | 'sterile'        // Особо чистые (Операционные, стерильные боксы) - Класс А
  | 'clean'          // Чистые (ОРИТ, предоперационные, процедурные) - Класс Б
  | 'conditional'    // Условно чистые (Палаты, ординаторские, холлы) - Класс В
  | 'dirty';         // Грязные (Санузлы, отходы, техпомещения) - Класс Г

export type CommonSubType = 
  | 'staircase'      // Лестничная клетка (3D марши и ступени)
  | 'elevator'       // Лифтовой узел / шахта (3D кабина и шахта)
  | 'hall'           // Общий холл / вестибюль / зал (3D стойка поста и инфозона)
  | 'restroom'       // Санузел / туалет / МГН (3D сантехнические перегородки)
  | 'standard';      // Стандартное медицинское / служебное помещение

export interface Point2D {
  x: number;
  y: number;
  /** Радиус скругления угла в данной вершине (в метрах, 0 = прямой/острый угол) */
  radius?: number;
  /** Коэффициент кривизны (прогиба) сегмента от этой точки к следующей (DXF group 42: tan(theta/4)) */
  bulge?: number;
}

export interface CADLine {
  id: string;
  start: Point2D;
  end: Point2D;
  layer: string;
  color?: string;
}

export interface CADText {
  id: string;
  text: string;
  position: Point2D;
  height: number;
  rotation?: number;
  layer: string;
}

export interface CADLayer {
  name: string;
  color: string;
  visible: boolean;
  count: number;
}

export interface Room {
  id: string;
  code: string;            // Номер помещения (e.g., 201)
  name: string;            // Наименование (e.g., "Операционная №1")
  zone: HospitalZone;      // Назначение / Зона
  cleanliness: CleanlinessClass; // Класс чистоты
  commonSubType?: CommonSubType; // Подтип общей/инженерной зоны для 3D-символов
  polygon: Point2D[];      // Точки контура в метрах (включая радиусы скругления и дуги)
  area: number;            // Площадь в м²
  perimeter: number;       // Периметр в м
  height: number;          // Высота стен / потолка в м (default ~3.3m)
  center: Point2D;         // Центр для подписи
  color?: string;          // Пользовательский цвет (опционально)
  floorId: string;
  isAutoDetected?: boolean;
}

export interface WallSegment {
  id: string;
  start: Point2D;
  end: Point2D;
  thickness: number; // e.g. 0.2m or 0.38m
  height: number;    // e.g. 3.3m
  isPartition?: boolean; // перегородка vs несущая стена
}

export interface FloorPlan {
  id: string;
  name: string;
  buildingName: string;
  floorNumber: number;
  scale: number;           // drawing units per meter
  elevation: number;       // высотная отметка (e.g. 0.000, +3.600, +7.200)
  cadLines: CADLine[];
  cadTexts: CADText[];
  cadLayers: CADLayer[];
  rooms: Room[];
  walls: WallSegment[];
  dimensions: {
    width: number;         // габарит в метрах
    length: number;        // габарит в метрах
  };
}

export interface HospitalBuilding {
  id: string;
  name: string;            // Наименование конкретного здания
  projectCode: string;     // Шифр проекта (напр., КБ-2026-ГК1)
  address: string;         // Адрес / площадка строительства
  typicalFloorHeight: number; // Высота типового этажа в м
  structuralGrid: string;  // Сетка колонн (напр., 6.0 × 6.0 м)
}

export const ZONE_CONFIG: Record<HospitalZone, { label: string; color: string; hex: number; bgClass: string; borderClass: string; textClass: string }> = {
  surgery: {
    label: 'Операционный блок',
    color: '#0d9488', // Teal 600
    hex: 0x0d9488,
    bgClass: 'bg-teal-50',
    borderClass: 'border-teal-400',
    textClass: 'text-teal-800'
  },
  icu: {
    label: 'Реанимация / ОРИТ',
    color: '#0284c7', // Sky 600
    hex: 0x0284c7,
    bgClass: 'bg-sky-50',
    borderClass: 'border-sky-400',
    textClass: 'text-sky-800'
  },
  ward: {
    label: 'Палатное отделение',
    color: '#3b82f6', // Blue 500
    hex: 0x3b82f6,
    bgClass: 'bg-blue-50',
    borderClass: 'border-blue-400',
    textClass: 'text-blue-800'
  },
  staff: {
    label: 'Врачи и персонал',
    color: '#10b981', // Emerald 500
    hex: 0x10b981,
    bgClass: 'bg-emerald-50',
    borderClass: 'border-emerald-400',
    textClass: 'text-emerald-800'
  },
  circulation: {
    label: 'Холлы и коридоры',
    color: '#64748b', // Slate 500
    hex: 0x64748b,
    bgClass: 'bg-slate-50',
    borderClass: 'border-slate-400',
    textClass: 'text-slate-700'
  },
  vertical: {
    label: 'Лестницы и лифты',
    color: '#6366f1', // Indigo 500
    hex: 0x6366f1,
    bgClass: 'bg-indigo-50',
    borderClass: 'border-indigo-400',
    textClass: 'text-indigo-800'
  },
  utility: {
    label: 'Стерилизация / Тех.',
    color: '#d97706', // Amber 600
    hex: 0xd97706,
    bgClass: 'bg-amber-50',
    borderClass: 'border-amber-400',
    textClass: 'text-amber-800'
  },
  sanitary: {
    label: 'Санузлы и шлюзы',
    color: '#8b5cf6', // Violet 500
    hex: 0x8b5cf6,
    bgClass: 'bg-violet-50',
    borderClass: 'border-violet-400',
    textClass: 'text-violet-800'
  }
};

export const COMMON_SUBTYPE_CONFIG: Record<CommonSubType, { label: string; shortLabel: string; description: string }> = {
  staircase: {
    label: 'Лестничная клетка',
    shortLabel: 'Лестница',
    description: 'Эвакуационный или межэтажный лестничный марш'
  },
  elevator: {
    label: 'Лифтовой узел / Шахта',
    shortLabel: 'Лифты',
    description: 'Больничные и пассажирские лифты со сквозной шахтой'
  },
  hall: {
    label: 'Общий холл / Зал / Пост',
    shortLabel: 'Холл / Зал',
    description: 'Распределительный вестибюль, зал ожидания или коридор'
  },
  restroom: {
    label: 'Санитарный узел / WC',
    shortLabel: 'Санузел',
    description: 'Туалеты, душевые, санитарные комнаты МГН и шлюзы'
  },
  standard: {
    label: 'Медицинское помещение',
    shortLabel: 'Кабинет / Палата',
    description: 'Основное лечебно-диагностическое или служебное помещение'
  }
};

export const CLEANLINESS_CONFIG: Record<CleanlinessClass, { label: string; badge: string; color: string }> = {
  sterile: { label: 'Класс А (Особо стерильно)', badge: 'Класс А', color: '#0d9488' },
  clean: { label: 'Класс Б (Чистое помещение)', badge: 'Класс Б', color: '#0284c7' },
  conditional: { label: 'Класс В (Условно чистое)', badge: 'Класс В', color: '#10b981' },
  dirty: { label: 'Класс Г (Грязное / Техн.)', badge: 'Класс Г', color: '#64748b' }
};
