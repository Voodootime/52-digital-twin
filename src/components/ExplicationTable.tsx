import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  FloorPlan,
  Room,
  HospitalZone,
  CommonSubType,
  CleanlinessClass,
  ZONE_CONFIG,
  CLEANLINESS_CONFIG,
  COMMON_SUBTYPE_CONFIG
} from '../types/cad';
import {
  hasCurvedGeometry,
  calculatePolygonArea,
  calculatePolygonPerimeter
} from '../services/dxfParser';
import {
  Search,
  Download,
  Plus,
  Trash2,
  Table,
  Sliders,
  Box,
  Ruler,
  Spline,
  ArrowUp,
  ArrowDown
} from 'lucide-react';

interface ExplicationTableProps {
  floorPlan: FloorPlan;
  allFloors: FloorPlan[];
  selectedRoomId: string | null;
  onSelectRoom: (roomId: string | null, floorId?: string) => void;
  onUpdateRoom: (updatedRoom: Room, floorId?: string) => void;
  onDeleteRoom: (roomId: string, floorId?: string) => void;
  onOpenManualDraw: () => void;
}

type SortField = 'code' | 'name' | 'area' | 'height';
type SortOrder = 'asc' | 'desc';
type QuickCategoryFilter = 'ALL' | 'MEDICAL' | 'HALLS' | 'VERTICAL' | 'SANITARY';

const CORNER_RADII = [0, 0.5, 1.0, 1.5, 2.0, 3.0];

