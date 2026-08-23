"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useProjects } from "@/context/ProjectContext";
import { apiRequest } from "@/utils/api";
import dynamic from "next/dynamic";

const MapComponent = dynamic(() => import("@/components/MapComponent"), { ssr: false });

interface RouteNode {
  id?: number;
  ID_Original?: number;
  Rota: string;
  Armazem: string;
  Ordem: number;
  Cliente: string;
  Nome_Cliente?: string;
  Morada: string;
  CP: string;
  Localidade: string;
  Janela_Horaria: string;
  Latitude: number;
  Longitude: number;
  Chegada: string;
  Tempo_Espera?: number;
  Tempo_Entrega: number;
  Saida: string;
  KM_Anterior: number;
  Dist_Acum: number;
  Peso_KG?: number;
  Carga_Acum: number;
  Carga_Vol_Acum: number;
}

interface Delivery {
  id: number;
  codigo_cliente: string;
  morada: string;
  codigo_postal: string;
  concelho: string;
  latitude: number;
  longitude: number;
}

interface WarehouseData {
  name: string;
  address: string;
  cp: string;
  locality: string;
  lat: number;
  lon: number;
  quality?: number;
}

interface VehicleData {
  veiculo: string;
  armazem: string;
  capacidade_kg: number;
  capacidade_vol: number;
  custo_km: number;
  velocidade_media: number;
  horario_inicio: string;
  horario_fim: string;
}

const routeColors = [
  "#6366f1", // Indigo
  "#ec4899", // Pink
  "#f59e0b", // Amber
  "#10b981", // Emerald
  "#3b82f6", // Blue
  "#ef4444", // Red
  "#8b5cf6", // Violet
  "#06b6d4", // Cyan
  "#f97316", // Orange
  "#14b8a6", // Teal
  "#a855f7", // Purple
  "#84cc16", // Lime
  "#0ea5e9", // Sky
  "#e11d48", // Rose
];

function isPendingRoute(routeName: string) {
  if (!routeName) return true;
  const s = routeName.toUpperCase();
  return s.includes("PENDENTE") || s.includes("DISTRIBUIR");
}

