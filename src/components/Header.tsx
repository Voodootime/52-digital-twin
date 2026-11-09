import React from 'react';
import { FloorPlan, HospitalBuilding } from '../types/cad';
import {
  Building2,
  Upload,
  Crosshair,
  Table,
  Layers,
  RotateCcw,
  ScanSearch
} from 'lucide-react';

interface HeaderProps {
  building: HospitalBuilding;
  currentFloor: FloorPlan;
  availableFloors: FloorPlan[];
  onSelectFloor: (floor: FloorPlan) => void;
  viewMode: 'single' | 'stack';
  onToggleViewMode: (mode: 'single' | 'stack') => void;
  onOpenBuildingPassport: () => void;
  onOpenUpload: () => void;
  onOpenManualDraw: () => void;
  onReconstructMissingRooms: () => void;
  onResetToSample: () => void;
  isExplicationOpen: boolean;
  onToggleExplication: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  building,
  currentFloor,
  availableFloors,
  onSelectFloor,
  viewMode,
  onToggleViewMode,
  onOpenBuildingPassport,
  onOpenUpload,
  onOpenManualDraw,
  onReconstructMissingRooms,
  onResetToSample,
  isExplicationOpen,
  onToggleExplication
}) => {
  const sortedFloors = [...availableFloors].sort((a, b) => a.floorNumber - b.floorNumber);
  const totalRoomsInBuilding = availableFloors.reduce((acc, f) => acc + f.rooms.length, 0);

  return (
    <header className="h-13 border-b border-slate-200 bg-white/95 px-4 flex items-center justify-between z-30 select-none shrink-0 shadow-2xs backdrop-blur-xs">
      {/* Zone 1 (Left): Brand + Specific Hospital Building Passport Breadcrumb */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-slate-900 text-white flex items-center justify-center font-bold text-xs tracking-tight shrink-0 shadow-xs">
            H3D
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900 text-sm tracking-tight whitespace-nowrap">
              HospPlan 3D
            </span>
            <span className="text-slate-300">/</span>
            <button
              type="button"
              onClick={onOpenBuildingPassport}
              className="text-xs text-slate-600 hover:text-slate-900 font-medium flex items-center gap-1.5 transition-colors cursor-pointer group"
              title="Открыть паспорт здания и управление этажами"
            >
              <Building2 className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-700 transition-colors" />
              <span className="font-mono text-slate-500 font-normal">[{building.projectCode}]</span>
              <span className="hidden sm:inline font-medium text-slate-800 hover:underline underline-offset-2">
                {building.name}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Zone 2 (Center): Unified Floor & Multi-Floor Stack Segmented Control */}
      <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200/80">
        {sortedFloors.map(f => {
          const isActive = viewMode === 'single' && f.id === currentFloor.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                onToggleViewMode('single');
                onSelectFloor(f);
              }}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                isActive
                  ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title={`${f.name} (Отметка ${f.elevation >= 0 ? '+' : ''}${f.elevation.toFixed(2)}м)`}
            >
              <span className="font-mono tabular-nums">{f.floorNumber} эт.</span>
              <span className="text-[10px] font-mono text-slate-400 tabular-nums hidden md:inline">
                {f.elevation >= 0 ? `+${f.elevation.toFixed(1)}м` : `${f.elevation.toFixed(1)}м`}
              </span>
            </button>
          );
        })}

        {/* Multi-Floor Stack View Mode Tab */}
        <div className="w-[1px] h-3.5 bg-slate-200 my-auto mx-0.5" />
        <button
          type="button"
          onClick={() => onToggleViewMode('stack')}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
            viewMode === 'stack'
              ? 'bg-slate-900 text-white shadow-2xs font-semibold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
          title="Отобразить все этажи корпуса как многослойный 3D-пирог (Взрыв-схема)"
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Пирог 3D</span>
        </button>
      </div>

      {/* Zone 3 (Right): Clean Working Action Group */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Reset to Clean Sample */}
        <button
          type="button"
          onClick={onResetToSample}
          className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          title="Сбросить все настройки к исходному 1-му этажу"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* Auto-Reconstruct Uncovered Rooms from CAD Underlay */}
        <button
          type="button"
          onClick={onReconstructMissingRooms}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          title="Дораспознать пропущенные помещения в пустых зонах по линиям стен и штампам на 2D-подложке"
        >
          <ScanSearch className="w-3.5 h-3.5 text-emerald-600" />
          <span className="hidden lg:inline">Дораспознать</span>
        </button>

        {/* Manual Boundary Drawing Tool Button */}
        <button
          type="button"
          onClick={onOpenManualDraw}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          title="Расставить границы помещения вручную по точкам и дугам"
        >
          <Crosshair className="w-3.5 h-3.5 text-sky-600" />
          <span className="hidden sm:inline">Разметить</span>
        </button>

        {/* Primary Action: Upload DWG / DXF */}
        <button
          type="button"
          onClick={onOpenUpload}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
          title="Импортировать план этажа из DWG или DXF"
        >
          <Upload className="w-3.5 h-3.5 text-sky-400" />
          <span>Импорт DWG/DXF</span>
        </button>

        <div className="h-4 w-[1px] bg-slate-200 mx-0.5 hidden sm:block" />

        {/* Toggle Right Sidebar (Explication / Inspector) */}
        <button
          type="button"
          onClick={onToggleExplication}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
            isExplicationOpen
              ? 'bg-sky-50 text-sky-800 border-sky-300 font-semibold'
              : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'
          }`}
          title="Открыть / скрыть панель экспликации и свойств помещений"
        >
          <Table className="w-3.5 h-3.5 text-slate-600" />
          <span className="hidden md:inline">Панель</span>
          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
            {viewMode === 'stack' ? totalRoomsInBuilding : currentFloor.rooms.length}
          </span>
        </button>
      </div>
    </header>
  );
};