export const ExplicationTable: React.FC<ExplicationTableProps> = ({
  floorPlan,
  allFloors,
  selectedRoomId,
  onSelectRoom,
  onUpdateRoom,
  onDeleteRoom,
  onOpenManualDraw
}) => {
  const [activeTab, setActiveTab] = useState<'table' | 'inspector'>('table');
  const [searchQuery, setSearchQuery] = useState('');
  const [quickCategory, setQuickCategory] = useState<QuickCategoryFilter>('ALL');
  const [scopeMode, setScopeMode] = useState<'floor' | 'building'>('floor');
  const [sortField, setSortField] = useState<SortField>('code');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  const selectedRowRef = useRef<HTMLTableRowElement | null>(null);

  // When room is selected, keep in sync
  useEffect(() => {
    if (selectedRoomId && selectedRowRef.current) {
      selectedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedRoomId]);

  // Source rooms based on scope ('floor' vs 'building')
  const sourceRoomsWithFloor = useMemo(() => {
    if (scopeMode === 'floor') {
      return floorPlan.rooms.map(room => ({ room, floor: floorPlan }));
    }
    const sortedFloors = [...allFloors].sort((a, b) => a.floorNumber - b.floorNumber);
    return sortedFloors.flatMap(f => f.rooms.map(room => ({ room, floor: f })));
  }, [scopeMode, floorPlan, allFloors]);

  // Currently selected room object + floor
  const selectedRoomContext = useMemo(() => {
    if (!selectedRoomId) return null;
    return sourceRoomsWithFloor.find(item => item.room.id === selectedRoomId) || null;
  }, [selectedRoomId, sourceRoomsWithFloor]);

  // Statistics
  const stats = useMemo(() => {
    const rooms = sourceRoomsWithFloor.map(x => x.room);
    const totalArea = rooms.reduce((acc, r) => acc + r.area, 0);
    const sterileCleanArea = rooms
      .filter(r => r.cleanliness === 'sterile' || r.cleanliness === 'clean')
      .reduce((acc, r) => acc + r.area, 0);
    const commonArea = rooms
      .filter(
        r =>
          r.zone === 'circulation' ||
          r.zone === 'sanitary' ||
          (r.commonSubType && r.commonSubType !== 'standard')
      )
      .reduce((acc, r) => acc + r.area, 0);

    return {
      count: rooms.length,
      totalArea: totalArea.toFixed(1),
      sterileCleanArea: sterileCleanArea.toFixed(1),
      commonArea: commonArea.toFixed(1)
    };
  }, [sourceRoomsWithFloor]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // Filtered and Sorted rooms
  const processedItems = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const filtered = sourceRoomsWithFloor.filter(({ room }) => {
      const matchesSearch =
        room.name.toLowerCase().includes(q) ||
        room.code.toLowerCase().includes(q);

      let matchesQuick = true;
      const st = room.commonSubType || 'standard';
      if (quickCategory === 'MEDICAL') {
        matchesQuick =
          room.zone === 'surgery' ||
          room.zone === 'icu' ||
          room.zone === 'ward' ||
          room.zone === 'staff' ||
          room.zone === 'utility';
      } else if (quickCategory === 'HALLS') {
        matchesQuick = st === 'hall' || (room.zone === 'circulation' && st === 'standard');
      } else if (quickCategory === 'VERTICAL') {
        matchesQuick = st === 'staircase' || st === 'elevator';
      } else if (quickCategory === 'SANITARY') {
        matchesQuick = st === 'restroom' || room.zone === 'sanitary';
      }

      return matchesSearch && matchesQuick;
    });

    return filtered.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'code') {
        cmp = a.room.code.localeCompare(b.room.code, undefined, { numeric: true });
      } else if (sortField === 'name') {
        cmp = a.room.name.localeCompare(b.room.name);
      } else if (sortField === 'area') {
        cmp = a.room.area - b.room.area;
      } else if (sortField === 'height') {
        cmp = a.room.height - b.room.height;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [sourceRoomsWithFloor, searchQuery, quickCategory, sortField, sortOrder]);

  // Inspector handlers for selected room
  const handleApplyFilletRadius = (targetRoom: Room, floorId: string, radius: number) => {
    const newPoly = targetRoom.polygon.map(pt => ({
      ...pt,
      radius: radius > 0 ? radius : undefined
    }));
    const newArea = calculatePolygonArea(newPoly);
    const newPerimeter = calculatePolygonPerimeter(newPoly);
    onUpdateRoom(
      {
        ...targetRoom,
        polygon: newPoly,
        area: newArea,
        perimeter: newPerimeter
      },
      floorId
    );
  };

  const handleQuickSubTypeChange = (
    targetRoom: Room,
    floorId: string,
    subType: CommonSubType
  ) => {
    onUpdateRoom(
      {
        ...targetRoom,
        commonSubType: subType
      },
      floorId
    );
  };

  // Export handlers
  const handleExportCSV = () => {
    const headers = [
      'Код',
      'Этаж',
      'Наименование',
      'Зона',
      'Класс чистоты',
      '3D-Символ',
      'Площадь (м2)',
      'Высота (м)',
      'Периметр (м)'
    ];
    const rows = processedItems.map(({ room, floor }) => [
      `"${room.code}"`,
      `"${floor.floorNumber}"`,
      `"${room.name.replace(/"/g, '""')}"`,
      `"${ZONE_CONFIG[room.zone]?.label || room.zone}"`,
      `"${CLEANLINESS_CONFIG[room.cleanliness]?.badge || room.cleanliness}"`,
      `"${COMMON_SUBTYPE_CONFIG[room.commonSubType || 'standard']?.label || 'Стандарт'}"`,
      room.area.toFixed(2),
      room.height.toFixed(2),
      room.perimeter.toFixed(2)
    ]);
    const csvContent =
      '\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Экспликация_${scopeMode === 'building' ? 'Здание' : floorPlan.name}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const currentUniformRadius = selectedRoomContext?.room.polygon.find(
    p => (p.radius || 0) > 0
  )?.radius || 0;

  return (
    <div className="flex flex-col h-full bg-white border-l border-slate-200 select-none text-xs">
      {/* Top Tab Bar: Unified Table & Inspector */}
      <div className="h-11 px-3 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 bg-slate-200/80 p-0.5 rounded-lg border border-slate-300/60">
          <button
            type="button"
            onClick={() => setActiveTab('table')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'table'
                ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Table className="w-3.5 h-3.5" />
            <span>Ведомость</span>
            <span className="font-mono text-[10px] text-slate-400 tabular-nums">
              ({processedItems.length})
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('inspector')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'inspector'
                ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Свойства</span>
            {selectedRoomContext && (
              <span className="font-mono text-[10px] font-semibold text-sky-700 bg-sky-50 px-1 rounded tabular-nums">
                №{selectedRoomContext.room.code}
              </span>
            )}
          </button>
        </div>

        {/* Scope Mode (Floor vs Building) */}
        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-md border border-slate-200 text-[10px]">
          <button
            type="button"
            onClick={() => setScopeMode('floor')}
            className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
              scopeMode === 'floor'
                ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
            title="Показать только текущий этаж"
          >
            Этаж
          </button>
          <button
            type="button"
            onClick={() => setScopeMode('building')}
            className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
              scopeMode === 'building'
                ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
            title="Показать экспликацию всех этажей корпуса"
          >
            Корпус
          </button>
        </div>
      </div>

      {/* TAB 1: TABLE (ВЕДОМОСТЬ ПОМЕЩЕНИЙ) */}
      {activeTab === 'table' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Header Controls: Search & Category Filter */}
          <div className="p-3 border-b border-slate-100 space-y-2 bg-white shrink-0">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Поиск по названию или номеру..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs placeholder:text-slate-400 focus:outline-hidden focus:ring-1 focus:ring-sky-500 focus:bg-white transition-all"
              />
            </div>

            {/* Quick Category Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5 text-[11px]">
              {(
                [
                  { id: 'ALL', label: 'Все' },
                  { id: 'MEDICAL', label: 'Мед. блоки' },
                  { id: 'HALLS', label: 'Холлы' },
                  { id: 'VERTICAL', label: 'Лифты / ЛК' },
                  { id: 'SANITARY', label: 'WC' }
                ] as const
              ).map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setQuickCategory(cat.id)}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    quickCategory === cat.id
                      ? 'bg-slate-900 text-white shadow-2xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Quick Area Metric Indicators (Unboxed) */}
            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100 tabular-nums">
              <span>
                Всего: <strong className="text-slate-800 font-mono">{stats.totalArea} м²</strong>
              </span>
              <span>·</span>
              <span>
                Стерильные/чистые:{' '}
                <strong className="text-emerald-700 font-mono">{stats.sterileCleanArea} м²</strong>
              </span>
              <span>·</span>
              <span>
                Общие зоны:{' '}
                <strong className="text-indigo-700 font-mono">{stats.commonArea} м²</strong>
              </span>
            </div>
          </div>

          {/* Table Data Viewport */}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full border-collapse text-left">
              <thead className="bg-slate-50 text-[10px] text-slate-500 uppercase tracking-wider sticky top-0 border-b border-slate-200 z-10 select-none">
                <tr>
                  <th
                    className="py-2 px-2.5 font-semibold cursor-pointer hover:text-slate-800"
                    onClick={() => handleSort('code')}
                  >
                    <div className="flex items-center gap-1">
                      <span>№</span>
                      {sortField === 'code' &&
                        (sortOrder === 'asc' ? (
                          <ArrowUp className="w-2.5 h-2.5" />
                        ) : (
                          <ArrowDown className="w-2.5 h-2.5" />
                        ))}
                    </div>
                  </th>
                  <th
                    className="py-2 px-2 font-semibold cursor-pointer hover:text-slate-800"
                    onClick={() => handleSort('name')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Помещение</span>
                      {sortField === 'name' &&
                        (sortOrder === 'asc' ? (
                          <ArrowUp className="w-2.5 h-2.5" />
                        ) : (
                          <ArrowDown className="w-2.5 h-2.5" />
                        ))}
                    </div>
                  </th>
                  <th className="py-2 px-2 font-semibold">Зона</th>
                  <th
                    className="py-2 px-2.5 font-semibold text-right cursor-pointer hover:text-slate-800"
                    onClick={() => handleSort('area')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Площадь</span>
                      {sortField === 'area' &&
                        (sortOrder === 'asc' ? (
                          <ArrowUp className="w-2.5 h-2.5" />
                        ) : (
                          <ArrowDown className="w-2.5 h-2.5" />
                        ))}
                    </div>
                  </th>
                  <th className="py-2 px-2 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {processedItems.map(({ room, floor }) => {
                  const isSelected = selectedRoomId === room.id;
                  const zoneCfg = ZONE_CONFIG[room.zone] || ZONE_CONFIG.circulation;
                  const cleanCfg =
                    CLEANLINESS_CONFIG[room.cleanliness] || CLEANLINESS_CONFIG.conditional;
                  const subType = room.commonSubType || 'standard';
                  const subCfg = COMMON_SUBTYPE_CONFIG[subType];
                  const isCurved = hasCurvedGeometry(room.polygon);

                  return (
                    <tr
                      key={room.id}
                      ref={isSelected ? selectedRowRef : null}
                      onClick={() => onSelectRoom(room.id, floor.id)}
                      onDoubleClick={() => setActiveTab('inspector')}
                      className={`transition-colors cursor-pointer group ${
                        isSelected
                          ? 'bg-sky-50/90 font-medium'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      {/* Code */}
                      <td className="py-2 px-2.5 font-mono text-[11px] font-bold text-slate-700 whitespace-nowrap tabular-nums">
                        <div className="flex items-center gap-1">
                          <span
                            className="w-1.5 h-1.5 rounded-full inline-block shrink-0"
                            style={{ backgroundColor: zoneCfg.color }}
                          />
                          <span>{room.code}</span>
                        </div>
                      </td>

                      {/* Name */}
                      <td className="py-2 px-2 min-w-0">
                        <div>
                          <div className="font-medium text-slate-800 line-clamp-1">
                            {room.name}
                          </div>
                          <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5 flex-wrap">
                            <span>{cleanCfg.badge}</span>
                            <span>·</span>
                            <span className="font-mono text-slate-500 tabular-nums">
                              H={room.height}м
                            </span>
                            {subType !== 'standard' && (
                              <>
                                <span>·</span>
                                <span
                                  className="font-semibold"
                                  style={{ color: zoneCfg.color }}
                                >
                                  {subCfg.shortLabel}
                                </span>
                              </>
                            )}
                            {isCurved && (
                              <>
                                <span>·</span>
                                <span className="text-teal-700 font-mono font-medium">
                                  R-контур
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Zone */}
                      <td className="py-2 px-2 whitespace-nowrap">
                        <span
                          className="text-[11px] font-medium"
                          style={{ color: zoneCfg.color }}
                        >
                          {zoneCfg.label}
                        </span>
                      </td>

                      {/* Area */}
                      <td className="py-2 px-2.5 text-right font-mono font-semibold text-slate-800 whitespace-nowrap tabular-nums">
                        {room.area.toFixed(1)} м²
                      </td>

                      {/* Actions */}
                      <td className="py-2 px-2 text-right">
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            onSelectRoom(room.id, floor.id);
                            setActiveTab('inspector');
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-sky-700 hover:bg-slate-100 rounded transition-all cursor-pointer"
                          title="Открыть свойства помещения"
                        >
                          <Sliders className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {processedItems.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400 text-xs">
                      Помещения не найдены по выбранному фильтру
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Footer Bar: Export CSV & Manual Draw Button */}
          <div className="p-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
            <button
              type="button"
              onClick={onOpenManualDraw}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 rounded-md transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-sky-600" />
              <span>Добавить помещение</span>
            </button>

            <button
              type="button"
              onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 rounded-md transition-colors cursor-pointer"
              title="Скачать ведомость помещений в формате CSV"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Экспорт CSV</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB 2: INSPECTOR (СВОЙСТВА ВЫБРАННОГО ПОМЕЩЕНИЯ) */}
      {activeTab === 'inspector' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {selectedRoomContext ? (
            <>
              {/* Selected Room Header */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{
                        backgroundColor:
                          ZONE_CONFIG[selectedRoomContext.room.zone]?.color || '#475569'
                      }}
                    />
                    <span className="font-mono font-bold text-sm text-slate-900 tabular-nums">
                      №{selectedRoomContext.room.code}
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="text-[11px] font-semibold text-slate-700">
                      {ZONE_CONFIG[selectedRoomContext.room.zone]?.label}
                    </span>
                  </div>

                  <span className="text-[10px] font-mono text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200 tabular-nums">
                    {selectedRoomContext.floor.floorNumber} этаж (+
                    {selectedRoomContext.floor.elevation.toFixed(2)}м)
                  </span>
                </div>

                <div className="font-semibold text-slate-900 text-sm leading-snug">
                  {selectedRoomContext.room.name}
                </div>

                <div className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap pt-0.5">
                  <span className="font-medium text-slate-700">
                    {CLEANLINESS_CONFIG[selectedRoomContext.room.cleanliness]?.badge}
                  </span>
                  <span>·</span>
                  <span className="text-slate-600">
                    {
                      COMMON_SUBTYPE_CONFIG[
                        selectedRoomContext.room.commonSubType || 'standard'
                      ]?.label
                    }
                  </span>
                </div>
              </div>

              {/* Key Geometry Numbers */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    <Ruler className="w-3 h-3 text-slate-500" /> Площадь помещения
                  </span>
                  <span className="font-mono font-bold text-slate-900 text-base tabular-nums">
                    {selectedRoomContext.room.area.toFixed(1)} м²
                  </span>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    <Box className="w-3 h-3 text-slate-500" /> Высота стен
                  </span>
                  <span className="font-mono font-bold text-slate-900 text-base tabular-nums">
                    {selectedRoomContext.room.height.toFixed(1)} м
                  </span>
                </div>
              </div>

              {/* Corner Fillet Radius Selector (R) */}
              <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                    <Spline className="w-3.5 h-3.5 text-sky-600" />
                    Радиус скругления углов (R)
                  </span>
                  <span className="font-mono text-[11px] font-semibold text-slate-700 tabular-nums">
                    {currentUniformRadius > 0 ? `R=${currentUniformRadius}м` : 'Прямые (90°)'}
                  </span>
                </div>

                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Быстрое сопряжение и скругление углов контура для чистых операционных блоков и холлов.
                </p>

                <div className="grid grid-cols-6 gap-1 pt-1">
                  {CORNER_RADII.map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() =>
                        handleApplyFilletRadius(
                          selectedRoomContext.room,
                          selectedRoomContext.floor.id,
                          r
                        )
                      }
                      className={`py-1.5 rounded font-mono text-[11px] font-semibold transition-all cursor-pointer tabular-nums border ${
                        currentUniformRadius === r
                          ? 'bg-sky-600 text-white border-sky-600 shadow-2xs'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {r === 0 ? '0м' : `${r}м`}
                    </button>
                  ))}
                </div>
              </div>

              {/* 3D Common-Zone Marker Selector */}
              <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
                <span className="text-xs font-semibold text-slate-800 block">
                  3D-символ общей / вертикальной зоны
                </span>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Отображает процедурные 3D-модели (ступени лестниц, кабина лифта, сантехника) внутри контура.
                </p>

                <div className="grid grid-cols-5 gap-1.5 pt-1">
                  {(Object.keys(COMMON_SUBTYPE_CONFIG) as CommonSubType[]).map(st => {
                    const cfg = COMMON_SUBTYPE_CONFIG[st];
                    const active = (selectedRoomContext.room.commonSubType || 'standard') === st;
                    return (
                      <button
                        key={st}
                        type="button"
                        onClick={() =>
                          handleQuickSubTypeChange(
                            selectedRoomContext.room,
                            selectedRoomContext.floor.id,
                            st
                          )
                        }
                        className={`py-1.5 px-1 rounded text-[11px] font-medium transition-all cursor-pointer border truncate text-center ${
                          active
                            ? 'bg-slate-900 text-white border-slate-900 shadow-2xs font-semibold'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                        title={cfg.description}
                      >
                        {cfg.shortLabel}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Functional Parameters Form */}
              <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-3">
                <span className="text-xs font-semibold text-slate-800 block">
                  Параметры назначения и СанПиН
                </span>

                <div className="space-y-2.5">
                  <div>
                    <label className="text-[10px] text-slate-500 font-medium block mb-1">
                      Наименование помещения
                    </label>
                    <input
                      type="text"
                      value={selectedRoomContext.room.name}
                      onChange={e =>
                        onUpdateRoom(
                          { ...selectedRoomContext.room, name: e.target.value },
                          selectedRoomContext.floor.id
                        )
                      }
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-500 font-medium block mb-1">
                        Функциональная зона
                      </label>
                      <select
                        value={selectedRoomContext.room.zone}
                        onChange={e =>
                          onUpdateRoom(
                            {
                              ...selectedRoomContext.room,
                              zone: e.target.value as HospitalZone
                            },
                            selectedRoomContext.floor.id
                          )
                        }
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
                      >
                        {Object.entries(ZONE_CONFIG).map(([k, cfg]) => (
                          <option key={k} value={k}>
                            {cfg.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] text-slate-500 font-medium block mb-1">
                        Класс чистоты СанПиН
                      </label>
                      <select
                        value={selectedRoomContext.room.cleanliness}
                        onChange={e =>
                          onUpdateRoom(
                            {
                              ...selectedRoomContext.room,
                              cleanliness: e.target.value as CleanlinessClass
                            },
                            selectedRoomContext.floor.id
                          )
                        }
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
                      >
                        {Object.entries(CLEANLINESS_CONFIG).map(([k, cfg]) => (
                          <option key={k} value={k}>
                            {cfg.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-500 font-medium block mb-1">
                      Высота стен 3D (м)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="1.0"
                      max="6.0"
                      value={selectedRoomContext.room.height}
                      onChange={e =>
                        onUpdateRoom(
                          {
                            ...selectedRoomContext.room,
                            height: parseFloat(e.target.value) || 3.3
                          },
                          selectedRoomContext.floor.id
                        )
                      }
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono tabular-nums"
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
                  <span>
                    Периметр: <strong className="text-slate-800 font-mono">{selectedRoomContext.room.perimeter.toFixed(1)} м</strong>
                  </span>
                  <span>
                    Центр: <span className="font-mono text-slate-700">X:{selectedRoomContext.room.center.x}м, Y:{selectedRoomContext.room.center.y}м</span>
                  </span>
                </div>
              </div>

              {/* Danger Zone: Delete Room */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() =>
                    onDeleteRoom(selectedRoomContext.room.id, selectedRoomContext.floor.id)
                  }
                  className="w-full py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Удалить помещение</span>
                </button>
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400 space-y-3">
              <Box className="w-10 h-10 text-slate-300 stroke-[1.5]" />
              <div className="space-y-1">
                <div className="font-semibold text-slate-700 text-sm">
                  Помещение не выбрано
                </div>
                <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                  Нажмите на любое помещение на 3D-плане или выберите строку в ведомости, чтобы настроить параметры, скругления стен (R) и 3D-символы.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
