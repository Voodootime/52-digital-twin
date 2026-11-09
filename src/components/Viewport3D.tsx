import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FloorPlan, Room, ZONE_CONFIG, CLEANLINESS_CONFIG, COMMON_SUBTYPE_CONFIG } from '../types/cad';
import { tessellatePolygon, hasCurvedGeometry } from '../services/dxfParser';
import { 
  Compass,
  Building2,
  Hand,
  Rotate3d,
  Maximize2
} from 'lucide-react';

interface Viewport3DProps {
  floorPlan: FloorPlan;
  allFloors: FloorPlan[];
  viewMode: 'single' | 'stack';
  explodeGap: number; // 0 to 14m vertical spacing between floors in stack mode
  selectedRoomId: string | null;
  onSelectRoom: (roomId: string | null, floorId?: string) => void;
  wallHeightCutaway: number; // 0.3 to 3.6m
  cadUnderlayOpacity: number; // 0 to 1
  showLabels: boolean;
  showCadUnderlay: boolean;
  show3DSymbols: boolean;
  colorMode: 'zone' | 'cleanliness' | 'monochrome';
}

// Check software WebGL renderer probe
const isSoftwareGl = (() => {
  if (typeof document === 'undefined') return true;
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return true;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
})();

/**
 * Generates procedural 3D architectural symbols inside common zones:
 * - staircase: two-flight stair steps + mid landing + handrail
 * - elevator: elevator shaft frame + metallic elevator cab + doors
 * - restroom: internal sanitary stalls & sink counter
 * - hall: nurse station / reception desk in wide lobbies
 */
function createProceduralSymbolGroup(room: Room, cutHeight: number): THREE.Group | null {
  const subType = room.commonSubType || 'standard';
  if (subType === 'standard') return null;

  const pts = room.polygon;
  const minX = Math.min(...pts.map(p => p.x));
  const maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y));
  const maxY = Math.max(...pts.map(p => p.y));
  const w = maxX - minX;
  const d = maxY - minY;
  const cx = (minX + maxX) / 2;
  const cz = (minY + maxY) / 2;

  if (w < 1.8 || d < 1.8) return null;

  const group = new THREE.Group();

  if (subType === 'staircase') {
    // Procedural Two-Flight Staircase with Mid-Landing
    const stairMat = new THREE.MeshStandardMaterial({
      color: 0x4f46e5,
      roughness: 0.4,
      metalness: 0.2
    });
    const railMat = new THREE.LineBasicMaterial({ color: 0x312e81 });

    const flightW = Math.min(w * 0.36, 1.4);
    const flightLen = Math.min(d * 0.65, 3.8);
    const landingD = Math.min(d * 0.22, 1.3);
    const maxH = Math.min(room.height, cutHeight);
    const stepsPerFlight = 6;
    const stepH = (maxH * 0.85) / (stepsPerFlight * 2);
    const stepD = flightLen / stepsPerFlight;

    // Flight 1 (Left side ascending along -Z)
    for (let i = 0; i < stepsPerFlight; i++) {
      const h = (i + 1) * stepH;
      const stepGeom = new THREE.BoxGeometry(flightW, h, stepD * 0.92);
      const stepMesh = new THREE.Mesh(stepGeom, stairMat);
      stepMesh.position.set(
        cx - flightW * 0.6,
        h / 2 + 0.02,
        cz + flightLen / 2 - (i + 0.5) * stepD
      );
      group.add(stepMesh);
    }

    // Mid Landing Platform
    const midH = stepsPerFlight * stepH;
    const landingGeom = new THREE.BoxGeometry(flightW * 2.25, 0.14, landingD);
    const landingMesh = new THREE.Mesh(landingGeom, stairMat);
    landingMesh.position.set(cx, midH, cz - flightLen / 2 - landingD / 2 + 0.1);
    group.add(landingMesh);

    // Flight 2 (Right side ascending along +Z)
    for (let i = 0; i < stepsPerFlight; i++) {
      const h = (i + 1) * stepH;
      const stepGeom = new THREE.BoxGeometry(flightW, 0.14, stepD * 0.92);
      const stepMesh = new THREE.Mesh(stepGeom, stairMat);
      stepMesh.position.set(
        cx + flightW * 0.6,
        midH + h,
        cz - flightLen / 2 + (i + 0.5) * stepD
      );
      group.add(stepMesh);
    }

    // Handrail line
    const railPts = [
      new THREE.Vector3(cx - flightW * 0.1, 0.5, cz + flightLen / 2),
      new THREE.Vector3(cx - flightW * 0.1, midH + 0.5, cz - flightLen / 2),
      new THREE.Vector3(cx + flightW * 0.1, midH + 0.5, cz - flightLen / 2),
      new THREE.Vector3(cx + flightW * 0.1, maxH * 0.85 + 0.5, cz + flightLen / 2)
    ];
    const railGeom = new THREE.BufferGeometry().setFromPoints(railPts);
    group.add(new THREE.Line(railGeom, railMat));

    return group;
  }

  if (subType === 'elevator') {
    // Procedural Hospital Elevator Cabs & Shaft Frame
    const cabMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.25,
      metalness: 0.7
    });
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.2,
      metalness: 0.85
    });
    const railMat = new THREE.LineBasicMaterial({ color: 0x4f46e5 });

    const numCabs = w >= 5.0 ? 2 : 1;
    const cabW = Math.min((w * 0.7) / numCabs, 2.1);
    const cabD = Math.min(d * 0.52, 2.4);
    const cabH = Math.min(room.height * 0.78, cutHeight * 0.9);

    for (let i = 0; i < numCabs; i++) {
      const offsetX = numCabs === 2 ? (i === 0 ? -cabW * 0.65 : cabW * 0.65) : 0;
      const cabX = cx + offsetX;
      const cabZ = cz - d * 0.12;

      // Elevator Cab Body
      const cabGeom = new THREE.BoxGeometry(cabW, cabH, cabD);
      const cabMesh = new THREE.Mesh(cabGeom, cabMat);
      cabMesh.position.set(cabX, cabH / 2 + 0.05, cabZ);
      group.add(cabMesh);

      // Elevator Doors (Front face)
      const doorGeom = new THREE.BoxGeometry(cabW * 0.75, cabH * 0.88, 0.08);
      const doorMesh = new THREE.Mesh(doorGeom, doorMat);
      doorMesh.position.set(cabX, cabH * 0.46 + 0.05, cabZ + cabD / 2 + 0.02);
      group.add(doorMesh);

      // Diagonal Shaft Bracing X-lines on top
      const xPts = [
        new THREE.Vector3(cabX - cabW / 2, cabH + 0.08, cabZ - cabD / 2),
        new THREE.Vector3(cabX + cabW / 2, cabH + 0.08, cabZ + cabD / 2),
        new THREE.Vector3(cabX + cabW / 2, cabH + 0.08, cabZ - cabD / 2),
        new THREE.Vector3(cabX - cabW / 2, cabH + 0.08, cabZ + cabD / 2)
      ];
      const xGeom = new THREE.BufferGeometry().setFromPoints(xPts);
      group.add(new THREE.LineSegments(xGeom, railMat));
    }

    return group;
  }

  if (subType === 'restroom') {
    // Procedural Sanitary Stalls & Washbasin Counter
    const stallMat = new THREE.MeshStandardMaterial({
      color: 0x7c3aed,
      roughness: 0.4,
      metalness: 0.1,
      transparent: true,
      opacity: 0.75
    });
    const fixtureMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.15,
      metalness: 0.1
    });

    const stallH = Math.min(1.8, cutHeight * 0.75);
    const numStalls = Math.min(3, Math.floor(w / 1.6));
    const stallW = Math.min(1.2, (w * 0.7) / Math.max(1, numStalls));
    const stallD = Math.min(1.5, d * 0.4);

    for (let i = 0; i < numStalls; i++) {
      const sx = minX + 0.8 + i * stallW;
      const sz = minY + 0.4 + stallD / 2;

      // Divider partition
      const partGeom = new THREE.BoxGeometry(0.08, stallH, stallD);
      const partMesh = new THREE.Mesh(partGeom, stallMat);
      partMesh.position.set(sx, stallH / 2 + 0.02, sz);
      group.add(partMesh);

      // Ceramic fixture block
      const fixGeom = new THREE.BoxGeometry(0.45, 0.45, 0.65);
      const fixMesh = new THREE.Mesh(fixGeom, fixtureMat);
      fixMesh.position.set(sx + stallW / 2, 0.25, sz - stallD * 0.2);
      group.add(fixMesh);
    }

    return group;
  }

  if (subType === 'hall' && w >= 5 && d >= 4 && w / d < 4) {
    // Procedural Central Medical Reception / Nurse Station Desk in Main Halls & Posts
    const deskMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.3,
      metalness: 0.2
    });
    const topMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.2,
      metalness: 0.1
    });

    const deskH = Math.min(1.1, cutHeight * 0.6);
    const deskW = Math.min(3.2, w * 0.32);
    const deskD = Math.min(1.4, d * 0.25);

    const baseGeom = new THREE.BoxGeometry(deskW, deskH, deskD);
    const baseMesh = new THREE.Mesh(baseGeom, deskMat);
    baseMesh.position.set(cx, deskH / 2 + 0.02, cz);
    group.add(baseMesh);

    const counterGeom = new THREE.BoxGeometry(deskW + 0.2, 0.08, deskD + 0.2);
    const counterMesh = new THREE.Mesh(counterGeom, topMat);
    counterMesh.position.set(cx, deskH + 0.05, cz);
    group.add(counterMesh);

    return group;
  }

  return null;
}

