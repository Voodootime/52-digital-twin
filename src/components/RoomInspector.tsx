import React, { useState, useEffect } from 'react';
import {
  Room,
  HospitalZone,
  CleanlinessClass,
  CommonSubType,
  ZONE_CONFIG,
  CLEANLINESS_CONFIG,
  COMMON_SUBTYPE_CONFIG
} from '../types/cad';
import { calculatePolygonArea, calculatePolygonPerimeter, hasCurvedGeometry } from '../services/dxfParser';
import { X, Box, Ruler, Edit2, Check, Trash2, Spline, Layers } from 'lucide-react';

interface RoomInspectorProps {
  room: Room | null;
  floorName?: string;
  onClose: () => void;
  onOpenSidebar?: () => void;
  onUpdateRoom: (room: Room) => void;
  onDeleteRoom: (roomId: string) => void;
}

const CORNER_RADII = [0, 0.5, 1.0, 1.5, 2.0, 3.0];

export const RoomInspector: React.FC<RoomInspectorProps> = ({
  room,
  floorName,
  onClose,
  onOpenSidebar,
  onUpdateRoom,
  onDeleteRoom
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editZone, setEditZone] = useState<HospitalZone>('ward');
  const [editCleanliness, setEditCleanliness] = useState<CleanlinessClass>('conditional');
  const [editCommonSubType, setEditCommonSubType] = useState<CommonSubType>('standard');
  const [editHeight, setEditHeight] = useState(3.3);
  const [editCode, setEditCode] = useState('');

  useEffect(() => {
    if (room) {
      setEditName(room.name);
      setEditZone(room.zone);
      setEditCleanliness(room.cleanliness);
      setEditCommonSubType(room.commonSubType || 'standard');
      setEditHeight(room.height);
      setEditCode(room.code);
      setIsEditing(false);
    }
  }, [room?.id]);

  if (!room) return null;

  const zoneCfg = ZONE_CONFIG[room.zone] || ZONE_CONFIG.circulation;
  const cleanCfg = CLEANLINESS_CONFIG[room.cleanliness] || CLEANLINESS_CONFIG.conditional;
  const subTypeCfg = COMMON_SUBTYPE_CONFIG[room.commonSubType || 'standard'];
  const isCurved = hasCurvedGeometry(room.polygon);
  const currentUniformRadius = room.polygon.find(p => (p.radius || 0) > 0)?.radius || 0;

  const handleApplyCornerRadius = (radius: number) => {
    const newPoly = room.polygon.map(pt => ({
      ...pt,
      radius: radius > 0 ? radius : undefined
    }));
    const newArea = calculatePolygonArea(newPoly);
    const newPerimeter = calculatePolygonPerimeter(newPoly);
    onUpdateRoom({
      ...room,
      polygon: newPoly,
      area: newArea,
      perimeter: newPerimeter
    });
  };

  const handleQuickSubTypeChange = (subType: CommonSubType) => {
    onUpdateRoom({
      ...room,
      commonSubType: subType
    });
  };

  const handleSave = () => {
    onUpdateRoom({
      ...room,
      code: editCode,
      name: editName,
      zone: editZone,
      cleanliness: editCleanliness,
      commonSubType: editCommonSubType,
      height: editHeight
    });
    setIsEditing(false);
  };

  return (
    <div className="absolute top-4 left-4 z-20 w-80 bg-white/95 border border-slate-200 rounded-xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-left-2 duration-150 text-xs">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: zoneCfg.color }}
          />
          {isEditing ? (
            <input
              type="text"
              value={editCode}
              onChange={e => setEditCode(e.target.value)}
              className="w-16 px-1.5 py-0.5 border border-slate-300 rounded font-mono font-bold text-xs tabular-nums"
            />
          ) : (
            <span className="font-mono font-bold text-slate-900 text-sm tabular-nums shrink-0">
              №{room.code}
            </span>
          )}

          <span className="text-slate-300">·</span>
          <span
            className="text-[11px] font-semibold truncate"
            style={{ color: zoneCfg.color }}
          >
            {zoneCfg.label}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onOpenSidebar && (
            <button
              onClick={onOpenSidebar}
              className="px-2 py-0.5 text-[11px] font-medium text-sky-700 hover:bg-sky-50 rounded transition-colors cursor-pointer"
              title="Открыть в боковой панели"
            >
              В панель
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {isEditing ? (
          <div className="space-y-2.5">
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium block mb-1">
                Наименование помещения
              </label>
              <input
                type="text"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium block mb-1">
                Функциональная зона
              </label>
              <select
                value={editZone}
                onChange={e => setEditZone(e.target.value as HospitalZone)}
                className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs bg-white"
              >
                {Object.entries(ZONE_CONFIG).map(([k, cfg]) => (
                  <option key={k} value={k}>{cfg.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium block mb-1">
                3D-символ / Тип общей зоны
              </label>
              <select
                value={editCommonSubType}
                onChange={e => setEditCommonSubType(e.target.value as CommonSubType)}
                className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs bg-white"
              >
                {Object.entries(COMMON_SUBTYPE_CONFIG).map(([k, cfg]) => (
                  <option key={k} value={k}>{cfg.label} ({cfg.shortLabel})</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium block mb-1">
                  Высота стен (м)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={editHeight}
                  onChange={e => setEditHeight(parseFloat(e.target.value) || 3.3)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium block mb-1">
                  Класс чистоты
                </label>
                <select
                  value={editCleanliness}
                  onChange={e => setEditCleanliness(e.target.value as CleanlinessClass)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs bg-white"
                >
                  {Object.entries(CLEANLINESS_CONFIG).map(([k, cfg]) => (
                    <option key={k} value={k}>{cfg.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleSave}
                className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-1 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" /> Сохранить
              </button>
              <button
                onClick={() => setIsEditing(false)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors cursor-pointer"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <>
            <div>
              {floorName && (
                <div className="text-[10px] text-slate-400 font-medium mb-0.5 flex items-center gap-1">
                  <Layers className="w-3 h-3 text-slate-400" />
                  <span>{floorName}</span>
                </div>
              )}
              <div className="text-sm font-semibold text-slate-900 leading-snug">
                {room.name}
              </div>
              <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
                <span>{cleanCfg.badge}</span>
                <span>·</span>
                <span className="font-medium text-slate-700">{subTypeCfg.label}</span>
                {isCurved && (
                  <>
                    <span>·</span>
                    <span className="text-sky-700 font-mono font-medium">R-контур</span>
                  </>
                )}
              </div>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
              <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <Ruler className="w-3 h-3" /> Площадь
                </span>
                <span className="font-mono font-bold text-slate-900 text-sm tabular-nums">
                  {room.area.toFixed(1)} м²
                </span>
              </div>

              <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <Box className="w-3 h-3" /> Высота стен
                </span>
                <span className="font-mono font-bold text-slate-900 text-sm tabular-nums">
                  {room.height.toFixed(1)} м
                </span>
              </div>
            </div>

            {/* Interactive Corner Fillet Radius Selector */}
            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 flex items-center gap-1">
                  <Spline className="w-3 h-3 text-sky-600" />
                  Радиус скругления углов (R)
                </span>
                <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                  {currentUniformRadius > 0 ? `R=${currentUniformRadius}м` : 'Прямые (90°)'}
                </span>
              </div>
              <div className="grid grid-cols-6 gap-1">
                {CORNER_RADII.map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => handleApplyCornerRadius(r)}
                    className={`py-1 rounded font-mono text-[10px] font-semibold transition-all cursor-pointer tabular-nums border ${
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

            {/* Quick 3D Symbol Switcher for Common Zones */}
            <div className="pt-2 border-t border-slate-100">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 block mb-1.5">
                3D-маркер общей / вертикальной зоны
              </span>
              <div className="grid grid-cols-5 gap-1">
                {(Object.keys(COMMON_SUBTYPE_CONFIG) as CommonSubType[]).map(st => {
                  const cfg = COMMON_SUBTYPE_CONFIG[st];
                  const active = (room.commonSubType || 'standard') === st;
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => handleQuickSubTypeChange(st)}
                      className={`py-1 px-1 rounded text-[10px] font-medium transition-all cursor-pointer border truncate ${
                        active
                          ? 'bg-slate-900 text-white border-slate-900'
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

            {/* Metadata Coordinates */}
            <div className="space-y-1 pt-1 border-t border-slate-100 text-[11px] text-slate-600">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Периметр контура:</span>
                <span className="font-mono font-medium text-slate-800 tabular-nums">{room.perimeter.toFixed(1)} м</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Координаты центра:</span>
                <span className="font-mono text-slate-700 tabular-nums">X:{room.center.x}м · Y:{room.center.y}м</span>
              </div>
            </div>

            <div className="pt-1 flex items-center gap-2">
              <button
                onClick={() => setIsEditing(true)}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors cursor-pointer"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>Параметры</span>
              </button>
              <button
                onClick={() => onDeleteRoom(room.id)}
                className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg transition-colors cursor-pointer"
                title="Удалить помещение"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
