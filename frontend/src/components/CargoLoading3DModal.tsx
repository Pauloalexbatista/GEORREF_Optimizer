"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import * as THREE from "three";
import {
  calculateCargoLoadingPlan,
  estimateVehicleDimensions,
  CargoBox,
  VehicleContainerDimensions,
} from "../utils/cargoPacking";

interface CargoLoading3DModalProps {
  isOpen: boolean;
  onClose: () => void;
  routes: any[];
  initialRouteIndex?: number;
  vehiclesData?: any[];
}

export default function CargoLoading3DModal({
  isOpen,
  onClose,
  routes,
  initialRouteIndex = 0,
  vehiclesData = [],
}: CargoLoading3DModalProps) {
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(initialRouteIndex);
  const [viewOrder, setViewOrder] = useState<"lifo" | "delivery">("lifo");
  const [hoveredStopSeq, setHoveredStopSeq] = useState<number | null>(null);
  const [selectedStopSeq, setSelectedStopSeq] = useState<number | null>(null);
  const [focusMode, setFocusMode] = useState<"ghost" | "isolate">("ghost");
  const [tooltipInfo, setTooltipInfo] = useState<{
    visible: boolean;
    x: number;
    y: number;
    box?: CargoBox;
  }>({ visible: false, x: 0, y: 0 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const threeStateRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    boxesGroup: THREE.Group;
    containerGroup: THREE.Group;
    boxMeshes: { mesh: THREE.Mesh; box: CargoBox; originalColor: THREE.Color }[];
    isDragging: boolean;
    prevMousePos: { x: number; y: number };
    spherical: { radius: number; theta: number; phi: number };
    target: THREE.Vector3;
    animationFrameId?: number;
  } | null>(null);

  // Sincronizar rota inicial ao abrir
  useEffect(() => {
    if (isOpen && initialRouteIndex >= 0 && initialRouteIndex < routes.length) {
      setSelectedRouteIdx(initialRouteIndex);
    }
  }, [isOpen, initialRouteIndex, routes.length]);

  // Rota selecionada
  const currentRoute = routes[selectedRouteIdx] || routes[0];

  // Identificar especificações da viatura associada à rota
  const vehicleConfig = useMemo(() => {
    if (!currentRoute) return null;
    const vName = currentRoute.vehicle || currentRoute.veiculo || "";
    const matched = vehiclesData.find(
      (v) => (v.veiculo || v.Veiculo || "").toLowerCase() === vName.toLowerCase()
    );
    const maxVol = matched?.capacidade_vol || matched?.Capacidade_Vol || currentRoute.max_volume || 14;
    const maxKg = matched?.capacidade_kg || matched?.Capacidade_Kg || currentRoute.max_weight || 1500;
    return estimateVehicleDimensions(maxVol, maxKg);
  }, [currentRoute, vehiclesData]);

  // Calcular o plano de caixas 3D com LIFO e Gravidade
  const { cargoBoxes, totalWeight, totalVolume } = useMemo(() => {
    if (!currentRoute || !vehicleConfig) {
      return { cargoBoxes: [], totalWeight: 0, totalVolume: 0 };
    }
    const stops = currentRoute.stops || currentRoute.paragens || [];
    const boxes = calculateCargoLoadingPlan(stops, vehicleConfig);
    const weight = boxes.reduce((acc, b) => acc + b.weightKg, 0);
    const vol = boxes.reduce((acc, b) => acc + b.volumeM3, 0);
    return { cargoBoxes: boxes, totalWeight: weight, totalVolume: vol };
  }, [currentRoute, vehicleConfig]);

  // Lista agrupada por paragem para a tabela lateral
  const groupedStops = useMemo(() => {
    const map = new Map<number, {
      seq: number;
      clientName: string;
      address: string;
      color: string;
      lifoZone: "cabine" | "meio" | "porta";
      totalBoxes: number;
      totalWeight: number;
      totalVolume: number;
    }>();

    cargoBoxes.forEach((b) => {
      if (!map.has(b.stopSeq)) {
        map.set(b.stopSeq, {
          seq: b.stopSeq,
          clientName: b.clientName,
          address: b.address,
          color: b.color,
          lifoZone: b.lifoZone,
          totalBoxes: 0,
          totalWeight: 0,
          totalVolume: 0,
        });
      }
      const entry = map.get(b.stopSeq)!;
      entry.totalBoxes += 1;
      entry.totalWeight += b.weightKg;
      entry.totalVolume += b.volumeM3;
    });

    const list = Array.from(map.values());
    if (viewOrder === "lifo") {
      // Ordem de carregamento (última entrega entra primeiro -> Fundo para a Porta)
      return list.sort((a, b) => b.seq - a.seq);
    }
    // Ordem de entrega (1 -> N)
    return list.sort((a, b) => a.seq - b.seq);
  }, [cargoBoxes, viewOrder]);

  // Inicialização e Ciclo de Vida do Three.js
  useEffect(() => {
    if (!isOpen || !canvasRef.current || !vehicleConfig) return;

    const canvas = canvasRef.current;
    const width = canvas.clientWidth || 600;
    const height = canvas.clientHeight || 500;

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090d16); // Fundo escuro executivo

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Luzes
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x1e293b, 0.8);
    scene.add(hemiLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight1.position.set(10, 15, 10);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x93c5fd, 0.6);
    dirLight2.position.set(-10, 8, -10);
    scene.add(dirLight2);

    // Grupos
    const containerGroup = new THREE.Group();
    const boxesGroup = new THREE.Group();
    scene.add(containerGroup);
    scene.add(boxesGroup);

    // Controlo de câmara esférica (Orbit simples e suave)
    const target = new THREE.Vector3(0, vehicleConfig.height / 2, 0);
    const spherical = {
      radius: Math.max(vehicleConfig.length * 1.6, vehicleConfig.height * 2.2, 5.5),
      theta: Math.PI / 4, // 45 graus
      phi: Math.PI / 3,   // 60 graus de elevação
    };

    function updateCameraPosition() {
      const x = spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta);
      const y = spherical.radius * Math.cos(spherical.phi);
      const z = spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta);
      camera.position.set(x + target.x, y + target.y, z + target.z);
      camera.lookAt(target);
    }
    updateCameraPosition();

    // Guardar estado no ref
    threeStateRef.current = {
      scene,
      camera,
      renderer,
      boxesGroup,
      containerGroup,
      boxMeshes: [],
      isDragging: false,
      prevMousePos: { x: 0, y: 0 },
      spherical,
      target,
    };

    // Render loop
    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();
    if (threeStateRef.current) {
      threeStateRef.current.animationFrameId = animId;
    }

    // Redimensionamento com ResizeObserver
    const updateSize = () => {
      if (!canvas || !threeStateRef.current) return;
      const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 600;
      const h = canvas.clientHeight || canvas.parentElement?.clientHeight || 500;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
      }
    };
    updateSize();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && canvas.parentElement) {
      resizeObserver = new ResizeObserver(() => {
        updateSize();
      });
      resizeObserver.observe(canvas.parentElement);
    }
    window.addEventListener("resize", updateSize);

    return () => {
      window.removeEventListener("resize", updateSize);
      resizeObserver?.disconnect();
      cancelAnimationFrame(animId);
      renderer.dispose();
      threeStateRef.current = null;
    };
  }, [isOpen, vehicleConfig]);

  // Reconstruir o baú da viatura e caixas quando mudar o veículo ou as caixas
  useEffect(() => {
    const state = threeStateRef.current;
    if (!state || !vehicleConfig) return;

    const { containerGroup, boxesGroup, scene } = state;

    // Limpar grupos anteriores
    while (containerGroup.children.length > 0) {
      containerGroup.remove(containerGroup.children[0]);
    }
    while (boxesGroup.children.length > 0) {
      boxesGroup.remove(boxesGroup.children[0]);
    }
    state.boxMeshes = [];

    const L = vehicleConfig.length;
    const W = vehicleConfig.width;
    const H = vehicleConfig.height;

    // Centrar o baú no sistema de coordenadas Three.js
    // X vai de -L/2 (Cabine) a +L/2 (Portas Traseiras)
    // Y vai de 0 (Piso) a H (Teto)
    // Z vai de -W/2 (Esquerda) a +W/2 (Direita)
    state.target.set(0, H / 2, 0);

    // 1. Piso com grelha metálica de armazém externa
    const grid = new THREE.GridHelper(Math.max(L, W) * 1.4, 20, 0x38bdf8, 0x1e293b);
    grid.position.set(0, -0.01, 0);
    containerGroup.add(grid);

    // Grelha matricial 3D de 5cm no piso do compartimento de carga (alinhamento exato de empacotamento)
    const floor5cmGeo = new THREE.BufferGeometry();
    const floor5cmVerts: number[] = [];
    const step = 0.05; // 5cm
    for (let z = -W / 2; z <= W / 2 + 0.001; z += step) {
      floor5cmVerts.push(-L / 2, 0.002, z);
      floor5cmVerts.push(L / 2, 0.002, z);
    }
    for (let x = -L / 2; x <= L / 2 + 0.001; x += step) {
      floor5cmVerts.push(x, 0.002, -W / 2);
      floor5cmVerts.push(x, 0.002, W / 2);
    }
    floor5cmGeo.setAttribute("position", new THREE.Float32BufferAttribute(floor5cmVerts, 3));
    const floor5cmMat = new THREE.LineBasicMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.35,
    });
    const floor5cmLines = new THREE.LineSegments(floor5cmGeo, floor5cmMat);
    containerGroup.add(floor5cmLines);

    // 2. Chassi transparente do baú da viatura
    const boxGeo = new THREE.BoxGeometry(L, H, W);
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      transparent: true,
      opacity: 0.08,
      roughness: 0.3,
      metalness: 0.1,
      depthWrite: false,
    });
    const containerMesh = new THREE.Mesh(boxGeo, boxMat);
    containerMesh.position.set(0, H / 2, 0);
    containerGroup.add(containerMesh);

    // Arestas luminosas do baú
    const edgesGeo = new THREE.EdgesGeometry(boxGeo);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2 });
    const containerEdges = new THREE.LineSegments(edgesGeo, edgesMat);
    containerEdges.position.set(0, H / 2, 0);
    containerGroup.add(containerEdges);

    // 3. Demarcação da Cabine (Frente) e Portas Traseiras (Descarga)
    // Frente: Parede da cabine
    const cabineGeo = new THREE.PlaneGeometry(W, H);
    const cabineMat = new THREE.MeshBasicMaterial({
      color: 0x1e3a8a,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });
    const cabineMesh = new THREE.Mesh(cabineGeo, cabineMat);
    cabineMesh.rotation.y = Math.PI / 2;
    cabineMesh.position.set(-L / 2, H / 2, 0);
    containerGroup.add(cabineMesh);

    // Traseira: Portas Batentes com dobradiças nos pilares exteriores
    const doorW = W * 0.46;
    const doorGeo = new THREE.PlaneGeometry(doorW, H);
    const doorMat = new THREE.MeshBasicMaterial({
      color: 0x16a34a,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
    });
    const doorEdgeMat = new THREE.LineBasicMaterial({ color: 0x4ade80, linewidth: 2 });

    // Porta Esquerda: Dobradiça no pilar exterior esquerdo (X = L/2, Z = -W/2)
    const leftDoorHinge = new THREE.Group();
    leftDoorHinge.position.set(L / 2, H / 2, -W / 2);
    const leftDoorMesh = new THREE.Mesh(doorGeo, doorMat);
    leftDoorMesh.position.set(doorW / 2, 0, 0);
    leftDoorMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(doorGeo), doorEdgeMat));
    leftDoorHinge.add(leftDoorMesh);
    leftDoorHinge.rotation.y = Math.PI * 0.35;
    containerGroup.add(leftDoorHinge);

    // Porta Direita: Dobradiça no pilar exterior direito (X = L/2, Z = +W/2)
    const rightDoorHinge = new THREE.Group();
    rightDoorHinge.position.set(L / 2, H / 2, W / 2);
    const rightDoorMesh = new THREE.Mesh(doorGeo, doorMat);
    rightDoorMesh.position.set(doorW / 2, 0, 0);
    rightDoorMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(doorGeo), doorEdgeMat));
    rightDoorHinge.add(rightDoorMesh);
    rightDoorHinge.rotation.y = -Math.PI * 0.35;
    containerGroup.add(rightDoorHinge);

    // 4. Criação das Caixas 3D
    cargoBoxes.forEach((b) => {
      const cGeo = new THREE.BoxGeometry(b.length, b.height, b.width);
      const origColor = new THREE.Color(b.color);
      const cMat = new THREE.MeshStandardMaterial({
        color: origColor,
        roughness: 0.4,
        metalness: 0.15,
      });
      const cMesh = new THREE.Mesh(cGeo, cMat);

      // Conversão das coordenadas locais da viatura para coordenadas Three.js centradas:
      // X: [0 -> L] => [-L/2 -> +L/2]
      // Y: [0 -> H]
      // Z: [-W/2 -> +W/2]
      const threeX = b.position.x - L / 2;
      const threeY = b.position.y;
      const threeZ = b.position.z;

      cMesh.position.set(threeX, threeY, threeZ);

      // Arestas escuras estilo caixa de cartão para contraste visual
      const cEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(cGeo),
        new THREE.LineBasicMaterial({ color: 0x0f172a, linewidth: 1.5 })
      );
      cMesh.add(cEdges);

      // Guarda metadados no mesh
      cMesh.userData = { box: b };

      boxesGroup.add(cMesh);
      state.boxMeshes.push({ mesh: cMesh, box: b, originalColor: origColor });
    });
  }, [vehicleConfig, cargoBoxes]);

  // Atualização de Destaque / Iluminação (Hover Bidirecional ou Seleção)
  const activeStopSeq = selectedStopSeq !== null ? selectedStopSeq : hoveredStopSeq;

  useEffect(() => {
    const state = threeStateRef.current;
    if (!state) return;

    state.boxMeshes.forEach(({ mesh, box, originalColor }) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const isTarget = activeStopSeq === null || activeStopSeq === box.stopSeq;

      if (activeStopSeq === null) {
        mesh.visible = true;
        mat.transparent = false;
        mat.opacity = 1.0;
        mat.depthWrite = true;
        mat.color.copy(originalColor);
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
        mesh.scale.set(1.0, 1.0, 1.0);
      } else if (isTarget) {
        mesh.visible = true;
        mat.transparent = false;
        mat.opacity = 1.0;
        mat.depthWrite = true;
        mat.color.copy(originalColor);
        mat.emissive.setHex(0x38bdf8);
        mat.emissiveIntensity = 0.65;
        mesh.scale.set(1.03, 1.03, 1.03);
      } else {
        if (focusMode === "isolate") {
          mesh.visible = false;
        } else {
          mesh.visible = true;
          mat.transparent = true;
          mat.opacity = 0.08;
          mat.depthWrite = false;
          mat.color.setHex(0x334155);
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
          mesh.scale.set(1.0, 1.0, 1.0);
        }
      }
    });
  }, [activeStopSeq, focusMode]);

  // Eventos de Rato na Cena 3D: Rotação, Zoom e Raycasting
  const handleMouseDown = (e: React.MouseEvent) => {
    const state = threeStateRef.current;
    if (!state) return;
    state.isDragging = true;
    state.prevMousePos = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const state = threeStateRef.current;
    if (!state || !canvasRef.current) return;

    // 1. Rotação orbital
    if (state.isDragging) {
      const deltaX = e.clientX - state.prevMousePos.x;
      const deltaY = e.clientY - state.prevMousePos.y;
      state.prevMousePos = { x: e.clientX, y: e.clientY };

      state.spherical.theta -= deltaX * 0.007;
      state.spherical.phi = Math.max(
        0.1,
        Math.min(Math.PI / 2 - 0.05, state.spherical.phi - deltaY * 0.007)
      );

      const { radius, theta, phi } = state.spherical;
      const x = radius * Math.sin(phi) * Math.sin(theta);
      const y = radius * Math.cos(phi);
      const z = radius * Math.sin(phi) * Math.cos(theta);
      state.camera.position.set(x + state.target.x, y + state.target.y, z + state.target.z);
      state.camera.lookAt(state.target);
      return;
    }

    // 2. Raycasting para Hover sobre as caixas 3D
    const rect = canvasRef.current.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, state.camera);
    const intersects = raycaster.intersectObjects(
      state.boxMeshes.map((b) => b.mesh)
    );

    if (intersects.length > 0) {
      const hitMesh = intersects[0].object as THREE.Mesh;
      const box = hitMesh.userData.box as CargoBox;
      if (box) {
        setHoveredStopSeq(box.stopSeq);
        setTooltipInfo({
          visible: true,
          x: e.clientX - rect.left + 15,
          y: e.clientY - rect.top + 15,
          box,
        });
      }
    } else {
      setTooltipInfo((prev) => ({ ...prev, visible: false }));
      if (hoveredStopSeq !== null) {
        setHoveredStopSeq(null);
      }
    }
  };

  const handleMouseUp = () => {
    const state = threeStateRef.current;
    if (state) state.isDragging = false;
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    const state = threeStateRef.current;
    if (!state || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, state.camera);
    const intersects = raycaster.intersectObjects(
      state.boxMeshes.map((b) => b.mesh)
    );

    if (intersects.length > 0) {
      const hitMesh = intersects[0].object as THREE.Mesh;
      const box = hitMesh.userData.box as CargoBox;
      if (box) {
        setSelectedStopSeq((prev) => (prev === box.stopSeq ? null : box.stopSeq));
      }
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    const state = threeStateRef.current;
    if (!state) return;
    state.spherical.radius = Math.max(
      3.5,
      Math.min(20, state.spherical.radius + e.deltaY * 0.006)
    );
    const { radius, theta, phi } = state.spherical;
    const x = radius * Math.sin(phi) * Math.sin(theta);
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.cos(theta);
    state.camera.position.set(x + state.target.x, y + state.target.y, z + state.target.z);
    state.camera.lookAt(state.target);
  };

  // Botões de Câmaras Predefinidas
  const setPresetCamera = (view: "isometric" | "top" | "side" | "doors") => {
    const state = threeStateRef.current;
    if (!state || !vehicleConfig) return;

    const baseDist = Math.max(vehicleConfig.length * 1.8, 6.5);
    state.spherical.radius = baseDist;

    switch (view) {
      case "top": // Planta superior
        state.spherical.theta = 0;
        state.spherical.phi = 0.05;
        break;
      case "side": // Perfil lateral (olhar a partir do eixo Z)
        state.spherical.theta = 0;
        state.spherical.phi = Math.PI / 2.3;
        break;
      case "doors": // Olhar de trás para as portas de descarga (olhar a partir do eixo X)
        state.spherical.theta = Math.PI / 2;
        state.spherical.phi = Math.PI / 2.3;
        break;
      case "isometric":
      default:
        state.spherical.theta = Math.PI / 4;
        state.spherical.phi = Math.PI / 3;
        break;
    }

    const { radius, theta, phi } = state.spherical;
    const x = radius * Math.sin(phi) * Math.sin(theta);
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.cos(theta);
    state.camera.position.set(x + state.target.x, y + state.target.y, z + state.target.z);
    state.camera.lookAt(state.target);
  };

  if (!isOpen) return null;

  const volPercent = vehicleConfig
    ? Math.min(100, Math.round((totalVolume / vehicleConfig.totalVolumeM3) * 100))
    : 0;
  const weightPercent = vehicleConfig
    ? Math.min(100, Math.round((totalWeight / vehicleConfig.maxWeightKg) * 100))
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl w-full max-w-7xl max-h-[94vh] flex flex-col overflow-hidden text-zinc-100">
        
        {/* Header do Modal */}
        <div className="flex flex-wrap items-center justify-between px-5 py-3.5 border-b border-zinc-800 bg-zinc-950/70 gap-3">
          <div className="flex items-center space-x-3">
            <span className="text-2xl">📦</span>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-white tracking-wide">
                  Simulador de Carregamento 3D da Viatura
                </h2>
                <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-semibold px-2 py-0.5 rounded border border-indigo-500/30 uppercase">
                  Protótipo LIFO & Gravidade
                </span>
                <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold px-2 py-0.5 rounded border border-emerald-500/30 uppercase flex items-center gap-1">
                  <span>📐</span> Grelha Voxel 5cm (0% Sobreposição)
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Visualização do baú com regra LIFO & Matriz 3D de 5cm (Última entrega ao fundo ➔ Primeira junto às portas de saída)
              </p>
            </div>
          </div>

          {/* Seletor de Rota / Viatura */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 bg-zinc-900 px-3 py-1 rounded-lg border border-zinc-700 text-xs">
              <span className="text-zinc-400 font-medium">Viatura / Rota:</span>
              <select
                value={selectedRouteIdx}
                onChange={(e) => setSelectedRouteIdx(Number(e.target.value))}
                className="bg-transparent text-white font-semibold focus:outline-none cursor-pointer"
              >
                {routes.map((r, i) => (
                  <option key={i} value={i} className="bg-zinc-900 text-white">
                    {r.vehicle || r.veiculo || `Rota ${i + 1}`} ({r.stops?.length || 0} paragens)
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors text-lg"
              title="Fechar"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Barra de Métricas de Ocupação da Viatura */}
        {vehicleConfig && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-5 py-2.5 bg-zinc-950/40 border-b border-zinc-800/80 text-xs">
            <div>
              <div className="text-zinc-400 text-[11px]">Dimensões do Baú</div>
              <div className="font-mono font-semibold text-zinc-200">
                {vehicleConfig.length}m × {vehicleConfig.width}m × {vehicleConfig.height}m
              </div>
            </div>
            <div>
              <div className="flex justify-between text-zinc-400 text-[11px] mb-0.5">
                <span>Ocupação Volumétrica</span>
                <span className="font-semibold text-zinc-200">{volPercent}% ({totalVolume.toFixed(2)} / {vehicleConfig.totalVolumeM3} m³)</span>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    volPercent > 90 ? "bg-rose-500" : volPercent > 75 ? "bg-amber-400" : "bg-emerald-500"
                  }`}
                  style={{ width: `${volPercent}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-zinc-400 text-[11px] mb-0.5">
                <span>Ocupação de Peso</span>
                <span className="font-semibold text-zinc-200">{weightPercent}% ({totalWeight.toFixed(0)} / {vehicleConfig.maxWeightKg} kg)</span>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    weightPercent > 90 ? "bg-rose-500" : weightPercent > 75 ? "bg-amber-400" : "bg-sky-500"
                  }`}
                  style={{ width: `${weightPercent}%` }}
                />
              </div>
            </div>
            <div className="flex items-center justify-end space-x-2">
              <span className="text-[11px] text-zinc-400 font-medium">Bultos na Viatura:</span>
              <span className="px-2 py-0.5 bg-zinc-800 text-zinc-100 rounded-md font-mono font-bold">
                {cargoBoxes.length} caixas
              </span>
            </div>
          </div>
        )}

        {/* Corpo Principal: Tabela LIFO à esquerda + Cena 3D à direita */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden">
          
          {/* Painel Esquerdo: Lista de Entregas e Ordem de Carregamento */}
          <div className="lg:col-span-5 flex flex-col border-r border-zinc-800 bg-zinc-950/30 overflow-hidden">
            <div className="flex flex-col p-3 border-b border-zinc-800/80 bg-zinc-900/60 gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Sequência de Arrumação
                </span>
                <div className="flex space-x-1 bg-zinc-950 p-0.5 rounded-md border border-zinc-800 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setViewOrder("lifo")}
                    className={`px-2 py-0.5 rounded font-medium transition-colors ${
                      viewOrder === "lifo"
                        ? "bg-indigo-600 text-white font-semibold"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                    title="Ordem recomendada de carregamento no cais (Fundo até à Porta)"
                  >
                    🚚 Carga (LIFO)
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewOrder("delivery")}
                    className={`px-2 py-0.5 rounded font-medium transition-colors ${
                      viewOrder === "delivery"
                        ? "bg-indigo-600 text-white font-semibold"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                    title="Ordem de descarga no cliente na estrada (1 -> N)"
                  >
                    🏁 Entrega
                  </button>
                </div>
              </div>

              {/* Barra de Foco e Isolamento de Encomendas */}
              <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-zinc-800/60">
                <div className="flex items-center space-x-1">
                  <span className="text-zinc-400 mr-1">Foco 3D:</span>
                  <button
                    type="button"
                    onClick={() => setFocusMode("ghost")}
                    className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                      focusMode === "ghost"
                        ? "bg-blue-600/30 text-blue-300 border border-blue-500/50 font-semibold"
                        : "text-zinc-400 hover:text-zinc-200 border border-transparent"
                    }`}
                    title="Outros clientes ficam translúcidos / modo fantasma"
                  >
                    👻 Fantasma
                  </button>
                  <button
                    type="button"
                    onClick={() => setFocusMode("isolate")}
                    className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                      focusMode === "isolate"
                        ? "bg-emerald-600/30 text-emerald-300 border border-emerald-500/50 font-semibold"
                        : "text-zinc-400 hover:text-zinc-200 border border-transparent"
                    }`}
                    title="Outros clientes ficam 100% invisíveis"
                  >
                    👁️ Isolar
                  </button>
                </div>

                {selectedStopSeq !== null && (
                  <button
                    type="button"
                    onClick={() => setSelectedStopSeq(null)}
                    className="text-amber-400 hover:text-amber-300 font-semibold text-[11px] transition-colors cursor-pointer bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20"
                  >
                    ✕ Ver Todos
                  </button>
                )}
              </div>
            </div>

            {/* Lista com scroll */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 divide-y divide-zinc-800/40">
              {groupedStops.length === 0 ? (
                <div className="text-center py-12 text-zinc-500 text-xs">
                  Sem paragens disponíveis nesta rota.
                </div>
              ) : (
                groupedStops.map((st) => {
                  const isHovered = hoveredStopSeq === st.seq;
                  const isSelected = selectedStopSeq === st.seq;
                  return (
                    <div
                      key={st.seq}
                      onClick={() => setSelectedStopSeq(isSelected ? null : st.seq)}
                      onMouseEnter={() => setHoveredStopSeq(st.seq)}
                      onMouseLeave={() => setHoveredStopSeq(null)}
                      className={`pt-2 pb-2 px-2.5 rounded-lg transition-all cursor-pointer border ${
                        isSelected
                          ? "bg-indigo-950/90 border-indigo-400 shadow-lg ring-2 ring-indigo-500/50"
                          : isHovered
                          ? "bg-zinc-850/80 border-zinc-600"
                          : "bg-zinc-900/50 hover:bg-zinc-850/60 border-zinc-800/50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center space-x-2">
                          <span
                            className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: st.color }}
                          />
                          <span className="font-mono text-xs font-bold text-white bg-zinc-800 px-1.5 py-0.2 rounded">
                            #{st.seq}
                          </span>
                          <span className="text-xs font-semibold text-zinc-200 truncate max-w-[170px]">
                            {st.clientName}
                          </span>
                          {isSelected && (
                            <span className="text-[10px] bg-indigo-500/30 text-indigo-200 px-1.5 py-0.2 rounded border border-indigo-400/40">
                              👁️ Focado
                            </span>
                          )}
                        </div>
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase ${
                            st.lifoZone === "porta"
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                              : st.lifoZone === "cabine"
                              ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                              : "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                          }`}
                        >
                          {st.lifoZone === "porta"
                            ? "🚪 Porta"
                            : st.lifoZone === "cabine"
                            ? "🧱 Fundo"
                            : "📦 Centro Baú"}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-zinc-400 mt-1 pl-5">
                        <span className="truncate max-w-[180px] text-zinc-400 text-[10px]">
                          {st.address || "Morada não especificada"}
                        </span>
                        <div className="flex items-center space-x-2 font-mono text-[10px] text-zinc-300">
                          <span>{st.totalBoxes} bulto(s)</span>
                          <span>•</span>
                          <span>{st.totalWeight.toFixed(0)} kg</span>
                          <span>•</span>
                          <span>{st.totalVolume.toFixed(2)} m³</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Dica operacional de rodapé */}
            <div className="p-2.5 bg-zinc-950 border-t border-zinc-800/80 text-[11px] text-zinc-400 flex items-center justify-between">
              <span className="text-zinc-400">
                💡 Clique num cliente para focar a carga no baú 3D (e ocultar os restantes).
              </span>
            </div>
          </div>

          {/* Painel Direito: Canvas 3D Interativo */}
          <div className="lg:col-span-7 flex flex-col relative bg-zinc-950">
            
            {/* Barra de Controlo de Câmaras Rápidas sobreposta */}
            <div className="absolute top-3 left-3 z-10 flex flex-wrap gap-1.5 bg-zinc-900/80 backdrop-blur-md p-1.5 rounded-lg border border-zinc-700/60 shadow-lg text-xs">
              <button
                type="button"
                onClick={() => setPresetCamera("isometric")}
                className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium transition-colors"
                title="Perspetiva Isométrica 3D"
              >
                🔄 3D Livre
              </button>
              <button
                type="button"
                onClick={() => setPresetCamera("top")}
                className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium transition-colors"
                title="Vista de Cima (Planta do Baú)"
              >
                🔝 Superior
              </button>
              <button
                type="button"
                onClick={() => setPresetCamera("side")}
                className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium transition-colors"
                title="Vista Lateral (Corte de Comprimento)"
              >
                ↔️ Lateral
              </button>
              <button
                type="button"
                onClick={() => setPresetCamera("doors")}
                className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium transition-colors"
                title="Vista de Traseira (Perspetiva do Cais / Portas de Descarga)"
              >
                🚪 Portas Traseiras
              </button>
            </div>

            {/* Legenda de Orientação da Viatura (Frente vs Traseira) */}
            <div className="absolute top-3 right-3 z-10 flex items-center space-x-2 bg-zinc-900/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-zinc-700/60 text-[11px] text-zinc-300 shadow-lg">
              <span className="flex items-center space-x-1 text-blue-400 font-semibold">
                <span>⬅️</span> <span>Cabine (Frente)</span>
              </span>
              <span className="text-zinc-600">|</span>
              <span className="flex items-center space-x-1 text-emerald-400 font-semibold">
                <span>Portas (Descarga)</span> <span>➡️</span>
              </span>
            </div>

            {/* Elemento Canvas Three.js */}
            <div className="flex-1 w-full h-full relative cursor-grab active:cursor-grabbing">
              <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onWheel={handleWheel}
                className="w-full h-full block"
              />

              {/* Tooltip 3D Dinâmico no cursor */}
              {tooltipInfo.visible && tooltipInfo.box && (
                <div
                  className="pointer-events-none absolute z-20 bg-zinc-900/95 border border-indigo-500/80 text-white text-xs p-2.5 rounded-lg shadow-2xl backdrop-blur-md min-w-[200px]"
                  style={{
                    left: `${tooltipInfo.x}px`,
                    top: `${tooltipInfo.y}px`,
                  }}
                >
                  <div className="flex items-center space-x-1.5 font-bold text-indigo-300 border-b border-zinc-800 pb-1 mb-1.5">
                    <span>📦 Paragem #{tooltipInfo.box.stopSeq}</span>
                    <span className="text-zinc-400 text-[10px]">
                      (Bulto {tooltipInfo.box.boxIndex}/{tooltipInfo.box.totalBoxesForStop})
                    </span>
                  </div>
                  <div className="font-semibold text-zinc-100 truncate mb-1">
                    {tooltipInfo.box.clientName}
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[11px] text-zinc-300 font-mono">
                    <span>Peso: {tooltipInfo.box.weightKg} kg</span>
                    <span>Vol: {tooltipInfo.box.volumeM3} m³</span>
                    <span>Tam: {tooltipInfo.box.length}×{tooltipInfo.box.width}×{tooltipInfo.box.height}m</span>
                    <span className="text-indigo-400 font-bold uppercase">
                      Zona: {tooltipInfo.box.lifoZone}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Rodapé Informativo da Cena 3D */}
            <div className="p-2.5 bg-zinc-950/90 border-t border-zinc-800 flex flex-wrap items-center justify-between text-[11px] text-zinc-400 px-4">
              <div className="flex items-center space-x-3">
                <span className="text-zinc-400">
                  🖱️ <strong>Clique e arraste</strong> para rodar 360º • <strong>Scroll</strong> para zoom
                </span>
              </div>
              <div className="flex items-center space-x-2 text-[10px] text-zinc-400">
                <span>Regra LIFO: Paragens finais assentam no fundo; Início na porta</span>
              </div>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
