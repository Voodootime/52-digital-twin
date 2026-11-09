import React, { useState } from 'react';
import { 
  Sliders, 
  Layers, 
  Tag, 
  ChevronDown, 
  ChevronUp, 
  Box
} from 'lucide-react';

interface BottomDockControlsProps {
  viewMode: 'single' | 'stack';
  explodeGap: number;
  setExplodeGap: (val: number) => void;
  wallHeightCutaway: number;
  setWallHeightCutaway: (val: number) => void;
  cadUnderlayOpacity: number;
  setCadUnderlayOpacity: (val: number) => void;
  showLabels: boolean;
  setShowLabels: (val: boolean) => void;
  showCadUnderlay: boolean;
  setShowCadUnderlay: (val: boolean) => void;
  show3DSymbols: boolean;
  setShow3DSymbols: (val: boolean) => void;
  colorMode: 'zone' | 'cleanliness' | 'monochrome';
  setColorMode: (mode: 'zone' | 'cleanliness' | 'monochrome') => void;
}

export const BottomDockControls: React.FC<BottomDockControlsProps> = ({
  viewMode,
  explodeGap,
  setExplodeGap,
  wallHeightCutaway,
  setWallHeightCutaway,
  cadUnderlayOpacity,
  setCadUnderlayOpacity,
  showLabels,
  setShowLabels,
  showCadUnderlay,
  setShowCadUnderlay,
  show3DSymbols,
  setShow3DSymbols,
  colorMode,
  setColorMode
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center pointer-events-none select-none transition-all duration-200">
      {/* Collapse / Expand Tab Button */}
      <div className="pointer-events-auto -mb-[1px]">
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="px-2.5 py-0.5 bg-white/95 border border-slate-200 border-b-0 rounded-t-md shadow-2xs text-[10px] font-medium text-slate-500 hover:text-slate-900 flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
          title={isCollapsed ? 'Развернуть панель инструментов 3D' : 'Свернуть панель инструментов'}
        >
          {isCollapsed ? (
            <>
              <ChevronUp className="w-3 h-3 text-slate-500" />
              <span>Панель 3D</span>
            </>
          ) : (
            <ChevronDown className="w-3 h-3 text-slate-400" />
          )}
        </button>
      </div>

      {/* Main Floating Capsule Dock */}
      {!isCollapsed && (
        <div className="pointer-events-auto bg-white/95 border border-slate-200/90 rounded-xl shadow-lg px-3 py-1.5 flex items-center gap-3 text-xs text-slate-700">
          {/* Group 1: Layer Visibility Toggles */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowCadUnderlay(!showCadUnderlay)}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                showCadUnderlay
                  ? 'bg-sky-50 text-sky-700 font-semibold border border-sky-200'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
              }`}
              title="Включить / скрыть векторную CAD подложку чертежа"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Подложка</span>
            </button>

            {showCadUnderlay && (
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={cadUnderlayOpacity}
                onChange={e => setCadUnderlayOpacity(parseFloat(e.target.value))}
                className="w-14 accent-sky-600 cursor-pointer"
                title={`Прозрачность подложки: ${Math.round(cadUnderlayOpacity * 100)}%`}
              />
            )}

            <button
              type="button"
              onClick={() => setShowLabels(!showLabels)}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                showLabels
                  ? 'bg-sky-50 text-sky-700 font-semibold border border-sky-200'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
              }`}
              title="Включить / скрыть подписи помещений"
            >
              <Tag className="w-3.5 h-3.5" />
              <span>Метки</span>
            </button>

            <button
              type="button"
              onClick={() => setShow3DSymbols(!show3DSymbols)}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                show3DSymbols
                  ? 'bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
              }`}
              title="Показывать 3D-символы внутри лестниц, лифтов, санузлов и холлов"
            >
              <Box className="w-3.5 h-3.5" />
              <span>3D-узлы</span>
            </button>
          </div>

          <div className="h-4 w-[1px] bg-slate-200" />

          {/* Group 2: Wall Cutaway & Explode Gap Sliders */}
          <div className="flex items-center gap-2.5 tabular-nums">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500 font-medium whitespace-nowrap flex items-center gap-1">
                <Sliders className="w-3 h-3 text-slate-400" /> Срез:
              </span>
              <input
                type="range"
                min="0.4"
                max="3.6"
                step="0.1"
                value={wallHeightCutaway}
                onChange={e => setWallHeightCutaway(parseFloat(e.target.value))}
                className="w-18 accent-sky-600 cursor-pointer"
                title="Регулировка высоты среза стен"
              />
              <span className="font-mono text-slate-800 font-semibold text-[11px] w-8">
                {wallHeightCutaway.toFixed(1)}м
              </span>
            </div>

            {viewMode === 'stack' && (
              <>
                <div className="h-3.5 w-[1px] bg-slate-200" />
                <div className="flex items-center gap-1.5 bg-sky-50/70 px-2 py-0.5 rounded-md border border-sky-100">
                  <span className="text-[11px] text-sky-800 font-medium whitespace-nowrap">
                    Раздвижка:
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="14"
                    step="0.5"
                    value={explodeGap}
                    onChange={e => setExplodeGap(parseFloat(e.target.value))}
                    className="w-18 accent-sky-600 cursor-pointer"
                    title="Вертикальный зазор между этажами"
                  />
                  <span className="font-mono text-sky-900 font-bold text-[11px] w-9 text-right">
                    +{explodeGap.toFixed(1)}м
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="h-4 w-[1px] bg-slate-200" />

          {/* Group 3: Color Mode Segmented Control */}
          <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg border border-slate-200/80 text-[11px]">
            <button
              type="button"
              onClick={() => setColorMode('zone')}
              className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer whitespace-nowrap ${
                colorMode === 'zone'
                  ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              По зонам
            </button>
            <button
              type="button"
              onClick={() => setColorMode('cleanliness')}
              className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer whitespace-nowrap ${
                colorMode === 'cleanliness'
                  ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Цветовая дифференциация по классам чистоты СанПиН (А, Б, В, Г)"
            >
              Чистота А–Г
            </button>
            <button
              type="button"
              onClick={() => setColorMode('monochrome')}
              className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer whitespace-nowrap ${
                colorMode === 'monochrome'
                  ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Архитектурный макет"
            >
              Макет
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
