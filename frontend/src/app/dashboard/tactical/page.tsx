"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useProjects } from "@/context/ProjectContext";
import { apiRequest } from "@/utils/api";
import { useI18n } from "@/context/I18nContext";

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

export default function TacticalPage() {
  const { t } = useI18n();
  const { selectedProject } = useProjects();
  const [routes, setRoutes] = useState<RouteNode[]>([]);
  const [vehicles, setVehicles] = useState<string[]>([]);
  const [fleetList, setFleetList] = useState<VehicleData[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseData[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [solving, setSolving] = useState(false);
  const [reorderingAll, setReorderingAll] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Accordion state
  const [expandedRoutes, setExpandedRoutes] = useState<Record<string, boolean>>({
    "Por Distribuir": true,
  });

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWarehouseFilter, setSelectedWarehouseFilter] = useState("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<"all" | "active" | "empty" | "pending" | "late">("all");

  // Strategy Config Drawer
  const [showConfig, setShowConfig] = useState(false);
  const [strategy, setStrategy] = useState("distance");
  const [loadMode, setLoadMode] = useState("balanced");
  const [maxTravelTime, setMaxTravelTime] = useState("09:00");
  const [respectWindows, setRespectWindows] = useState(true);

  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      channelRef.current = new BroadcastChannel("georoute_map_sync");
    }
    return () => {
      channelRef.current?.close();
    };
  }, []);

  const broadcastUpdate = (updatedRoutes: RouteNode[], vList: string[], wList: WarehouseData[]) => {
    const mappedClients = updatedRoutes.map((r) => ({
      id: r.id || r.ID_Original,
      ID_Original: r.id || r.ID_Original,
      Cliente: r.Cliente,
      Nome_Cliente: r.Nome_Cliente || r.Cliente,
      Morada: r.Morada,
      CP: r.CP,
      Localidade: r.Localidade,
      Latitude: r.Latitude,
      Longitude: r.Longitude,
      Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
      Ordem: r.Ordem,
      Janela_Horaria: r.Janela_Horaria,
      Chegada: r.Chegada,
      Saida: r.Saida,
      KM_Anterior: r.KM_Anterior,
      Dist_Acum: r.Dist_Acum,
      Carga_Acum: r.Carga_Acum,
    }));

    const payload = { type: "MAP_UPDATE", clients: mappedClients, warehouses: wList, vehicles: vList };
    try {
      channelRef.current?.postMessage(payload);
      localStorage.setItem("georoute_map_state", JSON.stringify(payload));
    } catch (e) {}
  };

  const handleOpenDetachedMap = () => {
    if (typeof window !== "undefined") {
      window.open("/dashboard/tactical/detached-map", "GeoRouteDetachedMap", "width=1350,height=900,menubar=no,toolbar=no,location=no,status=no");
    }
  };

  const handleOpenRoutesMatrix = () => {
    if (typeof window !== "undefined") {
      window.open("/dashboard/tactical/routes-matrix", "GeoRouteMatrix3", "width=1400,height=900,menubar=no,toolbar=no");
    }
  };

  const loadTacticalData = async () => {
    if (!selectedProject) return;
    setLoading(true);
    setError(null);
    try {
      const fleetRes = await apiRequest(`/api/fleet/${selectedProject.id}`);
      const rawFleet: VehicleData[] = fleetRes.fleet || [];
      const vList = rawFleet.map((v: any) => v.veiculo);
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

      const initialExp: Record<string, boolean> = { "Por Distribuir": true };
      vList.forEach((v: string) => {
        initialExp[v] = true;
      });
      setExpandedRoutes(initialExp);

      const assignedCount = loadedRoutes.filter((r) => !isPendingRoute(r.Rota)).length;
      setStatusMsg(`Carregadas ${loadedRoutes.length} paragens (${assignedCount} atribuídas, ${vList.length} viaturas).`);
      broadcastUpdate(loadedRoutes, vList, rawWh);
    } catch (e: any) {
      console.error("Failed to load tactical data:", e);
      setError("Erro ao carregar dados táticos. Certifique-se de que a frota e os clientes estão configurados.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTacticalData();
  }, [selectedProject]);

  const toggleRouteExpand = (routeName: string) => {
    setExpandedRoutes((prev) => ({ ...prev, [routeName]: !prev[routeName] }));
  };

  const toggleAllRoutes = (expand: boolean) => {
    const allState: Record<string, boolean> = { "Por Distribuir": expand };
    vehicles.forEach((v) => {
      allState[v] = expand;
    });
    setExpandedRoutes(allState);
  };

  const handleSolveRoutes = async () => {
    if (!selectedProject) return;
    setSolving(true);
    setError(null);
    try {
      const res = await apiRequest("/api/solver/solve", {
        method: "POST",
        body: JSON.stringify({
          project_id: selectedProject.id,
          params: {
            strategy: strategy,
            balance_load: loadMode === "balanced",
            max_route_duration: maxTravelTime,
            respect_time_windows: respectWindows,
            time_limit_seconds: 12,
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
      const alertMsg = pendingCount > 0
        ? `Otimização concluída: ${assignedCount} paragens atribuídas à frota. ${pendingCount} encomendas ficaram na rota "Por Distribuir" para gestão manual.`
        : `Otimização concluída com sucesso: Todas as ${assignedCount} paragens foram distribuídas pelas ${vehicles.length} viaturas.`;

      alert(alertMsg);
      broadcastUpdate(updatedRoutes, vehicles, warehouses);
    } catch (e: any) {
      console.error("Solver error:", e);
      alert(e.message || "Erro ao calcular otimização de rotas.");
    } finally {
      setSolving(false);
    }
  };

  const handleOptimizeAllSequences = async () => {
    if (!selectedProject) return;
    setReorderingAll(true);
    try {
      const res = await apiRequest("/api/solver/optimize-all-sequences", {
        method: "POST",
        body: JSON.stringify({ project_id: selectedProject.id }),
      });
      const updatedRoutes: RouteNode[] = (res.routes || []).map((r: any) => ({
        ...r,
        Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
      }));
      setRoutes(updatedRoutes);
      broadcastUpdate(updatedRoutes, vehicles, warehouses);
      alert("Sequência de todas as rotas otimizada com sucesso!");
    } catch (e: any) {
      alert("Erro ao otimizar sequências: " + (e.message || "Erro desconhecido"));
    } finally {
      setReorderingAll(false);
    }
  };

  const handleOptimizeSingleRoute = async (routeName: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!selectedProject) return;
    setActionLoading(`opt_${routeName}`);
    try {
      const res = await apiRequest("/api/solver/optimize-route", {
        method: "POST",
        body: JSON.stringify({
          project_id: selectedProject.id,
          route_name: routeName,
        }),
      });
      const updatedRoutes: RouteNode[] = (res.routes || []).map((r: any) => ({
        ...r,
        Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
      }));
      setRoutes(updatedRoutes);
      broadcastUpdate(updatedRoutes, vehicles, warehouses);
    } catch (e: any) {
      alert("Erro ao ordenar trajeto: " + (e.message || "Erro desconhecido"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleTransferEntireRoute = async (sourceRoute: string, targetRoute: string) => {
    if (!selectedProject) return;
    const tgtDisplay = isPendingRoute(targetRoute) ? "Por Distribuir" : targetRoute;
    const confirmMsg = isPendingRoute(targetRoute)
      ? `Tem a certeza que deseja esvaziar a rota "${sourceRoute}" e mover todas as paragens para "Por Distribuir"?`
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
      const updated: RouteNode[] = (res.routes || []).map((r: any) => ({
        ...r,
        Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
      }));
      setRoutes(updated);
      broadcastUpdate(updated, vehicles, warehouses);
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
      const updated: RouteNode[] = (res.routes || []).map((r: any) => ({
        ...r,
        Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
      }));
      setRoutes(updated);
      broadcastUpdate(updated, vehicles, warehouses);
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
      const updated: RouteNode[] = (res.routes || []).map((r: any) => ({
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

  const handleDownloadFile = async (endpoint: string, filename: string) => {
    try {
      const token = localStorage.getItem("georoute_token") || localStorage.getItem("token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(endpoint, { headers });
      if (!res.ok) throw new Error("Erro ao descarregar ficheiro.");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e: any) {
      alert(e.message || "Erro ao descarregar");
    }
  };

  const handleExportExcel = () => {
    if (!selectedProject) return;
    const projClean = (selectedProject.nome || `Projeto_${selectedProject.id}`).replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
    const filename = `GeoRoute_Completo_${projClean}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    handleDownloadFile(`/api/solver/export-full/${selectedProject.id}`, filename);
  };

  // Grouped and sorted data structures
  const vehicleMap = useMemo(() => {
    const map: Record<string, VehicleData> = {};
    fleetList.forEach((v) => {
      map[v.veiculo] = v;
    });
    return map;
  }, [fleetList]);

  const warehouseMap = useMemo(() => {
    const map: Record<string, WarehouseData> = {};
    warehouses.forEach((w) => {
      map[w.name] = w;
    });
    return map;
  }, [warehouses]);

  const groupedRoutes = useMemo(() => {
    const groups: Record<string, RouteNode[]> = {};
    routes.forEach((r) => {
      const rKey = isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota;
      if (!groups[rKey]) groups[rKey] = [];
      groups[rKey].push(r);
    });

    Object.keys(groups).forEach((k) => {
      groups[k].sort((a, b) => a.Ordem - b.Ordem);
    });

    return groups;
  }, [routes]);

  const hasPending = useMemo(() => {
    return (groupedRoutes["Por Distribuir"] || []).length > 0;
  }, [groupedRoutes]);

  // Available unique warehouses
  const uniqueWarehouseNames = useMemo(() => {
    const names = new Set<string>();
    warehouses.forEach((w) => names.add(w.name));
    fleetList.forEach((v) => {
      if (v.armazem) names.add(v.armazem);
    });
    return Array.from(names);
  }, [warehouses, fleetList]);

  // Hierarchical sort & filter of route keys
  const displayRouteKeys = useMemo(() => {
    const nonVehicleKeys = Object.keys(groupedRoutes).filter(
      (k) => k !== "Por Distribuir" && !vehicles.includes(k)
    );
    let list = [...vehicles, ...nonVehicleKeys];

    // Filter by Warehouse if selected
    if (selectedWarehouseFilter !== "all") {
      list = list.filter((vName) => {
        const vCfg = vehicleMap[vName];
        const wh = vCfg?.armazem || (vName.includes("_") ? vName.split("_")[0] : "");
        return wh.toLowerCase() === selectedWarehouseFilter.toLowerCase();
      });
    }

    // Filter by Vehicle Status
    if (selectedStatusFilter === "active") {
      list = list.filter((vName) => (groupedRoutes[vName] || []).length > 0);
    } else if (selectedStatusFilter === "empty") {
      list = list.filter((vName) => (groupedRoutes[vName] || []).length === 0);
    } else if (selectedStatusFilter === "late") {
      list = list.filter((vName) => {
        const items = groupedRoutes[vName] || [];
        return items.some((it) => isDeliveryLate(it.Chegada, it.Janela_Horaria));
      });
    }

    // Sort list
    list.sort((a, b) => {
      const cfgA = vehicleMap[a];
      const cfgB = vehicleMap[b];

      const whA = (cfgA?.armazem || (a.includes("_") ? a.split("_")[0] : a) || "").trim().toLowerCase();
      const whB = (cfgB?.armazem || (b.includes("_") ? b.split("_")[0] : b) || "").trim().toLowerCase();
      if (whA !== whB) {
        return whA.localeCompare(whB, undefined, { numeric: true, sensitivity: "base" });
      }

      const stopsA = (groupedRoutes[a] || []).length;
      const stopsB = (groupedRoutes[b] || []).length;
      const isActiveA = stopsA > 0;
      const isActiveB = stopsB > 0;

      if (isActiveA !== isActiveB) return isActiveA ? -1 : 1;
      if (stopsA !== stopsB) return stopsB - stopsA;

      const timeA = cfgA?.horario_inicio || "08:00";
      const timeB = cfgB?.horario_inicio || "08:00";
      if (timeA !== timeB) return timeA.localeCompare(timeB);

      return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    });

    // Handle "Por Distribuir" inclusion based on status filter
    if (selectedStatusFilter === "empty") {
      return list;
    }
    if (selectedStatusFilter === "pending") {
      return hasPending ? ["Por Distribuir"] : [];
    }

    return [...(hasPending ? ["Por Distribuir"] : []), ...list];
  }, [vehicles, groupedRoutes, hasPending, vehicleMap, selectedWarehouseFilter, selectedStatusFilter]);

  // Global KPIs
  const globalKpis = useMemo(() => {
    const pendingStops = groupedRoutes["Por Distribuir"] || [];
    const assignedStops = routes.filter((r) => !isPendingRoute(r.Rota));
    const activeVehicles = vehicles.filter((v) => (groupedRoutes[v] || []).length > 0);
    
    let totalKm = 0.0;
    let totalKg = 0.0;
    let totalVol = 0.0;
    let totalLate = 0;

    assignedStops.forEach((s) => {
      totalKg += s.Peso_KG || 0;
      if (isDeliveryLate(s.Chegada, s.Janela_Horaria)) totalLate++;
    });

    vehicles.forEach((v) => {
      const stops = groupedRoutes[v] || [];
      if (stops.length > 0) {
        const last = stops[stops.length - 1];
        const vCfg = vehicleMap[v];
        const whName = vCfg?.armazem || stops[0].Armazem;
        const wh = warehouseMap[whName] || warehouses[0];
        let returnDist = 0.0;
        if (wh && wh.lat && wh.lon) {
          returnDist = haversineDistance(last.Latitude, last.Longitude, wh.lat, wh.lon);
        }
        totalKm += (last.Dist_Acum || 0) + returnDist;
      }
    });

    const onTimeRate = assignedStops.length > 0
      ? Math.round(((assignedStops.length - totalLate) / assignedStops.length) * 100)
      : 100;

    return {
      totalDeliveries: routes.length,
      assignedCount: assignedStops.length,
      pendingCount: pendingStops.length,
      totalKm: totalKm.toFixed(1),
      totalKg: totalKg.toFixed(0),
      activeVehiclesCount: activeVehicles.length,
      totalVehiclesCount: vehicles.length,
      onTimeRate,
      totalLate,
    };
  }, [routes, groupedRoutes, vehicles, vehicleMap, warehouseMap, warehouses]);

  // Options for reassigning dropdowns
  const reassignOptions = [
    "Por Distribuir",
    ...vehicles,
    ...Object.keys(groupedRoutes).filter((k) => k !== "Por Distribuir" && !vehicles.includes(k)),
  ];

  return (
    <DashboardLayout>
      <div className="space-y-5 pb-12">
        {/* TOP HEADER & ACTION CONTROLS */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 bg-zinc-950/60 p-4 rounded-2xl border border-zinc-800 shadow-xl backdrop-blur-md">
          <div>
            <div className="flex items-center space-x-3">
              <span className="w-3 h-3 rounded-full bg-indigo-500 shadow-md shadow-indigo-500/50" />
              <h1 className="text-2xl font-black tracking-tight text-zinc-50 font-sans">
                Matriz Operacional & Planeamento Tático
              </h1>
            </div>
            <p className="text-zinc-400 text-xs mt-1">
              Gestão a toda a largura das paragens, capacidades de carga, janelas horárias e transferências entre viaturas.
            </p>
          </div>

          <div className="flex items-center flex-wrap gap-2.5">
            {/* 2nd Monitor Fullscreen Map Launcher */}
            <button
              onClick={handleOpenDetachedMap}
              className="cursor-pointer bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl px-4 py-2.5 text-xs font-bold shadow-lg shadow-emerald-500/20 transition-all flex items-center space-x-2 border border-emerald-400/40"
              title="Abrir o Mapa Dedicado numa janela independente para o 2.º Monitor"
            >
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              <span>🖥️ 2.º Monitor — Abrir Mapa Dedicado</span>
            </button>

            {/* Temporary Monitor 3 Link */}
            <button
              onClick={handleOpenRoutesMatrix}
              className="cursor-pointer bg-zinc-900 hover:bg-zinc-850 text-indigo-400 border border-zinc-800 rounded-xl px-3 py-2 text-xs font-semibold transition-all flex items-center space-x-1.5"
              title="Abrir Matriz Flutuante em Janela Extra"
            >
              <span>🖥️ 3.º Monitor</span>
            </button>

            {/* Config Strategy */}
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="cursor-pointer bg-zinc-900 hover:bg-zinc-850 text-zinc-300 border border-zinc-800 rounded-xl px-3 py-2 text-xs font-semibold transition-all flex items-center space-x-1.5"
            >
              <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>{t.tactical.settingsBtn}</span>
            </button>

            {/* Optimize Sequences TSP */}
            <button
              onClick={handleOptimizeAllSequences}
              disabled={reorderingAll || solving || routes.length === 0}
              className="cursor-pointer bg-zinc-900 hover:bg-zinc-850 text-amber-400 border border-amber-500/40 rounded-xl px-3.5 py-2 text-xs font-bold transition-all flex items-center space-x-1.5 disabled:opacity-50"
              title="Ordena o trajeto mais curto de cada viatura sem alterar as encomendas atribuídas"
            >
              <span>{reorderingAll ? "A ordenar..." : `⚡ ${t.tactical.optimizeSequencesBtn}`}</span>
            </button>

            {/* Global Solve VRP */}
            <button
              onClick={handleSolveRoutes}
              disabled={solving || vehicles.length === 0}
              className="cursor-pointer bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl px-4 py-2 text-xs font-bold shadow-md shadow-indigo-500/20 transition-all flex items-center space-x-2 disabled:opacity-50"
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
                  <span>{t.tactical.optimizeRoutesBtn}</span>
                </>
              )}
            </button>

            {/* Export Excel */}
            {routes.length > 0 && (
              <button
                type="button"
                onClick={handleExportExcel}
                className="cursor-pointer bg-zinc-900 hover:bg-zinc-850 text-emerald-400 border border-emerald-600/40 rounded-xl px-3 py-2 text-xs font-bold transition-all flex items-center space-x-1.5"
                title="Exportar Folha Excel Completa"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Exportar Excel</span>
              </button>
            )}
          </div>
        </div>

        {/* SETTINGS DRAWER / DRAWER OVERLAY */}
        {showConfig && (
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5 shadow-2xl space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-sm font-bold text-zinc-100 flex items-center space-x-2">
                <span>⚙️ Configuração dos Algoritmos de Otimização</span>
              </h3>
              <button
                onClick={() => setShowConfig(false)}
                className="text-zinc-400 hover:text-zinc-200 text-xs px-2 py-1 bg-zinc-900 rounded-lg"
              >
                ✕ Fechar
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div
                onClick={() => {
                  setStrategy("distance");
                  setLoadMode("cluster");
                }}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                  strategy === "distance" && loadMode === "cluster"
                    ? "bg-indigo-950/40 border-indigo-500 shadow-md ring-1 ring-indigo-500"
                    : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700"
                }`}
              >
                <p className="font-bold text-zinc-100 mb-1">🎯 Agrupamento por Zonas (Clusters)</p>
                <p className="text-[11px] text-zinc-400">
                  Concentra cada viatura na sua zona geográfica principal para máxima densidade de entrega.
                </p>
              </div>

              <div
                onClick={() => {
                  setStrategy("balanced");
                  setLoadMode("balanced");
                }}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                  strategy === "balanced"
                    ? "bg-indigo-950/40 border-indigo-500 shadow-md ring-1 ring-indigo-500"
                    : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700"
                }`}
              >
                <p className="font-bold text-zinc-100 mb-1">⚖️ Equilíbrio Perfeito de Carga</p>
                <p className="text-[11px] text-zinc-400">
                  Distribui o número de paragens e peso de forma equitativa por todos os carros disponíveis.
                </p>
              </div>

              <div
                onClick={() => {
                  setStrategy("distance");
                  setLoadMode("balanced");
                }}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                  strategy === "distance" && loadMode === "balanced"
                    ? "bg-indigo-950/40 border-indigo-500 shadow-md ring-1 ring-indigo-500"
                    : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700"
                }`}
              >
                <p className="font-bold text-zinc-100 mb-1">⚡ Mínima Quilometragem Total</p>
                <p className="text-[11px] text-zinc-400">
                  Reduz ao máximo a soma total de quilómetros percorridos por toda a frota.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* GLOBAL KPI DASHBOARD CARDS */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
          <div className="bg-zinc-900/70 border border-zinc-800/80 rounded-2xl p-3.5 shadow-md">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
              Total de Paragens
            </span>
            <div className="flex items-baseline space-x-2 mt-1">
              <span className="text-xl font-black text-zinc-100">{globalKpis.totalDeliveries}</span>
              <span className="text-[11px] text-emerald-400 font-semibold">
                ({globalKpis.assignedCount} atribuídas)
              </span>
            </div>
            {globalKpis.pendingCount > 0 && (
              <span className="text-[10px] text-amber-400 font-bold block mt-0.5">
                ⚠️ {globalKpis.pendingCount} por distribuir
              </span>
            )}
          </div>

          <div className="bg-zinc-900/70 border border-zinc-800/80 rounded-2xl p-3.5 shadow-md">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
              Distância Total Prevista
            </span>
            <div className="flex items-baseline space-x-1.5 mt-1">
              <span className="text-xl font-black text-indigo-400">{globalKpis.totalKm}</span>
              <span className="text-xs text-zinc-400 font-bold">km</span>
            </div>
            <span className="text-[10px] text-zinc-400 mt-0.5 block">
              Inclui regresso à base
            </span>
          </div>

          <div className="bg-zinc-900/70 border border-zinc-800/80 rounded-2xl p-3.5 shadow-md">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
              Utilização da Frota
            </span>
            <div className="flex items-baseline space-x-1.5 mt-1">
              <span className="text-xl font-black text-emerald-400">{globalKpis.activeVehiclesCount}</span>
              <span className="text-xs text-zinc-400">/ {globalKpis.totalVehiclesCount} viaturas</span>
            </div>
            <span className="text-[10px] text-zinc-400 mt-0.5 block">
              {globalKpis.totalVehiclesCount - globalKpis.activeVehiclesCount} viaturas livres
            </span>
          </div>

          <div className="bg-zinc-900/70 border border-zinc-800/80 rounded-2xl p-3.5 shadow-md">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
              Carga Global
            </span>
            <div className="flex items-baseline space-x-1.5 mt-1">
              <span className="text-xl font-black text-violet-400">{globalKpis.totalKg}</span>
              <span className="text-xs text-zinc-400 font-bold">kg</span>
            </div>
            <span className="text-[10px] text-zinc-400 mt-0.5 block">
              Distribuída pelas rotas ativas
            </span>
          </div>

          <div className="bg-zinc-900/70 border border-zinc-800/80 rounded-2xl p-3.5 shadow-md">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
              Pontualidade / Janelas
            </span>
            <div className="flex items-baseline space-x-1.5 mt-1">
              <span className={`text-xl font-black ${globalKpis.onTimeRate >= 95 ? "text-emerald-400" : "text-amber-400"}`}>
                {globalKpis.onTimeRate}%
              </span>
              <span className="text-xs text-zinc-400">no horário</span>
            </div>
            {globalKpis.totalLate > 0 ? (
              <span className="text-[10px] text-rose-400 font-bold block mt-0.5">
                🚨 {globalKpis.totalLate} paragens em atraso
              </span>
            ) : (
              <span className="text-[10px] text-emerald-400 block mt-0.5">
                ✓ Sem atrasos previstos
              </span>
            )}
          </div>
        </div>

        {/* ADVANCED FILTER & SEARCH TOOLBAR */}
        <div className="bg-zinc-900/80 border border-zinc-800 p-3.5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center flex-wrap gap-2.5 flex-1">
            {/* Text Search */}
            <div className="relative min-w-[240px] max-w-sm flex-1">
              <input
                type="text"
                placeholder="Pesquisar cliente, código, morada, CP..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-xl px-3.5 py-2 text-xs text-zinc-200 outline-none placeholder-zinc-500 transition-all pl-9"
              />
              <svg className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-zinc-200 text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Warehouse Filter */}
            {uniqueWarehouseNames.length > 0 && (
              <select
                value={selectedWarehouseFilter}
                onChange={(e) => setSelectedWarehouseFilter(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 text-zinc-300 rounded-xl px-3 py-2 text-xs outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="all">🏠 Todos os Armazéns ({uniqueWarehouseNames.length})</option>
                {uniqueWarehouseNames.map((w) => (
                  <option key={w} value={w}>
                    🏠 {w}
                  </option>
                ))}
              </select>
            )}

            {/* Vehicle Status Filter */}
            <div className="flex items-center space-x-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-[11px] font-semibold">
              <button
                onClick={() => setSelectedStatusFilter("all")}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  selectedStatusFilter === "all" ? "bg-indigo-600 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Todos ({vehicles.length})
              </button>
              <button
                onClick={() => setSelectedStatusFilter("active")}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  selectedStatusFilter === "active" ? "bg-emerald-600 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                🚚 Com Carga ({globalKpis.activeVehiclesCount})
              </button>
              <button
                onClick={() => setSelectedStatusFilter("empty")}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  selectedStatusFilter === "empty" ? "bg-zinc-800 text-zinc-200 shadow-sm" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                ⚪ Vazias ({globalKpis.totalVehiclesCount - globalKpis.activeVehiclesCount})
              </button>
              {hasPending && (
                <button
                  onClick={() => setSelectedStatusFilter("pending")}
                  className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                    selectedStatusFilter === "pending" ? "bg-amber-600 text-white shadow-sm" : "text-amber-400 hover:text-amber-300"
                  }`}
                >
                  ⚠️ Por Distribuir ({globalKpis.pendingCount})
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => toggleAllRoutes(true)}
              className="px-2.5 py-1.5 bg-zinc-950 hover:bg-zinc-850 border border-zinc-800 text-zinc-300 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              ▼ Expandir Todos
            </button>
            <button
              onClick={() => toggleAllRoutes(false)}
              className="px-2.5 py-1.5 bg-zinc-950 hover:bg-zinc-850 border border-zinc-800 text-zinc-300 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              ▲ Colapsar Todos
            </button>
          </div>
        </div>

        {/* MAIN FULL-WIDTH ROUTES MATRIX ACCORDION */}
        <div className="space-y-4">
          {displayRouteKeys.length === 0 ? (
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-zinc-800/80 flex items-center justify-center mx-auto text-zinc-500">
                🚚
              </div>
              <h3 className="text-sm font-bold text-zinc-200">Nenhuma rota encontrada</h3>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                Não existem viaturas ou rotas que correspondam aos filtros selecionados.
              </p>
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedWarehouseFilter("all");
                  setSelectedStatusFilter("all");
                }}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-bold cursor-pointer"
              >
                Limpar Todos os Filtros
              </button>
            </div>
          ) : (
            displayRouteKeys.map((routeName) => {
              const isPending = isPendingRoute(routeName);
              const allStops = groupedRoutes[routeName] || [];
              
              // Apply search filter to stops within this vehicle
              const filteredStops = searchQuery.trim() === ""
                ? allStops
                : allStops.filter((s) => {
                    const q = searchQuery.toLowerCase();
                    return (
                      s.Cliente.toLowerCase().includes(q) ||
                      (s.Nome_Cliente && s.Nome_Cliente.toLowerCase().includes(q)) ||
                      s.Morada.toLowerCase().includes(q) ||
                      s.Localidade.toLowerCase().includes(q) ||
                      s.CP.toLowerCase().includes(q)
                    );
                  });

              const isExpanded = !!expandedRoutes[routeName];
              const isEmptyVehicle = !isPending && allStops.length === 0;
              const color = getRouteColor(routeName, vehicles);

              // Vehicle configuration & warehouse
              const vConfig = vehicleMap[routeName];
              const whName = vConfig?.armazem || (allStops.length > 0 ? allStops[0].Armazem : warehouses[0]?.name) || "Armazém Principal";
              const whData = warehouseMap[whName] || warehouses[0] || {
                name: whName,
                address: "Base Central",
                cp: "0000-000",
                locality: "Principal",
                lat: 38.6593,
                lon: -9.1758,
              };

              const startTimeStr = vConfig?.horario_inicio || "08:00";
              const speed = vConfig?.velocidade_media || 50.0;
              const maxKg = vConfig?.capacidade_kg || 1000;
              const maxVol = vConfig?.capacidade_vol || 5.0;

              const totalKg = allStops.reduce((sum, item) => sum + (item.Peso_KG || 0), 0);
              const totalVol = allStops.reduce((sum, item) => sum + (item.Carga_Vol_Acum || 0), 0);
              const kgPct = Math.round((totalKg / maxKg) * 100);
              const volPct = Math.round((totalVol / maxVol) * 100);

              // Return trip calculation
              let returnDist = 0.0;
              let returnArrivalTimeStr = startTimeStr;
              let totalRouteKm = 0.0;

              if (allStops.length > 0) {
                const lastStop = allStops[allStops.length - 1];
                if (whData && whData.lat && whData.lon) {
                  returnDist = haversineDistance(lastStop.Latitude, lastStop.Longitude, whData.lat, whData.lon);
                }
                const returnTravelMin = (returnDist / speed) * 60.0;
                returnArrivalTimeStr = addMinutesToTime(lastStop.Saida || "12:00", returnTravelMin);
                totalRouteKm = (lastStop.Dist_Acum || 0) + returnDist;
              }

              const totalDurationStr = allStops.length > 0 ? calculateDurationString(startTimeStr, returnArrivalTimeStr) : "0h 0m";

              return (
                <div
                  key={routeName}
                  className="bg-zinc-950/80 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl transition-all"
                  style={{ borderLeft: `6px solid ${color}` }}
                >
                  {/* VEHICLE CARD HEADER */}
                  <div className="p-4 bg-zinc-900/80 border-b border-zinc-800/80 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Left: Info */}
                    <div
                      onClick={() => toggleRouteExpand(routeName)}
                      className="flex items-center space-x-3.5 cursor-pointer flex-1 min-w-0"
                    >
                      <span className="w-3.5 h-3.5 rounded-full shrink-0 shadow-md" style={{ backgroundColor: color }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center space-x-2 flex-wrap">
                          <h2 className={`text-base font-black ${isPending ? "text-amber-400" : "text-zinc-100"}`}>
                            {isPending ? "⚠️ Por Distribuir" : routeName}
                          </h2>

                          {!isPending && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 font-semibold border border-zinc-700">
                              🏠 {whData.name}
                            </span>
                          )}

                          {isEmptyVehicle && (
                            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-zinc-800/90 text-zinc-400 rounded-full font-bold border border-zinc-700">
                              Disponível • 0 Paragens
                            </span>
                          )}

                          {isPending && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 font-bold border border-amber-800/60">
                              {allStops.length} Encomendas Pendentes
                            </span>
                          )}
                        </div>

                        {!isPending && !isEmptyVehicle && (
                          <div className="flex items-center space-x-3 text-xs text-zinc-400 mt-1 font-mono flex-wrap">
                            <span className="text-emerald-400 font-bold">
                              🛫 {startTimeStr} ➔ 🏁 {returnArrivalTimeStr} ({totalDurationStr})
                            </span>
                            <span>•</span>
                            <span className="text-zinc-200 font-semibold">{allStops.length} paragens</span>
                            <span>•</span>
                            <span className="text-indigo-300 font-semibold">{totalRouteKm.toFixed(1)} km totais</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Middle: Capacity Bars (if assigned vehicle) */}
                    {!isPending && !isEmptyVehicle && (
                      <div className="flex items-center space-x-4 shrink-0 bg-zinc-950/80 px-4 py-2 rounded-xl border border-zinc-800">
                        {/* Weight capacity */}
                        <div className="w-32">
                          <div className="flex justify-between text-[10px] font-mono mb-1">
                            <span className="text-zinc-400">Peso: {totalKg.toFixed(0)}/{maxKg}kg</span>
                            <span className={`font-bold ${kgPct > 100 ? "text-rose-400" : kgPct > 80 ? "text-amber-400" : "text-emerald-400"}`}>
                              {kgPct}%
                            </span>
                          </div>
                          <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                kgPct > 100 ? "bg-rose-500" : kgPct > 80 ? "bg-amber-500" : "bg-emerald-500"
                              }`}
                              style={{ width: `${Math.min(kgPct, 100)}%` }}
                            />
                          </div>
                        </div>

                        {/* Volume capacity */}
                        <div className="w-32">
                          <div className="flex justify-between text-[10px] font-mono mb-1">
                            <span className="text-zinc-400">Vol: {totalVol.toFixed(1)}/{maxVol}m³</span>
                            <span className={`font-bold ${volPct > 100 ? "text-rose-400" : volPct > 80 ? "text-amber-400" : "text-emerald-400"}`}>
                              {volPct}%
                            </span>
                          </div>
                          <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                volPct > 100 ? "bg-rose-500" : volPct > 80 ? "bg-amber-500" : "bg-emerald-500"
                              }`}
                              style={{ width: `${Math.min(volPct, 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Right: Actions */}
                    <div className="flex items-center space-x-2 shrink-0">
                      {!isPending && allStops.length > 1 && (
                        <button
                          onClick={(e) => handleOptimizeSingleRoute(routeName, e)}
                          disabled={actionLoading === `opt_${routeName}`}
                          className="bg-indigo-950/90 hover:bg-indigo-900 border border-indigo-700/80 text-indigo-300 hover:text-white px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer shadow-sm"
                          title="Ordenar sequência pelo menor trajeto"
                        >
                          <span>{actionLoading === `opt_${routeName}` ? "A ordenar..." : "⚡ Ordenar Trajeto"}</span>
                        </button>
                      )}

                      {allStops.length > 0 && (
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            const tgt = e.target.value;
                            if (!tgt) return;
                            handleTransferEntireRoute(routeName, tgt);
                            e.target.value = "";
                          }}
                          className="bg-zinc-950 hover:bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs rounded-xl px-3 py-1.5 outline-none focus:border-indigo-500 cursor-pointer shadow-sm font-semibold"
                          title="Transferir todas as paragens desta rota em lote"
                        >
                          <option value="" disabled>
                            ⇄ Mover Toda a Rota ({allStops.length})
                          </option>
                          {!isPending && (
                            <option value="Por Distribuir" className="text-amber-400 font-bold bg-zinc-900">
                              📦 Esvaziar para Por Distribuir
                            </option>
                          )}
                          {vehicles
                            .filter((v) => v !== routeName)
                            .map((v) => (
                              <option key={v} value={v} className="bg-zinc-900 text-zinc-200">
                                🚚 Transferir para {v}
                              </option>
                            ))}
                        </select>
                      )}

                      <button
                        onClick={() => toggleRouteExpand(routeName)}
                        className="p-1.5 text-zinc-400 hover:text-zinc-200 bg-zinc-950 rounded-xl border border-zinc-800 cursor-pointer transition-colors"
                        title={isExpanded ? "Colapsar rota" : "Expandir rota"}
                      >
                        <svg
                          className={`w-4 h-4 transform transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* EXPANDED STOPS TABLE */}
                  {isExpanded && (
                    <div className="overflow-x-auto">
                      {filteredStops.length === 0 ? (
                        <div className="p-8 text-center text-zinc-500 text-xs italic">
                          {isEmptyVehicle
                            ? "Viatura disponível e sem paragens atribuídas. Pode transferir encomendas para esta viatura usando os seletores de paragens."
                            : "Nenhuma paragem corresponde à pesquisa efetuada."}
                        </div>
                      ) : (
                        <table className="w-full text-left text-xs border-collapse font-sans">
                          <thead>
                            <tr className="bg-zinc-950/90 border-b border-zinc-800 text-[10px] font-black text-zinc-400 uppercase tracking-wider">
                              <th className="py-2.5 px-3.5 text-center w-16"># Ordem</th>
                              <th className="py-2.5 px-4 min-w-[200px]">Cliente / Código</th>
                              <th className="py-2.5 px-4 min-w-[240px]">Morada & Localidade</th>
                              <th className="py-2.5 px-3 min-w-[110px]">Janela Horária</th>
                              <th className="py-2.5 px-3 min-w-[130px]">Previsão Turno</th>
                              <th className="py-2.5 px-3 min-w-[100px]">Carga (kg)</th>
                              <th className="py-2.5 px-3 min-w-[90px]">Distância</th>
                              <th className="py-2.5 px-4 text-center min-w-[180px]">Mover / Reatribuir</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-850">
                            {/* 1ª LINHA: ARMAZÉM DE ORIGEM (PARTIDA) */}
                            {!isPending && (
                              <tr className="bg-indigo-950/25 border-b border-indigo-800/40 text-indigo-200 font-medium">
                                <td className="py-2.5 px-3.5 text-center">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold bg-indigo-900/90 text-indigo-300 border border-indigo-700/60 shadow-sm">
                                    🛫 Partida
                                  </span>
                                </td>
                                <td className="py-2.5 px-4">
                                  <div className="font-bold text-indigo-300 flex items-center space-x-1.5">
                                    <span>🏠</span>
                                    <span>{whData.name}</span>
                                  </div>
                                  <div className="text-[10px] text-indigo-400/80 font-mono">Armazém de Origem</div>
                                </td>
                                <td className="py-2.5 px-4">
                                  <div className="text-zinc-200 truncate max-w-sm">{whData.address}</div>
                                  <div className="text-[10px] text-zinc-400 font-mono">{whData.cp} {whData.locality}</div>
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  <span className="font-mono text-zinc-400 bg-zinc-900/80 px-2 py-0.5 rounded border border-zinc-800 text-[10px]">
                                    Início Turno
                                  </span>
                                </td>
                                <td className="py-2.5 px-3">
                                  <div className="font-mono text-xs font-bold text-emerald-400">
                                    🛫 {startTimeStr}
                                  </div>
                                  <span className="text-[9px] text-zinc-400 block font-normal">Saída da Base</span>
                                </td>
                                <td className="py-2.5 px-3 font-mono text-zinc-400">
                                  0 kg
                                </td>
                                <td className="py-2.5 px-3 font-mono text-zinc-400">
                                  0.0 km
                                </td>
                                <td className="py-2.5 px-4 text-center text-[10px] text-indigo-300 font-semibold">
                                  Base Central
                                </td>
                              </tr>
                            )}

                            {filteredStops.map((stop, idx) => {
                              const isLate = !isPending && isDeliveryLate(stop.Chegada, stop.Janela_Horaria);
                              const actKey = stop.id ? `${stop.Cliente}_${stop.id}` : stop.Cliente;
                              const isRowLoading = actionLoading === actKey;

                              return (
                                <tr
                                  key={`${stop.Cliente}-${stop.id || idx}`}
                                  className={`hover:bg-zinc-850/40 transition-colors ${
                                    isLate ? "bg-rose-950/20" : ""
                                  }`}
                                >
                                  {/* # Ordem with Reorder Arrows */}
                                  <td className="py-2.5 px-3.5 text-center">
                                    <div className="flex items-center justify-center space-x-1">
                                      <span className="w-6 h-6 rounded-lg bg-zinc-900 border border-zinc-700 flex items-center justify-center font-mono font-bold text-zinc-200 text-xs shadow-inner">
                                        {stop.Ordem}
                                      </span>
                                      {!isPending && (
                                        <div className="flex flex-col">
                                          <button
                                            onClick={() => handleReorder(routeName, stop.Cliente, stop.Ordem, "up", stop.id, stop.Morada)}
                                            disabled={stop.Ordem === 1 || isRowLoading}
                                            className="text-zinc-400 hover:text-indigo-400 disabled:opacity-20 cursor-pointer p-0.5 leading-none text-[10px]"
                                            title="Subir na sequência"
                                          >
                                            ▲
                                          </button>
                                          <button
                                            onClick={() => handleReorder(routeName, stop.Cliente, stop.Ordem, "down", stop.id, stop.Morada)}
                                            disabled={stop.Ordem === allStops.length || isRowLoading}
                                            className="text-zinc-400 hover:text-indigo-400 disabled:opacity-20 cursor-pointer p-0.5 leading-none text-[10px]"
                                            title="Descer na sequência"
                                          >
                                            ▼
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </td>

                                  {/* Cliente / Código */}
                                  <td className="py-2.5 px-4">
                                    <div className="font-bold text-zinc-100">{stop.Nome_Cliente || stop.Cliente}</div>
                                    <div className="text-[10px] text-zinc-400 font-mono">{stop.Cliente}</div>
                                  </td>

                                  {/* Morada & Concelho */}
                                  <td className="py-2.5 px-4">
                                    <div className="text-zinc-200 truncate max-w-sm" title={stop.Morada}>
                                      {stop.Morada}
                                    </div>
                                    <div className="text-[10px] text-zinc-400 flex items-center space-x-1.5 mt-0.5">
                                      <span className="font-mono text-indigo-400">{stop.CP}</span>
                                      <span>•</span>
                                      <span>{stop.Localidade}</span>
                                    </div>
                                  </td>

                                  {/* Janela Horária */}
                                  <td className="py-2.5 px-3">
                                    <span className="font-mono text-zinc-300 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 text-[11px] block text-center">
                                      {stop.Janela_Horaria || "Qualquer"}
                                    </span>
                                  </td>

                                  {/* Previsão Turno & Alerta de Atraso */}
                                  <td className="py-2.5 px-3">
                                    {!isPending ? (
                                      <div>
                                        <div className="font-mono text-xs font-bold text-zinc-100">
                                          {stop.Chegada} ➔ {stop.Saida}
                                        </div>
                                        {isLate ? (
                                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-950 text-rose-400 border border-rose-800 mt-0.5">
                                            🚨 Fora da Janela
                                          </span>
                                        ) : (
                                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800 mt-0.5">
                                            ✓ No Horário
                                          </span>
                                        )}
                                      </div>
                                    ) : (
                                      <span className="text-zinc-500 font-mono text-xs">-- : --</span>
                                    )}
                                  </td>

                                  {/* Carga KG */}
                                  <td className="py-2.5 px-3 font-mono">
                                    <div className="text-zinc-200 font-semibold">{(stop.Peso_KG || 50).toFixed(0)} kg</div>
                                    {!isPending && (
                                      <div className="text-[10px] text-zinc-400">Acum: {stop.Carga_Acum.toFixed(0)} kg</div>
                                    )}
                                  </td>

                                  {/* Distância */}
                                  <td className="py-2.5 px-3 font-mono">
                                    {!isPending ? (
                                      <div>
                                        <div className="text-zinc-200 font-semibold">{(stop.KM_Anterior || 0).toFixed(1)} km</div>
                                        <div className="text-[10px] text-zinc-400">Acum: {(stop.Dist_Acum || 0).toFixed(1)} km</div>
                                      </div>
                                    ) : (
                                      <span className="text-zinc-500 text-xs">--</span>
                                    )}
                                  </td>

                                  {/* Quick Reassign Dropdown */}
                                  <td className="py-2.5 px-4 text-center">
                                    <select
                                      value={isPending ? "Por Distribuir" : routeName}
                                      disabled={isRowLoading}
                                      onChange={(e) => {
                                        const newR = e.target.value;
                                        if (newR === routeName) return;
                                        handleReassign(stop.Cliente, newR, stop.id || stop.ID_Original, stop.Morada);
                                      }}
                                      className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-700 hover:border-indigo-500 text-zinc-200 rounded-xl px-2.5 py-1 text-xs outline-none focus:border-indigo-500 cursor-pointer shadow-sm w-full max-w-[170px]"
                                    >
                                      {reassignOptions.map((opt) => (
                                        <option key={opt} value={opt} className={isPendingRoute(opt) ? "text-amber-400 font-bold" : ""}>
                                          {isPendingRoute(opt) ? "⚠️ Por Distribuir" : `🚚 ${opt}`}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                </tr>
                              );
                            })}

                            {/* ÚLTIMA LINHA: REGRESSO AO ARMAZÉM (CHEGADA) */}
                            {!isPending && allStops.length > 0 && (
                              <tr className="bg-emerald-950/25 border-t border-emerald-800/40 text-emerald-200 font-medium">
                                <td className="py-2.5 px-3.5 text-center">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-900/90 text-emerald-300 border border-emerald-700/60 shadow-sm">
                                    🏁 Regresso
                                  </span>
                                </td>
                                <td className="py-2.5 px-4">
                                  <div className="font-bold text-emerald-300 flex items-center space-x-1.5">
                                    <span>🏠</span>
                                    <span>{whData.name}</span>
                                  </div>
                                  <div className="text-[10px] text-emerald-400/80 font-mono">Regresso ao Armazém</div>
                                </td>
                                <td className="py-2.5 px-4">
                                  <div className="text-zinc-200 truncate max-w-sm">{whData.address}</div>
                                  <div className="text-[10px] text-zinc-400 font-mono">{whData.cp} {whData.locality}</div>
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  <span className="font-mono text-zinc-400 bg-zinc-900/80 px-2 py-0.5 rounded border border-zinc-800 text-[10px]">
                                    Fim Turno
                                  </span>
                                </td>
                                <td className="py-2.5 px-3">
                                  <div className="font-mono text-xs font-bold text-emerald-400">
                                    🏁 {returnArrivalTimeStr}
                                  </div>
                                  <span className="text-[9px] text-zinc-400 block font-normal">
                                    Total: {totalDurationStr}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 font-mono">
                                  <div className="text-zinc-300 font-semibold">{totalKg.toFixed(0)} kg</div>
                                  <div className="text-[9px] text-zinc-400">Total Entregue</div>
                                </td>
                                <td className="py-2.5 px-3 font-mono">
                                  <div className="text-indigo-300 font-semibold">{totalRouteKm.toFixed(1)} km</div>
                                  <div className="text-[9px] text-zinc-400">+{returnDist.toFixed(1)}km regresso</div>
                                </td>
                                <td className="py-2.5 px-4 text-center text-[10px] text-emerald-300 font-semibold">
                                  Fim da Rota
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
