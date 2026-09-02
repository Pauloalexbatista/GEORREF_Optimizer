"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import AuditModal, { ViolationItem } from "@/components/AuditModal";
import { useProjects } from "@/context/ProjectContext";
import { apiRequest } from "@/utils/api";
import { useI18n } from "@/context/I18nContext";

interface RouteNode {
  id?: number;
  ID_Original?: number;
  Doc_ID?: string;
  Codigo_Cliente?: string;
  Rota: string;
  Armazem: string;
  Ordem: number;
  Cliente: string;
  Nome_Cliente?: string;
  Morada: string;
  CP: string;
  Localidade: string;
  Janela_Horaria: string;
  Janela_Inicio?: string;
  Janela_Fim?: string;
  Dist_Km?: number;
  Latitude: number;
  Longitude: number;
  Chegada: string;
  Tempo_Espera?: number;
  Tempo_Entrega: number;
  Saida: string;
  KM_Anterior: number;
  Dist_Acum: number;
  Peso_KG?: number;
  Volume_m3?: number;
  Carga_Acum: number;
  Carga_Vol_Acum: number;
  Telefone?: string;
  Telefone_Cliente?: string;
  Observacoes?: string;
  Vendedor?: string;
  vendedor?: string;
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
  regras?: string;
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

function formatTimeWindow(winStr: string): string {
  if (!winStr || winStr === "Qualquer" || winStr === "--" || winStr === "None") return "Qualquer";
  const cleaned = String(winStr)
    .replace(/\d{4}-\d{2}-\d{2}\s*/g, "")
    .replace(/T/g, " ")
    .replace(/:00(?=\s|$|-)/g, "")
    .trim();
  if (cleaned.includes("-")) {
    const parts = cleaned.split("-").map(p => p.trim().slice(0, 5));
    if (parts[0] && parts[1]) return `${parts[0]} - ${parts[1]}`;
    if (parts[0]) return `${parts[0]} - 23:59`;
  }
  return cleaned.slice(0, 13) || "Qualquer";
}

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
  if (serviceStartTime.startsWith("+1d") || serviceStartTime.startsWith("+2d")) return true;
  const parts = windowStr.split("-");
  if (parts.length < 2) return false;
  const endStr = parts[1].trim().slice(0, 5);
  const [endH, endM] = endStr.split(":").map((x) => parseInt(x, 10) || 0);
  const [startH, startM] = serviceStartTime.replace("+1d", "").replace("+2d", "").trim().split(":").map((x) => parseInt(x, 10) || 0);
  const endMin = endH * 60 + endM;
  let startMin = startH * 60 + startM;
  if (startH < 6 && endH > 12) {
    startMin += 1440;
  }
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
  const [sortField, setSortField] = useState<"name" | "warehouse" | "stops" | "km" | "weight_pct" | "vol_pct" | "time">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleSort = (field: "name" | "warehouse" | "stops" | "km" | "weight_pct" | "vol_pct" | "time") => {
    if (sortField === field) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };
  const [solving, setSolving] = useState(false);
  const [solvingSeconds, setSolvingSeconds] = useState(0);
  const [auditData, setAuditData] = useState<{
    total_violations: number;
    routes_status: Record<string, { is_valid: boolean; violations_count: number; violations: ViolationItem[] }>;
    all_violations: ViolationItem[];
  }>({
    total_violations: 0,
    routes_status: {},
    all_violations: [],
  });
  const [auditModalOpen, setAuditModalOpen] = useState(false);

  useEffect(() => {
    let interval: any = null;
    if (solving) {
      setSolvingSeconds(0);
      interval = setInterval(() => {
        setSolvingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [solving]);
  const [reorderingAll, setReorderingAll] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Accordion state
  const [expandedRoutes, setExpandedRoutes] = useState<Record<string, boolean>>({
    "Por Distribuir": true,
  });

  // Filter & Search states (Bidirectional with Detached Map)
  const [searchQuery, setSearchQuery] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("georoute_active_filters");
        if (stored) return JSON.parse(stored).searchQuery || "";
      } catch (e) {}
    }
    return "";
  });

