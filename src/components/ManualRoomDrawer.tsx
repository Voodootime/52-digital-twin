import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  FloorPlan, 
  Room, 
  Point2D, 
  HospitalZone, 
  CleanlinessClass, 
  CommonSubType,
  ZONE_CONFIG, 
  CLEANLINESS_CONFIG,
  COMMON_SUBTYPE_CONFIG
} from '../types/cad';
import { 
  calculatePolygonArea, 
  calculatePolygonPerimeter, 
  calculatePolygonCenter, 
  classifyHospitalZone,
  tessellatePolygon,
  hasCurvedGeometry
} from '../services/dxfParser';
import { 
  X, 
  RotateCcw, 
  Crosshair, 
  Magnet, 
  Box,
  Compass,
  Square,
  Pentagon,
  CornerUpRight,
  CheckCircle2
} from 'lucide-react';

interface ManualRoomDrawerProps {
  floorPlan: FloorPlan;
  onAddRoom: (newRoom: Room) => void;
  onClose: () => void;
  isOpen: boolean;
}

export const ManualRoomDrawer: React.FC<ManualRoomDrawerProps> = ({
  floorPlan,
  onAddRoom,
  onClose,
  isOpen
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawMode, setDrawMode] = useState<'polygon' | 'rectangle'>('polygon');
  const [points, setPoints] = useState<Point2D[]>([]);
  const [rectStart, setRectStart] = useState<Point2D | null>(null);
  const [hoverPos, setHoverPos] = useState<Point2D | null>(null);

  // Corner rounding & curve controls
  const [defaultCornerRadius, setDefaultCornerRadius] = useState<number>(0);
  const [nextSegmentBulge, setNextSegmentBulge] = useState<number>(0);
  const [selectedVertexIdx, setSelectedVertexIdx] = useState<number | null>(null);

  // Snapping & Grid controls
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true);
  const [orthoMode, setOrthoMode] = useState<boolean>(false);
  const [gridSize] = useState<number>(0.5); // 0.5 meters
  const [isFinishing, setIsFinishing] = useState<boolean>(false);

  // Pan & Zoom state for CAD Canvas
  const [viewTransform, setViewTransform] = useState<{ x: number; y: number; zoom: number }>({
    x: 60,
    y: 60,
    zoom: 16
  });
  const isPanningRef = useRef(false);
  const startPanRef = useRef({ x: 0, y: 0 });

  // Modal form state for newly created room
  const [formData, setFormData] = useState<{
    code: string;
    name: string;
    zone: HospitalZone;
    cleanliness: CleanlinessClass;
    commonSubType: CommonSubType;
    height: number;
  }>({
    code: '220',
    name: 'Новое помещение',
    zone: 'ward',
    cleanliness: 'conditional',
    commonSubType: 'standard',
    height: 3.3
  });

  // Reset state and calculate next room code on open
  useEffect(() => {
    if (isOpen) {
      setPoints([]);
      setRectStart(null);
      setSelectedVertexIdx(null);
      setIsFinishing(false);
      setFormData({
        code: String(floorPlan.floorNumber * 100 + floorPlan.rooms.length + 1),
        name: 'Новое помещение',
        zone: 'ward',
        cleanliness: 'conditional',
        commonSubType: 'standard',
        height: 3.3
      });

      const timer = setTimeout(() => {
        const canvas = canvasRef.current;
        if (canvas) {
          const padding = 80;
          const availW = canvas.width - padding * 2;
          const availH = canvas.height - padding * 2;
          const zX = availW / Math.max(1, floorPlan.dimensions.width);
          const zY = availH / Math.max(1, floorPlan.dimensions.length);
          const initialZoom = Math.min(32, Math.max(2, Math.min(zX, zY)));
          const initX = (canvas.width - floorPlan.dimensions.width * initialZoom) / 2;
          const initY = (canvas.height - floorPlan.dimensions.length * initialZoom) / 2;
          setViewTransform({ x: initX, y: initY, zoom: initialZoom });
        }
      }, 50);

      return () => clearTimeout(timer);
    }
  }, [isOpen, floorPlan.id, floorPlan.floorNumber, floorPlan.rooms.length, floorPlan.dimensions.width, floorPlan.dimensions.length]);

  // Preview polygon points (including rubberband cursor or rectangle preview)
  const previewPolygon = React.useMemo(() => {
    if (drawMode === 'rectangle') {
      if (rectStart && hoverPos) {
        const minX = Math.min(rectStart.x, hoverPos.x);
        const maxX = Math.max(rectStart.x, hoverPos.x);
        const minY = Math.min(rectStart.y, hoverPos.y);
        const maxY = Math.max(rectStart.y, hoverPos.y);
        if (maxX - minX > 0.2 && maxY - minY > 0.2) {
          return [
            { x: minX, y: minY, radius: defaultCornerRadius },
            { x: maxX, y: minY, radius: defaultCornerRadius },
            { x: maxX, y: maxY, radius: defaultCornerRadius },
            { x: minX, y: maxY, radius: defaultCornerRadius }
          ];
        }
      }
      return points;
    }
    return points;
  }, [drawMode, rectStart, hoverPos, points, defaultCornerRadius]);

  // Calculate live area and perimeter
  const currentArea = calculatePolygonArea(previewPolygon);
  const currentPerimeter = calculatePolygonPerimeter(previewPolygon);

  // Convert CAD meters to screen coordinates
  const worldToScreen = useCallback((wx: number, wy: number) => {
    return {
      x: wx * viewTransform.zoom + viewTransform.x,
      y: wy * viewTransform.zoom + viewTransform.y
    };
  }, [viewTransform]);

  // Check if cursor is within magnetic closing distance of the start point
  const isHoveringStartPoint = React.useMemo(() => {
    if (drawMode !== 'polygon' || points.length < 3 || !hoverPos) return false;
    const firstPt = points[0];
    const sFirst = worldToScreen(firstPt.x, firstPt.y);
    const sHover = worldToScreen(hoverPos.x, hoverPos.y);
    const pixelDist = Math.hypot(sHover.x - sFirst.x, sHover.y - sFirst.y);
    return pixelDist <= 26;
  }, [drawMode, points, hoverPos, worldToScreen]);

  // Convert screen coordinates to CAD meters with optional Ortho mode
  const screenToWorld = useCallback((screenX: number, screenY: number, shiftPressed = false): Point2D => {
    let rawX = (screenX - viewTransform.x) / viewTransform.zoom;
    let rawY = (screenY - viewTransform.y) / viewTransform.zoom;

    if (drawMode === 'polygon' && (orthoMode || shiftPressed) && points.length > 0) {
      const prev = points[points.length - 1];
      const dx = Math.abs(rawX - prev.x);
      const dy = Math.abs(rawY - prev.y);
      if (dx > dy) rawY = prev.y;
      else rawX = prev.x;
    }

    if (snapToGrid) {
      return {
        x: Math.round(rawX / gridSize) * gridSize,
        y: Math.round(rawY / gridSize) * gridSize
      };
    }
    return {
      x: Number(rawX.toFixed(2)),
      y: Number(rawY.toFixed(2))
    };
  }, [viewTransform, snapToGrid, gridSize, orthoMode, points, drawMode]);

  // Draw 2D CAD Canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Architectural paper background
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid rendering
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#e2e8f0';

    const step = gridSize * viewTransform.zoom;
    if (step >= 8) {
      const startX = viewTransform.x % step;
      const startY = viewTransform.y % step;

      ctx.beginPath();
      for (let x = startX; x < canvas.width; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
      }
      for (let y = startY; y < canvas.height; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Draw CAD Underlay Lines
    ctx.save();
    floorPlan.cadLines.forEach(line => {
      const p1 = worldToScreen(line.start.x, line.start.y);
      const p2 = worldToScreen(line.end.x, line.end.y);

      if (line.layer.includes('НЕСУЩИЕ')) {
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2.0;
      } else if (line.layer.includes('ОСИ')) {
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 0.8;
      } else {
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1.0;
      }

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    });
    ctx.restore();

    // Draw Existing Rooms (including smooth curves)
    floorPlan.rooms.forEach(r => {
      if (r.polygon.length < 3) return;
      const tess = hasCurvedGeometry(r.polygon)
        ? tessellatePolygon(r.polygon, 14, true)
        : r.polygon;

      ctx.save();
      ctx.beginPath();
      tess.forEach((pt, i) => {
        const sp = worldToScreen(pt.x, pt.y);
        if (i === 0) ctx.moveTo(sp.x, sp.y);
        else ctx.lineTo(sp.x, sp.y);
      });
      ctx.closePath();
      ctx.fillStyle = `${ZONE_CONFIG[r.zone]?.color}1e` || 'rgba(100, 116, 139, 0.1)';
      ctx.fill();
      ctx.strokeStyle = ZONE_CONFIG[r.zone]?.color || '#64748b';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Room label
      const center = worldToScreen(r.center.x, r.center.y);
      ctx.fillStyle = '#1e293b';
      ctx.font = '600 10px Plus Jakarta Sans, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${r.code}`, center.x, center.y - 6);
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillStyle = '#64748b';
      ctx.fillText(`${r.area.toFixed(1)} м²`, center.x, center.y + 6);

      ctx.restore();
    });

    // Draw Active User Polygon / Rectangle Preview
    const activePts = previewPolygon;
    if (activePts.length > 0) {
      ctx.save();

      // Build list of points including live cursor if in polygon mode
      const workingPts: Point2D[] = [...activePts];
      if (drawMode === 'polygon' && hoverPos && !isFinishing) {
        const targetPt = isHoveringStartPoint ? activePts[0] : hoverPos;
        if (!isHoveringStartPoint) {
          workingPts.push({
            x: targetPt.x,
            y: targetPt.y,
            radius: defaultCornerRadius
          });
        }
      }

      // 1. Draw subtle dashed control polygon (shows sharp corner vertices before rounding)
      if (hasCurvedGeometry(workingPts)) {
        ctx.beginPath();
        workingPts.forEach((pt, i) => {
          const sp = worldToScreen(pt.x, pt.y);
          if (i === 0) ctx.moveTo(sp.x, sp.y);
          else ctx.lineTo(sp.x, sp.y);
        });
        if (isHoveringStartPoint || isFinishing || drawMode === 'rectangle') {
          ctx.closePath();
        }
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 2. Draw smooth tessellated contour (shows true rounded corners & curved bulge walls)
      const isClosedShape = isHoveringStartPoint || isFinishing || drawMode === 'rectangle';
      const smoothPts = workingPts.length >= 2
        ? tessellatePolygon(workingPts, 14, isClosedShape)
        : workingPts;

      ctx.beginPath();
      smoothPts.forEach((pt, i) => {
        const sp = worldToScreen(pt.x, pt.y);
        if (i === 0) ctx.moveTo(sp.x, sp.y);
        else ctx.lineTo(sp.x, sp.y);
      });
      if (isClosedShape && smoothPts.length >= 3) {
        ctx.closePath();
      }

      ctx.strokeStyle = isHoveringStartPoint ? '#059669' : '#0284c7';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      if (workingPts.length >= 3) {
        ctx.fillStyle = isHoveringStartPoint
          ? 'rgba(16, 185, 129, 0.22)'
          : 'rgba(2, 132, 199, 0.16)';
        ctx.fill();
      }

      // 3. Draw Wall Dimension Lengths (e.g. "6.00 м") along each segment
      for (let i = 0; i < workingPts.length; i++) {
        const isLast = i === workingPts.length - 1;
        if (isLast && !isClosedShape) continue;

        const pA = workingPts[i];
        const pB = workingPts[(i + 1) % workingPts.length];
        const segLen = Math.hypot(pB.x - pA.x, pB.y - pA.y);

        if (segLen >= 0.5) {
          const sA = worldToScreen(pA.x, pA.y);
          const sB = worldToScreen(pB.x, pB.y);
          const midX = (sA.x + sB.x) / 2;
          const midY = (sA.y + sB.y) / 2;

          const labelText = pA.bulge
            ? `Дуга ${segLen.toFixed(2)} м`
            : `${segLen.toFixed(2)} м`;

          ctx.font = '600 10px JetBrains Mono, monospace';
          const textW = ctx.measureText(labelText).width + 8;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
          ctx.fillRect(midX - textW / 2, midY - 8, textW, 16);
          ctx.strokeStyle = '#cbd5e1';
          ctx.lineWidth = 1;
          ctx.strokeRect(midX - textW / 2, midY - 8, textW, 16);

          ctx.fillStyle = '#0f172a';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(labelText, midX, midY);
        }
      }

      // 4. Draw Vertex Handles & Magnetic Start Ring
      activePts.forEach((pt, i) => {
        const sp = worldToScreen(pt.x, pt.y);
        const isStart = i === 0;
        const isSelectedV = i === selectedVertexIdx;

        // Magnetic outer halo on Start Point when >= 3 points exist
        if (isStart && activePts.length >= 3 && drawMode === 'polygon') {
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, isHoveringStartPoint ? 18 : 13, 0, Math.PI * 2);
          ctx.fillStyle = isHoveringStartPoint
            ? 'rgba(16, 185, 129, 0.3)'
            : 'rgba(16, 185, 129, 0.14)';
          ctx.fill();
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = isHoveringStartPoint ? 2.5 : 1.5;
          ctx.stroke();
        }

        // Main vertex circle
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, isStart ? 7 : isSelectedV ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = isStart
          ? '#10b981'
          : isSelectedV
          ? '#f59e0b'
          : (pt.radius && pt.radius > 0)
          ? '#0d9488'
          : '#0284c7';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Corner radius badge next to vertex if R > 0
        if (pt.radius && pt.radius > 0) {
          ctx.fillStyle = '#0f766e';
          ctx.font = 'bold 10px JetBrains Mono, monospace';
          ctx.textAlign = 'left';
          ctx.fillText(`R=${pt.radius}м`, sp.x + 10, sp.y + 12);
        }

        // Label first point
        if (isStart && drawMode === 'polygon') {
          const badgeTxt = isHoveringStartPoint
            ? 'КЛИКНИТЕ ДЛЯ ЗАМЫКАНИЯ КОНТУРА'
            : activePts.length >= 3
            ? 'Старт (Кликните сюда для замыкания)'
            : 'Старт (Точка 1)';
          ctx.font = '600 11px Plus Jakarta Sans, sans-serif';
          const tw = ctx.measureText(badgeTxt).width + 12;
          ctx.fillStyle = isHoveringStartPoint ? '#059669' : '#0f172a';
          ctx.fillRect(sp.x + 12, sp.y - 22, tw, 20);
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(badgeTxt, sp.x + 18, sp.y - 12);
        }
      });

      ctx.restore();
    }

    // Cursor Crosshair
    if (hoverPos) {
      const target = isHoveringStartPoint && points.length > 0 ? points[0] : hoverPos;
      const sp = worldToScreen(target.x, target.y);
      ctx.save();
      ctx.strokeStyle = isHoveringStartPoint ? '#059669' : '#0284c7';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(sp.x - 10, sp.y);
      ctx.lineTo(sp.x + 10, sp.y);
      ctx.moveTo(sp.x, sp.y - 10);
      ctx.lineTo(sp.x, sp.y + 10);
      ctx.stroke();

      ctx.fillStyle = '#0f172a';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillText(`X:${target.x.toFixed(1)}м Y:${target.y.toFixed(1)}м`, sp.x + 12, sp.y + 14);
      ctx.restore();
    }
  }, [
    floorPlan,
    viewTransform,
    previewPolygon,
    points,
    hoverPos,
    gridSize,
    worldToScreen,
    drawMode,
    isFinishing,
    isHoveringStartPoint,
    defaultCornerRadius,
    selectedVertexIdx
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleResize = () => {
      canvas.width = canvas.parentElement?.clientWidth || 800;
      canvas.height = canvas.parentElement?.clientHeight || 600;
      draw();
    };

    handleResize();
    const ro = new ResizeObserver(handleResize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    window.addEventListener('resize', handleResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen, draw]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Keyboard Shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isFinishing) return;

      if (e.key === 'Escape') {
        if (points.length > 0 || rectStart) {
          setPoints([]);
          setRectStart(null);
          setSelectedVertexIdx(null);
        } else {
          onClose();
        }
      } else if (e.key === 'Enter') {
        if (points.length >= 3) setIsFinishing(true);
      } else if (e.key === 'Backspace' || (e.ctrlKey && e.key === 'z')) {
        setPoints(prev => prev.slice(0, -1));
        setSelectedVertexIdx(null);
      } else if (e.key === 'ArrowLeft' || e.code === 'KeyA') {
        setViewTransform(prev => ({ ...prev, x: prev.x + 45 }));
      } else if (e.key === 'ArrowRight' || e.code === 'KeyD') {
        setViewTransform(prev => ({ ...prev, x: prev.x - 45 }));
      } else if (e.key === 'ArrowUp' || e.code === 'KeyW') {
        setViewTransform(prev => ({ ...prev, y: prev.y + 45 }));
      } else if (e.key === 'ArrowDown' || e.code === 'KeyS') {
        setViewTransform(prev => ({ ...prev, y: prev.y - 45 }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isFinishing, points.length, rectStart, onClose]);

  // Mouse Interactions
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
      isPanningRef.current = true;
      startPanRef.current = { x: e.clientX - viewTransform.x, y: e.clientY - viewTransform.y };
      return;
    }

    if (e.button === 0) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // 1. Check if clicking start point to close polygon
      if (drawMode === 'polygon' && points.length >= 3 && isHoveringStartPoint) {
        setIsFinishing(true);
        return;
      }

      // 2. Check if clicking an existing vertex (other than start when >=3) to edit its radius/bulge
      if (drawMode === 'polygon' && points.length > 0) {
        for (let i = 0; i < points.length; i++) {
          if (i === 0 && points.length >= 3) continue;
          const sp = worldToScreen(points[i].x, points[i].y);
          if (Math.hypot(mouseX - sp.x, mouseY - sp.y) <= 12) {
            setSelectedVertexIdx(i);
            return;
          }
        }
      }

      const pt = screenToWorld(mouseX, mouseY, e.shiftKey);

      // Rectangle 2-click mode
      if (drawMode === 'rectangle') {
        if (!rectStart) {
          setRectStart(pt);
        } else {
          const minX = Math.min(rectStart.x, pt.x);
          const maxX = Math.max(rectStart.x, pt.x);
          const minY = Math.min(rectStart.y, pt.y);
          const maxY = Math.max(rectStart.y, pt.y);
          if (maxX - minX >= 0.5 && maxY - minY >= 0.5) {
            const rectPoly: Point2D[] = [
              { x: minX, y: minY, radius: defaultCornerRadius || undefined },
              { x: maxX, y: minY, radius: defaultCornerRadius || undefined },
              { x: maxX, y: maxY, radius: defaultCornerRadius || undefined },
              { x: minX, y: maxY, radius: defaultCornerRadius || undefined }
            ];
            setPoints(rectPoly);
            setRectStart(null);
            setIsFinishing(true);
          }
        }
        return;
      }

      // Polygon mode: add new vertex with current corner radius & bulge
      const newVertex: Point2D = {
        x: pt.x,
        y: pt.y,
        radius: defaultCornerRadius > 0 ? defaultCornerRadius : undefined,
        bulge: Math.abs(nextSegmentBulge) > 0.01 ? nextSegmentBulge : undefined
      };
      setPoints(prev => [...prev, newVertex]);
      setSelectedVertexIdx(points.length);
      // Reset next segment bulge after placing point so only intentional walls curve
      if (nextSegmentBulge !== 0) {
        setNextSegmentBulge(0);
      }
    }
  };

  const handleDoubleClick = () => {
    if (drawMode === 'polygon' && points.length >= 3) {
      setIsFinishing(true);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (isPanningRef.current) {
      setViewTransform(prev => ({
        ...prev,
        x: e.clientX - startPanRef.current.x,
        y: e.clientY - startPanRef.current.y
      }));
      return;
    }

    const pt = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, e.shiftKey);
    setHoverPos(pt);
  };

  const handleMouseUp = () => {
    isPanningRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setViewTransform(prev => {
      const newZoom = Math.min(80, Math.max(1.5, prev.zoom * zoomFactor));
      return {
        zoom: newZoom,
        x: mouseX - (mouseX - prev.x) * (newZoom / prev.zoom),
        y: mouseY - (mouseY - prev.y) * (newZoom / prev.zoom)
      };
    });
  };

  // Update radius or bulge of currently selected vertex
  const updateSelectedVertex = (patch: Partial<Point2D>) => {
    if (selectedVertexIdx === null) return;
    setPoints(prev => prev.map((pt, idx) => idx === selectedVertexIdx ? { ...pt, ...patch } : pt));
  };

  const handleConfirmRoom = () => {
    const finalPoly = previewPolygon;
    if (finalPoly.length < 3) return;
    const center = calculatePolygonCenter(finalPoly);
    const area = calculatePolygonArea(finalPoly);
    const perimeter = calculatePolygonPerimeter(finalPoly);

    const newRoom: Room = {
      id: `manual_room_${Date.now()}`,
      code: formData.code,
      name: formData.name,
      zone: formData.zone,
      cleanliness: formData.cleanliness,
      commonSubType: formData.commonSubType,
      polygon: [...finalPoly],
      area: Number(area.toFixed(1)),
      perimeter: Number(perimeter.toFixed(1)),
      height: formData.height,
      center,
      floorId: floorPlan.id,
      isAutoDetected: false
    };

    onAddRoom(newRoom);
    setIsFinishing(false);
    onClose();
  };

  if (!isOpen) return null;

  const activeVertex = selectedVertexIdx !== null ? points[selectedVertexIdx] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="relative w-full max-w-6xl h-[90vh] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        {/* Top Header */}
        <div className="px-5 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shadow-xs">
              <Crosshair className="w-4 h-4 text-sky-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Разметка контура помещения ({floorPlan.floorNumber}-й этаж)
              </h2>
              <p className="text-[11px] text-slate-500">
                Поддерживаются прямые стены, скругленные углы (R) и дуговые эркеры
              </p>
            </div>
          </div>

          {/* Drawing Mode & Snapping Controls */}
          <div className="flex items-center gap-2">
            {/* Mode Switcher: Polygon vs 2-Click Rectangle */}
            <div className="flex items-center bg-slate-200/70 p-0.5 rounded-lg border border-slate-200 text-xs">
              <button
                onClick={() => { setDrawMode('polygon'); setRectStart(null); }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  drawMode === 'polygon'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Pentagon className="w-3.5 h-3.5 text-sky-600" />
                По точкам
              </button>
              <button
                onClick={() => { setDrawMode('rectangle'); setPoints([]); setRectStart(null); }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  drawMode === 'rectangle'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Square className="w-3.5 h-3.5 text-teal-600" />
                Прямоугольник (2 клика)
              </button>
            </div>

            {/* Default Corner Radius Selector */}
            <div className="flex items-center gap-1 bg-white px-2.5 py-1 rounded-lg border border-slate-200 text-xs">
              <CornerUpRight className="w-3.5 h-3.5 text-teal-600 shrink-0" />
              <span className="text-slate-500 whitespace-nowrap">Скругление R:</span>
              {[0, 0.8, 1.5, 2.5].map(rVal => (
                <button
                  key={rVal}
                  onClick={() => {
                    setDefaultCornerRadius(rVal);
                    if (selectedVertexIdx !== null) {
                      updateSelectedVertex({ radius: rVal || undefined });
                    }
                  }}
                  className={`px-1.5 py-0.5 rounded font-mono text-[11px] transition-colors cursor-pointer ${
                    defaultCornerRadius === rVal
                      ? 'bg-teal-600 text-white font-semibold'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {rVal === 0 ? '0м' : `${rVal}м`}
                </button>
              ))}
            </div>

            <button
              onClick={() => setOrthoMode(!orthoMode)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                orthoMode
                  ? 'bg-sky-50 text-sky-700 border-sky-300'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
              title="Фиксация прямых углов 90°"
            >
              <Compass className="w-3.5 h-3.5" />
              Орто 90°
            </button>

            <button
              onClick={() => setSnapToGrid(!snapToGrid)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                snapToGrid
                  ? 'bg-sky-50 text-sky-700 border-sky-300'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Magnet className="w-3.5 h-3.5" />
              Сетка {gridSize}м
            </button>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* CAD Canvas Area */}
        <div className="relative flex-1 bg-slate-100 overflow-hidden">
          <canvas
            ref={canvasRef}
            className="w-full h-full cursor-crosshair"
            onMouseDown={handleMouseDown}
            onDoubleClick={handleDoubleClick}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
            onContextMenu={e => e.preventDefault()}
          />

          {/* Top-Center Prominent Closing Guide Banner when >= 3 points exist */}
          {drawMode === 'polygon' && points.length >= 3 && !isFinishing && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-slate-900/95 text-white px-4 py-2 rounded-lg shadow-lg border border-slate-700 flex items-center gap-3 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                Поставлено <strong>{points.length}</strong> вершин (<strong>{currentArea.toFixed(1)} м²</strong>). Кликните в зеленую точку <strong>Старт</strong> или нажмите:
              </span>
              <button
                onClick={() => setIsFinishing(true)}
                className="px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap"
              >
                Замкнуть контур (Enter)
              </button>
            </div>
          )}

          {/* Selected Vertex Curvature / Corner Radius Bar (Top-Left on Canvas) */}
          {activeVertex && drawMode === 'polygon' && (
            <div className="absolute top-3 left-4 z-10 bg-white/95 p-3 rounded-lg border border-slate-200 shadow-md text-xs space-y-2 max-w-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                <span className="font-semibold text-slate-900">
                  Вершина №{(selectedVertexIdx ?? 0) + 1} ({activeVertex.x}м, {activeVertex.y}м)
                </span>
                <button
                  onClick={() => setSelectedVertexIdx(null)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              </div>

              <div>
                <span className="text-[11px] text-slate-500 block mb-1">
                  Радиус скругления этого угла (м):
                </span>
                <div className="flex items-center gap-1">
                  {[0, 0.5, 1.0, 1.5, 2.0, 3.0].map(r => (
                    <button
                      key={r}
                      onClick={() => updateSelectedVertex({ radius: r || undefined })}
                      className={`px-2 py-1 rounded font-mono text-[11px] border transition-colors cursor-pointer ${
                        (activeVertex.radius || 0) === r
                          ? 'bg-teal-600 text-white border-teal-600 font-semibold'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {r === 0 ? '0' : `${r}м`}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-[11px] text-slate-500 block mb-1">
                  Кривизна стены от этой точки к следующей:
                </span>
                <div className="flex items-center gap-1">
                  {[
                    { label: 'Прямая', val: 0 },
                    { label: 'Дуга наружу', val: 0.28 },
                    { label: 'Дуга внутрь', val: -0.28 },
                    { label: 'Эркер 180°', val: 0.6 }
                  ].map(opt => (
                    <button
                      key={opt.label}
                      onClick={() => updateSelectedVertex({ bulge: opt.val || undefined })}
                      className={`px-2 py-1 rounded text-[11px] border transition-colors cursor-pointer whitespace-nowrap ${
                        (activeVertex.bulge || 0) === opt.val
                          ? 'bg-sky-600 text-white border-sky-600 font-semibold'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Floating Status Bar (Bottom-Left) */}
          <div className="absolute bottom-4 left-4 z-10 bg-white/95 px-4 py-2.5 rounded-lg border border-slate-200 shadow-md flex items-center gap-4 text-xs tabular-nums">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Точек:</span>
              <span className="font-mono font-bold text-slate-900">
                {previewPolygon.length}
              </span>
            </div>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Площадь:</span>
              <span className="font-mono font-bold text-sky-700">
                {currentArea.toFixed(1)} м²
              </span>
            </div>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Периметр:</span>
              <span className="font-mono font-semibold text-slate-700">
                {currentPerimeter.toFixed(1)} м
              </span>
            </div>

            <div className="h-4 w-[1px] bg-slate-200" />

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setPoints(prev => prev.slice(0, -1));
                  setSelectedVertexIdx(null);
                }}
                disabled={points.length === 0}
                className="px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40 rounded flex items-center gap-1 font-medium transition-colors cursor-pointer"
                title="Отменить последнюю точку (Ctrl+Z)"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Шаг назад
              </button>
              <button
                onClick={() => {
                  setPoints([]);
                  setRectStart(null);
                  setSelectedVertexIdx(null);
                }}
                disabled={points.length === 0 && !rectStart}
                className="px-2 py-1 text-rose-600 hover:bg-rose-50 disabled:opacity-40 rounded font-medium transition-colors cursor-pointer"
              >
                Сбросить
              </button>
            </div>
          </div>

          {/* Action Button: Finish Polygon (Bottom-Right) */}
          <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-200 font-medium text-xs shadow-xs transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button
              onClick={() => setIsFinishing(true)}
              disabled={points.length < 3}
              className="flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white rounded-lg font-semibold text-xs shadow-md shadow-sky-600/20 transition-all cursor-pointer"
            >
              <Box className="w-4 h-4" />
              Замкнуть и построить 3D
            </button>
          </div>
        </div>

        {/* Modal: Room Parameters Form */}
        {isFinishing && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 p-6 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                  <Box className="w-4 h-4 text-sky-600" /> Параметры 3D помещения
                </h3>
                <span className="font-mono text-xs text-sky-700 font-semibold tabular-nums">
                  S = {currentArea.toFixed(1)} м²
                </span>
              </div>

              <div className="mt-4 space-y-3.5">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Код / №
                    </label>
                    <input
                      type="text"
                      value={formData.code}
                      onChange={e => setFormData({ ...formData, code: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-sky-500 font-mono"
                      placeholder="201"
                      autoFocus
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Высота стен в 3D (м)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="1.0"
                      max="6.0"
                      value={formData.height}
                      onChange={e => setFormData({ ...formData, height: parseFloat(e.target.value) || 3.3 })}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-sky-500 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Наименование помещения
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={e => {
                      const name = e.target.value;
                      const { zone, cleanliness, commonSubType } = classifyHospitalZone(name);
                      setFormData({ ...formData, name, zone, cleanliness, commonSubType });
                    }}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-sky-500"
                    placeholder="Например: Лестничная клетка ЛК-3 или Палата №5"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Назначение / Зона больницы
                  </label>
                  <select
                    value={formData.zone}
                    onChange={e => setFormData({ ...formData, zone: e.target.value as HospitalZone })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-sky-500 bg-white"
                  >
                    {Object.entries(ZONE_CONFIG).map(([key, cfg]) => (
                      <option key={key} value={key}>{cfg.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Тип 3D-символа (для общих и инженерных зон)
                  </label>
                  <select
                    value={formData.commonSubType}
                    onChange={e => setFormData({ ...formData, commonSubType: e.target.value as CommonSubType })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-sky-500 bg-white"
                  >
                    {Object.entries(COMMON_SUBTYPE_CONFIG).map(([key, cfg]) => (
                      <option key={key} value={key}>{cfg.label} — {cfg.description}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Класс чистоты (СанПиН)
                  </label>
                  <select
                    value={formData.cleanliness}
                    onChange={e => setFormData({ ...formData, cleanliness: e.target.value as CleanlinessClass })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-sky-500 bg-white"
                  >
                    {Object.entries(CLEANLINESS_CONFIG).map(([key, cfg]) => (
                      <option key={key} value={key}>{cfg.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsFinishing(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Вернуться к контуру
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRoom}
                  className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg shadow-xs transition-colors cursor-pointer"
                >
                  Построить 3D объем
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
