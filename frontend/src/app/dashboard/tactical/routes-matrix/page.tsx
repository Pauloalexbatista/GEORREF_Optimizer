"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { apiRequest } from "@/utils/api";
import { useProjects } from "@/context/ProjectContext";

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

function isTimeAfter(t1: string, t2: string): boolean {
  if (!t1 || !t2) return false;
  const [h1, m1] = t1.split(":").map((x) => parseInt(x, 10) || 0);
  const [h2, m2] = t2.split(":").map((x) => parseInt(x, 10) || 0);
  return h1 * 60 + m1 > h2 * 60 + m2;
}

function isDeliveryLate(serviceStartTime: string, windowStr: string): boolean {
  if (!serviceStartTime || !windowStr || windowStr === "Qualquer" || windowStr === "--") return false;
  const parts = windowStr.split("-");
  if (parts.length < 2) return false;
  const endStr = parts[1].trim().slice(0, 5);
  const [endH, endM] = endStr.split(":").map((x) => parseInt(x, 10) || 0);
  const [startH, startM] = serviceStartTime.split(":").map((x) => parseInt(x, 10) || 0);
  const endMin = endH * 60 + endM;
  const startMin = startH * 60 + startM;
  if (endMin <= 0 || endMin >= 1440) return false;
  return startMin > endMin;
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

interface RouteStop {
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

export default function RoutesMatrixPage() {
  const { selectedProject } = useProjects();
  const [routes, setRoutes] = useState<RouteStop[]>([]);
  const [vehicles, setVehicles] = useState<string[]>([]);
  const [fleetList, setFleetList] = useState<VehicleData[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseData[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("A carregar...");

  const [expandedRoutes, setExpandedRoutes] = useState<Record<string, boolean>>({
    "Por Distribuir": true,
  });

  const channelRef = useRef<BroadcastChannel | null>(null);

  const broadcastUpdate = (updatedRoutes: RouteStop[], vList: string[], wList: WarehouseData[]) => {
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

  const loadData = async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const fleetData = await apiRequest(`/api/fleet/${selectedProject.id}`);
      const rawFleet: VehicleData[] = fleetData.fleet || [];
      const vList = rawFleet.map((v) => v.veiculo);
      const rawWh: WarehouseData[] = fleetData.warehouses || [];

      setVehicles(vList);
      setFleetList(rawFleet);
      setWarehouses(rawWh);

      const solveRes = await apiRequest(`/api/solver/${selectedProject.id}`);
      const rList: RouteStop[] = (solveRes.routes || []).map((r: any) => ({
        ...r,
        Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
      }));
      setRoutes(rList);

      const initialExpanded: Record<string, boolean> = { "Por Distribuir": true };
      vList.forEach((v: string) => {
        initialExpanded[v] = true;
      });
      setExpandedRoutes(initialExpanded);

      const assignedCount = rList.filter((r) => !isPendingRoute(r.Rota)).length;
      setStatusMsg(`${assignedCount} paragens em ${vList.length} veículos.`);
      broadcastUpdate(rList, vList, rawWh);
    } catch (err: any) {
      setStatusMsg("Erro ao carregar dados: " + (err.message || "Erro desconhecido"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      channelRef.current = new BroadcastChannel("georoute_map_sync");
    }
    loadData();
    return () => {
      channelRef.current?.close();
    };
  }, [selectedProject]);

  const toggleRoute = (routeName: string) => {
    setExpandedRoutes((prev) => ({ ...prev, [routeName]: !prev[routeName] }));
  };

  const toggleAll = (expand: boolean) => {
    const allState: Record<string, boolean> = { "Por Distribuir": expand };
    vehicles.forEach((v) => {
      allState[v] = expand;
    });
    setExpandedRoutes(allState);
  };

  const handleTransferEntireRoute = async (sourceRoute: string, targetRoute: string) => {
    if (!selectedProject) return;
    const tgtDisplay = isPendingRoute(targetRoute) ? "Por Distribuir" : targetRoute;
    const confirmMsg = isPendingRoute(targetRoute)
      ? `Tem a certeza que deseja esvaziar a rota "${sourceRoute}" e mover todas as suas paragens para "Por Distribuir"?`
      : `Deseja transferir TODAS as paragens de "${sourceRoute}" para a viatura "${targetRoute}"?`;

    if (!window.confirm(confirmMsg)) return;

    setActionLoading(`bulk_${sourceRoute}`);
    try {
      const res = await apiRequest("/api/solver/reassign-entire-route", {
        method: "POST",
        body: JSON.stringify({
          project_id: selectedProject.id,
          source_route: sourceRoute,
          target_route: tgtDisplay,
        }),
      });
      const updated: RouteStop[] = (res.routes || []).map((r: any) => ({
        ...r,
        Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
      }));
      setRoutes(updated);
      broadcastUpdate(updated, vehicles, warehouses);
      setStatusMsg(`Carga total da rota "${sourceRoute}" transferida para "${tgtDisplay}" com sucesso.`);
    } catch (err: any) {
      alert("Erro ao transferir rota: " + (err.message || "Erro"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleReassign = async (clientCode: string, newRoute: string, deliveryId?: number, address?: string) => {
    if (!selectedProject) return;
    const actKey = deliveryId ? `${clientCode}_${deliveryId}` : clientCode;
    setActionLoading(actKey);
    try {
      const targetRoute = isPendingRoute(newRoute) ? "Por Distribuir" : newRoute;
      const res = await apiRequest("/api/solver/reassign", {
        method: "POST",
        body: JSON.stringify({
          project_id: selectedProject.id,
          client_code: clientCode,
          delivery_id: deliveryId,
          address: address,
          new_route: targetRoute,
        }),
      });
      const updated: RouteStop[] = (res.routes || []).map((r: any) => ({
        ...r,
        Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
      }));
      setRoutes(updated);
      broadcastUpdate(updated, vehicles, warehouses);
      setStatusMsg(`Cliente ${clientCode} movido para ${targetRoute}.`);
    } catch (err: any) {
      alert("Erro ao reatribuir: " + (err.message || "Erro"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleReorder = async (routeName: string, clientCode: string, currentOrder: number, direction: "up" | "down", deliveryId?: number, address?: string) => {
    if (!selectedProject) return;
    const newOrder = direction === "up" ? currentOrder - 1 : currentOrder + 1;
    const actKey = deliveryId ? `${clientCode}_${deliveryId}` : clientCode;
    setActionLoading(actKey);
    try {
      const res = await apiRequest("/api/solver/reorder", {
        method: "POST",
        body: JSON.stringify({
          project_id: selectedProject.id,
          route_name: routeName,
          client_code: clientCode,
          delivery_id: deliveryId,
          address: address,
          new_order: newOrder,
        }),
      });
      const updated: RouteStop[] = (res.routes || []).map((r: any) => ({
        ...r,
        Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
      }));
      setRoutes(updated);
      broadcastUpdate(updated, vehicles, warehouses);
    } catch (err: any) {
      alert("Erro ao reordenar: " + (err.message || "Erro"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleOptimizeSingle = async (routeName: string) => {
    if (!selectedProject) return;
    setActionLoading(routeName);
    try {
      const res = await apiRequest("/api/solver/optimize-single-route", {
        method: "POST",
        body: JSON.stringify({
          project_id: selectedProject.id,
          route_name: routeName,
        }),
      });
      const updated: RouteStop[] = (res.routes || []).map((r: any) => ({
        ...r,
        Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
      }));
      setRoutes(updated);
      broadcastUpdate(updated, vehicles, warehouses);
      setStatusMsg(`Rota ${routeName} reordenada otimamente.`);
    } catch (err: any) {
      alert("Erro ao otimizar trajeto: " + (err.message || "Erro"));
    } finally {
      setActionLoading(null);
    }
  };

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

  const pendingStops = routes.filter((r) => isPendingRoute(r.Rota));
  const hasPending = pendingStops.length > 0;

  // Hierarchical sort:
  // 1. Armazém (Nível 1)
  // 2. Estado de Utilização: Rotas Ativas primeiro, Rotas Vazias no fim (Nível 2)
  // 3. Horário de Saída / Início de Turno (09:50 -> 10:00 -> 12:00 ...)
  // 4. Identificador do Veículo (V1 -> V2 -> V3 ...)
  const sortedVehicles = useMemo(() => {
    const list = [...vehicles];
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
      const stopsA = routes.filter((r) => !isPendingRoute(r.Rota) && r.Rota === a).length;
      const stopsB = routes.filter((r) => !isPendingRoute(r.Rota) && r.Rota === b).length;
      const isActiveA = stopsA > 0;
      const isActiveB = stopsB > 0;

      if (isActiveA !== isActiveB) {
        return isActiveA ? -1 : 1; // Ativas primeiro
      }

      // 3. Horário de Saída / Início
      const timeA = cfgA?.horario_inicio || "09:50";
      const timeB = cfgB?.horario_inicio || "09:50";
      if (timeA !== timeB) {
        return timeA.localeCompare(timeB);
      }

      // 4. Identificador Numérico (V1 -> V2 -> V10)
      const numA = parseInt(a.replace(/\D/g, ""), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ""), 10) || 0;
      if (numA !== numB) {
        return numA - numB;
      }
      return a.localeCompare(b);
    });
    return list;
  }, [vehicles, routes, vehicleMap]);

  const allRows = [...(hasPending ? ["Por Distribuir"] : []), ...sortedVehicles];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans select-none">
      {/* HEADER BAR */}
      <header className="h-14 bg-zinc-900 border-b border-zinc-800 px-6 flex items-center justify-between shrink-0 shadow-lg">
        <div className="flex items-center space-x-4">
          <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-zinc-100 flex items-center space-x-2">
              <span>GeoRoute Pro — Matriz de Gestão Operacional</span>
              <span className="text-[10px] bg-indigo-950 text-indigo-400 px-2 py-0.5 rounded border border-indigo-800/60 font-semibold">3º Ecrã</span>
            </h1>
            <p className="text-[11px] text-zinc-400">{statusMsg}</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => toggleAll(true)}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-semibold border border-zinc-700 cursor-pointer transition-colors"
          >
            Expandir Tudo
          </button>
          <button
            onClick={() => toggleAll(false)}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-semibold border border-zinc-700 cursor-pointer transition-colors"
          >
            Recolher Tudo
          </button>
          <button
            onClick={loadData}
            disabled={loading}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-indigo-500/10 cursor-pointer transition-colors flex items-center space-x-1.5"
          >
            <svg className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Atualizar</span>
          </button>
        </div>
      </header>

      {/* MATRIX TABLE */}
      <main className="flex-1 overflow-auto p-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-zinc-950 border-b border-zinc-800 text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                <th className="py-3 px-4 w-16 text-center">Seq</th>
                <th className="py-3 px-4 w-28">Código</th>
                <th className="py-3 px-4">Morada & Destino</th>
                <th className="py-3 px-4 w-24">CP</th>
                <th className="py-3 px-4 w-28 text-center">Janela Horária</th>
                <th className="py-3 px-4 w-20 text-center">Chegada</th>
                <th className="py-3 px-4 w-24 text-center">Tempo Serviço</th>
                <th className="py-3 px-4 w-20 text-center">Saída</th>
                <th className="py-3 px-4 w-24 text-right">Distância (KM)</th>
                <th className="py-3 px-4 w-20 text-right">Peso (KG)</th>
                <th className="py-3 px-4 w-44 text-center">Reatribuir Rota</th>
                <th className="py-3 px-4 w-24 text-center">Ações</th>
              </tr>
            </thead>
            <tbody>
              {allRows.map((rowName) => {
                const isPending = isPendingRoute(rowName);
                const routeStops = routes.filter((r) => (isPending ? isPendingRoute(r.Rota) : r.Rota === rowName));
                const isExpanded = !!expandedRoutes[rowName];
                const color = getRouteColor(rowName, vehicles);

                // Vehicle details
                const vConfig = vehicleMap[rowName];
                const whName = vConfig?.armazem || (routeStops.length > 0 ? routeStops[0].Armazem : warehouses[0]?.name) || "Armazém Principal";
                const whData = warehouseMap[whName] || warehouses[0] || {
                  name: whName,
                  address: "Base Central",
                  cp: "0000-000",
                  locality: "Principal",
                  lat: 38.6593,
                  lon: -9.1758,
                };

                const startTimeStr = vConfig?.horario_inicio || "09:50";
                const endTimeStr = vConfig?.horario_fim || "18:00";
                const capKg = vConfig?.capacidade_kg || 1000.0;
                const speed = vConfig?.velocidade_media || 50.0;
                const totalKg = routeStops.length > 0
                  ? (routeStops[routeStops.length - 1].Carga_Acum || routeStops.reduce((sum, s) => sum + (s.Peso_KG || 50), 0))
                  : 0;
                const isOverweight = !isPending && totalKg > capKg;

                // Calculate return trip from last client to warehouse
                let returnDist = 0.0;
                let returnTravelMin = 0.0;
                let returnArrivalTimeStr = startTimeStr;
                let totalRouteKm = 0.0;

                if (routeStops.length > 0) {
                  const lastStop = routeStops[routeStops.length - 1];
                  returnDist = haversineDistance(lastStop.Latitude, lastStop.Longitude, whData.lat, whData.lon);
                  returnTravelMin = (returnDist / speed) * 60.0;
                  returnArrivalTimeStr = addMinutesToTime(lastStop.Saida || "12:00", returnTravelMin);
                  totalRouteKm = (lastStop.Dist_Acum || 0) + returnDist;
                }

                const totalDurationStr = routeStops.length > 0 ? calculateDurationString(startTimeStr, returnArrivalTimeStr) : "0h 0m";
                const isOvertime = !isPending && routeStops.length > 0 && isTimeAfter(returnArrivalTimeStr, endTimeStr);

                return (
                  <React.Fragment key={rowName}>
                    {/* ROUTE GROUP HEADER ROW */}
                    <tr
                      onClick={() => toggleRoute(rowName)}
                      className={`border-t-2 border-zinc-800 cursor-pointer transition-colors ${
                        isPending ? "bg-amber-950/20 hover:bg-amber-950/30" : "bg-zinc-950/90 hover:bg-zinc-800/60"
                      }`}
                    >
                      <td colSpan={12} className="py-3 px-4">
                        <div className="flex items-center justify-between gap-4">
                          {/* Left: Indicator, Color, Route Name, Warehouse */}
                          <div className="flex items-center space-x-3 shrink-0">
                            <span className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}>▶</span>
                            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                            <span className={`text-sm font-bold ${isPending ? "text-amber-400" : "text-zinc-100"}`}>
                              {isPending ? "⚠️ Entregas Por Distribuir (Ficaram de Fora)" : rowName}
                            </span>
                            {!isPending && (
                              <span className="text-[11px] font-normal text-zinc-400">
                                ({whData.name})
                              </span>
                            )}
                            {routeStops.length === 0 && !isPending && (
                              <span className="text-[10px] uppercase px-2 py-0.5 bg-zinc-800 text-zinc-400 rounded-full font-semibold border border-zinc-700">
                                Vazio / Disponível
                              </span>
                            )}
                          </div>

                          {/* Center / Metrics */}
                          <div className="flex-1 flex items-center justify-center space-x-3 text-xs text-zinc-400 font-mono">
                            {routeStops.length === 0 && !isPending ? (
                              <div className="flex items-center space-x-3 text-xs text-zinc-400 font-mono">
                                <span className="text-zinc-300">
                                  🕐 Turno: <b className="text-zinc-100">{startTimeStr}</b> ➔ <b className="text-zinc-100">{endTimeStr}</b>
                                </span>
                                <span>•</span>
                                <span><b>0</b> paragens</span>
                                <span>•</span>
                                <span>Distância: <b className="text-zinc-300">0.0 km</b></span>
                                <span>•</span>
                                <span>Carga: <b className="text-zinc-300">0 kg</b> <span className="text-zinc-500 font-normal">(Cap: {capKg.toFixed(0)} kg)</span></span>
                              </div>
                            ) : (
                              <>
                                <span>
                                  <b>{routeStops.length}</b> paragens
                                </span>
                                {!isPending && routeStops.length > 0 && (
                                  <>
                                    <span>•</span>
                                    <span className={`font-semibold ${
                                      isOvertime
                                        ? "text-rose-400 bg-rose-950/60 border border-rose-800/80 px-2 py-0.5 rounded shadow-sm"
                                        : "text-emerald-400"
                                    }`}>
                                      🛫 Saída: <b className="text-zinc-100">{startTimeStr}</b> ➔ 🏁 Regresso: <b className="text-zinc-100">{returnArrivalTimeStr}</b> ({totalDurationStr}{isOvertime ? ` ⚠️ Excede Fim: ${endTimeStr}` : ""})
                                    </span>
                                    <span>•</span>
                                    <span>
                                      Distância: <b className="text-zinc-200">{totalRouteKm.toFixed(1)} km</b>
                                    </span>
                                    <span>•</span>
                                    <span className={`${
                                      isOverweight
                                        ? "text-rose-400 font-bold bg-rose-950/60 border border-rose-800/80 px-2 py-0.5 rounded shadow-sm"
                                        : ""
                                    }`}>
                                      {isOverweight ? "⚠️ " : ""}Carga: <b className={isOverweight ? "text-rose-200" : "text-zinc-200"}>{totalKg.toFixed(0)} kg</b> <span className={isOverweight ? "text-rose-300 font-semibold" : "text-zinc-500 font-normal"}>(Cap: {capKg.toFixed(0)} kg)</span>
                                    </span>
                                  </>
                                )}
                              </>
                            )}
                          </div>

                          {/* Right: Actions stacked vertically (compact) */}
                          <div className="flex flex-col items-end gap-1 w-28 shrink-0" onClick={(e) => e.stopPropagation()}>
                            {!isPending && routeStops.length > 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOptimizeSingle(rowName);
                                }}
                                disabled={actionLoading === rowName}
                                className="w-full justify-center px-2 py-0.5 bg-indigo-950 hover:bg-indigo-900 border border-indigo-700/80 text-indigo-300 hover:text-white rounded-lg text-[10px] font-bold cursor-pointer transition-all shadow-sm flex items-center space-x-1 truncate"
                                title="Otimizar sequência do trajeto pelo percurso mais curto respeitando janelas horárias"
                              >
                                <span>⚡ Ordenar</span>
                              </button>
                            )}
                            {routeStops.length > 0 && (
                              <div className="w-full">
                                <select
                                  defaultValue=""
                                  disabled={actionLoading !== null}
                                  onChange={(e) => {
                                    const tgt = e.target.value;
                                    if (!tgt) return;
                                    handleTransferEntireRoute(rowName, tgt);
                                    e.target.value = "";
                                  }}
                                  className="w-full bg-zinc-900 hover:bg-zinc-850 border border-zinc-700 hover:border-indigo-500 text-zinc-200 text-[10px] rounded-lg px-1.5 py-0.5 outline-none focus:border-indigo-500 cursor-pointer shadow-sm font-sans truncate"
                                  title="Transferir toda a carga desta rota para outro carro ou para Por Distribuir"
                                >
                                  <option value="" disabled>
                                    ⇄ Mover ({routeStops.length})
                                  </option>
                                  {!isPending && (
                                    <option value="Por Distribuir" className="text-amber-400 font-bold bg-zinc-900">
                                      📦 Esvaziar
                                    </option>
                                  )}
                                  {vehicles
                                    .filter((v) => v !== rowName)
                                    .map((v) => (
                                      <option key={v} value={v} className="bg-zinc-900 text-zinc-200">
                                        🚚 {v}
                                      </option>
                                    ))}
                                </select>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>

                    {/* EMPTY VEHICLE ROW */}
                    {isExpanded && routeStops.length === 0 && !isPending && (
                      <tr className="bg-zinc-900/30 border-b border-zinc-800/40">
                        <td colSpan={12} className="py-4 px-6 text-center text-zinc-400 text-xs">
                          <div className="flex items-center justify-center space-x-6 text-zinc-400 font-mono">
                            <span className="text-zinc-300">
                              🏠 Base: <b className="text-indigo-300">{whData.name}</b>
                            </span>
                            <span>•</span>
                            <span>
                              🕒 Horário de Trabalho: <b className="text-emerald-400">{startTimeStr}</b> às <b className="text-emerald-400">{endTimeStr}</b>
                            </span>
                            <span>•</span>
                            <span>
                              📦 Capacidade Livre: <b className="text-zinc-200">{capKg.toFixed(0)} kg</b>
                            </span>
                            <span>•</span>
                            <span className="text-zinc-500 italic">
                              (Pode reatribuir entregas para esta viatura a partir de outras rotas)
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* 1ª LINHA: ARMAZÉM DE ORIGEM (PARTIDA) */}
                    {isExpanded && !isPending && routeStops.length > 0 && (
                      <tr className="bg-indigo-950/20 border-b border-indigo-800/40 text-indigo-200/90 font-medium">
                        <td className="py-2.5 px-4 text-center">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-900/80 text-indigo-300 border border-indigo-700/60">
                            🛫 Partida
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-bold text-indigo-300">{whData.name}</td>
                        <td className="py-2.5 px-4 truncate max-w-xs text-zinc-300">{whData.address}</td>
                        <td className="py-2.5 px-4 font-mono text-zinc-400">{whData.cp || "N/A"}</td>
                        <td className="py-2.5 px-4 text-center font-mono text-[11px] text-zinc-400">Início de Turno</td>
                        <td className="py-2.5 px-4 text-center font-mono text-zinc-500">--:--</td>
                        <td className="py-2.5 px-4 text-center font-mono text-[11px] text-indigo-400">Carregamento</td>
                        <td className="py-2.5 px-4 text-center font-mono font-bold text-emerald-400">{startTimeStr}</td>
                        <td className="py-2.5 px-4 text-right font-mono text-zinc-400">0.0 km</td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold text-zinc-200">{totalKg.toFixed(0)} kg</td>
                        <td className="py-2.5 px-4 text-center text-zinc-500 text-[10px]">Origem da Rota</td>
                        <td className="py-2.5 px-4 text-center text-zinc-500 text-[10px]">Base</td>
                      </tr>
                    )}

                    {/* LINHAS INTERMÉDIAS: TEMPOS DE ESPERA E PARAGENS DOS CLIENTES (#1 a #N) */}
                    {isExpanded &&
                      routeStops.map((stop, idx) => {
                        const isFirst = idx === 0;
                        const isLast = idx === routeStops.length - 1;
                        const isActing = actionLoading === (stop.id ? `${stop.Cliente}_${stop.id}` : stop.Cliente) || actionLoading === stop.Cliente;
                        const travelTimeMin = Math.round(((stop.KM_Anterior || 0) / speed) * 60);
                        const hasWait = !isPending && Number(stop.Tempo_Espera || 0) > 0;
                        const serviceStartTime = hasWait
                          ? addMinutesToTime(stop.Chegada, stop.Tempo_Espera || 0)
                          : stop.Chegada;
                        const isLate = !isPending && isDeliveryLate(serviceStartTime, stop.Janela_Horaria);
                        const isStopOverweight = !isPending && (stop.Carga_Acum || 0) > capKg;

                        return (
                          <React.Fragment key={stop.Cliente + idx}>
                            {/* LINHA DEDICADA DE TEMPO DE ESPERA (AGUARDAR ABERTURA DE JANELA) */}
                            {hasWait && (
                              <tr className="bg-amber-950/25 border-b border-amber-800/40 text-amber-200/90 font-medium">
                                <td className="py-2.5 px-4 text-center">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-900/90 text-amber-300 border border-amber-700/60 shadow-sm">
                                    ⏳ Espera
                                  </span>
                                </td>
                                <td className="py-2.5 px-4">
                                  <div className="font-bold text-amber-300">{stop.Nome_Cliente || stop.Cliente}</div>
                                  {stop.Nome_Cliente && stop.Nome_Cliente !== stop.Cliente && (
                                    <div className="text-[10px] text-amber-400/60 font-mono">{stop.Cliente}</div>
                                  )}
                                </td>
                                <td className="py-2.5 px-4 truncate max-w-xs text-amber-100/90 italic">
                                  Aguardar Abertura da Janela ({stop.Morada})
                                </td>
                                <td className="py-2.5 px-4 font-mono text-zinc-400">{stop.CP || "N/A"}</td>
                                <td className="py-2.5 px-4 text-center font-mono text-[11px] text-zinc-500">
                                  --
                                </td>
                                <td className="py-2.5 px-4 text-center font-mono font-bold text-zinc-200">
                                  {stop.Chegada}
                                </td>
                                <td className="py-2.5 px-4 text-center font-mono font-bold text-amber-400 text-[11px]">
                                  {stop.Tempo_Espera} min (Espera)
                                </td>
                                <td className="py-2.5 px-4 text-center font-mono font-bold text-emerald-400">
                                  {serviceStartTime}
                                </td>
                                <td className="py-2.5 px-4 text-right font-mono text-zinc-300">
                                  {stop.KM_Anterior.toFixed(1)} km
                                  {travelTimeMin > 0 && (
                                    <span className="text-[10px] text-zinc-500 block">(+{travelTimeMin}m)</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-4 text-right font-mono text-zinc-500">--</td>
                                <td className="py-2.5 px-4 text-center text-amber-400 text-[10px] font-medium">Porta do Cliente</td>
                                <td className="py-2.5 px-4 text-center text-zinc-500 text-[10px]">--</td>
                              </tr>
                            )}

                            {/* LINHA DE ENTREGA EFETIVA DO CLIENTE */}
                            <tr
                              className={`border-b border-zinc-800/40 transition-colors ${
                                isActing ? "opacity-40" : "hover:bg-zinc-800/40"
                              } ${isPending ? "bg-amber-950/5" : isLate ? "bg-rose-950/15" : "bg-zinc-900/40"}`}
                            >
                              <td className="py-2.5 px-4 text-center font-mono font-bold text-zinc-400">
                                {isPending ? "-" : `#${stop.Ordem}`}
                              </td>
                              <td className="py-2.5 px-4">
                              <div className="font-semibold text-zinc-200">{stop.Nome_Cliente || stop.Cliente}</div>
                              {stop.Nome_Cliente && stop.Nome_Cliente !== stop.Cliente && (
                                <div className="text-[10px] text-zinc-500 font-mono">{stop.Cliente}</div>
                              )}
                            </td>
                              <td className="py-2.5 px-4 text-zinc-300 truncate max-w-xs">{stop.Morada}</td>
                              <td className="py-2.5 px-4 text-zinc-400 font-mono">{stop.CP || "N/A"}</td>
                              <td className={`py-2.5 px-4 text-center font-mono text-[11px] ${
                                isLate ? "text-rose-400 font-bold" : "text-zinc-400"
                              }`}>
                                {stop.Janela_Horaria || "Qualquer"}
                              </td>
                              <td className={`py-2.5 px-4 text-center font-mono font-semibold ${
                                isPending ? "text-zinc-500" : isLate ? "text-rose-400 bg-rose-950/40 rounded border border-rose-800/50" : "text-emerald-400"
                              }`} title={isLate ? "Entrega fora da janela horária acordada!" : ""}>
                                {isPending ? "--:--" : (
                                  <div>
                                    <span>{serviceStartTime}</span>
                                    {isLate && <span className="text-[9px] text-rose-300 block font-bold">⚠️ Atrasado</span>}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-4 text-center font-mono text-zinc-300 text-[11px]">
                                {isPending ? "--" : `${stop.Tempo_Entrega || 15} min (Descarga)`}
                              </td>
                              <td className="py-2.5 px-4 text-center font-mono text-zinc-300 font-semibold">
                                {isPending ? "--:--" : stop.Saida}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono text-zinc-300">
                                {isPending ? "0.0 km" : hasWait ? "0.0 km" : `${stop.KM_Anterior.toFixed(1)} km`}
                                {!isPending && !hasWait && travelTimeMin > 0 && (
                                  <span className="text-[10px] text-zinc-500 block">(+{travelTimeMin}m)</span>
                                )}
                              </td>
                              <td className={`py-2.5 px-4 text-right font-mono ${
                                isStopOverweight ? "text-rose-400 font-bold bg-rose-950/30" : "text-zinc-300"
                              }`}>
                                {stop.Carga_Acum} kg
                              </td>
                              <td className="py-2.5 px-4 text-center">
                                <select
                                  value={isPending ? "Por Distribuir" : stop.Rota}
                                  onChange={(e) => handleReassign(stop.Cliente, e.target.value, stop.id || stop.ID_Original, stop.Morada)}
                                  disabled={isActing}
                                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500 cursor-pointer w-36"
                                >
                                  <option value="Por Distribuir">⚠️ Por Distribuir</option>
                                  {vehicles.map((v) => (
                                    <option key={v} value={v}>
                                      {v}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-2.5 px-4 text-center">
                                {!isPending && (
                                  <div className="flex items-center justify-center space-x-1">
                                    <button
                                      onClick={() => handleReorder(stop.Rota, stop.Cliente, stop.Ordem, "up", stop.id || stop.ID_Original, stop.Morada)}
                                      disabled={isFirst || isActing}
                                      className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 disabled:opacity-20 cursor-pointer"
                                      title="Mover para cima"
                                    >
                                      ▲
                                    </button>
                                    <button
                                      onClick={() => handleReorder(stop.Rota, stop.Cliente, stop.Ordem, "down", stop.id || stop.ID_Original, stop.Morada)}
                                      disabled={isLast || isActing}
                                      className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 disabled:opacity-20 cursor-pointer"
                                      title="Mover para baixo"
                                    >
                                      ▼
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          </React.Fragment>
                        );
                      })}

                    {/* ÚLTIMA LINHA: ARMAZÉM DE CHEGADA (REGRESSO) */}
                    {isExpanded && !isPending && routeStops.length > 0 && (
                      <tr className="bg-emerald-950/20 border-b border-emerald-800/40 text-emerald-200/90 font-medium">
                        <td className="py-2.5 px-4 text-center">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-900/80 text-emerald-300 border border-emerald-700/60">
                            🏁 Regresso
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-bold text-emerald-300">{whData.name}</td>
                        <td className="py-2.5 px-4 truncate max-w-xs text-zinc-300">{whData.address}</td>
                        <td className="py-2.5 px-4 font-mono text-zinc-400">{whData.cp || "N/A"}</td>
                        <td className="py-2.5 px-4 text-center font-mono text-[11px] text-zinc-400">Fim de Turno</td>
                        <td className={`py-2.5 px-4 text-center font-mono font-bold ${
                          isOvertime ? "text-rose-400 bg-rose-950/40 border-y border-rose-800/60" : "text-emerald-400"
                        }`}>
                          {returnArrivalTimeStr}
                          {isOvertime && (
                            <span className="text-[9px] text-rose-300 block font-normal">Excede Fim Turno ({endTimeStr})</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-center font-mono text-[11px] text-emerald-400">Descarga / Fim</td>
                        <td className="py-2.5 px-4 text-center font-mono text-zinc-500">--:--</td>
                        <td className="py-2.5 px-4 text-right font-mono text-zinc-300">
                          {returnDist.toFixed(1)} km
                          {returnTravelMin > 0 && (
                            <span className="text-[10px] text-zinc-500 block">(+{Math.round(returnTravelMin)}m)</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-zinc-400">0 kg</td>
                        <td className="py-2.5 px-4 text-center text-zinc-500 text-[10px]">Destino Final</td>
                        <td className="py-2.5 px-4 text-center text-zinc-500 text-[10px]">Base</td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