  const [selectedWarehouseFilter, setSelectedWarehouseFilter] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("georoute_active_filters");
        if (stored) return JSON.parse(stored).selectedWarehouse || "all";
      } catch (e) {}
    }
    return "all";
  });

  const [selectedStatusFilter, setSelectedStatusFilter] = useState<"all" | "active" | "empty" | "pending" | "late">(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("georoute_active_filters");
        if (stored) {
          const st = JSON.parse(stored).statusFilter;
          if (st === "with_cargo") return "active";
          return st || "all";
        }
      } catch (e) {}
    }
    return "all";
  });

  const broadcastFilterSync = (q: string, wh: string, st: string) => {
    try {
      const payload = {
        type: "FILTER_SYNC",
        sender: "TACTICAL_PAGE",
        filters: {
          searchQuery: q,
          selectedWarehouse: wh,
          statusFilter: st === "active" ? "with_cargo" : st,
        },
        timestamp: Date.now(),
      };
      channelRef.current?.postMessage(payload);
      localStorage.setItem("georoute_active_filters", JSON.stringify(payload.filters));
    } catch (e) {}
  };

  // Strategy Config Drawer & Enterprise LNS Depth
  const [showConfig, setShowConfig] = useState(false);
  const [strategy, setStrategy] = useState("clusters");
  const [loadMode, setLoadMode] = useState("full");
  const [solvingDepth, setSolvingDepth] = useState<"fast" | "balanced" | "deep">("balanced");
  const [maxTravelTime, setMaxTravelTime] = useState("12:00");
  const [respectWindows, setRespectWindows] = useState(false);

  const channelRef = useRef<BroadcastChannel | null>(null);
  const lastMutationTimeRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const channel = new BroadcastChannel("georoute_map_sync");
      channelRef.current = channel;

      channel.onmessage = (event) => {
        if (event.data?.type === "MAP_UPDATE" && event.data?.clients) {
          if (event.data.timestamp && event.data.timestamp < lastMutationTimeRef.current) {
            return; // Ignore stale broadcast
          }
          const mapped: RouteNode[] = event.data.clients.map((r: any) => ({
            ...r,
            id: r.id || r.ID_Original,
            ID_Original: r.id || r.ID_Original,
            Doc_ID: r.Doc_ID || r.doc_id || "",
            Codigo_Cliente: r.Codigo_Cliente || r.codigo_cliente || "",
            Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
            Nome_Cliente: r.Nome_Cliente || r.Cliente,
            Telefone: r.Telefone || r.Telefone_Cliente || "",
            Observacoes: r.Observacoes || "",
          }));
          setRoutes(mapped);
        } else if (event.data?.type === "FILTER_SYNC" && event.data?.sender !== "TACTICAL_PAGE") {
          const f = event.data?.filters;
          if (f) {
            if (f.searchQuery !== undefined) setSearchQuery(f.searchQuery);
            if (f.selectedWarehouse !== undefined) setSelectedWarehouseFilter(f.selectedWarehouse);
            if (f.statusFilter !== undefined) {
              setSelectedStatusFilter(f.statusFilter === "with_cargo" ? "active" : f.statusFilter);
            }
          }
        }
      };

      const handleStorage = (e: StorageEvent) => {
        if (e.key === "georoute_map_state" && e.newValue) {
          try {
            const parsed = JSON.parse(e.newValue);
            if (parsed.clients) {
              const mapped: RouteNode[] = parsed.clients.map((r: any) => ({
                ...r,
                id: r.id || r.ID_Original,
                ID_Original: r.id || r.ID_Original,
                Doc_ID: r.Doc_ID || r.doc_id || "",
                Codigo_Cliente: r.Codigo_Cliente || r.codigo_cliente || "",
                Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
                Nome_Cliente: r.Nome_Cliente || r.Cliente,
                Telefone: r.Telefone || r.Telefone_Cliente || "",
                Observacoes: r.Observacoes || "",
              }));
              setRoutes(mapped);
            }
          } catch (err) {}
        } else if (e.key === "georoute_active_filters" && e.newValue) {
          try {
            const f = JSON.parse(e.newValue);
            if (f.searchQuery !== undefined) setSearchQuery(f.searchQuery);
            if (f.selectedWarehouse !== undefined) setSelectedWarehouseFilter(f.selectedWarehouse);
            if (f.statusFilter !== undefined) {
              setSelectedStatusFilter(f.statusFilter === "with_cargo" ? "active" : f.statusFilter);
            }
          } catch (err) {}
        } else if (e.key === "georoute_fleet_saved") {
          // Frota/Armazens foram guardados - recarregar dados do planeamento automaticamente
          loadTacticalData();
        }
      };
      window.addEventListener("storage", handleStorage);

      return () => {
        channel.close();
        window.removeEventListener("storage", handleStorage);
      };
    }
  }, []);

  const broadcastUpdate = (updatedRoutes: RouteNode[], vList: string[], wList: WarehouseData[], fList?: VehicleData[]) => {
    const mappedClients = updatedRoutes.map((r) => ({
      id: r.id || r.ID_Original,
      ID_Original: r.id || r.ID_Original,
      Doc_ID: r.Doc_ID || (r as any).doc_id || "",
      Codigo_Cliente: r.Codigo_Cliente || (r as any).codigo_cliente || "",
      Armazem: r.Armazem,
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
      Peso_KG: r.Peso_KG || 0,
      Volume_m3: r.Volume_m3 || (r as any).Volume_M3 || 0,
      Carga_Acum: r.Carga_Acum,
      Carga_Vol_Acum: r.Carga_Vol_Acum,
      Telefone: r.Telefone || r.Telefone_Cliente || (r as any).telefone || "",
      Observacoes: r.Observacoes || (r as any).observacoes || (r as any).Notas_Motorista || "",
      Notas_Motorista: (r as any).Notas_Motorista || (r as any).notas_motorista || r.Observacoes || (r as any).observacoes || "",
      Vendedor: r.Vendedor || (r as any).vendedor || "",
    }));

    const payload = { type: "MAP_UPDATE", clients: mappedClients, warehouses: wList, vehicles: vList, fleet: fList || fleetList };
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
      if (solveRes.audit) setAuditData(solveRes.audit);

      const initialExp: Record<string, boolean> = { "Por Distribuir": true };
      vList.forEach((v: string) => {
        initialExp[v] = true;
      });
      setExpandedRoutes(initialExp);

      const assignedCount = loadedRoutes.filter((r) => !isPendingRoute(r.Rota)).length;
      setStatusMsg(`Carregadas ${loadedRoutes.length} paragens (${assignedCount} atribuídas, ${vList.length} viaturas).`);
      broadcastUpdate(loadedRoutes, vList, rawWh, rawFleet);
    } catch (e: any) {
      console.error("Failed to load tactical data:", e);
      setError("Erro ao carregar dados táticos. Certifique-se de que a frota e os clientes estão configurados.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedWarehouseFilter("all");
    setSelectedStatusFilter("all");
    setSearchQuery("");
    try {
      localStorage.removeItem("georoute_active_filters");
    } catch (e) {}
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
    const startTimestamp = Date.now();
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
            solving_depth: solvingDepth,
            time_limit_seconds: solvingDepth === "deep" ? 240 : solvingDepth === "fast" ? 30 : 90,
          },
        }),
      });

      const elapsedSec = Math.max(1, Math.round((Date.now() - startTimestamp) / 1000));
      const mins = Math.floor(elapsedSec / 60);
      const secs = elapsedSec % 60;
      const timeDisplay = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

      // Reload fresh fleet, warehouses, vehicles and routes
       // Apply routes directly from solver response (avoids React state race condition)
      const allResRoutes: RouteNode[] = (res.routes || []).map((r: any) => ({
        ...r,
        Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
      }));
      const pendingCount = allResRoutes.filter((r) => isPendingRoute(r.Rota)).length;
      const assignedCount = allResRoutes.length - pendingCount;
      setRoutes(allResRoutes);
      if (res.audit) setAuditData(res.audit);

      // Reload fleet/vehicles without overwriting routes
      const fleetRes2 = await apiRequest(`/api/fleet/${selectedProject.id}`);
      const rawFleet2: VehicleData[] = fleetRes2.fleet || [];
      const vList2 = rawFleet2.map((v: any) => v.veiculo);
      const rawWh2: WarehouseData[] = fleetRes2.warehouses || [];
      setFleetList(rawFleet2);
      setVehicles(vList2);
      setWarehouses(rawWh2);

      // Expand all routes in the accordion
      const expState2: Record<string, boolean> = { "Por Distribuir": true };
      vList2.forEach((v: string) => { expState2[v] = true; });
      setExpandedRoutes(expState2);

      // Broadcast to map with fresh data
      broadcastUpdate(allResRoutes, vList2, rawWh2, rawFleet2);

      const numVehicles = res.vehicles?.length || vList2.length;
      const alertMsg = pendingCount > 0
        ? `Otimização concluída em ${timeDisplay}: ${assignedCount} paragens atribuídas à frota. ${pendingCount} encomendas ficaram na rota "Por Distribuir" para gestão manual.`
        : `Otimização concluída com sucesso em ${timeDisplay}: Todas as ${assignedCount} paragens foram distribuídas pelas ${numVehicles} viaturas.`;

      alert(alertMsg);
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
      broadcastUpdate(updatedRoutes, vehicles, warehouses, fleetList);
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
      const res = await apiRequest("/api/solver/optimize-single-route", {
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
      broadcastUpdate(updatedRoutes, vehicles, warehouses, fleetList);
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


  // Real-time compliance & quality audit calculation
  useEffect(() => {
    if (routes.length === 0) {
      setAuditData({ total_violations: 0, routes_status: {}, all_violations: [] });
      return;
    }

    const allViolations: ViolationItem[] = [];
    const routesStatus: Record<string, { is_valid: boolean; violations_count: number; violations: ViolationItem[] }> = {};
    const uniqueRoutes = Array.from(new Set(routes.map((r) => r.Rota).filter((r) => !isPendingRoute(r))));

    uniqueRoutes.forEach((rName) => {
      const stops = routes.filter((r) => r.Rota === rName).sort((a, b) => a.Ordem - b.Ordem);
      const vConfig = vehicleMap[rName];
      const vRules = (vConfig?.regras || "").trim();
      const vEnd = vConfig?.horario_fim || "18:00";
      const maxKg = vConfig?.capacidade_kg || 1000;
      const maxVol = vConfig?.capacidade_vol || 10.0;
      const rViolations: ViolationItem[] = [];

      let totalKg = 0;
      let totalVol = 0;

      stops.forEach((s) => {
        totalKg += s.Peso_KG || 0;
        totalVol += s.Volume_m3 || 0;

        // 1. Time window late check (tolerância zero)
        if (isDeliveryLate(s.Chegada, s.Janela_Horaria)) {
          const vItem: ViolationItem = {
            type: "time_window",
            severity: "error",
            route: rName,
            client: s.Cliente,
            order: s.Ordem,
            title: `Atraso na Janela (${s.Cliente})`,
            message: `Chegada prevista às ${s.Chegada} na paragem #${s.Ordem}, ultrapassando a janela limite ${s.Janela_Horaria}.`,
          };
          rViolations.push(vItem);
          allViolations.push(vItem);
        }

        // 2. Tag / Rule check
        const cRules = (s.Observacoes || (s as any).Regras || "").trim();
        if (cRules && vRules) {
          const vTags = vRules.split(/[;,]/).map((x: string) => x.trim().toLowerCase());
          const cTags = cRules.split(/[;,]/).map((x: string) => x.trim().toLowerCase());
          const hasCommon = cTags.some((ct: string) => vTags.includes(ct));
          if (!hasCommon) {
            const vItem: ViolationItem = {
              type: "tag_rule",
              severity: "error",
              route: rName,
              client: s.Cliente,
              order: s.Ordem,
              title: `Incompatibilidade de Tag (${s.Cliente})`,
              message: `A viatura '${rName}' (Tag: '${vRules}') não possui a Tag '${cRules}' exigida pelo cliente.`,
            };
            rViolations.push(vItem);
            allViolations.push(vItem);
          }
        }
      });

      // 3. Weight Capacity check
      if (totalKg > maxKg) {
        const vItem: ViolationItem = {
          type: "capacity_kg",
          severity: "error",
          route: rName,
          title: `Excesso de Peso (${rName})`,
          message: `Carga total de ${totalKg.toFixed(1)} kg excede a capacidade de ${maxKg} kg (+${(totalKg - maxKg).toFixed(1)} kg).`,
        };
        rViolations.push(vItem);
        allViolations.push(vItem);
      }

      // 4. Volume Capacity check
      if (totalVol > maxVol) {
        const vItem: ViolationItem = {
          type: "capacity_vol",
          severity: "error",
          route: rName,
          title: `Excesso de Volume (${rName})`,
          message: `Volume total de ${totalVol.toFixed(2)} m³ excede a capacidade de ${maxVol} m³ (+${(totalVol - maxVol).toFixed(2)} m³).`,
        };
        rViolations.push(vItem);
        allViolations.push(vItem);
      }

      // 5. Shift return overtime check (tolerância zero)
      if (stops.length > 0) {
        const lastStop = stops[stops.length - 1];
        const whData = warehouseMap[vConfig?.armazem || ""] || Object.values(warehouseMap)[0];
        let returnDist = 0.0;
        if (whData && whData.lat && whData.lon) {
          returnDist = haversineDistance(lastStop.Latitude, lastStop.Longitude, whData.lat, whData.lon) * 1.28;
        }
        const speed = vConfig?.velocidade_media || 50.0;
        const returnTravelMin = (returnDist / speed) * 60.0;
        const returnArrStr = addMinutesToTime(lastStop.Saida || "12:00", returnTravelMin);

        const [rArrH, rArrM] = returnArrStr.split(":").map(Number);
        const [vEndH, vEndM] = vEnd.split(":").map(Number);
        const returnArrMin = rArrH * 60 + rArrM;
        const vEndMin = vEndH * 60 + vEndM;

        if (returnArrMin > vEndMin) {
          const overtimeMin = returnArrMin - vEndMin;
          const vItem: ViolationItem = {
            type: "shift_overtime",
            severity: "error",
            route: rName,
            title: `Atraso no Fim de Turno (${rName})`,
            message: `A viatura regressa às ${returnArrStr}, ultrapassando o fim de turno das ${vEnd} (${overtimeMin} min de horas extra).`,
          };
          rViolations.push(vItem);
          allViolations.push(vItem);
        }
      }

      routesStatus[rName] = {
        is_valid: rViolations.length === 0,
        violations_count: rViolations.length,
        violations: rViolations,
      };
    });

    setAuditData({
      total_violations: allViolations.length,
      routes_status: routesStatus,
      all_violations: allViolations,
    });
  }, [routes, vehicleMap, warehouseMap]);

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
    if (selectedWarehouseFilter && selectedWarehouseFilter !== "all") {
      const targetWh = selectedWarehouseFilter.toLowerCase().trim();
      list = list.filter((vName) => {
        const vCfg = vehicleMap[vName];
        const stops = groupedRoutes[vName] || [];
        const whFromStop = stops.length > 0 ? (stops[0].Armazem || "") : "";
        const whFromCfg = vCfg?.armazem || "";
        
        if (whFromStop && (whFromStop.toLowerCase().trim() === targetWh || targetWh.includes(whFromStop.toLowerCase()) || whFromStop.toLowerCase().includes(targetWh))) {
          return true;
        }
        if (whFromCfg && (whFromCfg.toLowerCase().trim() === targetWh || targetWh.includes(whFromCfg.toLowerCase()) || whFromCfg.toLowerCase().includes(targetWh))) {
          return true;
        }
        const prefix = vName.includes("_") ? vName.split("_")[0].toLowerCase() : vName.toLowerCase();
        if (targetWh.includes(prefix) || prefix.includes(targetWh)) {
          return true;
        }
        return false;
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

    // Filter by Search Query if present
    if (searchQuery && searchQuery.trim() !== "") {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((vName) => {
        if (vName.toLowerCase().includes(q)) return true;
        const items = groupedRoutes[vName] || [];
        return items.some((s) => {
          return (
            (s.Cliente && s.Cliente.toLowerCase().includes(q)) ||
            (s.Nome_Cliente && s.Nome_Cliente.toLowerCase().includes(q)) ||
            (s.Codigo_Cliente && s.Codigo_Cliente.toLowerCase().includes(q)) ||
            (s.Doc_ID && s.Doc_ID.toLowerCase().includes(q)) ||
            (s.Morada && s.Morada.toLowerCase().includes(q)) ||
            (s.Localidade && s.Localidade.toLowerCase().includes(q)) ||
            (s.CP && s.CP.toLowerCase().includes(q)) ||
            (s.Vendedor && s.Vendedor.toLowerCase().includes(q)) ||
            (s.vendedor && s.vendedor.toLowerCase().includes(q))
          );
        });
      });
    }

    // Sort list with user-selected criteria
    list.sort((a, b) => {
      const cfgA = vehicleMap[a];
      const cfgB = vehicleMap[b];
      const stopsA = groupedRoutes[a] || [];
      const stopsB = groupedRoutes[b] || [];

      const maxKgA = cfgA?.capacidade_kg || 1000;
      const maxKgB = cfgB?.capacidade_kg || 1000;
      const totalKgA = stopsA.length > 0 ? (stopsA[stopsA.length - 1].Carga_Acum || stopsA.reduce((sum, item) => sum + (item.Peso_KG || 0), 0)) : 0;
      const totalKgB = stopsB.length > 0 ? (stopsB[stopsB.length - 1].Carga_Acum || stopsB.reduce((sum, item) => sum + (item.Peso_KG || 0), 0)) : 0;
      const kgPctA = (totalKgA / maxKgA) * 100;
      const kgPctB = (totalKgB / maxKgB) * 100;

      const maxVolA = cfgA?.capacidade_vol || 5.0;
      const maxVolB = cfgB?.capacidade_vol || 5.0;
      const totalVolA = stopsA.length > 0 ? (stopsA[stopsA.length - 1].Carga_Vol_Acum || stopsA.reduce((sum, item) => sum + (item.Volume_m3 || 0.1), 0)) : 0;
      const totalVolB = stopsB.length > 0 ? (stopsB[stopsB.length - 1].Carga_Vol_Acum || stopsB.reduce((sum, item) => sum + (item.Volume_m3 || 0.1), 0)) : 0;
      const volPctA = (totalVolA / maxVolA) * 100;
      const volPctB = (totalVolB / maxVolB) * 100;

      const whA = (cfgA?.armazem || (stopsA.length > 0 ? stopsA[0].Armazem : "") || "").trim();
      const whB = (cfgB?.armazem || (stopsB.length > 0 ? stopsB[0].Armazem : "") || "").trim();

      const kmA = stopsA.length > 0 ? (stopsA[stopsA.length - 1].Dist_Acum || 0) : 0;
      const kmB = stopsB.length > 0 ? (stopsB[stopsB.length - 1].Dist_Acum || 0) : 0;

      const timeA = cfgA?.horario_inicio || "08:00";
      const timeB = cfgB?.horario_inicio || "08:00";

      let comp = 0;
      if (sortField === "name") {
        comp = a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
      } else if (sortField === "warehouse") {
        comp = whA.localeCompare(whB, undefined, { numeric: true, sensitivity: "base" });
      } else if (sortField === "stops") {
        comp = stopsA.length - stopsB.length;
      } else if (sortField === "km") {
        comp = kmA - kmB;
      } else if (sortField === "weight_pct") {
        comp = kgPctA - kgPctB;
      } else if (sortField === "vol_pct") {
        comp = volPctA - volPctB;
      } else if (sortField === "time") {
        comp = timeA.localeCompare(timeB);
      }

      if (comp === 0) {
        comp = a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
      }

      return sortDirection === "asc" ? comp : -comp;
    });

    // Handle "Por Distribuir" inclusion based on status filter
    if (selectedStatusFilter === "empty") {
      return list;
    }
    if (selectedStatusFilter === "pending") {
      return hasPending ? ["Por Distribuir"] : [];
    }

    return [...(hasPending ? ["Por Distribuir"] : []), ...list];
  }, [vehicles, groupedRoutes, hasPending, vehicleMap, selectedWarehouseFilter, selectedStatusFilter, searchQuery]);

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
              <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-zinc-50 font-sans">
                Planeamento
              </h1>
            </div>
            <p className="text-zinc-600 dark:text-zinc-400 text-xs mt-1">
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

            {/* Recarregar Frota/Dados */}
            <button
              onClick={() => loadTacticalData()}
              disabled={loading}
              className="cursor-pointer bg-zinc-900 hover:bg-zinc-800 text-sky-400 border border-sky-500/40 rounded-xl px-3 py-2 text-xs font-bold transition-all flex items-center space-x-1.5 disabled:opacity-50"
              title="Recarregar frota, armazens e dados do planeamento a partir da base de dados"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>{loading ? "A carregar..." : "Recarregar"}</span>
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
                  <span>A Otimizar... ({solvingSeconds}s)</span>
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

            {/* Quality & Audit Status Button */}
            {routes.length > 0 && (
              <button
                type="button"
                onClick={() => setAuditModalOpen(true)}
                className={`cursor-pointer px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 shadow-md border ${
                  auditData.total_violations === 0
                    ? "bg-emerald-950/80 hover:bg-emerald-900 border-emerald-600/60 text-emerald-300 shadow-emerald-900/20"
                    : "bg-rose-950/90 hover:bg-rose-900 border-rose-500 text-rose-200 shadow-rose-900/40 animate-pulse ring-1 ring-rose-500"
                }`}
                title="Relatório de Auditoria de Qualidade & Inconformidades"
              >
                <span className={`w-2 h-2 rounded-full ${auditData.total_violations === 0 ? "bg-emerald-400" : "bg-rose-500 animate-ping"}`} />
                <span>
                  {auditData.total_violations === 0
                    ? "✅ 0 Erros (Conforme)"
                    : `🚨 ${auditData.total_violations} ${auditData.total_violations === 1 ? "Erro" : "Erros"}`}
                </span>
              </button>
            )}

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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">

              {/* Card 1: Agrupadas por Centro de Gravidade */}
              <div
                onClick={() => { setStrategy("clusters"); setLoadMode("full"); }}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  strategy !== "min_km"
                    ? "bg-indigo-950/40 border-indigo-500 shadow-md ring-1 ring-indigo-500"
                    : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700"
                }`}
              >
                <p className="font-bold text-zinc-100 mb-1">ðµ Agrupadas por Centro de Gravidade</p>
                <p className="text-[11px] text-zinc-400">
                  Começa na entrega mais distante e preenche cada viatura com as entregas da mesma zona geográfica (menor dispersão territorial). Ideal para rotas compactas por bairros ou concelhos.
                </p>
              </div>

              {/* Card 2: Mínimos KM */}
              <div
                onClick={() => { setStrategy("min_km"); setLoadMode("full"); }}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  strategy === "min_km"
                    ? "bg-emerald-950/40 border-emerald-500 shadow-md ring-1 ring-emerald-500"
                    : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700"
                }`}
              >
                <p className="font-bold text-zinc-100 mb-1">ð¢ Mínimos KM (Menor Distância Total)</p>
                <p className="text-[11px] text-zinc-400">
                  Começa na entrega mais distante e insere as seguintes com o menor acréscimo de quilómetros à rota. Ideal para reduzir combustível e tempo de condução total.
                </p>
              </div>

            </div>

            {/* Depth / Computation Time Selector */}
            <div className="border-t border-zinc-800 pt-3">
              <label className="text-[11px] font-bold text-zinc-300 block mb-2 uppercase tracking-wider">
                🧠 Profundidade do Cálculo e Metaheurística (LNS - Large Neighborhood Search):
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div
                  onClick={() => setSolvingDepth("fast")}
                  className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center space-x-2.5 ${
                    solvingDepth === "fast"
                      ? "bg-amber-950/40 border-amber-500 text-amber-200 ring-1 ring-amber-500"
                      : "bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                  }`}
                >
                  <span className="text-base">⚡</span>
                  <div>
                    <p className="font-bold text-xs">Modo Rápido (~30 seg)</p>
                    <p className="text-[10px] opacity-80">Heurística rápida para validação e rascunho.</p>
                  </div>
                </div>

                <div
                  onClick={() => setSolvingDepth("balanced")}
                  className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center space-x-2.5 ${
                    solvingDepth === "balanced"
                      ? "bg-indigo-950/40 border-indigo-500 text-indigo-200 ring-1 ring-indigo-500"
                      : "bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                  }`}
                >
                  <span className="text-base">⚖️</span>
                  <div>
                    <p className="font-bold text-xs">Modo Equilibrado (1 a 2 min)</p>
                    <p className="text-[10px] opacity-80">Decomposição Polar + 600 iterações LNS.</p>
                  </div>
                </div>

                <div
                  onClick={() => setSolvingDepth("deep")}
                  className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center space-x-2.5 ${
                    solvingDepth === "deep"
                      ? "bg-emerald-950/40 border-emerald-500 text-emerald-200 ring-1 ring-emerald-500"
                      : "bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                  }`}
                >
                  <span className="text-base">🧠</span>
                  <div>
                    <p className="font-bold text-xs">Produção Profunda (3 a 5 min)</p>
                    <p className="text-[10px] opacity-80">2.500+ iterações LNS para 200+ clientes sem sobreposições.</p>
                  </div>
                </div>
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
                onChange={(e) => { const v = e.target.value; setSearchQuery(v); broadcastFilterSync(v, selectedWarehouseFilter, selectedStatusFilter); }}
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-xl px-3.5 py-2 text-xs text-zinc-200 outline-none placeholder-zinc-500 transition-all pl-9"
              />
              <svg className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(""); broadcastFilterSync("", selectedWarehouseFilter, selectedStatusFilter); }}
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
                onChange={(e) => { const v = e.target.value; setSelectedWarehouseFilter(v); broadcastFilterSync(searchQuery, v, selectedStatusFilter); }}
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
                onClick={() => { setSelectedStatusFilter("all"); broadcastFilterSync(searchQuery, selectedWarehouseFilter, "all"); }}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  selectedStatusFilter === "all" ? "bg-indigo-600 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Todos ({vehicles.length})
              </button>
              <button
                onClick={() => { setSelectedStatusFilter("active"); broadcastFilterSync(searchQuery, selectedWarehouseFilter, "active"); }}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  selectedStatusFilter === "active" ? "bg-emerald-600 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                🚚 Com Carga ({globalKpis.activeVehiclesCount})
              </button>
              <button
                onClick={() => { setSelectedStatusFilter("empty"); broadcastFilterSync(searchQuery, selectedWarehouseFilter, "empty"); }}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  selectedStatusFilter === "empty" ? "bg-zinc-800 text-zinc-200 shadow-sm" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                ⚪ Vazias ({globalKpis.totalVehiclesCount - globalKpis.activeVehiclesCount})
              </button>
              {hasPending && (
                <button
                  onClick={() => { setSelectedStatusFilter("pending"); broadcastFilterSync(searchQuery, selectedWarehouseFilter, "pending"); }}
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

        {/* MAIN FULL-WIDTH ROUTES MATRIX: EXCEL DATA GRID TABLE */}
        <div className="border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-950/90 shadow-2xl">
          {displayRouteKeys.length === 0 ? (
            <div className="p-12 text-center space-y-3">
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
                  try {
                    localStorage.removeItem("georoute_active_filters");
                    broadcastFilterSync("", "all", "all");
                  } catch (e) {}
                }}
                className="inline-flex items-center px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-500/20 transition-all cursor-pointer"
              >
                🔄 Limpar Todos os Filtros & Ver Todas as Rotas
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-zinc-900/90 border-b border-zinc-800 text-zinc-400 font-bold uppercase tracking-wider text-[10px] select-none sticky top-0 z-20">
                    <th className="py-2.5 px-3 w-8 text-center"></th>
                    <th
                      onClick={() => handleSort("name")}
                      className="py-2.5 px-3 cursor-pointer hover:text-zinc-100 hover:bg-zinc-800/60 transition-colors min-w-[170px]"
                    >
                      <div className="flex items-center space-x-1">
                        <span>Rota / Viatura</span>
                        <span className="text-indigo-400">{sortField === "name" ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}</span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort("warehouse")}
                      className="py-2.5 px-3 cursor-pointer hover:text-zinc-100 hover:bg-zinc-800/60 transition-colors min-w-[130px]"
                    >
                      <div className="flex items-center space-x-1">
                        <span>Armazém</span>
                        <span className="text-indigo-400">{sortField === "warehouse" ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}</span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort("time")}
                      className="py-2.5 px-3 cursor-pointer hover:text-zinc-100 hover:bg-zinc-800/60 transition-colors min-w-[150px]"
                    >
                      <div className="flex items-center space-x-1">
                        <span>Horário Previsto</span>
                        <span className="text-indigo-400">{sortField === "time" ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}</span>
                      </div>
                    </th>
                    <th className="py-2.5 px-3 min-w-[80px]">Duração</th>
                    <th
                      onClick={() => handleSort("stops")}
                      className="py-2.5 px-3 text-center cursor-pointer hover:text-zinc-100 hover:bg-zinc-800/60 transition-colors min-w-[90px]"
                    >
                      <div className="flex items-center justify-center space-x-1">
                        <span>Paragens</span>
                        <span className="text-indigo-400">{sortField === "stops" ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}</span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort("km")}
                      className="py-2.5 px-3 text-center cursor-pointer hover:text-zinc-100 hover:bg-zinc-800/60 transition-colors min-w-[90px]"
                    >
                      <div className="flex items-center justify-center space-x-1">
                        <span>Distância</span>
                        <span className="text-indigo-400">{sortField === "km" ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}</span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort("weight_pct")}
                      className="py-2.5 px-3 cursor-pointer hover:text-zinc-100 hover:bg-zinc-800/60 transition-colors min-w-[140px]"
                    >
                      <div className="flex items-center space-x-1">
                        <span>Carga (Peso)</span>
                        <span className="text-indigo-400">{sortField === "weight_pct" ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}</span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort("vol_pct")}
                      className="py-2.5 px-3 cursor-pointer hover:text-zinc-100 hover:bg-zinc-800/60 transition-colors min-w-[140px]"
                    >
                      <div className="flex items-center space-x-1">
                        <span>Volume (m³)</span>
                        <span className="text-indigo-400">{sortField === "vol_pct" ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}</span>
                      </div>
                    </th>
                    <th className="py-2.5 px-3 text-center min-w-[110px]">Estado / Erros</th>
                    <th className="py-2.5 px-3 text-right min-w-[280px]">Ações Rápidas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-850">
                  {displayRouteKeys.map((routeName) => {
                    try {
                      const isPending = isPendingRoute(routeName);
                      const allStops = groupedRoutes[routeName] || [];

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

                      const totalKg = allStops.length > 0
                        ? (allStops[allStops.length - 1].Carga_Acum || allStops.reduce((sum, item) => sum + (item.Peso_KG || 0), 0))
                        : 0;
                      const totalVol = allStops.length > 0
                        ? (allStops[allStops.length - 1].Carga_Vol_Acum || allStops.reduce((sum, item) => sum + (item.Volume_m3 || 0.1), 0))
                        : 0;
                      const kgPct = Math.round((totalKg / maxKg) * 100);
                      const volPct = Math.round((totalVol / maxVol) * 100);

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
                      const routeAudit = auditData?.routes_status?.[routeName];
                      const hasRouteErrors = routeAudit && !routeAudit.is_valid;

                      return (
                        <React.Fragment key={routeName}>
                          {/* MASTER ROUTE ROW (EXCEL DENSE ROW) */}
                          <tr
                            onClick={() => toggleRouteExpand(routeName)}
                            className={`group cursor-pointer transition-colors border-b border-zinc-800/80 ${
                              hasRouteErrors
                                ? "bg-rose-950/20 hover:bg-rose-900/30"
                                : isPending
                                ? "bg-amber-950/20 hover:bg-amber-900/30"
                                : isExpanded
                                ? "bg-zinc-900/80 hover:bg-zinc-850"
                                : "hover:bg-zinc-900/60"
                            }`}
                          >
                            {/* Expand Indicator */}
                            <td className="py-2.5 px-3 text-center text-zinc-400 group-hover:text-zinc-100 font-bold">
                              {isExpanded ? "▼" : "▶"}
                            </td>

                            {/* Rota / Viatura */}
                            <td className="py-2.5 px-3">
                              <div className="flex items-center space-x-2">
                                <span
                                  className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                                  style={{ backgroundColor: color }}
                                />
                                <span className={`font-black text-xs ${isPending ? "text-amber-400" : "text-zinc-100"}`}>
                                  {isPending ? "⚠️ Por Distribuir" : routeName}
                                </span>
                              </div>
                            </td>

                            {/* Armazém */}
                            <td className="py-2.5 px-3">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-zinc-900 text-zinc-300 border border-zinc-700/80">
                                🏠 {whName}
                              </span>
                            </td>

                            {/* Horário */}
                            <td className="py-2.5 px-3 font-mono text-[11px]">
                              {!isPending && !isEmptyVehicle ? (
                                <span className="text-emerald-400 font-bold">
                                  🛫 {startTimeStr} ➔ 🏁 {returnArrivalTimeStr}
                                </span>
                              ) : (
                                <span className="text-zinc-500">--:--</span>
                              )}
                            </td>

                            {/* Duração */}
                            <td className="py-2.5 px-3 font-mono text-[11px] text-zinc-300">
                              {!isPending && !isEmptyVehicle ? totalDurationStr : "--"}
                            </td>

                            {/* Paragens */}
                            <td className="py-2.5 px-3 text-center">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                isPending
                                  ? "bg-amber-900/80 text-amber-300 border border-amber-700/60"
                                  : allStops.length > 0
                                  ? "bg-indigo-950 text-indigo-300 border border-indigo-800/60"
                                  : "bg-zinc-900 text-zinc-500 border border-zinc-800"
                              }`}>
                                {allStops.length}
                              </span>
                            </td>

                            {/* Distância KM */}
                            <td className="py-2.5 px-3 text-center font-mono font-bold text-indigo-300">
                              {!isPending && !isEmptyVehicle ? `${totalRouteKm.toFixed(1)} km` : "--"}
                            </td>

                            {/* Carga Peso */}
                            <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                              {!isPending && !isEmptyVehicle ? (
                                <div className="w-32">
                                  <div className="flex justify-between text-[10px] font-mono mb-0.5">
                                    <span className="text-zinc-400">{totalKg.toFixed(0)}/{maxKg}kg</span>
                                    <span className={`font-bold ${kgPct > 100 ? "text-rose-400" : kgPct > 80 ? "text-amber-400" : "text-emerald-400"}`}>
                                      {kgPct}%
                                    </span>
                                  </div>
                                  <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${
                                        kgPct > 100 ? "bg-rose-500" : kgPct > 80 ? "bg-amber-500" : "bg-emerald-500"
                                      }`}
                                      style={{ width: `${Math.min(kgPct, 100)}%` }}
                                    />
                                  </div>
                                </div>
                              ) : (
                                <span className="text-zinc-600 text-[10px]">--</span>
                              )}
                            </td>

                            {/* Volume */}
                            <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                              {!isPending && !isEmptyVehicle ? (
                                <div className="w-32">
                                  <div className="flex justify-between text-[10px] font-mono mb-0.5">
                                    <span className="text-zinc-400">{totalVol.toFixed(1)}/{maxVol}m³</span>
                                    <span className={`font-bold ${volPct > 100 ? "text-rose-400" : volPct > 80 ? "text-amber-400" : "text-emerald-400"}`}>
                                      {volPct}%
                                    </span>
                                  </div>
                                  <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${
                                        volPct > 100 ? "bg-rose-500" : volPct > 80 ? "bg-amber-500" : "bg-emerald-500"
                                      }`}
                                      style={{ width: `${Math.min(volPct, 100)}%` }}
                                    />
                                  </div>
                                </div>
                              ) : (
                                <span className="text-zinc-600 text-[10px]">--</span>
                              )}
                            </td>

                            {/* Estado / Erros */}
                            <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                              {hasRouteErrors ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setAuditModalOpen(true);
                                  }}
                                  className="text-[10px] px-2 py-0.5 rounded-full font-black bg-rose-600 hover:bg-rose-500 text-white shadow flex items-center justify-center gap-1 cursor-pointer mx-auto animate-pulse"
                                  title="Clique para ver relatório detalhado de erros"
                                >
                                  🚨 {routeAudit.violations_count} {routeAudit.violations_count === 1 ? "Erro" : "Erros"}
                                </button>
                              ) : isPending ? (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 font-bold border border-amber-800/60">
                                  {allStops.length} Pendentes
                                </span>
                              ) : isEmptyVehicle ? (
                                <span className="text-[10px] px-2 py-0.5 bg-zinc-900 text-zinc-400 rounded-full font-bold border border-zinc-800">
                                  Disponível
                                </span>
                              ) : (
                                <span className="text-[10px] px-2 py-0.5 bg-emerald-950 text-emerald-300 rounded-full font-bold border border-emerald-800/60">
                                  Em Rota
                                </span>
                              )}
                            </td>

                            {/* Ações Rápidas */}
                            <td className="py-2 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end space-x-1.5">
                                {!isPending && allStops.length > 1 && (
                                  <button
                                    onClick={(e) => handleOptimizeSingleRoute(routeName, e)}
                                    disabled={actionLoading === `opt_${routeName}`}
                                    className="bg-indigo-950 hover:bg-indigo-900 border border-indigo-700/80 text-indigo-300 hover:text-white px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all flex items-center space-x-1 cursor-pointer shadow-sm"
                                    title="Ordenar sequência pelo menor trajeto"
                                  >
                                    <span>{actionLoading === `opt_${routeName}` ? "A ordenar..." : "⚡ Ordenar"}</span>
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
                                    className="bg-zinc-950 hover:bg-zinc-900 border border-zinc-700 text-zinc-200 text-[11px] rounded-lg px-2 py-1 outline-none focus:border-indigo-500 cursor-pointer font-semibold max-w-[160px]"
                                    title="Transferir todas as paragens desta rota em lote"
                                  >
                                    <option value="" disabled>
                                      ⇄ Mover Rota ({allStops.length})
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
                                          🚚 Para {v}
                                        </option>
                                      ))}
                                  </select>
                                )}

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleRouteExpand(routeName);
                                  }}
                                  className="p-1 text-zinc-400 hover:text-zinc-200 bg-zinc-900 rounded-lg border border-zinc-800 cursor-pointer text-xs"
                                  title={isExpanded ? "Colapsar detalhes" : "Expandir paragens"}
                                >
                                  {isExpanded ? "▲" : "▼"}
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* EXPANDED SUB-TABLE (STOPS / CLIENTS) */}
                          {isExpanded && (
                            <tr className="bg-zinc-950">
                              <td colSpan={11} className="p-3 bg-zinc-950/90 border-b border-zinc-800">
                                <div className="border border-zinc-800/80 rounded-xl overflow-hidden bg-zinc-900/50 shadow-inner">
                                  {allStops.length === 0 ? (
                                    <div className="p-6 text-center text-zinc-500 text-xs">
                                      Nenhuma paragem atribuída a esta viatura. Arraste clientes ou use o seletor para atribuir entregas.
                                    </div>
                                  ) : (
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-left text-xs border-collapse">
                                        <thead>
                                          <tr className="bg-zinc-950 border-b border-zinc-800 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                                            <th className="py-2 px-3 text-center w-16 sticky top-0 bg-zinc-950 z-10"># Ordem</th>
                                            <th className="py-2 px-3 min-w-[180px] sticky top-0 bg-zinc-950 z-10">Doc ID / Cliente</th>
                                            <th className="py-2 px-3 min-w-[220px] sticky top-0 bg-zinc-950 z-10">Morada & Localidade</th>
                                            <th className="py-2 px-2 min-w-[110px] text-center sticky top-0 bg-zinc-950 z-10">Contacto / Vend.</th>
                                            <th className="py-2 px-2 min-w-[100px] text-center sticky top-0 bg-zinc-950 z-10">Janela Horária</th>
                                            <th className="py-2 px-2 min-w-[110px] text-center sticky top-0 bg-zinc-950 z-10">Previsão Chegada</th>
                                            <th className="py-2 px-2 w-[100px] text-center sticky top-0 bg-zinc-950 z-10">Peso / Volume</th>
                                            <th className="py-2 px-2 w-[85px] text-center sticky top-0 bg-zinc-950 z-10">Distância</th>
                                            <th className="py-2 px-3 text-center min-w-[150px] sticky top-0 bg-zinc-950 z-10">Mover / Reatribuir</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-850">
                                          {/* 1ª LINHA: ARMAZÉM DE ORIGEM (PARTIDA) */}
                                          {!isPending && (
                                            <tr className="bg-indigo-950/25 border-b border-indigo-800/40 text-indigo-200 font-medium">
                                              <td className="py-2 px-3 text-center">
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-lg text-[9px] font-bold bg-indigo-900/90 text-indigo-300 border border-indigo-700/60 shadow-sm">
                                                  Partida
                                                </span>
                                              </td>
                                              <td className="py-2 px-3">
                                                <div className="font-bold text-indigo-300">{whData.name}</div>
                                                <div className="text-[9px] text-indigo-400/80 font-mono">Armazém de Origem</div>
                                              </td>
                                              <td className="py-2 px-3">
                                                <div className="text-zinc-200 truncate max-w-xs">{whData.address}</div>
                                                <div className="text-[9px] text-zinc-400 font-mono">{whData.cp} {whData.locality}</div>
                                              </td>
                                              <td className="py-2 px-2 text-center text-zinc-500 text-[10px] font-mono">
                                                --
                                              </td>
                                              <td className="py-2 px-2 text-center">
                                                <span className="font-mono text-zinc-400 bg-zinc-900/80 px-1.5 py-0.5 rounded border border-zinc-800 text-[9px]">
                                                  Início Turno
                                                </span>
                                              </td>
                                              <td className="py-2 px-2 text-center">
                                                <div className="font-mono text-xs font-bold text-emerald-400">
                                                  {startTimeStr}
                                                </div>
                                              </td>
                                              <td className="py-2 px-2 text-center font-mono text-zinc-450">
                                                0 kg / 0 m³
                                              </td>
                                              <td className="py-2 px-2 text-center font-mono text-zinc-450">
                                                0.0 km
                                              </td>
                                              <td className="py-2 px-3 text-center text-[10px] text-indigo-350 font-semibold">
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

                                                {/* Doc ID / Cliente */}
                                                <td className="py-2 px-3">
                                                  <div className="font-bold text-zinc-100">{stop.Doc_ID || stop.Cliente || "S/ Doc"}</div>
                                                  <div className="text-[10px] text-zinc-400 truncate max-w-xs">{stop.Nome_Cliente || stop.Cliente}</div>
                                                </td>

                                                {/* Morada & Localidade */}
                                                <td className="py-2 px-3">
                                                  <div className="text-zinc-200 truncate max-w-xs">{stop.Morada}</div>
                                                  <div className="text-[10px] text-zinc-400 font-mono">{stop.CP} {stop.Localidade}</div>
                                                </td>

                                                {/* Contacto / Vendedor */}
                                                <td className="py-2 px-2 text-center">
                                                  <div className="font-mono text-[10px] text-zinc-300">{stop.Telefone_Cliente || stop.Telefone || "--"}</div>
                                                  <div className="text-[9px] text-zinc-500">{stop.Vendedor || stop.vendedor || "--"}</div>
                                                </td>

                                                {/* Janela Horária */}
                                                <td className="py-2 px-2 text-center">
                                                  <span className="font-mono text-zinc-300 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 text-[10px]">
                                                    {stop.Janela_Horaria || (stop.Janela_Inicio && stop.Janela_Fim ? `${stop.Janela_Inicio}-${stop.Janela_Fim}` : "08:00-19:00")}
                                                  </span>
                                                </td>

                                                {/* Previsão Chegada */}
                                                <td className="py-2 px-2 text-center">
                                                  <div className="flex items-center justify-center space-x-1">
                                                    <span className={`font-mono text-xs font-bold ${
                                                      isLate ? "text-rose-400 bg-rose-950/60 px-1.5 py-0.5 rounded border border-rose-800" : "text-emerald-400"
                                                    }`}>
                                                      {stop.Chegada || "--:--"}
                                                    </span>
                                                    {isLate && <span title="Atraso face à janela do cliente">⚠️</span>}
                                                  </div>
                                                </td>

                                                {/* Peso / Volume */}
                                                <td className="py-2 px-2 text-center font-mono text-zinc-300">
                                                  <div>{stop.Peso_KG || 0} kg</div>
                                                  <div className="text-[9px] text-zinc-500">{(stop.Volume_m3 || 0).toFixed(2)} m³</div>
                                                </td>

                                                {/* Distância */}
                                                <td className="py-2 px-2 text-center font-mono text-indigo-300">
                                                  <div>{(stop.Dist_Km || 0).toFixed(1)} km</div>
                                                  <div className="text-[9px] text-zinc-500">Acum: {(stop.Dist_Acum || 0).toFixed(1)}</div>
                                                </td>

                                                {/* Mover / Reatribuir */}
                                                <td className="py-2 px-3 text-center">
                                                  <select
                                                    value={isPending ? "Por Distribuir" : routeName}
                                                    disabled={isRowLoading}
                                                    onChange={(e) => {
                                                      const tgt = e.target.value;
                                                      if (tgt === routeName) return;
                                                      handleReassign(stop.Cliente, tgt, stop.id, stop.Morada);
                                                    }}
                                                    className="bg-zinc-950 hover:bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-2 py-1 outline-none focus:border-indigo-500 cursor-pointer font-semibold max-w-[150px]"
                                                  >
                                                    <option value="Por Distribuir" className="text-amber-400 font-bold bg-zinc-900">
                                                      ⚠️ Por Distribuir
                                                    </option>
                                                    {vehicles.map((v) => (
                                                      <option key={v} value={v} className="bg-zinc-900 text-zinc-200">
                                                        🚚 {v}
                                                      </option>
                                                    ))}
                                                  </select>
                                                </td>
                                              </tr>
                                            );
                                          })}

                                          {/* ÚLTIMA LINHA: REGRESSO AO ARMAZÉM */}
                                          {!isPending && (
                                            <tr className="bg-emerald-950/20 border-t border-emerald-800/40 text-emerald-200 font-medium">
                                              <td className="py-2 px-3 text-center">
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-lg text-[9px] font-bold bg-emerald-900/90 text-emerald-300 border border-emerald-700/60 shadow-sm">
                                                  Regresso
                                                </span>
                                              </td>
                                              <td className="py-2 px-3">
                                                <div className="font-bold text-emerald-300">{whData.name}</div>
                                                <div className="text-[9px] text-emerald-400/80 font-mono">Regresso ao Armazém</div>
                                              </td>
                                              <td className="py-2 px-3">
                                                <div className="text-zinc-200 truncate max-w-xs">{whData.address}</div>
                                                <div className="text-[9px] text-zinc-400 font-mono">{whData.cp} {whData.locality}</div>
                                              </td>
                                              <td className="py-2 px-2 text-center text-zinc-500 text-[10px] font-mono">
                                                --
                                              </td>
                                              <td className="py-2 px-2 text-center">
                                                <span className="font-mono text-zinc-400 bg-zinc-900/80 px-1.5 py-0.5 rounded border border-zinc-800 text-[9px]">
                                                  Fim Turno
                                                </span>
                                              </td>
                                              <td className="py-2 px-2 text-center">
                                                <div className="font-mono text-xs font-bold text-emerald-400">
                                                  {returnArrivalTimeStr}
                                                </div>
                                              </td>
                                              <td className="py-2 px-2 text-center font-mono text-zinc-450">
                                                --
                                              </td>
                                              <td className="py-2 px-2 text-center font-mono text-zinc-450">
                                                Acum: {totalRouteKm.toFixed(1)} km
                                              </td>
                                              <td className="py-2 px-3 text-center text-[10px] text-emerald-400 font-semibold">
                                                Fim de Turno
                                              </td>
                                            </tr>
                                          )}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    } catch (renderError: any) {
                      console.error("Error rendering route row:", routeName, renderError);
                      return (
                        <tr key={routeName} className="bg-rose-950/40 border border-rose-800">
                          <td colSpan={11} className="p-4 text-xs text-rose-300 font-mono">
                            Erro ao renderizar rota {routeName}: {renderError.message}
                          </td>
                        </tr>
                      );
                    }
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {/* Quality Audit Modal */}
        <AuditModal
          isOpen={auditModalOpen}
          onClose={() => setAuditModalOpen(false)}
          violations={auditData.all_violations}
          onFocusRoute={(rName) => {
            setExpandedRoutes((prev) => ({ ...prev, [rName]: true }));
          }}
        />
      </div>
    </DashboardLayout>
  );
}
