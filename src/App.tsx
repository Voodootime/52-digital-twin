/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
import { FloorPlan, Room, HospitalBuilding } from './types/cad';
import {
  DEFAULT_HOSPITAL_BUILDING,
  SAMPLE_FLOOR_1
} from './data/sampleHospitalPlans';
import { reconstructMissingRoomsFromUnderlay } from './services/dxfParser';
import { Viewport3D } from './components/Viewport3D';
import { Header } from './components/Header';
import { ExplicationTable } from './components/ExplicationTable';
import { BottomDockControls } from './components/BottomDockControls';
import { ManualRoomDrawer } from './components/ManualRoomDrawer';
import { UploadModal } from './components/UploadModal';
import { RoomInspector } from './components/RoomInspector';
import { BuildingPassportModal } from './components/BuildingPassportModal';

// Helper to create a clean deep copy of SAMPLE_FLOOR_1
function createCleanSampleFloor1(): FloorPlan {
  return JSON.parse(JSON.stringify(SAMPLE_FLOOR_1));
}

export default function App() {
  // Specific Hospital Building Passport state
  const [building, setBuilding] = useState<HospitalBuilding>(() => ({
    ...DEFAULT_HOSPITAL_BUILDING
  }));

  // Single default sample floor (1st Floor: Emergency & Admissions with rounded lobby, surgery, ICU, elevators, stairs, WC)
  const [floors, setFloors] = useState<FloorPlan[]>(() => [createCleanSampleFloor1()]);

  // Current active floor ID
  const [currentFloorId, setCurrentFloorId] = useState<string>(SAMPLE_FLOOR_1.id);

  // Active Floor Object
  const currentFloor = floors.find(f => f.id === currentFloorId) || floors[0];

  // Selection & 3D Parameters
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [wallHeightCutaway, setWallHeightCutaway] = useState<number>(2.4);
  const [cadUnderlayOpacity, setCadUnderlayOpacity] = useState<number>(0.75);
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [showCadUnderlay, setShowCadUnderlay] = useState<boolean>(true);
  const [colorMode, setColorMode] = useState<'zone' | 'cleanliness' | 'monochrome'>('zone');

  // Multi-floor Stack ("Многослойный пирог") & 3D Symbols state
  const [viewMode, setViewMode] = useState<'single' | 'stack'>('single');
  const [explodeGap, setExplodeGap] = useState<number>(5.5);
  const [show3DSymbols, setShow3DSymbols] = useState<boolean>(true);

  // UI Modals & Panels
  const [isExplicationOpen, setIsExplicationOpen] = useState<boolean>(true);
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false);
  const [isManualDrawOpen, setIsManualDrawOpen] = useState<boolean>(false);
  const [isPassportOpen, setIsPassportOpen] = useState<boolean>(false);
  const [reconMessage, setReconMessage] = useState<string | null>(null);

  // Reset all settings and imports back to the single 1st-floor demonstration sample
  const handleResetToSample = useCallback(() => {
    const cleanFloor1 = createCleanSampleFloor1();
    setBuilding({ ...DEFAULT_HOSPITAL_BUILDING });
    setFloors([cleanFloor1]);
    setCurrentFloorId(cleanFloor1.id);
    setSelectedRoomId(null);
    setViewMode('single');
    setExplodeGap(5.5);
    setWallHeightCutaway(2.4);
    setCadUnderlayOpacity(0.75);
    setShowLabels(true);
    setShowCadUnderlay(true);
    setShow3DSymbols(true);
    setColorMode('zone');
    setReconMessage(null);
  }, []);

  // Reconstruct missing rooms on the currently active floor from its 2D CAD underlay
  const handleReconstructMissingRooms = useCallback(() => {
    const { updatedPlan, addedCount } = reconstructMissingRoomsFromUnderlay(currentFloor);
    if (addedCount > 0) {
      setFloors(prev => prev.map(f => (f.id === currentFloor.id ? updatedPlan : f)));
      setReconMessage(`Дораспознано помещений по 2D-подложке: +${addedCount} шт.`);
    } else {
      setReconMessage('Все замкнутые ячейки и штампы на текущем этаже уже распознаны.');
    }
    window.setTimeout(() => setReconMessage(null), 4500);
  }, [currentFloor]);

  // Find selected room across all floors so selection works seamlessly in both Single & Stack modes
  const selectedRoomContext = React.useMemo(() => {
    for (const f of floors) {
      const found = f.rooms.find(r => r.id === selectedRoomId);
      if (found) return { room: found, floor: f };
    }
    return null;
  }, [floors, selectedRoomId]);

  // Select room handler
  const handleSelectRoom = (roomId: string | null, floorId?: string) => {
    setSelectedRoomId(roomId);
    if (floorId && floorId !== currentFloorId) {
      setCurrentFloorId(floorId);
    }
  };

  // Add room (from manual 2D point/arc drawer)
  const handleAddRoom = (newRoom: Room) => {
    setFloors(prev =>
      prev.map(f => {
        if (f.id === currentFloor.id) {
          return {
            ...f,
            rooms: [...f.rooms, newRoom]
          };
        }
        return f;
      })
    );
    setSelectedRoomId(newRoom.id);
  };

  // Update room (from RoomInspector or ExplicationTable)
  const handleUpdateRoom = (updatedRoom: Room, targetFloorId?: string) => {
    const fId = targetFloorId || selectedRoomContext?.floor.id || currentFloor.id;
    setFloors(prev =>
      prev.map(f => {
        if (f.id === fId) {
          return {
            ...f,
            rooms: f.rooms.map(r => (r.id === updatedRoom.id ? updatedRoom : r))
          };
        }
        return f;
      })
    );
  };

  // Delete room
  const handleDeleteRoom = (roomId: string, targetFloorId?: string) => {
    const fId = targetFloorId || selectedRoomContext?.floor.id || currentFloor.id;
    setFloors(prev =>
      prev.map(f => {
        if (f.id === fId) {
          return {
            ...f,
            rooms: f.rooms.filter(r => r.id !== roomId)
          };
        }
        return f;
      })
    );
    if (selectedRoomId === roomId) {
      setSelectedRoomId(null);
    }
  };

  // Load newly imported floor plan from DXF / DWG
  const handleLoadImportedFloor = (importedPlan: FloorPlan) => {
    setFloors(prev => {
      const existingIdx = prev.findIndex(
        f => f.id === importedPlan.id || f.floorNumber === importedPlan.floorNumber
      );
      if (existingIdx >= 0) {
        const copy = [...prev];
        copy[existingIdx] = importedPlan;
        return copy;
      }
      return [...prev, importedPlan].sort((a, b) => a.floorNumber - b.floorNumber);
    });
    setCurrentFloorId(importedPlan.id);
    setSelectedRoomId(null);
  };

  // Building Passport floor management handlers
  const handleUpdateFloorMeta = (
    floorId: string,
    name: string,
    floorNumber: number,
    elevation: number
  ) => {
    setFloors(prev =>
      prev.map(f => (f.id === floorId ? { ...f, name, floorNumber, elevation } : f))
    );
  };

  const handleAddEmptyFloor = (name: string, floorNumber: number, elevation: number) => {
    const newId = `floor_${floorNumber}_${Date.now()}`;
    const templateFloor: FloorPlan = {
      id: newId,
      name,
      floorNumber,
      elevation,
      buildingName: building.name,
      scale: 1,
      dimensions: { width: 48, length: 21 },
      cadLines: [
        { id: `${newId}_w1`, start: { x: 0, y: 0 }, end: { x: 48, y: 0 }, layer: 'A-WALL-EXT' },
        { id: `${newId}_w2`, start: { x: 48, y: 0 }, end: { x: 48, y: 21 }, layer: 'A-WALL-EXT' },
        { id: `${newId}_w3`, start: { x: 48, y: 21 }, end: { x: 0, y: 21 }, layer: 'A-WALL-EXT' },
        { id: `${newId}_w4`, start: { x: 0, y: 21 }, end: { x: 0, y: 0 }, layer: 'A-WALL-EXT' }
      ],
      cadTexts: [],
      cadLayers: [{ name: 'A-WALL-EXT', color: '#334155', visible: true, count: 4 }],
      walls: [],
      rooms: [
        {
          id: `${newId}_elev`,
          floorId: newId,
          code: `${floorNumber}03-Л`,
          name: 'Лифтовой холл и шахты больничных лифтов',
          zone: 'vertical',
          commonSubType: 'elevator',
          cleanliness: 'conditional',
          area: 36,
          perimeter: 24,
          height: 3.3,
          isAutoDetected: true,
          center: { x: 20, y: 3.5 },
          polygon: [
            { x: 17, y: 0.5 },
            { x: 23, y: 0.5 },
            { x: 23, y: 6.5 },
            { x: 17, y: 6.5 }
          ]
        },
        {
          id: `${newId}_st1`,
          floorId: newId,
          code: `ЛК-1`,
          name: 'Лестничная клетка ЛК-1 (эвакуационная)',
          zone: 'vertical',
          commonSubType: 'staircase',
          cleanliness: 'conditional',
          area: 30,
          perimeter: 22,
          height: 3.3,
          isAutoDetected: true,
          center: { x: 25.5, y: 3.5 },
          polygon: [
            { x: 23, y: 0.5 },
            { x: 28, y: 0.5 },
            { x: 28, y: 6.5 },
            { x: 23, y: 6.5 }
          ]
        },
        {
          id: `${newId}_st2`,
          floorId: newId,
          code: `ЛК-2`,
          name: 'Лестничная клетка ЛК-2 (служебная)',
          zone: 'vertical',
          commonSubType: 'staircase',
          cleanliness: 'dirty',
          area: 30,
          perimeter: 22,
          height: 3.3,
          isAutoDetected: true,
          center: { x: 44.5, y: 3.5 },
          polygon: [
            { x: 42, y: 0.5 },
            { x: 47, y: 0.5 },
            { x: 47, y: 6.5 },
            { x: 42, y: 6.5 }
          ]
        }
      ]
    };
    setFloors(prev => [...prev, templateFloor].sort((a, b) => a.floorNumber - b.floorNumber));
    setCurrentFloorId(newId);
  };

  const handleDeleteFloor = (floorId: string) => {
    if (floors.length <= 1) return;
    const remaining = floors.filter(f => f.id !== floorId);
    setFloors(remaining);
    if (currentFloorId === floorId) {
      setCurrentFloorId(remaining[0].id);
    }
    if (remaining.length <= 1) {
      setViewMode('single');
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-50 font-sans text-slate-900">
      {/* Top Application Header */}
      <Header
        building={building}
        currentFloor={currentFloor}
        availableFloors={floors}
        onSelectFloor={f => {
          setCurrentFloorId(f.id);
          setSelectedRoomId(null);
        }}
        viewMode={viewMode}
        onToggleViewMode={setViewMode}
        onOpenBuildingPassport={() => setIsPassportOpen(true)}
        onOpenUpload={() => setIsUploadOpen(true)}
        onOpenManualDraw={() => setIsManualDrawOpen(true)}
        onReconstructMissingRooms={handleReconstructMissingRooms}
        onResetToSample={handleResetToSample}
        isExplicationOpen={isExplicationOpen}
        onToggleExplication={() => setIsExplicationOpen(!isExplicationOpen)}
      />

      {/* Main Workspace: 3D Viewport + Explication Sidebar */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* 3D Isometric Viewport */}
        <div className="flex-1 h-full relative overflow-hidden bg-slate-100">
          {reconMessage && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-slate-900/95 text-white text-xs font-medium px-3.5 py-2 rounded-lg shadow-lg border border-slate-700 backdrop-blur-xs pointer-events-none">
              {reconMessage}
            </div>
          )}

          <Viewport3D
            floorPlan={currentFloor}
            allFloors={floors}
            viewMode={viewMode}
            explodeGap={explodeGap}
            show3DSymbols={show3DSymbols}
            selectedRoomId={selectedRoomId}
            onSelectRoom={handleSelectRoom}
            wallHeightCutaway={wallHeightCutaway}
            cadUnderlayOpacity={cadUnderlayOpacity}
            showLabels={showLabels}
            showCadUnderlay={showCadUnderlay}
            colorMode={colorMode}
          />

          {/* Selected Room Inspector Floating Card (Only when sidebar is closed) */}
          {!isExplicationOpen && (
            <RoomInspector
              room={selectedRoomContext?.room || null}
              floorName={selectedRoomContext?.floor.name}
              onClose={() => setSelectedRoomId(null)}
              onOpenSidebar={() => setIsExplicationOpen(true)}
              onUpdateRoom={room => handleUpdateRoom(room, selectedRoomContext?.floor.id)}
              onDeleteRoom={roomId => handleDeleteRoom(roomId, selectedRoomContext?.floor.id)}
            />
          )}

          {/* Ergonomic Collapsible Bottom Control Dock */}
          <BottomDockControls
            wallHeightCutaway={wallHeightCutaway}
            setWallHeightCutaway={setWallHeightCutaway}
            cadUnderlayOpacity={cadUnderlayOpacity}
            setCadUnderlayOpacity={setCadUnderlayOpacity}
            showLabels={showLabels}
            setShowLabels={setShowLabels}
            showCadUnderlay={showCadUnderlay}
            setShowCadUnderlay={setShowCadUnderlay}
            colorMode={colorMode}
            setColorMode={setColorMode}
            viewMode={viewMode}
            explodeGap={explodeGap}
            setExplodeGap={setExplodeGap}
            show3DSymbols={show3DSymbols}
            setShow3DSymbols={setShow3DSymbols}
          />
        </div>

        {/* Right Explication & Properties Panel */}
        {isExplicationOpen && (
          <aside className="w-[410px] xl:w-[440px] max-w-[48vw] h-full flex flex-col z-20 shadow-md">
            <ExplicationTable
              floorPlan={currentFloor}
              allFloors={floors}
              selectedRoomId={selectedRoomId}
              onSelectRoom={handleSelectRoom}
              onUpdateRoom={handleUpdateRoom}
              onDeleteRoom={handleDeleteRoom}
              onOpenManualDraw={() => setIsManualDrawOpen(true)}
            />
          </aside>
        )}
      </div>

      {/* Building Passport & Multi-Floor Structure Modal */}
      <BuildingPassportModal
        isOpen={isPassportOpen}
        onClose={() => setIsPassportOpen(false)}
        building={building}
        onUpdateBuilding={setBuilding}
        floors={floors}
        onUpdateFloorMeta={handleUpdateFloorMeta}
        onAddEmptyFloor={handleAddEmptyFloor}
        onDeleteFloor={handleDeleteFloor}
      />

      {/* Upload DWG / DXF Modal */}
      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onLoadFloorPlan={handleLoadImportedFloor}
        typicalFloorHeight={building.typicalFloorHeight}
      />

      {/* Manual Boundary Drawing Tool Modal */}
      <ManualRoomDrawer
        floorPlan={currentFloor}
        onAddRoom={handleAddRoom}
        onClose={() => setIsManualDrawOpen(false)}
        isOpen={isManualDrawOpen}
      />
    </div>
  );
}