function getRouteColor(routeName: string, vehicleList: string[]) {
  if (isPendingRoute(routeName)) return "#f59e0b"; // Amber for pending
  const idx = vehicleList.indexOf(routeName);
  if (idx === -1) return routeColors[0];
  return routeColors[idx % routeColors.length];
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function addMinutesToTime(timeStr: string, minutesToAdd: number): string {
  const parts = (timeStr || "08:00").split(":");
  const h = parseInt(parts[0], 10) || 8;
  const m = parseInt(parts[1], 10) || 0;
  const totalMins = h * 60 + m + Math.round(minutesToAdd);
  const newH = Math.floor(totalMins / 60) % 24;
  const newM = totalMins % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

function calculateDurationString(startStr: string, endStr: string): string {
  const [h1, m1] = (startStr || "08:00").split(":").map(Number);
  const [h2, m2] = (endStr || "08:00").split(":").map(Number);
  let totalMin = h2 * 60 + m2 - (h1 * 60 + m1);
  if (totalMin < 0) totalMin += 24 * 60;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours === 0) return `${mins}m`;
  return `${hours}h ${mins > 0 ? `${mins}m` : ""}`;
}

export default function TacticalPage() {
  const { selectedProject } = useProjects();
  const [routes, setRoutes] = useState<RouteNode[]>([]);
  const [vehicles, setVehicles] = useState<string[]>([]);
  const [fleetList, setFleetList] = useState<VehicleData[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseData[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [expandedRoute, setExpandedRoute] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [solving, setSolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Optimization params state & 2x2 Decision Matrix
  const [strategy, setStrategy] = useState<"distance" | "far_first">("far_first");
  const [loadMode, setLoadMode] = useState<"full" | "balanced">("full");
  const [timeLimit, setTimeLimit] = useState(15);
  const [distWeight, setDistWeight] = useState(100);
  const [balWeight, setBalWeight] = useState(0);
  const [maxDurStr, setMaxDurStr] = useState("08:00");
  const [showConfig, setShowConfig] = useState(false);

  const channelRef = useRef<BroadcastChannel | null>(null);

  const broadcastUpdate = (updatedRoutes: RouteNode[], vList: string[], wList: WarehouseData[]) => {
    const mappedClients = updatedRoutes.map((r) => ({
      Cliente: r.Cliente,
      Nome_Cliente: r.Nome_Cliente || r.Cliente,
      Morada: r.Morada,
      Latitude: r.Latitude,
      Longitude: r.Longitude,
      Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
      Ordem: r.Ordem,
      Janela_Horaria: r.Janela_Horaria,
      Chegada: r.Chegada,
      Saida: r.Saida,
      KM_Anterior: r.KM_Anterior,
    }));

    const payload = { type: "MAP_UPDATE", clients: mappedClients, warehouses: wList, vehicles: vList };
    try {
      channelRef.current?.postMessage(payload);
      localStorage.setItem("georoute_map_state", JSON.stringify(payload));
    } catch (e) {}
  };

  const handleOpenDetachedMap = () => {
    if (typeof window !== "undefined") {
      window.open("/dashboard/tactical/detached-map", "GeoRouteMap2", "width=1280,height=800,menubar=no,toolbar=no");
    }
  };

  const handleOpenRoutesMatrix = () => {
    if (typeof window !== "undefined") {
      window.open("/dashboard/tactical/routes-matrix", "GeoRouteMatrix3", "width=1400,height=900,menubar=no,toolbar=no");
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      channelRef.current = new BroadcastChannel("georoute_map_sync");
      channelRef.current.onmessage = (event) => {
        if (event.data?.type === "MAP_UPDATE") {
          loadTacticalData();
        }
      };
    }
    return () => {
      channelRef.current?.close();
    };
  }, []);

  const loadTacticalData = async () => {
    if (!selectedProject) return;
    setLoading(true);
    setError(null);
    try {
      const fleetRes = await apiRequest(`/api/fleet/${selectedProject.id}`);
      const rawFleet: VehicleData[] = fleetRes.fleet || [];
      const vList = rawFleet.map((v) => v.veiculo);
      const rawWh: WarehouseData[] = fleetRes.warehouses || [];

      setFleetList(rawFleet);
      setVehicles(vList);
      setWarehouses(rawWh);

      const delivRes = await apiRequest(`/api/geocoding/${selectedProject.id}`);
      setDeliveries(delivRes || []);

      const solveRes = await apiRequest(`/api/solver/${selectedProject.id}`);
      const loadedRoutes: RouteNode[] = (solveRes.routes || []).map((r: any) => ({
        ...r,
        Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
      }));
      setRoutes(loadedRoutes);

      if (loadedRoutes.length > 0) {
        const firstWithStops = loadedRoutes.find((r) => !isPendingRoute(r.Rota));
        setExpandedRoute(firstWithStops ? firstWithStops.Rota : "Por Distribuir");
      }
      broadcastUpdate(loadedRoutes, vList, rawWh);
    } catch (e: any) {
      console.error("Failed to load tactical data:", e);
      setError("Erro ao carregar dados táticos. Por favor configure a frota e os clientes primeiro.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTacticalData();
  }, [selectedProject]);

  const handleSolveRoutes = async () => {
    if (!selectedProject) return;
    setSolving(true);
    setError(null);
    setInfoMsg(null);
    setShowConfig(false);

    try {
      const res = await apiRequest("/api/solver/solve", {
        method: "POST",
        body: JSON.stringify({
          project_id: selectedProject.id,
          params: {
            strategy: strategy,
            load_mode: loadMode,
            time_limit: timeLimit,
            time_limit_seconds: timeLimit,
            distance_weight: distWeight,
            balance_weight: loadMode === "balanced" ? (balWeight > 0 ? balWeight : 50) : 0,
            max_route_duration: maxDurStr,
          },
        }),
      });

      const updatedRoutes: RouteNode[] = (res.routes || []).map((r: any) => ({
        ...r,
        Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
      }));

      setRoutes(updatedRoutes);
      if (res.vehicles && res.vehicles.length > 0) {
        setVehicles(res.vehicles);
      }

      const pendingCount = updatedRoutes.filter((r) => isPendingRoute(r.Rota)).length;
      const assignedCount = updatedRoutes.length - pendingCount;

      if (pendingCount > 0) {
        setInfoMsg(
          `Otimização concluída: ${assignedCount} paragens atribuídas à frota. ${pendingCount} encomendas ficaram na rota "Por Distribuir" para gestão manual.`
        );
      } else {
        setInfoMsg(`Otimização concluída com 100% de sucesso: todas as ${assignedCount} paragens foram distribuídas pelos veículos.`);
      }

      const firstVehicleWithStops = updatedRoutes.find((r) => !isPendingRoute(r.Rota));
      if (firstVehicleWithStops) {
        setExpandedRoute(firstVehicleWithStops.Rota);
      } else if (pendingCount > 0) {
        setExpandedRoute("Por Distribuir");
      }
      broadcastUpdate(updatedRoutes, vehicles, warehouses);
    } catch (e: any) {
      setError(e.message || "Erro inesperado ao otimizar rotas.");
    } finally {
      setSolving(false);
    }
  };

    const [reorderingAll, setReorderingAll] = useState(false);

  const handleOptimizeAllSequences = async () => {
    if (!selectedProject) return;
    setReorderingAll(true);
    try {
      const res = await apiRequest("/api/solver/optimize-all-sequences", {
        method: "POST",
        body: JSON.stringify({ project_id: selectedProject.id }),
      });
      const cleaned = (res.routes || []).map((r: any) => ({
        ...r,
        Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
      }));
      setRoutes(cleaned);
      broadcastUpdate(cleaned, vehicles, warehouses);
      setInfoMsg(res.message || "Sequências de todas as viaturas ordenadas com sucesso!");
    } catch (err: any) {
      alert(err.message || "Erro ao ordenar sequências.");
    } finally {
      setReorderingAll(false);
    }
  };

  const handleOptimizeSingleRoute = async (routeName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedProject) return;
    setLoading(true);
    try {
      const res = await apiRequest("/api/solver/optimize-single-route", {
        method: "POST",
        body: JSON.stringify({
          project_id: selectedProject.id,
          route_name: routeName,
        }),
      });
      const cleaned = (res.routes || []).map((r: any) => ({
        ...r,
        Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
      }));
      setRoutes(cleaned);
      broadcastUpdate(cleaned, vehicles, warehouses);
    } catch (err: any) {
      alert(err.message || "Erro ao otimizar trajeto da rota.");
    } finally {
      setLoading(false);
    }
  };

  const handleTransferEntireRoute = async (sourceRoute: string, targetRoute: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!selectedProject) return;
    const tgtDisplay = isPendingRoute(targetRoute) ? "Por Distribuir" : targetRoute;
    const confirmMsg = isPendingRoute(targetRoute)
      ? `Tem a certeza que deseja esvaziar a rota "${sourceRoute}" e mover todas as suas paragens para "Por Distribuir"?`
      : `Deseja transferir TODAS as paragens de "${sourceRoute}" para a viatura "${targetRoute}"?`;

    if (!window.confirm(confirmMsg)) return;

    setLoading(true);
    try {
      const res = await apiRequest("/api/solver/reassign-entire-route", {
        method: "POST",
        body: JSON.stringify({
          project_id: selectedProject.id,
          source_route: sourceRoute,
          target_route: tgtDisplay,
        }),
      });
      const cleaned = (res.routes || []).map((r: any) => ({
        ...r,
        Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
      }));
      setRoutes(cleaned);
      broadcastUpdate(cleaned, vehicles, warehouses);
      
    } catch (err: any) {
      alert("Erro ao transferir rota: " + (err.message || "Erro"));
    } finally {
      setLoading(false);
    }
  };

  const handleMoveClientRoute = async (clientName: string, newRoute: string, deliveryId?: number, address?: string) => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const targetRoute = isPendingRoute(newRoute) ? "Por Distribuir" : newRoute;
      const res = await apiRequest("/api/solver/reassign", {
        method: "POST",
        body: JSON.stringify({
          project_id: selectedProject.id,
          client_code: clientName,
          delivery_id: deliveryId,
          address: address,
          new_route: targetRoute,
        }),
      });
      const cleaned = (res.routes || []).map((r: any) => ({
        ...r,
        Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
      }));
      setRoutes(cleaned);
      broadcastUpdate(cleaned, vehicles, warehouses);
    } catch (e: any) {
      alert(e.message || "Erro ao reatribuir rota.");
    } finally {
      setLoading(false);
    }
  };

  const handleReorderStop = async (routeName: string, clientName: string, currentOrder: number, direction: "up" | "down", e: React.MouseEvent, deliveryId?: number, address?: string) => {
    e.stopPropagation();
    if (!selectedProject) return;
    const newOrder = direction === "up" ? currentOrder - 1 : currentOrder + 1;
    setLoading(true);
    try {
      const res = await apiRequest("/api/solver/reorder", {
        method: "POST",
        body: JSON.stringify({
          project_id: selectedProject.id,
          route_name: routeName,
          client_code: clientName,
          delivery_id: deliveryId,
          address: address,
          new_order: newOrder,
        }),
      });
      const cleaned = (res.routes || []).map((r: any) => ({
        ...r,
        Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
      }));
      setRoutes(cleaned);
      broadcastUpdate(cleaned, vehicles, warehouses);
    } catch (e: any) {
      alert(e.message || "Erro ao reordenar paragem.");
    } finally {
      setLoading(false);
    }
  };

  const handleExportExcel = () => {
    if (!selectedProject) return;
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const projClean = (selectedProject.nome || `Projeto_${selectedProject.id}`).replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
    const filename = `Distribuicao_${projClean}_${dateStr}.xlsx`;
    handleDownloadFile(`/api/solver/export-full/${selectedProject.id}`, filename);
  };
  const handleDownloadFile = async (endpoint: string, filename: string) => {
    try {
      const token = localStorage.getItem("georoute_token") || localStorage.getItem("token");
      const headers = new Headers();
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      const response = await fetch(`${endpoint}`, { headers });
      if (!response.ok) {
        throw new Error("Erro ao descarregar ficheiro.");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e.message || "Erro ao efetuar o download.");
    }
  };

  // Group routes for accordion view
  const groupedRoutes: { [key: string]: RouteNode[] } = {};
  routes.forEach((r) => {
    const routeKey = isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota;
    if (!groupedRoutes[routeKey]) {
      groupedRoutes[routeKey] = [];
    }
    groupedRoutes[routeKey].push(r);
  });

  // Helper dictionary for vehicle configs
  const vehicleMap = useMemo(() => {
    const map: Record<string, VehicleData> = {};
    fleetList.forEach((v) => {
      map[v.veiculo] = v;
    });
    return map;
  }, [fleetList]);

  // Helper dictionary for warehouses
  const warehouseMap = useMemo(() => {
    const map: Record<string, WarehouseData> = {};
    warehouses.forEach((w) => {
      map[w.name] = w;
    });
    return map;
  }, [warehouses]);

  const pendingStops = groupedRoutes["Por Distribuir"] || [];
  const hasPending = pendingStops.length > 0;

  // Hierarchical sort for tactical sidebar routes:
  // 1. Armazém (Nível 1)
  // 2. Estado de Utilização: Rotas Ativas primeiro, depois Vazias (Nível 2)
  // 3. Horário de Saída
  // 4. Identificador Numérico
  const displayRouteKeys = useMemo(() => {
    const nonVehicleKeys = Object.keys(groupedRoutes).filter(
      (k) => k !== "Por Distribuir" && !vehicles.includes(k)
    );
    const list = [...vehicles, ...nonVehicleKeys];

    list.sort((a, b) => {
      const cfgA = vehicleMap[a];
      const cfgB = vehicleMap[b];

      // 1. Armazém
      const whA = (cfgA?.armazem || "").trim().toLowerCase();
      const whB = (cfgB?.armazem || "").trim().toLowerCase();
      if (whA !== whB) {
        return whA.localeCompare(whB);
      }

      // 2. Estado de Utilização
      const stopsA = (groupedRoutes[a] || []).length;
      const stopsB = (groupedRoutes[b] || []).length;
      const isActiveA = stopsA > 0;
      const isActiveB = stopsB > 0;

      if (isActiveA !== isActiveB) {
        return isActiveA ? -1 : 1; // Ativas primeiro
      }

      // 3. Horário de Saída
      const timeA = cfgA?.horario_inicio || "09:50";
      const timeB = cfgB?.horario_inicio || "09:50";
      if (timeA !== timeB) {
        return timeA.localeCompare(timeB);
      }

      // 4. Identificador Numérico
      const numA = parseInt(a.replace(/\D/g, ""), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ""), 10) || 0;
      if (numA !== numB) {
        return numA - numB;
      }
      return a.localeCompare(b);
    });

    return [...(hasPending ? ["Por Distribuir"] : []), ...list];
  }, [vehicles, groupedRoutes, hasPending, vehicleMap]);

  const reassignVehicleOptions = [
    "Por Distribuir",
    ...vehicles,
    ...Object.keys(groupedRoutes).filter((k) => k !== "Por Distribuir" && !vehicles.includes(k)),
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6 h-[calc(100vh-8.5rem)] flex flex-col">
        {/* Header Section */}
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-50 font-sans">Dashboard Tático</h1>
            <p className="text-zinc-400 text-xs mt-1">Calcule trajetos eficientes e acompanhe as rotas de distribuição em tempo real.</p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={handleOpenDetachedMap}
              className="cursor-pointer bg-zinc-900 hover:bg-zinc-850 text-emerald-400 border border-zinc-800 hover:border-emerald-700/60 rounded-xl px-3.5 py-2 text-xs font-semibold shadow-sm transition-all flex items-center space-x-2"
              title="Abrir o mapa numa janela independente para o 2.º monitor"
            >
              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              <span>🖥️ 2º Monitor (Mapa)</span>
            </button>

            <button
              onClick={handleOpenRoutesMatrix}
              className="cursor-pointer bg-zinc-900 hover:bg-zinc-850 text-indigo-400 border border-zinc-800 hover:border-indigo-700/60 rounded-xl px-3.5 py-2 text-xs font-semibold shadow-sm transition-all flex items-center space-x-2"
              title="Abrir a Matriz de Gestão de Rotas num 3.º monitor"
            >
              <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
              </svg>
              <span>🖥️ 3º Monitor (Rotas)</span>
            </button>

            <button
              onClick={() => setShowConfig(!showConfig)}
              className="cursor-pointer bg-zinc-900 hover:bg-zinc-850 text-zinc-300 border border-zinc-800 rounded-xl px-4 py-2 text-xs font-semibold shadow-sm transition-all flex items-center space-x-2"
            >
              <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Configurações</span>
            </button>

            <button
              onClick={handleOptimizeAllSequences}
              disabled={reorderingAll || solving || routes.length === 0}
              className="cursor-pointer bg-zinc-900 hover:bg-zinc-850 text-amber-400 border border-amber-500/30 hover:border-amber-500/60 rounded-xl px-3.5 py-2 text-xs font-semibold shadow-sm transition-all flex items-center space-x-2 disabled:opacity-50"
              title="Ordena a sequência de paragens de cada viatura pelo menor trajeto, sem transferir clientes entre carros."
            >
              <span>{reorderingAll ? "A ordenar..." : "⚡ Ordenar Sequências"}</span>
            </button>
            <button
              onClick={handleSolveRoutes}
              disabled={solving || vehicles.length === 0}
              className="cursor-pointer bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white rounded-xl px-5 py-2 text-xs font-semibold shadow-md shadow-indigo-500/10 transition-all flex items-center space-x-2 disabled:opacity-50"
            >
              {solving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <span>A Otimizar...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>Otimizar Rotas</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Error / Info alerts */}
        {error && (
          <div className="bg-rose-950/40 border border-rose-800 text-rose-300 px-4 py-3 rounded-2xl text-xs flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <svg className="w-4 h-4 text-rose-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-200 text-xs">✕</button>
          </div>
        )}

        {infoMsg && (
          <div className="bg-emerald-950/40 border border-emerald-800 text-emerald-300 px-4 py-3 rounded-2xl text-xs flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>{infoMsg}</span>
            </div>
            <button onClick={() => setInfoMsg(null)} className="text-emerald-400 hover:text-emerald-200 text-xs">✕</button>
          </div>
        )}

        {/* Config Flyout: 2x2 Decision Matrix */}
        {showConfig && (
          <div className="bg-zinc-900/95 border border-zinc-800 rounded-2xl p-5 shadow-2xl space-y-4 text-xs shrink-0 backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h4 className="font-bold text-sm text-zinc-100 flex items-center space-x-2">
                  <span>Matriz de Decisão de Otimização (2x2)</span>
                  <span className="text-[10px] bg-indigo-950 text-indigo-300 px-2 py-0.5 rounded border border-indigo-700 font-mono">
                    {strategy === "far_first" ? "🎯 ZONAS" : "⚡ KM"} + {loadMode === "full" ? "📦 CHEIO" : "⚖️ EQUILIBRADO"}
                  </span>
                </h4>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Selecione a combinação estratégica entre critério de percurso e gestão de capacidade da frota.
                </p>
              </div>

              <div className="flex items-center space-x-3">
                <div className="w-36">
                  <label className="block text-[10px] text-zinc-400 mb-1 font-medium">Duração Máx. (HH:MM)</label>
                  <input
                    type="text"
                    value={maxDurStr}
                    onChange={(e) => setMaxDurStr(e.target.value)}
                    placeholder="08:00"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-zinc-200 font-mono outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="w-28">
                  <label className="block text-[10px] text-zinc-400 mb-1 font-medium">Limite Solver (s)</label>
                  <input
                    type="number"
                    value={timeLimit}
                    onChange={(e) => setTimeLimit(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>

            {/* 2x2 Interactive Grid */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              {/* Opção 1: ZONA + CHEIO */}
              <div
                onClick={() => {
                  setStrategy("far_first");
                  setLoadMode("full");
                }}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                  strategy === "far_first" && loadMode === "full"
                    ? "bg-indigo-950/50 border-indigo-500 shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-500/50"
                    : "bg-zinc-950/50 border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-850/40"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-base">🎯📦</span>
                    <span className="font-bold text-xs text-zinc-100">Zona + Cheio</span>
                    <span className="text-[9px] bg-emerald-950 text-emerald-300 px-1.5 py-0.2 rounded border border-emerald-700/60 font-semibold">
                      Recomendado Tráfego
                    </span>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    strategy === "far_first" && loadMode === "full"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-zinc-800 text-zinc-400"
                  }`}>
                    {strategy === "far_first" && loadMode === "full" ? "✓ Ativo" : "Selecionar"}
                  </span>
                </div>
                <ul className="text-[11px] text-zinc-300 space-y-1 pl-1">
                  <li className="flex items-start space-x-1.5">
                    <span className="text-indigo-400 font-bold">•</span>
                    <span>Começa pelas entregas mais distantes e agrupa clientes por setor/corredor geográfico.</span>
                  </li>
                  <li className="flex items-start space-x-1.5">
                    <span className="text-indigo-400 font-bold">•</span>
                    <span>Enche cada carro até ao limite da capacidade/turno para <b>sobrarem viaturas livres</b> no armazém.</span>
                  </li>
                  <li className="flex items-start space-x-1.5">
                    <span className="text-indigo-400 font-bold">•</span>
                    <span>Se faltarem carros, os clientes que ficarem de fora ficam garantidamente <b>junto ao armazém</b>.</span>
                  </li>
                </ul>
              </div>

              {/* Opção 2: ZONA + EQUILIBRADO */}
              <div
                onClick={() => {
                  setStrategy("far_first");
                  setLoadMode("balanced");
                }}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                  strategy === "far_first" && loadMode === "balanced"
                    ? "bg-indigo-950/50 border-indigo-500 shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-500/50"
                    : "bg-zinc-950/50 border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-850/40"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-base">🎯⚖️</span>
                    <span className="font-bold text-xs text-zinc-100">Zona + Equilibrado</span>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    strategy === "far_first" && loadMode === "balanced"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-zinc-800 text-zinc-400"
                  }`}>
                    {strategy === "far_first" && loadMode === "balanced" ? "✓ Ativo" : "Selecionar"}
                  </span>
                </div>
                <ul className="text-[11px] text-zinc-300 space-y-1 pl-1">
                  <li className="flex items-start space-x-1.5">
                    <span className="text-indigo-400 font-bold">•</span>
                    <span>Mantém o agrupamento por setor geográfico a começar nos extremos longínquos.</span>
                  </li>
                  <li className="flex items-start space-x-1.5">
                    <span className="text-indigo-400 font-bold">•</span>
                    <span>Suaviza a carga para que as viaturas de cada zona tenham um <b>peso e número de paragens equilibrado</b>.</span>
                  </li>
                </ul>
              </div>

              {/* Opção 3: KM + CHEIO */}
              <div
                onClick={() => {
                  setStrategy("distance");
                  setLoadMode("full");
                }}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                  strategy === "distance" && loadMode === "full"
                    ? "bg-indigo-950/50 border-indigo-500 shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-500/50"
                    : "bg-zinc-950/50 border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-850/40"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-base">⚡📦</span>
                    <span className="font-bold text-xs text-zinc-100">KM + Cheio</span>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    strategy === "distance" && loadMode === "full"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-zinc-800 text-zinc-400"
                  }`}>
                    {strategy === "distance" && loadMode === "full" ? "✓ Ativo" : "Selecionar"}
                  </span>
                </div>
                <ul className="text-[11px] text-zinc-300 space-y-1 pl-1">
                  <li className="flex items-start space-x-1.5">
                    <span className="text-indigo-400 font-bold">•</span>
                    <span>Minimização matemática global de quilómetros para poupança estrita de combustível.</span>
                  </li>
                  <li className="flex items-start space-x-1.5">
                    <span className="text-indigo-400 font-bold">•</span>
                    <span>Consolidação no menor número de viaturas possível.</span>
                  </li>
                </ul>
              </div>

              {/* Opção 4: KM + EQUILIBRADO */}
              <div
                onClick={() => {
                  setStrategy("distance");
                  setLoadMode("balanced");
                }}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                  strategy === "distance" && loadMode === "balanced"
                    ? "bg-indigo-950/50 border-indigo-500 shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-500/50"
                    : "bg-zinc-950/50 border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-850/40"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-base">⚡⚖️</span>
                    <span className="font-bold text-xs text-zinc-100">KM + Equilibrado</span>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    strategy === "distance" && loadMode === "balanced"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-zinc-800 text-zinc-400"
                  }`}>
                    {strategy === "distance" && loadMode === "balanced" ? "✓ Ativo" : "Selecionar"}
                  </span>
                </div>
                <ul className="text-[11px] text-zinc-300 space-y-1 pl-1">
                  <li className="flex items-start space-x-1.5">
                    <span className="text-indigo-400 font-bold">•</span>
                    <span>Minimiza a quilometragem global enquanto distribui o trabalho proporcionalmente por todas as viaturas ativas da frota.</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Main Content Layout */}
        <div className="flex-1 flex gap-6 min-h-0">
          {/* MAP CONTAINER */}
          <div className="flex-1 border border-zinc-800 bg-zinc-900/40 rounded-2xl overflow-hidden shadow-2xl relative">
            <MapComponent
              clients={routes}
              warehouses={warehouses}
              vehicles={vehicles}
              onMoveClientRoute={handleMoveClientRoute}
              onUpdateClientCoords={async (clientName, lat, lon) => {
                await handleMoveClientRoute(clientName, "Por Distribuir");
              }}
            />
          </div>

          {/* SIDEBAR: ROUTES ACCORDION */}
          <div className="w-[480px] shrink-0 border border-zinc-800 bg-zinc-900/60 backdrop-blur-md rounded-2xl flex flex-col overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/20">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">Rotas e Distribuição</h3>
                <p className="text-[10px] text-zinc-500 font-mono mt-0.5">
                  {vehicles.length} Veículos na Frota • {routes.filter((r) => !isPendingRoute(r.Rota)).length} Paragens Atribuídas
                </p>
              </div>

              {routes.length > 0 && (
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="cursor-pointer bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white rounded-lg px-3 py-1.5 text-[10px] font-semibold shadow-md shadow-emerald-500/10 transition-all flex items-center space-x-1.5"
                  title="Exportar Excel Completo"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>Exportar Excel</span>
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {displayRouteKeys.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3 text-zinc-500">
                  <svg className="w-8 h-8 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-xs">Não existem rotas calculadas ou veículos configurados.</p>
                  <button
                    onClick={handleSolveRoutes}
                    disabled={solving || vehicles.length === 0}
                    className="cursor-pointer text-xs text-indigo-400 hover:text-indigo-300 font-semibold transition-colors"
                  >
                    Calcular Otimização Agora →
                  </button>
                </div>
              ) : (
                displayRouteKeys.map((routeName) => {
                  const isPending = isPendingRoute(routeName);
                  const items = groupedRoutes[routeName] || [];
                  const isExpanded = expandedRoute === routeName;
                  const isEmptyVehicle = !isPending && items.length === 0;
                  const color = getRouteColor(routeName, vehicles);

                  // Vehicle details
                  const vConfig = vehicleMap[routeName];
                  const whName = vConfig?.armazem || (items.length > 0 ? items[0].Armazem : warehouses[0]?.name) || "Armazém Principal";
                  const whData = warehouseMap[whName] || warehouses[0] || {
                    name: whName,
                    address: "Base Central",
                    cp: "0000-000",
                    locality: "Principal",
                    lat: 38.6593,
                    lon: -9.1758,
                  };

                  const startTimeStr = vConfig?.horario_inicio || "09:50";
                  const speed = vConfig?.velocidade_media || 50.0;
                  const totalKg = items.reduce((sum, item) => sum + (item.Carga_Acum || 0), 0);

                  // Calculate return trip from last client to warehouse
                  let returnDist = 0.0;
                  let returnTravelMin = 0.0;
                  let returnArrivalTimeStr = startTimeStr;
                  let totalRouteKm = 0.0;

                  if (items.length > 0) {
                    const lastStop = items[items.length - 1];
                    returnDist = haversineDistance(lastStop.Latitude, lastStop.Longitude, whData.lat, whData.lon);
                    returnTravelMin = (returnDist / speed) * 60.0;
                    returnArrivalTimeStr = addMinutesToTime(lastStop.Saida || "12:00", returnTravelMin);
                    totalRouteKm = (lastStop.Dist_Acum || 0) + returnDist;
                  }

                  const totalDurationStr = items.length > 0 ? calculateDurationString(startTimeStr, returnArrivalTimeStr) : "0h 0m";

                  return (
                    <div
                      key={routeName}
                      className="bg-zinc-950/40 border border-zinc-800 rounded-xl overflow-hidden transition-all shadow-sm"
                      style={{ borderLeft: `4px solid ${color}` }}
                    >
                      {/* VEHICLE CARD HEADER */}
                      <div className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2.5 hover:bg-zinc-850/20 transition-colors">
                        <div
                          onClick={() => setExpandedRoute(isExpanded ? null : routeName)}
                          className="flex-1 min-w-0 cursor-pointer flex items-center space-x-2.5"
                        >
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center space-x-1.5 flex-wrap">
                              <p className={`text-xs font-bold ${isPending ? "text-amber-400" : "text-zinc-200"}`}>
                                {isPending ? "⚠️ Por Distribuir" : routeName}
                              </p>
                              {!isPending && (
                                <span className="text-[10px] text-zinc-400 font-normal truncate">
                                  ({whData.name})
                                </span>
                              )}
                              {isEmptyVehicle && (
                                <span className="text-[9px] uppercase px-1.5 py-0.5 bg-zinc-800 text-zinc-400 rounded font-semibold border border-zinc-700">
                                  Vazio
                                </span>
                              )}
                            </div>

                            <p className="text-[10px] text-zinc-400 mt-0.5 font-mono">
                              {isPending ? (
                                `${items.length} encomendas não atribuídas`
                              ) : isEmptyVehicle ? (
                                "0 paragens • 0.0 km (Disponível)"
                              ) : (
                                <>
                                  <span className="text-emerald-400 font-semibold">
                                    🛫 {startTimeStr} ➔ 🏁 {returnArrivalTimeStr} ({totalDurationStr})
                                  </span>
                                  <br />
                                  <span>{items.length} paragens • {totalRouteKm.toFixed(1)} km • {totalKg.toFixed(0)} kg</span>
                                </>
                              )}
                            </p>
                          </div>
                        </div>

                        {/* Actions container stacked vertically on the right (compact 1/4 width) */}
                        <div className="flex items-center space-x-1.5 shrink-0">
                          <div className="flex flex-col items-end gap-1 w-24 shrink-0" onClick={(e) => e.stopPropagation()}>
                            {!isPending && items.length > 1 && (
                              <button
                                onClick={(e) => handleOptimizeSingleRoute(routeName, e)}
                                className="w-full justify-center bg-indigo-950/90 hover:bg-indigo-900 border border-indigo-700/80 text-indigo-300 hover:text-white px-1.5 py-0.5 rounded-lg text-[9px] font-bold transition-all flex items-center space-x-1 cursor-pointer shadow-sm truncate"
                                title="Ordenar sequência pelo trajeto mais curto"
                              >
                                <svg className="w-2.5 h-2.5 text-indigo-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                <span>Ordenar</span>
                              </button>
                            )}
                            {items.length > 0 && (
                              <div className="w-full">
                                <select
                                  defaultValue=""
                                  disabled={loading}
                                  onChange={(e) => {
                                    const tgt = e.target.value;
                                    if (!tgt) return;
                                    handleTransferEntireRoute(routeName, tgt);
                                    e.target.value = "";
                                  }}
                                  className="w-full bg-zinc-900 hover:bg-zinc-850 border border-zinc-700 hover:border-indigo-500 text-zinc-200 text-[9px] rounded-lg px-1.5 py-0.5 outline-none focus:border-indigo-500 cursor-pointer shadow-sm font-sans truncate"
                                  title="Transferir todas as paragens desta rota para outro carro ou para Por Distribuir"
                                >
                                  <option value="" disabled>
                                    ⇄ Mover ({items.length})
                                  </option>
                                  {!isPending && (
                                    <option value="Por Distribuir" className="text-amber-400 font-bold bg-zinc-900">
                                      📦 Esvaziar
                                    </option>
                                  )}
                                  {vehicles
                                    .filter((v) => v !== routeName)
                                    .map((v) => (
                                      <option key={v} value={v} className="bg-zinc-900 text-zinc-200">
                                        🚚 {v}
                                      </option>
                                    ))}
                                </select>
                              </div>
                            )}
                          </div>

                          <button
                            onClick={() => setExpandedRoute(isExpanded ? null : routeName)}
                            className="p-1 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                          >
                            <svg
                              className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* VEHICLE EXPANDED STOPS LIST */}
                      {isExpanded && (
                        <div className="border-t border-zinc-800 p-3 space-y-2 bg-zinc-950/20">
                          {isEmptyVehicle ? (
                            <div className="p-3 bg-zinc-900/50 border border-zinc-800/80 rounded-lg text-center text-zinc-400 text-xs font-mono space-y-1">
                              <p className="text-zinc-300 font-semibold">Viatura Livre (0 paragens • 0.0 km • 0 kg)</p>
                              <p className="text-[11px] text-emerald-400">Turno: {startTimeStr} às {vConfig?.horario_fim || "18:00"} (Cap: {vConfig?.capacidade_kg || 1000} kg)</p>
                              <p className="text-[10px] text-zinc-500 mt-1">
                                Pode reatribuir clientes de outras rotas diretamente para este carro.
                              </p>
                            </div>
                          ) : (
                            <>
                              {/* 1ª LINHA: ARMAZÉM DE ORIGEM (PARTIDA) */}
                              {!isPending && (
                                <div className="p-2.5 bg-indigo-950/30 border border-indigo-800/50 rounded-xl text-xs space-y-1">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-2">
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-900 text-indigo-300 border border-indigo-700/60">
                                        🛫 Partida
                                      </span>
                                      <span className="font-bold text-indigo-300">{whData.name}</span>
                                    </div>
                                    <span className="font-mono font-bold text-emerald-400">
                                      Saída: {startTimeStr}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-zinc-400 truncate">{whData.address} • {whData.cp}</p>
                                  <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono pt-0.5">
                                    <span>Ponto de Origem</span>
                                    <span>Carga: {totalKg.toFixed(0)} kg</span>
                                  </div>
                                </div>
                              )}

                              {/* LINHAS INTERMÉDIAS: PARAGENS DE CLIENTES E TEMPOS DE ESPERA */}
                              {items.map((node, index) => {
                                const isFirst = index === 0;
                                const isLast = index === items.length - 1;
                                const travelTimeMin = Math.round(((node.KM_Anterior || 0) / speed) * 60);
                                const hasWait = !isPending && Number(node.Tempo_Espera || 0) > 0;
                                const serviceStartTime = hasWait
                                  ? addMinutesToTime(node.Chegada, node.Tempo_Espera || 0)
                                  : node.Chegada;

                                return (
                                  <React.Fragment key={node.Cliente + index}>
                                    {/* CARD DEDICADO DE TEMPO DE ESPERA */}
                                    {hasWait && (
                                      <div className="p-2.5 rounded-xl border bg-amber-950/25 border-amber-800/60 text-xs space-y-1.5 font-mono shadow-sm">
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center space-x-2">
                                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-900 text-amber-300 border border-amber-700/60">
                                              ⏳ Espera
                                            </span>
                                            <div>
                                                    <div className="font-bold text-amber-300">{node.Nome_Cliente || node.Cliente}</div>
                                                    {node.Nome_Cliente && node.Nome_Cliente !== node.Cliente && (
                                                      <div className="text-[10px] text-amber-400/60 font-mono">{node.Cliente}</div>
                                                    )}
                                                   </div>
                                          </div>
                                          <div className="flex items-center space-x-2 text-[11px]">
                                            <span className="text-zinc-200 font-semibold">Chegada: {node.Chegada}</span>
                                            <span className="text-zinc-500">→</span>
                                            <span className="text-emerald-400 font-semibold">Abertura: {serviceStartTime}</span>
                                          </div>
                                        </div>
                                        <p className="text-[11px] text-amber-200/80 font-sans truncate">
                                          Aguardar Abertura de Janela ({node.Morada})
                                        </p>
                                        <div className="flex items-center justify-between text-[10px] text-zinc-400 pt-1 border-t border-amber-900/40">
                                          <span className="text-amber-300 font-medium">⏳ Aguarda Abertura</span>
                                          <span>Espera: <b className="text-amber-400">{node.Tempo_Espera} min</b></span>
                                          <span>Deslocação: <b className="text-zinc-300">{node.KM_Anterior.toFixed(1)} km</b></span>
                                        </div>
                                      </div>
                                    )}

                                    <div
                                      className={`p-2.5 rounded-xl border text-xs space-y-1.5 ${
                                        isPending
                                          ? "bg-amber-950/20 border-amber-800/50"
                                          : "bg-zinc-900/60 border-zinc-800/80 hover:border-zinc-700"
                                      }`}
                                    >
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center space-x-2">
                                          <span className="font-mono font-bold text-zinc-400">
                                            {isPending ? "⚠️" : `#${node.Ordem}`}
                                          </span>
                                          <div>
                                                  <div className="font-bold text-zinc-200">{node.Nome_Cliente || node.Cliente}</div>
                                                  {node.Nome_Cliente && node.Nome_Cliente !== node.Cliente && (
                                                    <div className="text-[10px] text-zinc-500 font-mono">{node.Cliente}</div>
                                                  )}
                                                  </div>
                                        </div>

                                        {!isPending && (
                                          <div className="flex items-center space-x-2 font-mono text-[11px]">
                                            <span className="text-emerald-400 font-semibold">Início: {serviceStartTime}</span>
                                            <span className="text-zinc-500">→</span>
                                            <span className="text-zinc-300 font-semibold">Saída: {node.Saida}</span>
                                          </div>
                                        )}
                                      </div>

                                    <p className="text-[11px] text-zinc-300 truncate">{node.Morada}</p>

                                    <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono pt-1 border-t border-zinc-800/60">
                                      <span>
                                        Janela: <b className="text-zinc-300">{node.Janela_Horaria || "Qualquer"}</b>
                                      </span>
                                      <span>
                                        Deslocação: <b className="text-zinc-300">{node.KM_Anterior.toFixed(1)} km</b>
                                        {travelTimeMin > 0 && <span className="text-zinc-500"> (+{travelTimeMin}m)</span>}
                                      </span>
                                      <span>
                                        Carga: <b className="text-zinc-300">{node.Carga_Acum} kg</b>
                                      </span>
                                    </div>

                                    <div className="flex items-center justify-between pt-1.5">
                                      <select
                                        value={isPending ? "Por Distribuir" : node.Rota}
                                        onChange={(e) => handleMoveClientRoute(node.Cliente, e.target.value, node.id || (node as any).ID_Original, node.Morada)}
                                        className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-indigo-500 cursor-pointer"
                                      >
                                        {reassignVehicleOptions.map((v) => (
                                          <option key={v} value={v}>
                                            {v === "Por Distribuir" ? "⚠️ Por Distribuir" : v}
                                          </option>
                                        ))}
                                      </select>

                                      {!isPending && (
                                        <div className="flex items-center space-x-1">
                                          <button
                                            onClick={(e) => handleReorderStop(node.Rota, node.Cliente, node.Ordem, "up", e)}
                                            disabled={isFirst}
                                            className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 disabled:opacity-20 cursor-pointer text-xs"
                                            title="Mover para cima"
                                          >
                                            ▲
                                          </button>
                                          <button
                                            onClick={(e) => handleReorderStop(node.Rota, node.Cliente, node.Ordem, "down", e)}
                                            disabled={isLast}
                                            className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 disabled:opacity-20 cursor-pointer text-xs"
                                            title="Mover para baixo"
                                          >
                                            ▼
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </React.Fragment>
                                );
                              })}

                              {/* ÚLTIMA LINHA: ARMAZÉM DE CHEGADA (REGRESSO) */}
                              {!isPending && (
                                <div className="p-2.5 bg-emerald-950/30 border border-emerald-800/50 rounded-xl text-xs space-y-1">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-2">
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-900 text-emerald-300 border border-emerald-700/60">
                                        🏁 Regresso
                                      </span>
                                      <span className="font-bold text-emerald-300">{whData.name}</span>
                                    </div>
                                    <span className="font-mono font-bold text-emerald-400">
                                      Chegada: {returnArrivalTimeStr}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-zinc-400 truncate">{whData.address} • {whData.cp}</p>
                                  <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono pt-0.5">
                                    <span>
                                      Troço Final: {returnDist.toFixed(1)} km (+{Math.round(returnTravelMin)}m)
                                    </span>
                                    <span>Total: {totalRouteKm.toFixed(1)} km</span>
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
