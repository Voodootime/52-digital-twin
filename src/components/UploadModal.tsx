import React, { useState, useRef } from 'react';
import { FloorPlan } from '../types/cad';
import {
  parseDXFContent,
  parseDWGContent,
  ParseResult,
  exportFloorPlanToDXF
} from '../services/dxfParser';
import { SAMPLE_FLOOR_1, SAMPLE_FLOOR_2, SAMPLE_FLOOR_3 } from '../data/sampleHospitalPlans';
import {
  Upload,
  CheckCircle2,
  AlertCircle,
  X,
  ArrowRight,
  HelpCircle,
  Download,
  Layers
} from 'lucide-react';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadFloorPlan: (plan: FloorPlan) => void;
  typicalFloorHeight?: number;
}

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  onClose,
  onLoadFloorPlan,
  typicalFloorHeight = 3.6
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');

  // Target floor assignment for the specific hospital building
  const [targetFloorNumber, setTargetFloorNumber] = useState<number>(2);
  const [targetElevation, setTargetElevation] = useState<number>(3.6);

  React.useEffect(() => {
    if (isOpen) {
      setParseResult(null);
      setErrorMsg(null);
      setUploadedFileName('');
      setIsProcessing(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFloorNumberChange = (num: number) => {
    setTargetFloorNumber(num);
    setTargetElevation(Number(((num - 1) * typicalFloorHeight).toFixed(3)));
  };

  const handleProcessFile = async (file: File) => {
    setIsProcessing(true);
    setErrorMsg(null);
    setParseResult(null);
    setUploadedFileName(file.name);

    const ext = file.name.split('.').pop()?.toLowerCase();

    try {
      if (ext === 'dxf') {
        const text = await file.text();
        const result = parseDXFContent(text, file.name, targetFloorNumber, targetElevation);
        setParseResult(result);
      } else if (ext === 'dwg') {
        const buffer = await file.arrayBuffer();
        const result = await parseDWGContent(
          buffer,
          file.name,
          targetFloorNumber,
          targetElevation
        );
        setParseResult(result);
      } else {
        setErrorMsg('Пожалуйста, выберите файл чертежа с расширением .dwg или .dxf');
      }
    } catch (err: any) {
      console.error('CAD file parsing error:', err);
      setErrorMsg(`Ошибка чтения чертежа: ${err.message || 'Не удалось разобрать геометрию файла'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleProcessFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleProcessFile(e.target.files[0]);
    }
  };

  const handleConfirmImport = () => {
    if (parseResult) {
      onLoadFloorPlan({
        ...parseResult.floorPlan,
        floorNumber: targetFloorNumber,
        elevation: targetElevation
      });
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-600 text-white flex items-center justify-center shadow-xs">
              <Upload className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Прямой импорт чертежей DWG и DXF в 3D-модель
              </h2>
              <p className="text-xs text-slate-500">
                Встроенный движок LibreDWG (WebAssembly) + DXF: чтение стен, дуг, блоков и экспликации
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

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto">
          {/* Floor & Elevation Assignment Bar */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-2 text-slate-700 font-medium">
              <Layers className="w-4 h-4 text-sky-600 shrink-0" />
              <span>Целевой этаж для импортируемого плана (1 = замена 1 эт., 2+ = новый этаж в пирог):</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-500">Этаж №:</span>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={targetFloorNumber}
                  onChange={e => handleFloorNumberChange(parseInt(e.target.value, 10) || 1)}
                  className="w-14 px-2 py-1 bg-white border border-slate-300 rounded font-mono font-bold text-xs tabular-nums"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-500">Отметка (м):</span>
                <input
                  type="number"
                  step="0.1"
                  value={targetElevation}
                  onChange={e => setTargetElevation(parseFloat(e.target.value) || 0)}
                  className="w-20 px-2 py-1 bg-white border border-slate-300 rounded font-mono font-bold text-xs tabular-nums"
                />
              </div>
            </div>
          </div>

          {/* Drag & Drop Box */}
          <div
            onDragOver={e => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
              isDragging
                ? 'border-sky-500 bg-sky-50/50 scale-[0.99]'
                : 'border-slate-300 hover:border-slate-400 bg-slate-50/50 hover:bg-slate-50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".dwg,.dxf"
              onChange={handleFileChange}
              className="hidden"
            />
            <div className="w-10 h-10 mx-auto rounded-full bg-sky-100 text-sky-600 flex items-center justify-center mb-2">
              <Upload className="w-5 h-5" />
            </div>
            <div className="text-xs font-semibold text-slate-800 mb-1">
              Нажмите для выбора или перетащите файл .DWG или .DXF сюда
            </div>
            <div className="text-[11px] text-slate-500 max-w-md mx-auto">
              Нативное декодирование бинарных файлов AutoCAD `.dwg` (R13–2024 через WebAssembly LibreDWG) и текстовых `.dxf`: извлечение полилиний `LWPOLYLINE`, дуг `bulge`, блоков `INSERT` и марок помещений.
            </div>
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Processing Indicator */}
          {isProcessing && (
            <div className="p-4 bg-sky-50 border border-sky-200 rounded-lg flex items-center gap-3 text-xs text-sky-800">
              <div className="w-4 h-4 border-2 border-sky-600 border-t-transparent rounded-full animate-spin shrink-0" />
              <span>Декодирование геометрии DWG/DXF, поиск замкнутых контуров помещений и расчет площадей...</span>
            </div>
          )}

          {/* Unified Recognition Results Preview (DWG & DXF) */}
          {parseResult && (
            <div className="p-4 bg-emerald-50/80 border border-emerald-200 rounded-xl space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-900">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    Чертеж {parseResult.stats.format} разобран: {uploadedFileName}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {parseResult.stats.cadVersion && (
                    <span className="text-[10px] font-mono text-slate-600 bg-white border border-emerald-200 px-2 py-0.5 rounded">
                      {parseResult.stats.cadVersion}
                    </span>
                  )}
                  <span className="text-[11px] font-mono font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded tabular-nums">
                    {parseResult.stats.detectedScale}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-5 gap-2 text-xs pt-1">
                <div className="bg-white p-2.5 rounded-lg border border-emerald-100">
                  <span className="text-[10px] text-slate-400 block">Помещений</span>
                  <span className="font-mono font-bold text-slate-900 text-sm tabular-nums">
                    {parseResult.stats.recognizedRoomsCount}
                  </span>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-emerald-100">
                  <span className="text-[10px] text-slate-400 block">Площадь</span>
                  <span className="font-mono font-bold text-slate-900 text-sm tabular-nums">
                    {parseResult.stats.totalArea} м²
                  </span>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-emerald-100">
                  <span className="text-[10px] text-slate-400 block">Дуги / R-углы</span>
                  <span className="font-mono font-bold text-teal-700 text-sm tabular-nums">
                    {parseResult.stats.curvedWallsCount}
                  </span>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-emerald-100">
                  <span className="text-[10px] text-slate-400 block">Отрезков стен</span>
                  <span className="font-mono font-bold text-slate-900 text-sm tabular-nums">
                    {parseResult.stats.linesCount}
                  </span>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-emerald-100">
                  <span className="text-[10px] text-slate-400 block">Подписей</span>
                  <span className="font-mono font-bold text-slate-900 text-sm tabular-nums">
                    {parseResult.stats.textsCount}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Optional Additional Floors Presets & Test DXF Download */}
          <div className="pt-1">
            <span className="text-xs font-semibold text-slate-700 block mb-2">
              Быстрое подключение типовых этажей корпуса (для проверки многослойного пирога):
            </span>
            <div className="grid grid-cols-3 gap-2.5">
              {[SAMPLE_FLOOR_1, SAMPLE_FLOOR_2, SAMPLE_FLOOR_3].map(plan => (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => {
                    onLoadFloorPlan(JSON.parse(JSON.stringify(plan)));
                    onClose();
                  }}
                  className="p-2.5 text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-all group cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-900 group-hover:text-sky-600 transition-colors">
                      {plan.floorNumber} этаж
                    </span>
                    <span className="text-[10px] font-mono text-slate-500 tabular-nums">
                      +{plan.elevation.toFixed(1)}м
                    </span>
                  </div>
                  <div className="text-[11px] font-medium text-slate-700 line-clamp-1 mb-0.5">
                    {plan.name.replace(/^\d+-й\s*Этаж:\s*/i, '')}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono tabular-nums">
                    {plan.rooms.length} пом. · {plan.rooms.reduce((s, r) => s + r.area, 0).toFixed(0)} м²
                  </div>
                </button>
              ))}
            </div>

            {/* Download authentic DXF samples */}
            <div className="mt-3 p-3 bg-slate-100/70 border border-slate-200 rounded-xl flex items-center justify-between gap-3">
              <div className="text-[11px] text-slate-600">
                Скачать эталонный CAD-чертеж больницы (с дуговым эркером и радиусными углами) для теста загрузки:
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const dxf = exportFloorPlanToDXF(SAMPLE_FLOOR_2);
                    const blob = new Blob([dxf], { type: 'application/dxf' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'Хирургия_Этаж2.dxf';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-2.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-sky-600" />
                  <span>Этаж 2 (.DXF)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const dxf = exportFloorPlanToDXF(SAMPLE_FLOOR_3);
                    const blob = new Blob([dxf], { type: 'application/dxf' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'Стационар_Этаж3_Эркер.dxf';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-2.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-teal-600" />
                  <span>Этаж 3 с эркером (.DXF)</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
            <span>Поддерживаются как бинарные .DWG (AutoCAD 2000–2024), так и .DXF</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
            >
              Отмена
            </button>
            {parseResult && (
              <button
                onClick={handleConfirmImport}
                className="px-5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg shadow-sm shadow-sky-600/20 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span>Построить 3D-модель этажа</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
