"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useProjects } from "@/context/ProjectContext";
import { apiRequest } from "@/utils/api";
import * as THREE from "three";
import {
  calculateCargoLoadingPlan,
  estimateVehicleDimensions,
  CargoBox,
  VehicleContainerDimensions,
} from "@/utils/cargoPacking";

export default function Cargo3DPage() {
  const { selectedProject } = useProjects();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routes, setRoutes] = useState<any[]>([]);
  const [fleetList, setFleetList] = useState<any[]>([]);
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0);
  const [viewOrder, setViewOrder] = useState<"lifo" | "delivery">("lifo");
  const [hoveredStopSeq, setHoveredStopSeq] = useState<number | null>(null);
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

  // Carregar dados táticos do projeto ativo
  useEffect(() => {
    async function loadData() {
      if (!selectedProject) return;
      setLoading(true);
      setError(null);
      try {
        const fleetRes = await apiRequest(`/api/fleet/${selectedProject.id}`);
        const rawFleet = fleetRes.fleet || [];
        setFleetList(rawFleet);

        const solveRes = await apiRequest(`/api/solver/${selectedProject.id}`);
        const rawRoutes: any[] = solveRes.routes || [];

        // Agrupar por viatura/rota
        const groups: Record<string, any[]> = {};
        rawRoutes.forEach((r: any) => {
          const rKey = r.Rota || r.rota || "Por Distribuir";
          if (rKey.toUpperCase() !== "POR DISTRIBUIR" && !rKey.toUpperCase().includes("PENDENTE")) {
            if (!groups[rKey]) groups[rKey] = [];
            groups[rKey].push(r);
          }
        });

        const structuredRoutes = Object.entries(groups).map(([rKey, stops]) => {
          const vCfg = rawFleet.find((f: any) => (f.veiculo || "").toLowerCase() === rKey.toLowerCase());
          return {
            vehicle: rKey,
            veiculo: rKey,
            max_volume: vCfg?.capacidade_vol || 14,
            max_weight: vCfg?.capacidade_kg || 1500,
            stops: stops.sort((a, b) => (a.Ordem || 0) - (b.Ordem || 0)).map((s, idx) => ({
              id: s.id || s.ID_Original || idx,
              client_name: s.Nome_Cliente || s.Cliente || `Cliente ${s.Ordem || idx + 1}`,
              address: `${s.Morada || ""} ${s.CP || ""} ${s.Localidade || ""}`.trim(),
              seq: s.Ordem || idx + 1,
              weight: Number(s.Peso_KG) || 15,
              volume: Number(s.Volume_m3) || 0.15,
              packages: Math.max(1, Math.round((Number(s.Volume_m3) || 0.15) / 0.1) || 1),
            })),
          };
        });

        setRoutes(structuredRoutes);
        if (structuredRoutes.length > 0) {
          setSelectedRouteIdx(0);
        }
      } catch (err: any) {
        console.error("Erro ao carregar dados para Carregamento 3D:", err);
        setError("Não foi possível carregar as rotas ativas. Certifique-se de que já executou o Planeamento de Rotas no menu 3.");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [selectedProject]);

  const currentRoute = routes[selectedRouteIdx] || null;

  // Dimensões estimadas da viatura
  const vehicleConfig = useMemo(() => {
    if (!currentRoute) return null;
    const vName = currentRoute.vehicle || "";
    const matched = fleetList.find(
      (v) => (v.veiculo || "").toLowerCase() === vName.toLowerCase()
    );
    const maxVol = matched?.capacidade_vol || currentRoute.max_volume || 14;
    const maxKg = matched?.capacidade_kg || currentRoute.max_weight || 1500;
    return estimateVehicleDimensions(maxVol, maxKg);
  }, [currentRoute, fleetList]);

  // Plano de empacotamento com LIFO e Gravidade
  const { cargoBoxes, totalWeight, totalVolume } = useMemo(() => {
    if (!currentRoute || !vehicleConfig) {
      return { cargoBoxes: [], totalWeight: 0, totalVolume: 0 };
    }
    const stops = currentRoute.stops || [];
    const boxes = calculateCargoLoadingPlan(stops, vehicleConfig);
    const weight = boxes.reduce((acc, b) => acc + b.weightKg, 0);
    const vol = boxes.reduce((acc, b) => acc + b.volumeM3, 0);
    return { cargoBoxes: boxes, totalWeight: weight, totalVolume: vol };
  }, [currentRoute, vehicleConfig]);

  // Agrupamento para a lista de paragens lateral
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
      return list.sort((a, b) => b.seq - a.seq);
    }
    return list.sort((a, b) => a.seq - b.seq);
  }, [cargoBoxes, viewOrder]);

  // Inicialização Three.js
  useEffect(() => {
    if (!canvasRef.current || !vehicleConfig) return;

    const canvas = canvasRef.current;
    const width = canvas.clientWidth || 800;
    const height = canvas.clientHeight || 600;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090d16);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight1.position.set(10, 15, 10);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x93c5fd, 0.6);
    dirLight2.position.set(-10, 8, -10);
    scene.add(dirLight2);

    const containerGroup = new THREE.Group();
    const boxesGroup = new THREE.Group();
    scene.add(containerGroup);
    scene.add(boxesGroup);

    const target = new THREE.Vector3(0, vehicleConfig.height / 2, 0);
    const spherical = {
      radius: Math.max(vehicleConfig.length * 1.8, 6.5),
      theta: Math.PI / 4,
      phi: Math.PI / 3,
    };

    function updateCameraPosition() {
      const x = spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta);
      const y = spherical.radius * Math.cos(spherical.phi);
      const z = spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta);
      camera.position.set(x + target.x, y + target.y, z + target.z);
      camera.lookAt(target);
    }
    updateCameraPosition();

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

    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();
    if (threeStateRef.current) {
      threeStateRef.current.animationFrameId = animId;
    }

    const handleResize = () => {
      if (!canvas) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animId);
      renderer.dispose();
      threeStateRef.current = null;
    };
  }, [vehicleConfig]);

  // Atualização dos elementos 3D
  useEffect(() => {
    const state = threeStateRef.current;
    if (!state || !vehicleConfig) return;

    const { containerGroup, boxesGroup } = state;

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

    state.target.set(0, H / 2, 0);

    // 1. Piso
    const grid = new THREE.GridHelper(Math.max(L, W) * 1.4, 20, 0x38bdf8, 0x1e293b);
    grid.position.set(0, -0.01, 0);
    containerGroup.add(grid);

    // 2. Chassi do baú
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

    const edgesGeo = new THREE.EdgesGeometry(boxGeo);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2 });
    const containerEdges = new THREE.LineSegments(edgesGeo, edgesMat);
    containerEdges.position.set(0, H / 2, 0);
    containerGroup.add(containerEdges);

    // 3. Cabine e Portas
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

    const doorGeo = new THREE.PlaneGeometry(W * 0.45, H);
    const doorMat = new THREE.MeshBasicMaterial({
      color: 0x15803d,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
    });
    const doorLeft = new THREE.Mesh(doorGeo, doorMat);
    doorLeft.position.set(L / 2 + 0.3, H / 2, -W * 0.25);
    doorLeft.rotation.y = Math.PI / 4;
    containerGroup.add(doorLeft);

    const doorRight = new THREE.Mesh(doorGeo, doorMat);
    doorRight.position.set(L / 2 + 0.3, H / 2, W * 0.25);
    doorRight.rotation.y = -Math.PI / 4;
    containerGroup.add(doorRight);

    // 4. Caixas
    cargoBoxes.forEach((b) => {
      const cGeo = new THREE.BoxGeometry(b.length, b.height, b.width);
      const origColor = new THREE.Color(b.color);
      const cMat = new THREE.MeshStandardMaterial({
        color: origColor,
        roughness: 0.4,
        metalness: 0.15,
      });
      const cMesh = new THREE.Mesh(cGeo, cMat);

      const threeX = b.position.x - L / 2;
      const threeY = b.position.y;
      const threeZ = b.position.z;

      cMesh.position.set(threeX, threeY, threeZ);

      const cEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(cGeo),
        new THREE.LineBasicMaterial({ color: 0x0f172a, linewidth: 1.5 })
      );
      cMesh.add(cEdges);
      cMesh.userData = { box: b };

      boxesGroup.add(cMesh);
      state.boxMeshes.push({ mesh: cMesh, box: b, originalColor: origColor });
    });
  }, [vehicleConfig, cargoBoxes]);

  // Hover sync
  useEffect(() => {
    const state = threeStateRef.current;
    if (!state) return;

    state.boxMeshes.forEach(({ mesh, box }) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (hoveredStopSeq === box.stopSeq) {
        mat.emissive.setHex(0xffffff);
        mat.emissiveIntensity = 0.55;
        mesh.scale.set(1.03, 1.03, 1.03);
      } else {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
        mesh.scale.set(1.0, 1.0, 1.0);
      }
    });
  }, [hoveredStopSeq]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const state = threeStateRef.current;
    if (!state) return;
    state.isDragging = true;
    state.prevMousePos = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const state = threeStateRef.current;
    if (!state || !canvasRef.current) return;

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

  const setPresetCamera = (view: "isometric" | "top" | "side" | "doors") => {
    const state = threeStateRef.current;
    if (!state || !vehicleConfig) return;

    const baseDist = Math.max(vehicleConfig.length * 1.8, 6.5);
    state.spherical.radius = baseDist;

    switch (view) {
      case "top":
        state.spherical.theta = 0;
        state.spherical.phi = 0.05;
        break;
      case "side":
        state.spherical.theta = Math.PI / 2;
        state.spherical.phi = Math.PI / 2.3;
        break;
      case "doors":
        state.spherical.theta = 0;
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

  const volPercent = vehicleConfig
    ? Math.min(100, Math.round((totalVolume / vehicleConfig.totalVolumeM3) * 100))
    : 0;
  const weightPercent = vehicleConfig
    ? Math.min(100, Math.round((totalWeight / vehicleConfig.maxWeightKg) * 100))
    : 0;

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full overflow-hidden bg-zinc-950 text-zinc-100">
        
        {/* Barra Superior / Header da Página */}
        <div className="flex flex-wrap items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/60 gap-4">
          <div className="flex items-center space-x-3">
            <span className="text-2xl p-2 bg-blue-500/10 border border-blue-500/20 rounded-xl">📦</span>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-base font-bold text-white tracking-wide">
                  8. Carregamento 3D da Viatura
                </h1>
                <span className="bg-blue-500/20 text-blue-300 text-[10px] font-semibold px-2 py-0.5 rounded border border-blue-500/30 uppercase">
                  Protótipo LIFO & Gravidade
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Simulação tridimensional da arrumação da mercadoria no cais com base nas regras de rota e física de carga
              </p>
            </div>
          </div>

          {/* Seletor de Rota */}
          {routes.length > 0 && (
            <div className="flex items-center space-x-2 bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-700 text-xs">
              <span className="text-zinc-400 font-medium">Viatura:</span>
              <select
                value={selectedRouteIdx}
                onChange={(e) => setSelectedRouteIdx(Number(e.target.value))}
                className="bg-transparent text-white font-semibold focus:outline-none cursor-pointer"
              >
                {routes.map((r, i) => (
                  <option key={i} value={i} className="bg-zinc-900 text-white">
                    {r.vehicle} ({r.stops.length} paragens)
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Métricas da Viatura Selecionada */}
        {vehicleConfig && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 py-2.5 bg-zinc-950/70 border-b border-zinc-800/80 text-xs">
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

        {/* Conteúdo Principal */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mr-3" />
            A carregar dados de distribuição e modelos 3D...
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="text-3xl mb-2">⚠️</div>
            <h3 className="text-sm font-bold text-zinc-200 mb-1">{error}</h3>
            <p className="text-xs text-zinc-400 max-w-md">
              Aceda à opção <strong>3. Planeamento</strong> para gerar e otimizar as rotas do dia antes de visualizar o carregamento tridimensional.
            </p>
          </div>
        ) : routes.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-zinc-400">
            <div className="text-3xl mb-2">📦</div>
            <h3 className="text-sm font-bold text-zinc-200 mb-1">Sem rotas ativas com carga</h3>
            <p className="text-xs text-zinc-400 max-w-md">
              Execute o solver no menu <strong>3. Planeamento</strong> para atribuir encomendas às viaturas.
            </p>
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden">
            
            {/* Lista de Paragens (Esquerda) */}
            <div className="lg:col-span-5 flex flex-col border-r border-zinc-800 bg-zinc-900/30 overflow-hidden">
              <div className="flex items-center justify-between p-3.5 border-b border-zinc-800/80 bg-zinc-900/60">
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
                  >
                    🚚 Ordem Carga (LIFO)
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewOrder("delivery")}
                    className={`px-2 py-0.5 rounded font-medium transition-colors ${
                      viewOrder === "delivery"
                        ? "bg-indigo-600 text-white font-semibold"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    🏁 Ordem Entrega
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5 divide-y divide-zinc-800/40">
                {groupedStops.map((st) => {
                  const isHovered = hoveredStopSeq === st.seq;
                  return (
                    <div
                      key={st.seq}
                      onMouseEnter={() => setHoveredStopSeq(st.seq)}
                      onMouseLeave={() => setHoveredStopSeq(null)}
                      className={`pt-1.5 pb-1.5 px-2.5 rounded-lg transition-all cursor-pointer border ${
                        isHovered
                          ? "bg-indigo-950/60 border-indigo-500 shadow-md"
                          : "bg-zinc-900/50 hover:bg-zinc-850/60 border-zinc-800/50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center space-x-2">
                          <span
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: st.color }}
                          />
                          <span className="font-mono text-xs font-bold text-white bg-zinc-800 px-1.5 py-0.2 rounded">
                            #{st.seq}
                          </span>
                          <span className="text-xs font-semibold text-zinc-200 truncate max-w-[180px]">
                            {st.clientName}
                          </span>
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
                            ? "🚪 Junto à Porta"
                            : st.lifoZone === "cabine"
                            ? "🧱 Fundo (Cabine)"
                            : "📦 Centro"}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-zinc-400 mt-1 pl-5">
                        <span className="truncate max-w-[200px] text-zinc-400 text-[10px]">
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
                })}
              </div>

              <div className="p-3 bg-zinc-950 border-t border-zinc-800 text-[11px] text-zinc-400">
                💡 Passe o cursor sobre qualquer paragem para destacar a mercadoria dentro do baú 3D.
              </div>
            </div>

            {/* Cena 3D (Direita) */}
            <div className="lg:col-span-7 flex flex-col relative bg-zinc-950">
              
              {/* Botões de Câmara */}
              <div className="absolute top-4 left-4 z-10 flex flex-wrap gap-1.5 bg-zinc-900/80 backdrop-blur-md p-1.5 rounded-lg border border-zinc-700/60 shadow-lg text-xs">
                <button
                  type="button"
                  onClick={() => setPresetCamera("isometric")}
                  className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium transition-colors"
                >
                  🔄 3D Livre
                </button>
                <button
                  type="button"
                  onClick={() => setPresetCamera("top")}
                  className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium transition-colors"
                >
                  🔝 Superior
                </button>
                <button
                  type="button"
                  onClick={() => setPresetCamera("side")}
                  className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium transition-colors"
                >
                  ↔️ Lateral
                </button>
                <button
                  type="button"
                  onClick={() => setPresetCamera("doors")}
                  className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium transition-colors"
                >
                  🚪 Portas Traseiras
                </button>
              </div>

              {/* Orientação */}
              <div className="absolute top-4 right-4 z-10 flex items-center space-x-2 bg-zinc-900/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-zinc-700/60 text-[11px] text-zinc-300 shadow-lg">
                <span className="text-blue-400 font-semibold">⬅️ Cabine (Frente)</span>
                <span className="text-zinc-600">|</span>
                <span className="text-emerald-400 font-semibold">Portas (Descarga) ➡️</span>
              </div>

              {/* Canvas Three.js */}
              <div className="flex-1 w-full h-full relative cursor-grab active:cursor-grabbing">
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onWheel={handleWheel}
                  className="w-full h-full block"
                />

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

              <div className="p-3 bg-zinc-950/90 border-t border-zinc-800 flex items-center justify-between text-[11px] text-zinc-400 px-5">
                <span>🖱️ Arraste com o rato para rodar 360º • Scroll para zoom</span>
                <span className="text-[10px] text-zinc-400">Regra LIFO: Fundo para a Porta Traseira</span>
              </div>

            </div>

          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
