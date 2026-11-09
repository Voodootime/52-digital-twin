import React, { useState, useEffect } from 'react';
import { HospitalBuilding, FloorPlan } from '../types/cad';
import { Building2, X, Check, Layers, Plus, Trash2 } from 'lucide-react';

interface BuildingPassportModalProps {
  isOpen: boolean;
  onClose: () => void;
  building: HospitalBuilding;
  onUpdateBuilding: (updated: HospitalBuilding) => void;
  floors: FloorPlan[];
  onUpdateFloorMeta: (floorId: string, name: string, floorNumber: number, elevation: number) => void;
  onAddEmptyFloor: (name: string, floorNumber: number, elevation: number) => void;
  onDeleteFloor: (floorId: string) => void;
}

export const BuildingPassportModal: React.FC<BuildingPassportModalProps> = ({
  isOpen,
  onClose,
  building,
  onUpdateBuilding,
  floors,
  onUpdateFloorMeta,
  onAddEmptyFloor,
  onDeleteFloor
}) => {
  const [name, setName] = useState(building.name);
  const [projectCode, setProjectCode] = useState(building.projectCode);
  const [address, setAddress] = useState(building.address);
  const [typicalFloorHeight, setTypicalFloorHeight] = useState(building.typicalFloorHeight);
  const [structuralGrid, setStructuralGrid] = useState(building.structuralGrid);

  useEffect(() => {
    if (isOpen) {
      setName(building.name);
      setProjectCode(building.projectCode);
      setAddress(building.address);
      setTypicalFloorHeight(building.typicalFloorHeight);
      setStructuralGrid(building.structuralGrid);
    }
  }, [isOpen, building]);

  // New floor inputs
  const nextFloorNum = Math.max(...floors.map(f => f.floorNumber), 0) + 1;
  const nextElev = Number(((nextFloorNum - 1) * typicalFloorHeight).toFixed(3));
  const [newFloorName, setNewFloorName] = useState(`${nextFloorNum} этаж — Технический / Палатный`);
  const [newFloorNumber, setNewFloorNumber] = useState(nextFloorNum);
  const [newFloorElevation, setNewFloorElevation] = useState(nextElev);

  if (!isOpen) return null;

  const totalBuildingArea = floors.reduce(
    (sum, f) => sum + f.rooms.reduce((rSum, r) => rSum + r.area, 0),
    0
  );
  const totalRoomsCount = floors.reduce((sum, f) => sum + f.rooms.length, 0);

  const handleSavePassport = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateBuilding({
      ...building,
      name,
      projectCode,
      address,
      typicalFloorHeight,
      structuralGrid
    });
    onClose();
  };

  const handleCreateFloor = () => {
    if (!newFloorName.trim()) return;
    onAddEmptyFloor(newFloorName.trim(), newFloorNumber, newFloorElevation);
    const nextNum = newFloorNumber + 1;
    setNewFloorNumber(nextNum);
    setNewFloorElevation(Number(((nextNum - 1) * typicalFloorHeight).toFixed(3)));
    setNewFloorName(`${nextNum} этаж — Новое отделение`);
  };

  const sortedFloors = [...floors].sort((a, b) => a.floorNumber - b.floorNumber);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shadow-xs">
              <Building2 className="w-4 h-4 text-sky-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Паспорт объекта строительства и структура этажей
              </h2>
              <p className="text-xs text-slate-500">
                Единая координатная сетка, высотные отметки и параметры здания больницы
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSavePassport} className="p-6 overflow-y-auto space-y-5 text-xs">
          {/* Summary KPI Strip */}
          <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Этажей в модели</span>
              <span className="font-mono font-bold text-slate-900 text-base tabular-nums">{floors.length}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Всего помещений</span>
              <span className="font-mono font-bold text-sky-700 text-base tabular-nums">{totalRoomsCount}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Суммарная площадь</span>
              <span className="font-mono font-bold text-emerald-700 text-base tabular-nums">
                {totalBuildingArea.toFixed(1)} м²
              </span>
            </div>
          </div>

          {/* Building Identification Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block mb-1">
                Наименование здания / корпуса
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block mb-1">
                Шифр проекта (BIM / АР)
              </label>
              <input
                type="text"
                value={projectCode}
                onChange={e => setProjectCode(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono font-semibold text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-sky-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block mb-1">
                Строительный адрес / Площадка
              </label>
              <input
                type="text"
                value={address}
                onChange={e => setAddress(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block mb-1">
                Типовая высота этажа (м)
              </label>
              <input
                type="number"
                step="0.1"
                value={typicalFloorHeight}
                onChange={e => setTypicalFloorHeight(parseFloat(e.target.value) || 3.6)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono tabular-nums text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block mb-1">
                Конструктивная сетка осей
              </label>
              <input
                type="text"
                value={structuralGrid}
                onChange={e => setStructuralGrid(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-sky-500"
              />
            </div>
          </div>

          {/* Floor Stack Management */}
          <div className="pt-2 border-t border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-slate-800 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-sky-600" />
                Поэтажная структура здания (Пирог этажей)
              </span>
              <span className="text-[11px] text-slate-500">
                Вертикальные шахты лифтов и ЛК синхронизированы по осям X/Y
              </span>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
              {sortedFloors.map(f => {
                const floorArea = f.rooms.reduce((s, r) => s + r.area, 0);
                return (
                  <div key={f.id} className="p-2.5 bg-white flex items-center gap-2 hover:bg-slate-50/80">
                    <div className="w-16">
                      <label className="text-[9px] text-slate-400 block">Этаж №</label>
                      <input
                        type="number"
                        value={f.floorNumber}
                        onChange={e =>
                          onUpdateFloorMeta(
                            f.id,
                            f.name,
                            parseInt(e.target.value, 10) || 1,
                            f.elevation
                          )
                        }
                        className="w-full px-2 py-1 border border-slate-200 rounded font-mono font-bold text-xs tabular-nums"
                      />
                    </div>

                    <div className="flex-1">
                      <label className="text-[9px] text-slate-400 block">Наименование этажа / отделения</label>
                      <input
                        type="text"
                        value={f.name}
                        onChange={e =>
                          onUpdateFloorMeta(f.id, e.target.value, f.floorNumber, f.elevation)
                        }
                        className="w-full px-2 py-1 border border-slate-200 rounded text-xs font-medium text-slate-800"
                      />
                    </div>

                    <div className="w-24">
                      <label className="text-[9px] text-slate-400 block">Отметка (м)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={f.elevation}
                        onChange={e =>
                          onUpdateFloorMeta(
                            f.id,
                            f.name,
                            f.floorNumber,
                            parseFloat(e.target.value) || 0
                          )
                        }
                        className="w-full px-2 py-1 border border-slate-200 rounded font-mono text-xs tabular-nums"
                      />
                    </div>

                    <div className="w-28 text-right font-mono text-[11px] text-slate-600 tabular-nums">
                      <div className="font-semibold text-slate-800">{floorArea.toFixed(0)} м²</div>
                      <div className="text-[10px] text-slate-400">{f.rooms.length} пом.</div>
                    </div>

                    {floors.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onDeleteFloor(f.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                        title="Удалить этаж"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Add New Floor Strip */}
            <div className="mt-2.5 p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-end gap-2">
              <div className="w-16">
                <label className="text-[9px] text-slate-500 block mb-0.5">Этаж №</label>
                <input
                  type="number"
                  value={newFloorNumber}
                  onChange={e => setNewFloorNumber(parseInt(e.target.value, 10) || 1)}
                  className="w-full px-2 py-1 bg-white border border-slate-300 rounded font-mono text-xs tabular-nums"
                />
              </div>
              <div className="flex-1">
                <label className="text-[9px] text-slate-500 block mb-0.5">Новый этаж (с базовыми шахтами лифта и лестниц)</label>
                <input
                  type="text"
                  value={newFloorName}
                  onChange={e => setNewFloorName(e.target.value)}
                  className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                />
              </div>
              <div className="w-24">
                <label className="text-[9px] text-slate-500 block mb-0.5">Отметка (м)</label>
                <input
                  type="number"
                  step="0.1"
                  value={newFloorElevation}
                  onChange={e => setNewFloorElevation(parseFloat(e.target.value) || 0)}
                  className="w-full px-2 py-1 bg-white border border-slate-300 rounded font-mono text-xs tabular-nums"
                />
              </div>
              <button
                type="button"
                onClick={handleCreateFloor}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg flex items-center gap-1 transition-colors cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5 text-sky-400" />
                <span>Добавить этаж</span>
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            >
              Закрыть
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Сохранить паспорт здания</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