export const Viewport3D: React.FC<Viewport3DProps> = ({
  floorPlan,
  allFloors,
  viewMode,
  explodeGap,
  selectedRoomId,
  onSelectRoom,
  wallHeightCutaway,
  cadUnderlayOpacity,
  showLabels,
  showCadUnderlay,
  show3DSymbols,
  colorMode
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  // Master container holding Floor Groups (1 group in 'single' mode, N groups in 'stack' mode)
  const buildingStackGroupRef = useRef<THREE.Group | null>(null);
  const floorGroupsMapRef = useRef<Map<string, { group: THREE.Group; targetY: number }>>(new Map());
  const shaftGuidesGroupRef = useRef<THREE.Group | null>(null);

  // Fast lookup arrays for zero-allocation raycasting & instant material updates without geometry rebuilds
  const roomMeshesRef = useRef<THREE.Mesh[]>([]);
  const cadLinesRef = useRef<THREE.LineSegments[]>([]);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const pointerNdcRef = useRef<THREE.Vector2>(new THREE.Vector2());
  const isPointerDownRef = useRef<boolean>(false);
  const lastHoverCheckRef = useRef<number>(0);

  // Click vs Drag detection
  const pointerDownPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const [hoveredRoom, setHoveredRoom] = useState<{ room: Room; floorName: string } | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Navigation tool mode ('orbit' = LMB rotates, 'pan' = LMB pans horizontally along floor)
  const [navToolMode, setNavToolMode] = useState<'orbit' | 'pan'>('orbit');
  const [isSpaceHeld, setIsSpaceHeld] = useState<boolean>(false);
  const pressedKeysRef = useRef<Set<string>>(new Set());

  // Camera animation targets
  const targetCameraPos = useRef<THREE.Vector3 | null>(null);
  const targetLookAt = useRef<THREE.Vector3 | null>(null);

  // References for room label DOM nodes & floor badge DOM nodes
  const labelDomsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const floorBadgeDomsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // Keep active floors ref for the animation loop
  const activeFloorsList = viewMode === 'stack'
    ? [...allFloors].sort((a, b) => a.floorNumber - b.floorNumber)
    : [floorPlan];

  const activeFloorsRef = useRef<FloorPlan[]>(activeFloorsList);
  activeFloorsRef.current = activeFloorsList;

  const wallHeightRef = useRef(wallHeightCutaway);
  wallHeightRef.current = wallHeightCutaway;

  const explodeGapRef = useRef(explodeGap);
  explodeGapRef.current = explodeGap;

  const selectedRoomIdRef = useRef<string | null>(selectedRoomId);
  selectedRoomIdRef.current = selectedRoomId;

  const showCadUnderlayRef = useRef<boolean>(showCadUnderlay);
  showCadUnderlayRef.current = showCadUnderlay;

  const cadUnderlayOpacityRef = useRef<number>(cadUnderlayOpacity);
  cadUnderlayOpacityRef.current = cadUnderlayOpacity;

  // Update targetY whenever explodeGap or viewMode changes
  useEffect(() => {
    const sorted = viewMode === 'stack'
      ? [...allFloors].sort((a, b) => a.floorNumber - b.floorNumber)
      : [floorPlan];

    const minElev = sorted.length > 0 ? sorted[0].elevation : 0;

    sorted.forEach((fl, idx) => {
      const entry = floorGroupsMapRef.current.get(fl.id);
      if (entry) {
        entry.targetY = viewMode === 'stack'
          ? (fl.elevation - minElev) + idx * explodeGap
          : 0;
      }
    });
  }, [viewMode, explodeGap, allFloors, floorPlan]);

  // Adjust camera distance smoothly when switching between Single Floor and Multi-Floor Stack ("Пирог")
  useEffect(() => {
    const cx = floorPlan.dimensions.width / 2;
    const cz = floorPlan.dimensions.length / 2;
    const dist = Math.max(floorPlan.dimensions.width, floorPlan.dimensions.length);

    if (viewMode === 'stack') {
      const stackHeight = (allFloors.length - 1) * (3.6 + explodeGap);
      targetLookAt.current = new THREE.Vector3(cx, stackHeight * 0.4, cz);
      targetCameraPos.current = new THREE.Vector3(
        cx - dist * 0.9,
        dist * 0.75 + stackHeight * 0.65,
        cz + dist * 0.95
      );
    } else {
      targetLookAt.current = new THREE.Vector3(cx, 0, cz);
      targetCameraPos.current = new THREE.Vector3(
        cx + dist * 0.7,
        dist * 0.75,
        cz + dist * 0.7
      );
    }
  }, [viewMode]);

  // Initialize Scene
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const maxPlanDim = Math.max(floorPlan.dimensions.width, floorPlan.dimensions.length, 40);

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8fafc);
    scene.fog = new THREE.Fog(0xf8fafc, maxPlanDim * 1.8, maxPlanDim * 5.5);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.5, maxPlanDim * 6);
    const centerX = floorPlan.dimensions.width / 2;
    const centerZ = floorPlan.dimensions.length / 2;
    const dist = Math.max(floorPlan.dimensions.width, floorPlan.dimensions.length);
    camera.position.set(centerX + dist * 0.7, dist * 0.75, centerZ + dist * 0.7);
    camera.lookAt(centerX, 0, centerZ);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      alpha: true
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.replaceChildren(renderer.domElement);
    rendererRef.current = renderer;

    // WebGL Context Loss & Restoration resilience
    const handleContextLost = (event: Event) => {
      event.preventDefault();
    };
    const handleContextRestored = () => {
      renderer.render(scene, camera);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost, false);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored, false);

    // Studio Environment
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // Lighting
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xe2e8f0, 0.9);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xfffaed, 1.35);
    dirLight.position.set(centerX + maxPlanDim * 0.6, maxPlanDim * 1.1, centerZ + maxPlanDim * 0.5);
    dirLight.castShadow = !isSoftwareGl;
    if (!isSoftwareGl) {
      dirLight.shadow.mapSize.width = 2048;
      dirLight.shadow.mapSize.height = 2048;
      dirLight.shadow.camera.near = 1;
      dirLight.shadow.camera.far = maxPlanDim * 3.5;
      const d = Math.max(centerX, centerZ) + 30;
      dirLight.shadow.camera.left = -d;
      dirLight.shadow.camera.right = d;
      dirLight.shadow.camera.top = d;
      dirLight.shadow.camera.bottom = -d;
      dirLight.shadow.bias = -0.0005;
      dirLight.shadow.normalBias = 0.02;
    }
    scene.add(dirLight);

    // Orbit Controls configured for horizontal floor plane (XZ) traversal
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.enablePan = true;
    controls.panSpeed = 1.15;
    // CRITICAL: false = pan strictly horizontally parallel to the floor (XZ plane)
    controls.screenSpacePanning = false;
    controls.target.set(centerX, 0, centerZ);
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    controls.minDistance = 3;
    controls.maxDistance = Math.max(260, maxPlanDim * 3.2);
    controlsRef.current = controls;

    // Stop scripted camera transitions when user manually orbits or pans
    const handleControlsStart = () => {
      targetCameraPos.current = null;
      targetLookAt.current = null;
    };
    controls.addEventListener('start', handleControlsStart);

    // Ground Base Platform (generously sized so long floors can be panned freely)
    const groundGeom = new THREE.PlaneGeometry(
      floorPlan.dimensions.width + maxPlanDim * 1.5,
      floorPlan.dimensions.length + maxPlanDim * 1.5
    );
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0.02
    });
    const groundMesh = new THREE.Mesh(groundGeom, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.set(centerX, -0.08, centerZ);
    groundMesh.receiveShadow = !isSoftwareGl;
    scene.add(groundMesh);

    // Ground Grid
    const gridSpan = Math.round(maxPlanDim * 2.2);
    const gridHelper = new THREE.GridHelper(
      gridSpan,
      Math.min(120, Math.round(gridSpan / 2)),
      0xcbd5e1,
      0xe2e8f0
    );
    gridHelper.position.set(centerX, -0.04, centerZ);
    scene.add(gridHelper);

    // Master Building Stack Group
    const buildingStackGroup = new THREE.Group();
    scene.add(buildingStackGroup);
    buildingStackGroupRef.current = buildingStackGroup;

    // Vertical Shaft Alignment Guides Group
    const shaftGuidesGroup = new THREE.Group();
    scene.add(shaftGuidesGroup);
    shaftGuidesGroupRef.current = shaftGuidesGroup;

    const tempVec = new THREE.Vector3();

    // Direct DOM label projection helper
    const updateLabelPositions = () => {
      if (!camera || !container) return;
      const hw = container.clientWidth / 2;
      const hh = container.clientHeight / 2;

      activeFloorsRef.current.forEach(fl => {
        const floorEntry = floorGroupsMapRef.current.get(fl.id);
        const floorY = floorEntry ? floorEntry.group.position.y : 0;

        // Project Floor Slab Badge (for multi-floor stack view)
        const floorBadgeDom = floorBadgeDomsRef.current.get(fl.id);
        if (floorBadgeDom) {
          tempVec.set(-1.5, floorY + 1.2, fl.dimensions.length / 2);
          tempVec.project(camera);
          if (tempVec.z < 1) {
            const fx = (tempVec.x * hw) + hw;
            const fy = -(tempVec.y * hh) + hh;
            floorBadgeDom.style.transform = `translate3d(${fx.toFixed(1)}px, ${fy.toFixed(1)}px, 0) translate(-100%, -50%)`;
            floorBadgeDom.style.display = 'block';
          } else {
            floorBadgeDom.style.display = 'none';
          }
        }

        // Project Room Labels
        fl.rooms.forEach(r => {
          const dom = labelDomsRef.current.get(r.id);
          if (!dom) return;

          const roomTop = Math.min(r.height, wallHeightRef.current);
          tempVec.set(r.center.x, floorY + roomTop + 0.35, r.center.y);
          tempVec.project(camera);

          if (tempVec.z < 1) {
            const sx = (tempVec.x * hw) + hw;
            const sy = -(tempVec.y * hh) + hh;
            dom.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -50%)`;
            dom.style.display = 'block';
          } else {
            dom.style.display = 'none';
          }
        });
      });
    };

    // Pre-allocated vectors for zero-GC keyboard navigation in animate()
    const keyForward = new THREE.Vector3();
    const keyRight = new THREE.Vector3();
    const keyMoveDelta = new THREE.Vector3();
    const worldUp = new THREE.Vector3(0, 1, 0);

    // Render loop
    let animationFrameId = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.1);

      // Smoothly damp each floor group's Y position for the Exploded Multi-Floor Stack ("Пирог")
      let maxCurrentFloorY = 0;
      floorGroupsMapRef.current.forEach(entry => {
        entry.group.position.y = THREE.MathUtils.damp(
          entry.group.position.y,
          entry.targetY,
          8,
          delta
        );
        if (entry.group.position.y > maxCurrentFloorY) {
          maxCurrentFloorY = entry.group.position.y;
        }
      });

      // Keep vertical shaft guide lines locked to the top floor's current animated Y
      if (shaftGuidesGroupRef.current) {
        shaftGuidesGroupRef.current.scale.y = Math.max(0.1, maxCurrentFloorY + 3.6);
      }

      // WASD / Arrow Keys horizontal floor traversal
      const keys = pressedKeysRef.current;
      if (keys.size > 0) {
        let forwardInput = 0;
        let rightInput = 0;
        if (keys.has('KeyW') || keys.has('ArrowUp')) forwardInput += 1;
        if (keys.has('KeyS') || keys.has('ArrowDown')) forwardInput -= 1;
        if (keys.has('KeyD') || keys.has('ArrowRight')) rightInput += 1;
        if (keys.has('KeyA') || keys.has('ArrowLeft')) rightInput -= 1;

        if (forwardInput !== 0 || rightInput !== 0) {
          targetCameraPos.current = null;
          targetLookAt.current = null;

          // Compute camera horizontal forward direction on XZ plane
          keyForward.subVectors(controls.target, camera.position);
          keyForward.y = 0;
          if (keyForward.lengthSq() < 0.0001) {
            // In top-down view, use camera's up vector projected on XZ
            keyForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
            keyForward.y = 0;
          }
          keyForward.normalize();
          keyRight.crossVectors(keyForward, worldUp).normalize();

          const camDist = camera.position.distanceTo(controls.target);
          const isBoost = keys.has('ShiftLeft') || keys.has('ShiftRight');
          const moveSpeed = Math.max(16, camDist * 0.65) * (isBoost ? 2.2 : 1.0);

          keyMoveDelta
            .set(0, 0, 0)
            .addScaledVector(keyForward, forwardInput)
            .addScaledVector(keyRight, rightInput)
            .normalize()
            .multiplyScalar(moveSpeed * delta);

          camera.position.add(keyMoveDelta);
          controls.target.add(keyMoveDelta);
        }
      }

      // Camera lerp animation
      if (targetCameraPos.current && targetLookAt.current) {
        camera.position.lerp(targetCameraPos.current, 0.09);
        controls.target.lerp(targetLookAt.current, 0.09);

        if (
          camera.position.distanceTo(targetCameraPos.current) < 0.2 &&
          controls.target.distanceTo(targetLookAt.current) < 0.2
        ) {
          targetCameraPos.current = null;
          targetLookAt.current = null;
        }
      }

      controls.update();
      renderer.render(scene, camera);
      updateLabelPositions();
    };

    animate();

    // Resize Handler (both window and container flex resize when Explication sidebar toggles)
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      updateLabelPositions();
    };

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(container);
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      controls.removeEventListener('start', handleControlsStart);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      groundGeom.dispose();
      groundMat.dispose();
      gridHelper.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [floorPlan.dimensions.width, floorPlan.dimensions.length]);

  // Build / Rebuild 3D Floors (Single Floor or Multi-Floor Stack "Пирог")
  // Decoupled from `selectedRoomId`, `showCadUnderlay`, and `cadUnderlayOpacity` so room clicks and opacity sliders run in <0.1ms!
  useEffect(() => {
    const stackGroup = buildingStackGroupRef.current;
    const shaftGuidesGroup = shaftGuidesGroupRef.current;
    if (!stackGroup || !shaftGuidesGroup) return;

    // Dispose previous meshes & lines
    const disposeHierarchy = (root: THREE.Object3D) => {
      while (root.children.length > 0) {
        const obj = root.children[0];
        root.remove(obj);
        disposeHierarchy(obj);
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments || obj instanceof THREE.Line) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material?.dispose();
        }
      }
    };

    // Preserve current Y positions of floor groups for smooth damping across prop updates
    const prevFloorY = new Map<string, number>();
    floorGroupsMapRef.current.forEach((val, key) => {
      prevFloorY.set(key, val.group.position.y);
    });

    disposeHierarchy(stackGroup);
    disposeHierarchy(shaftGuidesGroup);
    floorGroupsMapRef.current.clear();
    roomMeshesRef.current = [];
    cadLinesRef.current = [];

    const floorsToRender = viewMode === 'stack'
      ? [...allFloors].sort((a, b) => a.floorNumber - b.floorNumber)
      : [floorPlan];

    const minElev = floorsToRender.length > 0 ? floorsToRender[0].elevation : 0;

    floorsToRender.forEach((fl, floorIdx) => {
      const targetY = viewMode === 'stack'
        ? (fl.elevation - minElev) + floorIdx * explodeGapRef.current
        : 0;

      const flGroup = new THREE.Group();
      flGroup.position.y = prevFloorY.has(fl.id) ? prevFloorY.get(fl.id)! : targetY;

      // 1. Semi-transparent Floor Slab Plate in Stack Mode (or subtle base in single mode)
      if (viewMode === 'stack') {
        const slabGeom = new THREE.BoxGeometry(fl.dimensions.width, 0.14, fl.dimensions.length);
        const slabMat = new THREE.MeshStandardMaterial({
          color: fl.id === floorPlan.id ? 0xe0f2fe : 0xf1f5f9,
          roughness: 0.7,
          metalness: 0.05,
          transparent: true,
          opacity: 0.65
        });
        const slabMesh = new THREE.Mesh(slabGeom, slabMat);
        slabMesh.position.set(fl.dimensions.width / 2, -0.07, fl.dimensions.length / 2);
        flGroup.add(slabMesh);

        // Slab edge outline
        const slabEdges = new THREE.EdgesGeometry(slabGeom);
        const slabLine = new THREE.LineSegments(
          slabEdges,
          new THREE.LineBasicMaterial({
            color: fl.id === floorPlan.id ? 0x0284c7 : 0x94a3b8
          })
        );
        slabMesh.add(slabLine);
      }

      // 2. CAD Underlay Lines for this Floor (always created once and toggled via fast ref)
      if (fl.cadLines.length > 0) {
        const positions: number[] = [];
        const colors: number[] = [];

        fl.cadLines.forEach(line => {
          positions.push(line.start.x, 0.02, line.start.y);
          positions.push(line.end.x, 0.02, line.end.y);

          const isExt = line.layer.includes('НЕСУЩИЕ') || line.layer.includes('EXTERNAL');
          const isAxis = line.layer.includes('ОСИ');
          const isDoor = line.layer.includes('ДВЕРИ');

          let r = 0.28, g = 0.35, b = 0.42;
          if (isExt) { r = 0.05; g = 0.08; b = 0.15; }
          else if (isAxis) { r = 0.65; g = 0.7; b = 0.78; }
          else if (isDoor) { r = 0.4; g = 0.45; b = 0.55; }

          colors.push(r, g, b);
          colors.push(r, g, b);
        });

        if (positions.length > 0) {
          const lineGeom = new THREE.BufferGeometry();
          lineGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          lineGeom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

          const lineMat = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: cadUnderlayOpacityRef.current,
            depthWrite: false
          });

          const cadLineSegments = new THREE.LineSegments(lineGeom, lineMat);
          cadLineSegments.visible =
            showCadUnderlayRef.current && cadUnderlayOpacityRef.current > 0.01;
          flGroup.add(cadLineSegments);
          cadLinesRef.current.push(cadLineSegments);
        }
      }

      // 3. Volumetric 3D Rooms (including curved walls, rounded corners, and 3D symbols)
      fl.rooms.forEach(room => {
        if (room.polygon.length < 3) return;

        // Tessellate curved walls / rounded corners into smooth points
        const contourPts = hasCurvedGeometry(room.polygon)
          ? tessellatePolygon(room.polygon, 16, true)
          : room.polygon;

        const shape = new THREE.Shape();
        contourPts.forEach((pt, idx) => {
          if (idx === 0) shape.moveTo(pt.x, -pt.y);
          else shape.lineTo(pt.x, -pt.y);
        });
        shape.closePath();

        // Corridors have slightly lower cutaway so interior symbols & doors read clearly
        const isCorridor = room.zone === 'circulation' && room.area > 95;
        const effectiveRoomH = isCorridor
          ? Math.min(room.height * 0.55, wallHeightCutaway)
          : Math.min(room.height, wallHeightCutaway);

        const extrudeGeom = new THREE.ExtrudeGeometry(shape, {
          depth: effectiveRoomH,
          bevelEnabled: true,
          bevelSegments: 2,
          steps: 1,
          bevelSize: 0.025,
          bevelThickness: 0.025,
          curveSegments: 16
        });

        extrudeGeom.rotateX(-Math.PI / 2);
        extrudeGeom.computeVertexNormals();

        const zoneCfg = ZONE_CONFIG[room.zone] || ZONE_CONFIG.circulation;
        let baseColor = zoneCfg.hex;

        if (colorMode === 'cleanliness') {
          const cleanHexStr = CLEANLINESS_CONFIG[room.cleanliness]?.color || '#64748b';
          baseColor = parseInt(cleanHexStr.replace('#', ''), 16);
        } else if (colorMode === 'monochrome') {
          baseColor = 0xf1f5f9;
        }

        const isSelected = room.id === selectedRoomIdRef.current;
        const hasSymbol = Boolean(
          show3DSymbols && room.commonSubType && room.commonSubType !== 'standard'
        );
        const baseOpacity = hasSymbol ? 0.48 : isCorridor ? 0.62 : 0.82;

        const material = new THREE.MeshStandardMaterial({
          color: isSelected ? 0x0284c7 : baseColor,
          roughness: 0.35,
          metalness: 0.08,
          transparent: true,
          opacity: isSelected ? 0.92 : baseOpacity,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1
        });

        const mesh = new THREE.Mesh(extrudeGeom, material);
        mesh.castShadow = !isSoftwareGl;
        mesh.receiveShadow = !isSoftwareGl;

        // Crisp architectural edges (higher threshold angle 28 deg so smooth rounded corners have no vertical facet lines)
        const edges = new THREE.EdgesGeometry(extrudeGeom, 28);
        const edgeMat = new THREE.LineBasicMaterial({
          color: isSelected ? 0x0369a1 : 0x334155,
          linewidth: isSelected ? 2 : 1
        });
        const edgeLine = new THREE.LineSegments(edges, edgeMat);
        mesh.add(edgeLine);

        mesh.userData = {
          roomId: room.id,
          room,
          floorId: fl.id,
          floorName: fl.name,
          baseColor,
          baseOpacity,
          edgeMat
        };

        // Add Procedural 3D Symbol inside Common / Vertical Zones
        if (show3DSymbols) {
          const symbolGroup = createProceduralSymbolGroup(room, effectiveRoomH);
          if (symbolGroup) {
            mesh.add(symbolGroup);
          }
        }

        if (isSelected) {
          mesh.position.y = 0.18;
        }

        flGroup.add(mesh);
        roomMeshesRef.current.push(mesh);
      });

      stackGroup.add(flGroup);
      floorGroupsMapRef.current.set(fl.id, { group: flGroup, targetY });
    });

    // 4. In Multi-Floor Stack Mode ("Пирог"), draw unit-height vertical shaft connector columns (scaled dynamically in animate loop)
    if (viewMode === 'stack' && floorsToRender.length > 1) {
      const baseFloor = floorsToRender[0];
      const verticalRooms = baseFloor.rooms.filter(
        r => r.commonSubType === 'elevator' || r.commonSubType === 'staircase'
      );

      verticalRooms.forEach(vr => {
        const pts = vr.polygon;
        const minX = Math.min(...pts.map(p => p.x));
        const maxX = Math.max(...pts.map(p => p.x));
        const minZ = Math.min(...pts.map(p => p.y));
        const maxZ = Math.max(...pts.map(p => p.y));

        const corners = [
          [minX, minZ],
          [maxX, minZ],
          [maxX, maxZ],
          [minX, maxZ]
        ];

        const linePositions: number[] = [];
        corners.forEach(([cx, cz]) => {
          linePositions.push(cx, 0, cz);
          linePositions.push(cx, 1, cz);
        });

        const colGeom = new THREE.BufferGeometry();
        colGeom.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
        const colMat = new THREE.LineBasicMaterial({
          color: 0x6366f1,
          transparent: true,
          opacity: 0.45
        });
        shaftGuidesGroup.add(new THREE.LineSegments(colGeom, colMat));
      });
    }
  }, [
    allFloors,
    floorPlan,
    viewMode,
    wallHeightCutaway,
    show3DSymbols,
    colorMode
  ]);

  // Lightweight O(N_rooms) Selection Highlight Updater (<0.1ms, zero geometry rebuild)
  useEffect(() => {
    roomMeshesRef.current.forEach(mesh => {
      const isSelected = mesh.userData.roomId === selectedRoomId;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const edgeMat = mesh.userData.edgeMat as THREE.LineBasicMaterial | undefined;

      mat.color.setHex(isSelected ? 0x0284c7 : mesh.userData.baseColor);
      mat.opacity = isSelected ? 0.92 : mesh.userData.baseOpacity;
      mesh.position.y = isSelected ? 0.18 : 0;

      if (edgeMat) {
        edgeMat.color.setHex(isSelected ? 0x0369a1 : 0x334155);
      }
    });
  }, [selectedRoomId]);

  // Lightweight CAD Underlay Visibility & Opacity Updater (zero geometry rebuild)
  useEffect(() => {
    const visible = showCadUnderlay && cadUnderlayOpacity > 0.01;
    cadLinesRef.current.forEach(lineSeg => {
      lineSeg.visible = visible;
      const mat = lineSeg.material as THREE.LineBasicMaterial;
      mat.opacity = cadUnderlayOpacity;
    });
  }, [showCadUnderlay, cadUnderlayOpacity]);

  // Pointer Down
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    isPointerDownRef.current = true;
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
  };

  // Pointer Up (select room on any floor via fast non-recursive roomMeshesRef raycast)
  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    isPointerDownRef.current = false;
    const dist = Math.hypot(
      e.clientX - pointerDownPos.current.x,
      e.clientY - pointerDownPos.current.y
    );
    if (dist > 4) return;

    const container = mountRef.current;
    const camera = cameraRef.current;
    if (!container || !camera || roomMeshesRef.current.length === 0) return;

    const rect = container.getBoundingClientRect();
    pointerNdcRef.current.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    raycasterRef.current.setFromCamera(pointerNdcRef.current, camera);

    const intersects = raycasterRef.current.intersectObjects(roomMeshesRef.current, false);
    if (intersects.length > 0) {
      const hitMesh = intersects[0].object;
      if (hitMesh.userData?.roomId) {
        onSelectRoom(hitMesh.userData.roomId, hitMesh.userData.floorId);
        return;
      }
    }
    onSelectRoom(null);
  }, [onSelectRoom]);

  // Throttled zero-allocation Hover detection (skips during drag & raycasts only roomMeshesRef)
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isPointerDownRef.current) {
      if (hoveredRoom) setHoveredRoom(null);
      return;
    }

    const now = performance.now();
    if (now - lastHoverCheckRef.current < 30) {
      if (hoveredRoom) {
        setMousePos({ x: e.clientX, y: e.clientY });
      }
      return;
    }
    lastHoverCheckRef.current = now;

    const container = mountRef.current;
    const camera = cameraRef.current;
    if (!container || !camera || roomMeshesRef.current.length === 0) return;

    const rect = container.getBoundingClientRect();
    pointerNdcRef.current.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    raycasterRef.current.setFromCamera(pointerNdcRef.current, camera);

    const intersects = raycasterRef.current.intersectObjects(roomMeshesRef.current, false);
    if (intersects.length > 0) {
      const hitMesh = intersects[0].object;
      if (hitMesh.userData?.room) {
        setMousePos({ x: e.clientX, y: e.clientY });
        setHoveredRoom({
          room: hitMesh.userData.room,
          floorName: hitMesh.userData.floorName || ''
        });
        container.style.cursor = 'pointer';
        return;
      }
    }
    setHoveredRoom(null);
    container.style.cursor = '';
  }, [hoveredRoom]);

  // Sync OrbitControls mouse button mapping with active tool ('orbit' vs 'pan' or Space held)
  const isPanModeActive = navToolMode === 'pan' || isSpaceHeld;
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (isPanModeActive) {
      controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
      controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    } else {
      controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
      controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    }
  }, [isPanModeActive]);

  // Fit entire floor plan or building stack in view ("Весь этаж")
  const fitEntireFloor = useCallback(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const cx = floorPlan.dimensions.width / 2;
    const cz = floorPlan.dimensions.length / 2;
    const stackBonus = viewMode === 'stack' ? (allFloors.length - 1) * (2.5 + explodeGap * 0.6) : 0;
    const dist = Math.max(floorPlan.dimensions.width, floorPlan.dimensions.length) * 0.85 + stackBonus;
    const targetY = viewMode === 'stack' ? stackBonus * 0.4 : 0;

    targetLookAt.current = new THREE.Vector3(cx, targetY, cz);
    targetCameraPos.current = new THREE.Vector3(
      cx - dist * 0.65,
      dist * 0.72 + targetY,
      cz + dist * 0.75
    );
  }, [floorPlan.dimensions.width, floorPlan.dimensions.length, viewMode, allFloors.length, explodeGap]);

  // Global keyboard listeners for WASD / Arrows horizontal navigation, Space pan hold, and F (Fit Floor)
  useEffect(() => {
    const isInputFocused = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || (el as HTMLElement).isContentEditable;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isInputFocused()) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpaceHeld(true);
        return;
      }

      if (e.code === 'KeyF' || e.code === 'Home') {
        e.preventDefault();
        fitEntireFloor();
        return;
      }

      if (
        e.code === 'KeyW' ||
        e.code === 'KeyA' ||
        e.code === 'KeyS' ||
        e.code === 'KeyD' ||
        e.code === 'ArrowUp' ||
        e.code === 'ArrowDown' ||
        e.code === 'ArrowLeft' ||
        e.code === 'ArrowRight' ||
        e.code === 'ShiftLeft' ||
        e.code === 'ShiftRight'
      ) {
        if (e.code.startsWith('Arrow')) {
          e.preventDefault();
        }
        pressedKeysRef.current.add(e.code);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpaceHeld(false);
      }
      pressedKeysRef.current.delete(e.code);
    };

    const handleWindowBlur = () => {
      setIsSpaceHeld(false);
      pressedKeysRef.current.clear();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [fitEntireFloor]);

  // Preset Views Switcher
  const setCameraView = (type: 'iso_sw' | 'iso_se' | 'iso_ne' | 'top' | 'front') => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const cx = floorPlan.dimensions.width / 2;
    const cz = floorPlan.dimensions.length / 2;
    const stackBonus = viewMode === 'stack' ? (allFloors.length - 1) * (2.5 + explodeGap * 0.6) : 0;
    const dist = Math.max(floorPlan.dimensions.width, floorPlan.dimensions.length) * 1.15 + stackBonus;
    const targetY = viewMode === 'stack' ? stackBonus * 0.45 : 0;

    targetLookAt.current = new THREE.Vector3(cx, targetY, cz);

    switch (type) {
      case 'iso_sw':
        targetCameraPos.current = new THREE.Vector3(cx - dist * 0.75, dist * 0.68, cz + dist * 0.75);
        break;
      case 'iso_se':
        targetCameraPos.current = new THREE.Vector3(cx + dist * 0.75, dist * 0.68, cz + dist * 0.75);
        break;
      case 'iso_ne':
        targetCameraPos.current = new THREE.Vector3(cx + dist * 0.75, dist * 0.68, cz - dist * 0.75);
        break;
      case 'top':
        targetCameraPos.current = new THREE.Vector3(cx, dist * 1.45, cz + 0.01);
        break;
      case 'front':
        targetCameraPos.current = new THREE.Vector3(cx, targetY + dist * 0.28, cz + dist * 1.15);
        break;
    }
  };

  // Smoothly fly both camera position and lookAt target horizontally to the selected room
  useEffect(() => {
    if (!selectedRoomId) return;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    for (const fl of activeFloorsList) {
      const room = fl.rooms.find(r => r.id === selectedRoomId);
      if (room) {
        const entry = floorGroupsMapRef.current.get(fl.id);
        const flY = entry ? entry.targetY : 0;
        const newTarget = new THREE.Vector3(room.center.x, flY + 0.8, room.center.y);

        // Preserve current viewing angle offset from target, scaled to a comfortable inspection distance
        const currentOffset = camera.position.clone().sub(controls.target);
        const currentDist = currentOffset.length();
        const roomSpan = Math.max(6, Math.sqrt(Math.max(9, room.area)));
        const desiredDist = Math.min(Math.max(roomSpan * 3.2, 22), Math.max(48, currentDist * 0.75));

        if (currentDist > 0.1) {
          currentOffset.normalize().multiplyScalar(desiredDist);
          // Ensure camera stays at a comfortable height above the floor
          currentOffset.y = Math.max(desiredDist * 0.45, currentOffset.y);
        } else {
          currentOffset.set(desiredDist * 0.6, desiredDist * 0.65, desiredDist * 0.6);
        }

        targetLookAt.current = newTarget;
        targetCameraPos.current = newTarget.clone().add(currentOffset);
        break;
      }
    }
  }, [selectedRoomId]);

  // Subtype icon badge text helper
  const getSubtypeIndicator = (r: Room) => {
    if (r.commonSubType === 'staircase') return 'ЛК';
    if (r.commonSubType === 'elevator') return 'ЛИФТ';
    if (r.commonSubType === 'restroom') return 'WC';
    if (r.commonSubType === 'hall') return 'ХОЛЛ';
    return null;
  };

  return (
    <div className="relative w-full h-full select-none overflow-hidden bg-slate-50">
      {/* 3D WebGL Canvas Container */}
      <div 
        ref={mountRef} 
        className={`w-full h-full ${
          isPanModeActive ? 'cursor-move active:cursor-grabbing' : 'cursor-grab active:cursor-grabbing'
        }`}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerMove={handlePointerMove}
      />

      {/* Multi-Floor Stack Level Badges on the Left Edge of the Building */}
      {viewMode === 'stack' && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {activeFloorsList.map(fl => {
            const isCurrent = fl.id === floorPlan.id;
            return (
              <div
                key={`badge_${fl.id}`}
                ref={el => {
                  if (el) floorBadgeDomsRef.current.set(fl.id, el);
                  else floorBadgeDomsRef.current.delete(fl.id);
                }}
                className="absolute top-0 left-0 z-20 will-change-transform"
                style={{ display: 'none' }}
              >
                <div
                  className={`px-2.5 py-1 rounded-md text-xs font-mono shadow-sm border whitespace-nowrap ${
                    isCurrent
                      ? 'bg-slate-900 text-white border-slate-800 font-semibold'
                      : 'bg-white/95 text-slate-700 border-slate-200'
                  }`}
                >
                  <span>{fl.floorNumber} ЭТАЖ</span>
                  <span className="mx-1.5 text-slate-400">·</span>
                  <span className={isCurrent ? 'text-sky-300' : 'text-slate-500'}>
                    +{fl.elevation.toFixed(3)}м
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Floating 2D Room Labels (Direct DOM Transforms for 60FPS) */}
      {showLabels && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {activeFloorsList.flatMap(fl =>
            fl.rooms.map(r => {
              const isSelected = selectedRoomId === r.id;
              const zoneColor = ZONE_CONFIG[r.zone]?.color || '#475569';
              const subBadge = getSubtypeIndicator(r);
              const isCurved = hasCurvedGeometry(r.polygon);

              return (
                <div
                  key={r.id}
                  ref={el => {
                    if (el) labelDomsRef.current.set(r.id, el);
                    else labelDomsRef.current.delete(r.id);
                  }}
                  className={`absolute top-0 left-0 transition-opacity duration-150 will-change-transform ${
                    isSelected ? 'z-30 scale-105' : 'z-10'
                  }`}
                  style={{ display: 'none' }}
                >
                  <div 
                    className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium shadow-xs border transition-all ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-700 shadow-md ring-2 ring-sky-500'
                        : 'bg-white/92 text-slate-800 border-slate-200/90'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 whitespace-nowrap tabular-nums">
                      <span 
                        className="w-1.5 h-1.5 rounded-full inline-block shrink-0" 
                        style={{ backgroundColor: zoneColor }}
                      />
                      <span className="font-bold">{r.code}</span>
                      {subBadge && (
                        <span className={`text-[9px] font-semibold px-1 rounded ${
                          isSelected ? 'bg-sky-500/30 text-sky-200' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {subBadge}
                        </span>
                      )}
                      {isCurved && (
                        <span className="text-[9px] text-teal-600 font-semibold" title="Скругленный контур">
                          R
                        </span>
                      )}
                      <span className={`text-[10px] border-l pl-1 ${
                        isSelected ? 'text-slate-300 border-slate-700' : 'text-slate-500 border-slate-200'
                      }`}>
                        {r.area.toFixed(1)} м²
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Hovered Room Tooltip */}
      {hoveredRoom && (
        <div 
          className="fixed pointer-events-none z-30 transform -translate-x-1/2 -translate-y-full -mt-3 bg-slate-900/95 text-white px-3.5 py-2.5 rounded-lg shadow-xl border border-slate-700 text-xs font-sans max-w-xs"
          style={{ left: `${mousePos.x}px`, top: `${mousePos.y}px` }}
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-700/80 pb-1.5 mb-1.5">
            <span className="font-mono font-bold text-sky-400">№{hoveredRoom.room.code}</span>
            <span className="text-[11px] text-slate-300">
              {ZONE_CONFIG[hoveredRoom.room.zone]?.label}
            </span>
          </div>
          <div className="font-medium text-white leading-snug">{hoveredRoom.room.name}</div>
          {hoveredRoom.room.commonSubType && hoveredRoom.room.commonSubType !== 'standard' && (
            <div className="mt-1 text-[11px] text-indigo-300">
              Узел: {COMMON_SUBTYPE_CONFIG[hoveredRoom.room.commonSubType].label}
            </div>
          )}
          <div className="mt-1.5 flex items-center justify-between text-slate-400 font-mono text-[11px] tabular-nums">
            <span>S: <strong className="text-white">{hoveredRoom.room.area.toFixed(1)} м²</strong></span>
            <span>·</span>
            <span>H: <strong className="text-white">{hoveredRoom.room.height} м</strong></span>
            {hasCurvedGeometry(hoveredRoom.room.polygon) && (
              <>
                <span>·</span>
                <span className="text-teal-300">Радиусный контур</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Camera & Floor Traversal Toolbar (Top-Right Floating) */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-white/95 p-1 rounded-lg border border-slate-200/90 shadow-2xs text-xs">
        {/* Orbit vs Pan (Hand) Mode Switcher */}
        <div className="flex items-center bg-slate-100 p-0.5 rounded-md border border-slate-200/70">
          <button
            type="button"
            onClick={() => setNavToolMode('orbit')}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1 ${
              !isPanModeActive
                ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            title="Режим вращения камеры (Левая кнопка мыши — поворот, Правая кнопка — сдвиг вдоль этажа)"
          >
            <Rotate3d className="w-3.5 h-3.5 text-slate-600" />
            <span>Орбита</span>
          </button>
          <button
            type="button"
            onClick={() => setNavToolMode('pan')}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1 ${
              isPanModeActive
                ? 'bg-sky-600 text-white shadow-2xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            title="Горизонтальное перемещение вдоль этажа (также доступно при удержании клавиши Пробел, ПКМ или клавишами WASD / Стрелки)"
          >
            <Hand className="w-3.5 h-3.5" />
            <span>Рука</span>
          </button>
        </div>

        <div className="w-[1px] h-4 bg-slate-200 mx-0.5" />

        {/* Fit Entire Floor Button */}
        <button
          type="button"
          onClick={fitEntireFloor}
          className="px-2.5 py-1 text-xs font-medium text-sky-700 hover:text-sky-900 hover:bg-sky-50 rounded-md transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1"
          title="Показать весь этаж целиком (горячая клавиша F)"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          <span>Весь этаж</span>
        </button>

        <div className="w-[1px] h-4 bg-slate-200 mx-0.5" />

        {/* Camera View Angle Presets */}
        <button
          type="button"
          onClick={() => setCameraView('iso_sw')}
          className="px-2 py-1 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1"
          title="Юго-Западная Изометрия (3D)"
        >
          <Compass className="w-3.5 h-3.5 text-slate-500" />
          <span>3D</span>
        </button>
        <button
          type="button"
          onClick={() => setCameraView('top')}
          className="px-2 py-1 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer whitespace-nowrap"
          title="План сверху (2D ортогональный вид)"
        >
          План
        </button>
        <button
          type="button"
          onClick={() => setCameraView('front')}
          className="px-2 py-1 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer whitespace-nowrap"
          title="Главный фасад здания"
        >
          Фасад
        </button>
      </div>

      {/* Building & Scale Spec Overlay (Top-Left, Quiet Unboxed Text) */}
      <div className="absolute top-3 left-3 z-10 bg-white/95 px-3 py-1.5 rounded-lg border border-slate-200/90 shadow-2xs text-xs text-slate-600 flex items-center gap-2 tabular-nums">
        <Building2 className="w-3.5 h-3.5 text-slate-600 shrink-0" />
        <span className="font-semibold text-slate-900">
          {viewMode === 'stack'
            ? `Корпус (${allFloors.length} эт.)`
            : `${floorPlan.floorNumber} этаж (+${floorPlan.elevation.toFixed(2)}м)`}
        </span>
        <span aria-hidden="true" className="text-slate-300">·</span>
        <span className="font-mono text-slate-500">
          {floorPlan.dimensions.width}×{floorPlan.dimensions.length}м
        </span>
        <span aria-hidden="true" className="text-slate-300">·</span>
        <span className="font-mono text-slate-500">
          {viewMode === 'stack'
            ? `${allFloors.reduce((acc, f) => acc + f.rooms.length, 0)} помещ.`
            : `${floorPlan.rooms.length} помещ.`}
        </span>
        <span aria-hidden="true" className="text-slate-300 hidden xl:inline">·</span>
        <span className="text-[11px] text-slate-400 hidden xl:inline">
          Сдвиг: Рука / ПКМ / WASD
        </span>
      </div>
    </div>
  );
};
