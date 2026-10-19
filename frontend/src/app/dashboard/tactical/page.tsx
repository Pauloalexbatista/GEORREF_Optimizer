"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import AuditModal, { ViolationItem } from "@/components/AuditModal";
import AgentChatDrawer from "@/components/AgentChatDrawer";
import AgentCopilotModal from "@/components/AgentCopilotModal";
import ReoptimizeModal from "@/components/ReoptimizeModal";
import BigPictureModal, { computeBigPictureAnalytics } from "@/components/BigPictureModal";
import CargoLoading3DModal from "@/components/CargoLoading3DModal";
import { normalizeVehicleVolume, normalizeStopVolume } from "@/utils/cargoPacking";

import { useProjects } from "@/context/ProjectContext";
import { apiRequest, api } from "@/utils/api";
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
  Tipo_Operacao?: string;
  Par_ID?: string;
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
  regresso_armazem?: string;
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

export type DeliveryComplianceStatus = "on_time" | "early" | "late";

export interface DeliveryCompliance {
  status: DeliveryComplianceStatus;
  label: string;
  tooltip: string;
  badgeClass: string;
  diffMinutes: number;
}

function getDeliveryWindowCompliance(
  chegadaStr?: string,
  windowStr?: string
): DeliveryCompliance {
  if (!chegadaStr || !windowStr || windowStr === "Qualquer" || windowStr === "--") {
    return {
      status: "on_time",
      label: "Livre",
      tooltip: "Sem restrição de janela horária",
      badgeClass: "text-zinc-300 bg-zinc-900/60 border border-zinc-800",
      diffMinutes: 0,
    };
  }

  if (chegadaStr.startsWith("+1d") || chegadaStr.startsWith("+2d")) {
    return {
      status: "late",
      label: "Atrasado (+1d)",
      tooltip: `Chegada no dia seguinte (${chegadaStr}), fora da janela acordada (${windowStr})`,
      badgeClass: "text-rose-400 bg-rose-950/70 border border-rose-800 shadow-sm",
      diffMinutes: 1440,
    };
  }

  const parts = windowStr.split("-");
  if (parts.length < 2) {
    return {
      status: "on_time",
      label: "OK",
      tooltip: `Horário dentro do previsto`,
      badgeClass: "text-zinc-300 bg-zinc-900/60 border border-zinc-800",
      diffMinutes: 0,
    };
  }

  const parseMins = (t: string) => {
    const clean = t.replace("+1d", "").replace("+2d", "").trim().slice(0, 5);
    const [h, m] = clean.split(":").map((x) => parseInt(x, 10) || 0);
    return h * 60 + m;
  };

  const winStartMin = parseMins(parts[0]);
  const winEndMin = parseMins(parts[1]);
  const arrMin = parseMins(chegadaStr);

  if (arrMin < winStartMin - 15) {
    const earlyMin = winStartMin - arrMin;
    const earlyH = Math.floor(earlyMin / 60);
    const earlyRem = earlyMin % 60;
    const diffStr = earlyH > 0 ? `${earlyH}h${earlyRem > 0 ? `${earlyRem}m` : ""}` : `${earlyRem}m`;
    return {
      status: "early",
      label: `Adiantado (${parts[0].trim()})`,
      tooltip: `Chegada ${diffStr} antes da abertura do cliente (Abre às ${parts[0].trim()})`,
      badgeClass: "text-amber-400 bg-amber-950/70 border border-amber-800 shadow-sm",
      diffMinutes: -earlyMin,
    };
  }

  if (arrMin > winEndMin) {
    const lateMin = arrMin - winEndMin;
    const lateH = Math.floor(lateMin / 60);
    const lateRem = lateMin % 60;
    const diffStr = lateH > 0 ? `${lateH}h${lateRem > 0 ? `${lateRem}m` : ""}` : `${lateRem}m`;
    return {
      status: "late",
      label: `Atrasado (${parts[1].trim()})`,
      tooltip: `Chegada ${diffStr} após o fecho do cliente (Fechou às ${parts[1].trim()})`,
      badgeClass: "text-rose-400 bg-rose-950/70 border border-rose-800 shadow-sm",
      diffMinutes: lateMin,
    };
  }

  return {
    status: "on_time",
    label: "Pontual",
    tooltip: `Chegada dentro da janela horária acordada (${windowStr})`,
    badgeClass: "text-emerald-400 bg-emerald-950/40 border border-emerald-800/60",
    diffMinutes: 0,
  };
}

function isDeliveryLate(serviceStartTime: string, windowStr: string): boolean {
  return getDeliveryWindowCompliance(serviceStartTime, windowStr).status !== "on_time";
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

function renderOperationTypeBadge(opType?: string, parId?: string) {
  const norm = (opType || "D").trim();
  switch (norm) {
    case "P":
      return (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 shadow-sm"
          title="Recolha de Sucata / Retoma (P) - Carrega no cliente para entregar no armazém"
        >
          ♻️ <span className="font-mono">P</span>
        </span>
      );
    case "From":
      return (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30 shadow-sm"
          title={`Levantamento em Loja (From)${parId ? ` - Par Casado: ${parId}` : ""}`}
        >
          🏪⤴️ <span className="font-mono">From</span>
          {parId && <span className="text-[8px] opacity-75 font-mono">#{parId.slice(-4)}</span>}
        </span>
      );
    case "To":
      return (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm"
          title={`Entrega de Loja (To)${parId ? ` - Par Casado: ${parId}` : ""}`}
        >
          🏠⤵️ <span className="font-mono">To</span>
          {parId && <span className="text-[8px] opacity-75 font-mono">#{parId.slice(-4)}</span>}
        </span>
      );
    case "D":
    default:
      return (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30 shadow-sm"
          title="Entrega Normal (D) - Sai do armazém e descarrega no cliente"
        >
          📦 <span className="font-mono">D</span>
        </span>
      );
  }
}

function extractTags(raw: string): string[] {
  if (!raw) return [];
  const bracketed = raw.match(/\[([^\]]+)\]/g);
  if (bracketed && bracketed.length > 0) {
    const res: string[] = [];
    bracketed.forEach((b) => {
      const inner = b.slice(1, -1).trim();
      inner.split(/[,;|\s]+/).forEach((t) => {
        if (t.trim()) res.push(t.trim().toUpperCase());
      });
    });
    return res;
  }
  return raw.split(/[,;|]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
}

function isVehicleCompatibleFrontend(vRulesStr: string, cRulesStr: string, rulesMatrix: any[]): boolean {
  if (!rulesMatrix || rulesMatrix.length === 0) return true;
  const cTags = extractTags(cRulesStr);
  if (cTags.length === 0) return true;
  const vTags = extractTags(vRulesStr);

  const prohibitions = new Set<string>();
  const permissions = new Set<string>();
  const configuredDeliveryTags = new Set<string>();

  rulesMatrix.forEach((r) => {
    const tv = String(r.Tag_Veiculo || r.tag_veiculo || "").trim().toUpperCase();
    const perm = String(r.Permissao || r.permissao || "SIM").trim().toUpperCase();
    const td = String(r.Tag_Entrega || r.tag_entrega || "").trim().toUpperCase();
    if (!tv || !td) return;

    configuredDeliveryTags.add(td);
    if (["NAO", "NÃO", "NO", "PROIBIR", "FALSE", "0"].includes(perm)) {
      prohibitions.add(`${tv}|${td}`);
    } else {
      permissions.add(`${tv}|${td}`);
    }
  });

  // 1. Proibições Rígidas (NAO)
  for (const vt of vTags) {
    for (const dt of cTags) {
      if (prohibitions.has(`${vt}|${dt}`)) return false;
    }
  }

  // 2. Obrigatoriedades para tags configuradas na matriz de regras
  for (const dt of cTags) {
    if (!configuredDeliveryTags.has(dt)) continue;
    let matched = vTags.includes(dt);
    if (!matched) {
      for (const vt of vTags) {
        if (permissions.has(`${vt}|${dt}`)) {
          matched = true;
          break;
        }
      }
    }
    if (!matched) return false;
  }

  return true;
}

export default function TacticalPage() {
  const { t } = useI18n();
  const { selectedProject } = useProjects();
  const [routes, setRoutes] = useState<RouteNode[]>([]);
  const [vehicles, setVehicles] = useState<string[]>([]);
  const [fleetList, setFleetList] = useState<VehicleData[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseData[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [rulesMatrix, setRulesMatrix] = useState<any[]>([]);
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
    routes_status: Record<string, { is_valid: boolean; errors_count?: number; warnings_count?: number; violations_count: number; violations: ViolationItem[] }>;
    all_violations: ViolationItem[];
  }>({
    total_violations: 0,
    routes_status: {},
    all_violations: [],
  });
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [copilotModalOpen, setCopilotModalOpen] = useState(false);
  const [selectedRouteNames, setSelectedRouteNames] = useState<string[]>([]);
  const [reoptimizeModalOpen, setReoptimizeModalOpen] = useState(false);
  const [bigPictureModalOpen, setBigPictureModalOpen] = useState(false);
  const [selectedBigPictureZone, setSelectedBigPictureZone] = useState<string>("all");
  const [cargoLoadingModalOpen, setCargoLoadingModalOpen] = useState(false);
  const [selectedCargoRouteIdx, setSelectedCargoRouteIdx] = useState(0);
  const [draggedStopKey, setDraggedStopKey] = useState<string | null>(null);
  const [dragOverStopKey, setDragOverStopKey] = useState<string | null>(null);
  const [appAlert, setAppAlert] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: "success" | "warning" | "error" | "info";
  } | null>(null);

  const showAlert = (title: string, message: string, type: "success" | "warning" | "error" | "info" = "info") => {
    setAppAlert({ isOpen: true, title, message, type });
  };

  const toggleRouteSelection = (routeName: string) => {
    setSelectedRouteNames((prev) =>
      prev.includes(routeName) ? prev.filter((r) => r !== routeName) : [...prev, routeName]
    );
  };

  const handleReoptimizeSelected = async (options: {
    selectedRoutes?: string[];
    objective: "distance" | "group";
    balanceRoutes: boolean;
    respectTimeWindows: boolean;
  }) => {
    const projId = selectedProject?.id || parseInt(localStorage.getItem("georoute_selected_project_id") || "0", 10);
    const targetRoutes = options.selectedRoutes && options.selectedRoutes.length > 0 
      ? options.selectedRoutes 
      : selectedRouteNames;

    if (!projId) {
      showAlert("Aviso", "Nenhum projeto ativo selecionado. Por favor recarregue a página.", "warning");
      return;
    }
    if (!targetRoutes || targetRoutes.length === 0) {
      showAlert("Aviso", "Selecione pelo menos 2 rotas para re-otimizar.", "warning");
      return;
    }

    setActionLoading("reoptimizing_subset");
    setStatusMsg("A re-otimizar rotas selecionadas via OR-Tools...");

    try {
      const res = await apiRequest("/api/solver/reoptimize-selected-routes", {
        method: "POST",
        body: JSON.stringify({
          project_id: projId,
          selected_routes: targetRoutes,
          objective: options.objective,
          balance_routes: options.balanceRoutes,
          respect_time_windows: options.respectTimeWindows,
        }),
      });
      if (res && res.routes) {
        setRoutes(res.routes);
        if (res.quality_metrics) {
          setAuditData(res.quality_metrics);
        }
        broadcastUpdate(res.routes, vehicles, warehouses, fleetList);
        setStatusMsg(res.message || "Rotas re-otimizadas com sucesso!");
        setTimeout(() => setStatusMsg(""), 5000);
        setSelectedRouteNames([]);
      } else {
        showAlert("Erro", "O solver não devolveu rotas atualizadas.", "error");
      }
    } catch (err: any) {
      showAlert("Erro", "Erro ao re-otimizar rotas selecionadas: " + (err.message || "Erro desconhecido"), "error");
      throw err;
    } finally {
      setActionLoading(null);
    }
  };

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

  // Auto-dismiss do statusMsg após 3.5 segundos para não ficar permanentemente no ecrã
  useEffect(() => {
    if (!statusMsg) return;
    const timer = setTimeout(() => {
      setStatusMsg("");
    }, 3500);
    return () => clearTimeout(timer);
  }, [statusMsg]);

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
          return st || "active";
        }
      } catch (e) {}
    }
    return "active";
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
  const [respectWindows, setRespectWindows] = useState(true);

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

    const payload = {
      type: "MAP_UPDATE",
      clients: mappedClients,
      warehouses: wList,
      vehicles: vList,
      fleet: fList || fleetList,
      rulesMatrix: rulesMatrix || [],
    };
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
      setRulesMatrix(fleetRes.rules_matrix || []);

      const delivRes = await apiRequest(`/api/geocoding/${selectedProject.id}`);
      setDeliveries(delivRes || []);

      const solveRes = await apiRequest(`/api/solver/${selectedProject.id}`);
      const loadedRoutes: RouteNode[] = (solveRes.routes || []).map((r: any) => ({
        ...r,
        Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
      }));
      setRoutes(loadedRoutes);
      if (solveRes.audit) setAuditData(solveRes.audit);

      const initialExp: Record<string, boolean> = { "Por Distribuir": false };
      vList.forEach((v: string) => {
        initialExp[v] = false;
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
    setSelectedStatusFilter("active");
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

  const handleSolveRoutes = async (overrideParams?: Record<string, any>, modeLabel?: string) => {
    if (!selectedProject) return;
    setSolving(true);
    setError(null);
    const startTimestamp = Date.now();
    try {
      const baseParams = {
        strategy: strategy,
        balance_load: loadMode === "balanced",
        max_route_duration: maxTravelTime,
        respect_time_windows: respectWindows,
        solving_depth: solvingDepth,
        time_limit_seconds: solvingDepth === "deep" ? 240 : solvingDepth === "fast" ? 30 : 90,
      };
      const mergedParams = overrideParams && typeof overrideParams === "object" && !("nativeEvent" in overrideParams)
        ? { ...baseParams, ...overrideParams }
        : baseParams;

      const res = await apiRequest("/api/solver/solve", {
        method: "POST",
        body: JSON.stringify({
          project_id: selectedProject.id,
          params: mergedParams,
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
      setRulesMatrix(fleetRes2.rules_matrix || []);

      // Default routes to collapsed in the accordion
      const expState2: Record<string, boolean> = { "Por Distribuir": false };
      vList2.forEach((v: string) => { expState2[v] = false; });
      setExpandedRoutes(expState2);

      // Broadcast to map with fresh data
      broadcastUpdate(allResRoutes, vList2, rawWh2, rawFleet2);

      const numVehicles = res.vehicles?.length || vList2.length;
      const alertMsg = pendingCount > 0
        ? `Otimização concluída em ${timeDisplay}: ${assignedCount} paragens atribuídas à frota. ${pendingCount} encomendas ficaram na rota "Por Distribuir" para gestão manual.`
        : `Otimização concluída com sucesso em ${timeDisplay}: Todas as ${assignedCount} paragens foram distribuídas pelas ${numVehicles} viaturas.`;

      showAlert("Otimização Concluída", alertMsg, pendingCount > 0 ? "warning" : "success");
    } catch (e: any) {
      console.error("Solver error:", e);
      showAlert("Erro", e.message || "Erro ao calcular otimização de rotas.", "error");
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
      showAlert("Sucesso", "Sequência de todas as rotas otimizada com sucesso!", "success");
    } catch (e: any) {
      showAlert("Erro", "Erro ao otimizar sequências: " + (e.message || "Erro desconhecido"), "error");
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
      showAlert("Erro", "Erro ao ordenar trajeto: " + (e.message || "Erro desconhecido"), "error");
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
      showAlert("Erro", "Erro ao transferir rota: " + (err.message || "Erro"), "error");
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
      showAlert("Erro", "Erro ao reatribuir: " + (err.message || "Erro"), "error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReorder = async (
    routeName: string,
    clientCode: string,
    currentOrTargetOrder: number,
    directionOrExact: "up" | "down" | "exact",
    deliveryId?: number,
    address?: string
  ) => {
    if (!selectedProject) return;
    let newOrder = currentOrTargetOrder;
    if (directionOrExact === "up") newOrder = currentOrTargetOrder - 1;
    else if (directionOrExact === "down") newOrder = currentOrTargetOrder + 1;
    if (newOrder < 1) return;

    const actKey = deliveryId ? `${clientCode}_${deliveryId}` : clientCode;
    setActionLoading(actKey);

    // Optimistic UI local swap
    const prevRoutes = [...routes];
    const routeStops = routes
      .filter((r) => r.Rota === routeName)
      .sort((a, b) => (Number(a.Ordem) || 0) - (Number(b.Ordem) || 0));

    const stopIdx = routeStops.findIndex(
      (s) =>
        (deliveryId !== undefined && (s.id === deliveryId || s.ID_Original === deliveryId)) ||
        (clientCode && (s.Cliente === clientCode || s.Nome_Cliente === clientCode))
    );

    if (stopIdx !== -1) {
      const targetIdx = Math.max(0, Math.min(routeStops.length - 1, newOrder - 1));
      if (stopIdx !== targetIdx) {
        const reordered = [...routeStops];
        const [moved] = reordered.splice(stopIdx, 1);
        reordered.splice(targetIdx, 0, moved);
        const reindexed = reordered.map((s, idx) => ({ ...s, Ordem: idx + 1 }));
        const otherRoutes = routes.filter((r) => r.Rota !== routeName);
        const optimistic = [...otherRoutes, ...reindexed];
        setRoutes(optimistic);
        broadcastUpdate(optimistic, vehicles, warehouses);
      }
    }

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
      setRoutes(prevRoutes);
      broadcastUpdate(prevRoutes, vehicles, warehouses);
      showAlert("Erro", "Erro ao reordenar: " + (err.message || "Erro"), "error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDownloadFile = async (endpoint: string, filename: string) => {
    try {
      await api.download(endpoint, filename);
    } catch (e: any) {
      showAlert("Erro", e.message || "Erro ao descarregar", "error");
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

  // Rotas estruturadas para o Simulador de Carregamento 3D da Viatura (LIFO & Gravidade)
  const cargo3DRoutes = useMemo(() => {
    return Object.entries(groupedRoutes)
      .filter(([rKey, stops]) => !isPendingRoute(rKey) && stops.length > 0)
      .map(([rKey, stops]) => {
        const vCfg = vehicleMap[rKey];
        return {
          vehicle: rKey,
          veiculo: rKey,
          max_volume: normalizeVehicleVolume(vCfg?.capacidade_vol || 14),
          max_weight: vCfg?.capacidade_kg || 1500,
          stops: stops.map((s, idx) => {
            const anyS = s as any;
            const rawVol = Number(s.Volume_m3 || anyS.volume_m3 || anyS.volume || 0);
            const cleanVol = normalizeStopVolume(rawVol);
            const rawWeight = Number(s.Peso_KG || anyS.peso_kg || anyS.peso || 0);
            const cleanWeight = rawWeight > 0 ? rawWeight : 15;
            const rawPackages = Number(anyS.Volumes || anyS.bultos || anyS.volumes || 0);
            const cleanPackages = rawPackages > 0 && rawPackages <= 20
              ? rawPackages
              : Math.max(1, Math.min(10, Math.round(cleanVol / 0.08) || 1));

            return {
              id: (s as any).id || s.ID_Original || idx,
              client_name: s.Nome_Cliente || (s as any).Cliente || `Cliente ${s.Ordem || idx + 1}`,
              address: `${s.Morada || ""} ${s.CP || ""} ${s.Localidade || ""}`.trim(),
              seq: s.Ordem || idx + 1,
              weight: cleanWeight,
              volume: cleanVol,
              packages: cleanPackages,
            };
          }),
        };
      });
  }, [groupedRoutes, vehicleMap]);


  // Real-time compliance & quality audit calculation
  useEffect(() => {
    if (routes.length === 0) {
      setAuditData({ total_violations: 0, routes_status: {}, all_violations: [] });
      return;
    }

    const allViolations: ViolationItem[] = [];
    const routesStatus: Record<string, { is_valid: boolean; errors_count?: number; warnings_count?: number; violations_count: number; violations: ViolationItem[] }> = {};
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

        // 1. Time window compliance check (tolerância zero)
        const compliance = getDeliveryWindowCompliance(s.Chegada, s.Janela_Horaria);
        if (compliance.status === "late") {
          const vItem: ViolationItem = {
            type: "time_window",
            severity: "error",
            route: rName,
            client: s.Cliente,
            order: s.Ordem,
            title: `Atraso na Janela (${s.Cliente})`,
            message: `Chegada prevista às ${s.Chegada} na paragem #${s.Ordem}, ultrapassando o fecho da janela ${s.Janela_Horaria}.`,
          };
          rViolations.push(vItem);
          allViolations.push(vItem);
        } else if (compliance.status === "early") {
          const vItem: ViolationItem = {
            type: "time_window",
            severity: "warning",
            route: rName,
            client: s.Cliente,
            order: s.Ordem,
            title: `Chegada Prematura (${s.Cliente})`,
            message: `Chegada prevista às ${s.Chegada} na paragem #${s.Ordem}, antes da abertura da janela ${s.Janela_Horaria}.`,
          };
          rViolations.push(vItem);
          allViolations.push(vItem);
        }

        // 2. Tag / Rule check (Apenas se existirem regras configuradas na Matriz de Regras)
        if (rulesMatrix && rulesMatrix.length > 0) {
          const cRules = ((s as any).Regras || "").trim();
          if (cRules && !isVehicleCompatibleFrontend(vRules, cRules, rulesMatrix)) {
            const vItem: ViolationItem = {
              type: "tag_rule",
              severity: "error",
              route: rName,
              client: s.Cliente,
              order: s.Ordem,
              title: `Incompatibilidade de Regra/Tag (${s.Cliente})`,
              message: `A viatura '${rName}' (Tag: '${vRules || "Geral"}') não possui autorização para a Tag '${cRules}' exigida pela entrega.`,
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
        const returnsToDepot = !["não", "nao", "false", "0", "no"].includes(String(vConfig?.regresso_armazem || "Sim").trim().toLowerCase());
        let returnArrStr = lastStop.Saida || lastStop.Chegada || "12:00";

        if (returnsToDepot) {
          const whData = warehouseMap[vConfig?.armazem || ""] || Object.values(warehouseMap)[0];
          let returnDist = 0.0;
          if (whData && whData.lat && whData.lon) {
            returnDist = haversineDistance(lastStop.Latitude, lastStop.Longitude, whData.lat, whData.lon) * 1.28;
          }
          const speed = vConfig?.velocidade_media || 50.0;
          const returnTravelMin = (returnDist / speed) * 60.0;
          returnArrStr = addMinutesToTime(lastStop.Saida || "12:00", returnTravelMin);
        }

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
            message: returnsToDepot
              ? `A viatura regressa às ${returnArrStr}, ultrapassando o fim de turno das ${vEnd} (${overtimeMin} min de horas extra).`
              : `A viatura conclui a última entrega às ${returnArrStr}, ultrapassando o fim de turno das ${vEnd} (${overtimeMin} min de horas extra).`,
          };
          rViolations.push(vItem);
          allViolations.push(vItem);
        }
      }

      const errors = rViolations.filter((v) => v.severity === "error");
      const warnings = rViolations.filter((v) => v.severity === "warning");

      routesStatus[rName] = {
        is_valid: errors.length === 0,
        errors_count: errors.length,
        warnings_count: warnings.length,
        violations_count: rViolations.length,
        violations: rViolations,
      };
    });

    setAuditData({
      total_violations: allViolations.length,
      routes_status: routesStatus,
      all_violations: allViolations,
    });
  }, [routes, vehicleMap, warehouseMap, rulesMatrix]);

  const hasPending = useMemo(() => {
    return (groupedRoutes["Por Distribuir"] || []).length > 0;
  }, [groupedRoutes]);

  // Available unique warehouses (Apenas os armazéns que têm carga/rotas atribuídas por defeito)
  const uniqueWarehouseNames = useMemo(() => {
    const names = new Set<string>();
    routes.forEach((r) => {
      if (r.Armazem && !isPendingRoute(r.Rota)) {
        names.add(r.Armazem.trim());
      }
    });
    Object.entries(groupedRoutes).forEach(([vName, stops]) => {
      if (stops.length > 0 && !isPendingRoute(vName)) {
        const vCfg = vehicleMap[vName];
        if (vCfg?.armazem) names.add(vCfg.armazem.trim());
      }
    });
    // Fallback se ainda não existirem rotas atribuídas
    if (names.size === 0) {
      warehouses.forEach((w) => names.add(w.name));
      fleetList.forEach((v) => {
        if (v.armazem) names.add(v.armazem);
      });
    }
    return Array.from(names);
  }, [routes, groupedRoutes, vehicleMap, warehouses, fleetList]);

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
      const totalKgA = stopsA.reduce((sum, item) => sum + (Number(item.Peso_KG) || 0), 0);
      const totalKgB = stopsB.reduce((sum, item) => sum + (Number(item.Peso_KG) || 0), 0);
      const kgPctA = (totalKgA / maxKgA) * 100;
      const kgPctB = (totalKgB / maxKgB) * 100;

      const maxVolA = cfgA?.capacidade_vol || 5.0;
      const maxVolB = cfgB?.capacidade_vol || 5.0;
      const totalVolA = stopsA.reduce((sum, item) => sum + (Number(item.Volume_m3) || 0), 0);
      const totalVolB = stopsB.reduce((sum, item) => sum + (Number(item.Volume_m3) || 0), 0);
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

  // Diagnóstico Executivo The Big Picture (Balanço Temporal AM/PM/Noite e Carga Física)
  const bigPictureAnalytics = useMemo(() => {
    const vList = vehicles.map((v) => ({
      veiculo: v,
      armazem: vehicleMap[v]?.armazem,
      capacidade_kg: vehicleMap[v]?.capacidade_kg,
      capacidade_vol: vehicleMap[v]?.capacidade_vol,
      horario_inicio: vehicleMap[v]?.horario_inicio,
      horario_fim: vehicleMap[v]?.horario_fim,
    }));
    return computeBigPictureAnalytics(routes, vList);
  }, [routes, vehicles, vehicleMap]);

  // Options for reassigning dropdowns
  const reassignOptions = [
    "Por Distribuir",
    ...vehicles,
    ...Object.keys(groupedRoutes).filter((k) => k !== "Por Distribuir" && !vehicles.includes(k)),
  ];

  return (
    <DashboardLayout>
      <div className="space-y-2 pb-6">
        {/* TOP HEADER & ACTION CONTROLS */}
        {/* HEADER COMPACTO & TOOLBAR INTEGRADA (COLADO EM CIMA E À ESQUERDA) */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 shadow-sm">
          {/* Linha 1: Título Colado à Esquerda + Ações à Direita */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-sm shadow-indigo-500/50" />
              <h1 className="text-base font-bold tracking-tight text-zinc-100 font-sans">
                Planeamento de Rotas
              </h1>
              <span className="text-[11px] font-mono bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded border border-zinc-700/60">
                {globalKpis.totalDeliveries} paragens · {globalKpis.activeVehiclesCount}/{globalKpis.totalVehiclesCount} viaturas ativas
              </span>
            </div>

            {/* Ações da Toolbar */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {/* Botão Primário: Otimizar Rotas */}
              <button
                onClick={handleSolveRoutes}
                disabled={solving || vehicles.length === 0}
                className="cursor-pointer bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-md px-3 py-1.5 transition-all flex items-center space-x-1.5 disabled:opacity-50 shadow-sm"
                title="Executar otimização global OR-Tools VRPTW"
              >
                {solving ? (
                  <>
                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>A Calcular ({solvingSeconds}s)...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span>Otimizar Rotas</span>
                  </>
                )}
              </button>

              {/* Botão Executivo: The Big Picture (Diagnóstico de Capacidade AM/PM/Noite/Carga) */}
              {routes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setBigPictureModalOpen(true)}
                  className={`cursor-pointer px-2.5 py-1.5 rounded-md font-medium transition-all flex items-center space-x-1.5 border text-xs shadow-sm ${
                    bigPictureAnalytics.overallStatus === "critical"
                      ? "bg-rose-950/70 hover:bg-rose-900/80 border-rose-700 text-rose-200"
                      : bigPictureAnalytics.overallStatus === "warning"
                      ? "bg-amber-950/70 hover:bg-amber-900/80 border-amber-700 text-amber-200"
                      : "bg-zinc-950 hover:bg-zinc-850 border-zinc-700 text-emerald-400"
                  }`}
                  title="Diagnóstico Executivo de Capacidade & Viabilidade (Balanço Temporal e Físico)"
                >
                  <span className={`w-2 h-2 rounded-full ${
                    bigPictureAnalytics.overallStatus === "critical"
                      ? "bg-rose-500 animate-pulse"
                      : bigPictureAnalytics.overallStatus === "warning"
                      ? "bg-amber-400"
                      : "bg-emerald-400"
                  }`} />
                  <span className="font-semibold">The Big Picture</span>
                  {bigPictureAnalytics.criticalPeriod && bigPictureAnalytics.criticalPeriod.deficitVehicles > 0 && (
                    <span className="text-[10px] bg-rose-500/20 text-rose-300 px-1.5 py-0.2 rounded font-mono font-bold">
                      {bigPictureAnalytics.criticalPeriod.label.split(" ")[0]}: -{bigPictureAnalytics.criticalPeriod.deficitVehicles}v
                    </span>
                  )}
                  {bigPictureAnalytics.overallStatus === "balanced" && (
                    <span className="text-[10px] text-emerald-500 font-mono hidden sm:inline">
                      (Viável)
                    </span>
                  )}
                </button>
              )}

              {/* Botão Copiloto IA & Negociador Tático (100% Opt-In pelo utilizador) */}
              {routes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCopilotModalOpen(true)}
                  className="cursor-pointer px-2.5 py-1.5 rounded-md font-semibold transition-all flex items-center space-x-1.5 border text-xs shadow-sm bg-indigo-950/80 hover:bg-indigo-900 border-indigo-500/40 text-indigo-200"
                  title="Copiloto IA & Negociador Tático: Resgate de Janelas, Trocas entre Rotas Vizinhas, Notas Ocultas e Modos de Planeamento (Tu decides o que aplicar)"
                >
                  <span>✨</span>
                  <span>Copiloto IA</span>
                </button>
              )}

              {/* Botão Simulador de Carregamento 3D da Viatura */}
              {cargo3DRoutes.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCargoRouteIdx(0);
                    setCargoLoadingModalOpen(true);
                  }}
                  className="cursor-pointer px-2.5 py-1.5 rounded-md font-semibold transition-all flex items-center space-x-1.5 border text-xs shadow-sm bg-blue-950/80 hover:bg-blue-900 border-blue-500/40 text-blue-200"
                  title="Simulador de Carregamento 3D da Viatura (Arrumação LIFO, Distribuição de Peso e Caixas Interativas)"
                >
                  <span>📦</span>
                  <span>Carga 3D</span>
                </button>
              )}

              {/* Botão Parâmetros */}
              <button
                onClick={() => setShowConfig(!showConfig)}
                className={`cursor-pointer px-2.5 py-1.5 rounded-md border font-medium transition-colors flex items-center space-x-1.5 ${
                  showConfig
                    ? "bg-zinc-800 border-zinc-600 text-zinc-100"
                    : "bg-zinc-950 hover:bg-zinc-850 border-zinc-800 text-zinc-300"
                }`}
                title="Ajustar estratégia de agrupamento por zonas e distribuição da frota"
              >
                <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>Parâmetros</span>
                <span className="text-[10px] text-zinc-400 font-mono">
                  ({strategy === "clusters" ? "Zonas" : "Min KM"})
                </span>
              </button>

              {/* Botão 2-Opt */}
              <button
                onClick={handleOptimizeAllSequences}
                disabled={reorderingAll || solving || routes.length === 0}
                className="cursor-pointer bg-zinc-950 hover:bg-zinc-850 text-zinc-300 border border-zinc-800 rounded-md px-2.5 py-1.5 font-medium transition-colors flex items-center space-x-1 disabled:opacity-50"
                title="Polimento sequencial 2-Opt do trajeto mais curto de cada viatura"
              >
                <span>{reorderingAll ? "A ordenar..." : "⇅ 2-Opt"}</span>
              </button>

              {/* Re-otimizar Seleção */}
              {selectedRouteNames.length >= 2 && (
                <button
                  type="button"
                  onClick={() => setReoptimizeModalOpen(true)}
                  disabled={actionLoading === "reoptimizing_subset" || solving}
                  className="cursor-pointer bg-zinc-800 hover:bg-zinc-750 text-indigo-300 border border-indigo-500/50 rounded-md px-2.5 py-1.5 font-semibold transition-colors flex items-center space-x-1"
                  title="Re-planear em conjunto apenas as viaturas selecionadas"
                >
                  <span>🎯 Re-otimizar ({selectedRouteNames.length})</span>
                </button>
              )}

              <div className="h-4 w-px bg-zinc-800 mx-0.5 hidden sm:block" />

              {/* Status Auditoria */}
              {routes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAuditModalOpen(true)}
                  className={`cursor-pointer px-2.5 py-1.5 rounded-md font-medium transition-colors flex items-center space-x-1.5 border text-xs ${
                    auditData.total_violations === 0
                      ? "bg-zinc-950 hover:bg-zinc-850 border-emerald-900 text-emerald-400"
                      : "bg-rose-950/60 hover:bg-rose-900/60 border-rose-800 text-rose-300"
                  }`}
                  title="Relatório de Auditoria e Validação Operacional"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${auditData.total_violations === 0 ? "bg-emerald-400" : "bg-rose-500"}`} />
                  <span>{auditData.total_violations === 0 ? "Conforme (0 Erros)" : `${auditData.total_violations} Alertas`}</span>
                </button>
              )}

              {/* Botão MAPA */}
              <button
                onClick={handleOpenDetachedMap}
                className="cursor-pointer bg-zinc-950 hover:bg-zinc-850 text-zinc-300 border border-zinc-800 rounded-md px-2.5 py-1.5 font-medium transition-colors flex items-center space-x-1"
                title="Abrir Mapa Dedicado em janela independente"
              >
                <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                <span>MAPA</span>
              </button>

              {/* Exportar Excel */}
              {routes.length > 0 && (
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="cursor-pointer bg-zinc-950 hover:bg-zinc-850 text-emerald-400 border border-zinc-800 hover:border-emerald-800/80 rounded-md px-2.5 py-1.5 font-medium transition-colors flex items-center space-x-1"
                  title="Exportar Folha Excel Canónica Completa (9 Abas)"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>Exportar</span>
                </button>
              )}

              {/* Recarregar */}
              <button
                onClick={() => loadTacticalData()}
                disabled={loading}
                className="cursor-pointer bg-zinc-950 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200 border border-zinc-800 rounded-md px-2 py-1.5 transition-colors disabled:opacity-50"
                title="Recarregar dados"
              >
                <svg className={`w-3.5 h-3.5 ${loading ? "animate-spin text-indigo-400" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>

              {/* Co-Piloto */}
              {routes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAgentModalOpen(true)}
                  className="cursor-pointer bg-zinc-950 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200 border border-zinc-800 rounded-md px-2 py-1.5 transition-colors"
                  title="Assistente Co-Piloto"
                >
                  <span className="text-xs">🤖</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* PAINEL DE PARÂMETROS SÓBRIO & COMPACTO */}
        {showConfig && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 shadow-xl text-xs space-y-2.5 animate-in fade-in duration-150">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
              <span className="font-semibold text-zinc-100 text-xs flex items-center gap-1.5">
                <span>⚙️</span> Parâmetros de Otimização das Rotas
              </span>
              <button
                onClick={() => setShowConfig(false)}
                className="text-zinc-400 hover:text-zinc-200 text-xs px-2 py-0.5 rounded hover:bg-zinc-800 transition-colors"
              >
                ✕ Fechar
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              {/* Estratégia de Trajeto */}
              <div className="space-y-1 bg-zinc-950/60 p-2 rounded-md border border-zinc-800/80">
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                  1. Estratégia de Agrupamento
                </span>
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => setStrategy("clusters")}
                    className={`text-left px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
                      strategy === "clusters" ? "opt-param-active" : "opt-param-inactive"
                    }`}
                  >
                    <div className="text-xs opt-title">Rotas Agrupadas por Zonas</div>
                    <div className="text-[10px] opt-desc">Agrupa em torno dos clientes distantes (centro de gravidade). Enche as viaturas na mesma zona geográfica.</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStrategy("min_km")}
                    className={`text-left px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
                      strategy === "min_km" ? "opt-param-active" : "opt-param-inactive"
                    }`}
                  >
                    <div className="text-xs opt-title">Mínimos KM (Menor Distância)</div>
                    <div className="text-[10px] opt-desc">Minimiza estritamente os quilómetros percorridos e consumo total.</div>
                  </button>
                </div>
              </div>

              {/* Distribuição da Frota */}
              <div className="space-y-1 bg-zinc-950/60 p-2 rounded-md border border-zinc-800/80">
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                  2. Distribuição da Frota
                </span>
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => setLoadMode("full")}
                    className={`text-left px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
                      loadMode === "full" ? "opt-param-active" : "opt-param-inactive"
                    }`}
                  >
                    <div className="text-xs opt-title">Minimizar Viaturas (Carga Máxima)</div>
                    <div className="text-[10px] opt-desc">Enche os carros ao máximo da capacidade, sem viaturas subutilizadas na rua.</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLoadMode("balanced")}
                    className={`text-left px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
                      loadMode === "balanced" ? "opt-param-active" : "opt-param-inactive"
                    }`}
                  >
                    <div className="text-xs opt-title">Equilibrar Frota (Distribuição Homogénea)</div>
                    <div className="text-[10px] opt-desc">Distribui paragens e carga homogeneamente entre as viaturas disponíveis.</div>
                  </button>
                </div>
              </div>

              {/* Tempo & Profundidade */}
              <div className="space-y-1 bg-zinc-950/60 p-2 rounded-md border border-zinc-800/80">
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                  3. Tempo & Profundidade
                </span>
                <div className="flex flex-col gap-1.5">
                  <div className="grid grid-cols-3 gap-1">
                    <button
                      type="button"
                      onClick={() => setSolvingDepth("fast")}
                      className={`px-2 py-1.5 rounded-lg border text-center transition-all cursor-pointer ${
                        solvingDepth === "fast" ? "opt-param-active" : "opt-param-inactive"
                      }`}
                    >
                      <div className="text-xs opt-title">Rápido</div>
                      <div className="text-[9px] opt-desc">~30 seg</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSolvingDepth("balanced")}
                      className={`px-2 py-1.5 rounded-lg border text-center transition-all cursor-pointer ${
                        solvingDepth === "balanced" ? "opt-param-active" : "opt-param-inactive"
                      }`}
                    >
                      <div className="text-xs opt-title">Equilibrado</div>
                      <div className="text-[9px] opt-desc">1 a 2 min</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSolvingDepth("deep")}
                      className={`px-2 py-1.5 rounded-lg border text-center transition-all cursor-pointer ${
                        solvingDepth === "deep" ? "opt-param-active" : "opt-param-inactive"
                      }`}
                    >
                      <div className="text-xs opt-title">Profundo</div>
                      <div className="text-[9px] opt-desc">3 a 5 min</div>
                    </button>
                  </div>

                  <div className="pt-1 flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="respectWindowsCheck"
                      checked={respectWindows}
                      onChange={(e) => setRespectWindows(e.target.checked)}
                      className="rounded border-zinc-700 bg-zinc-900 text-indigo-600 focus:ring-0 cursor-pointer"
                    />
                    <label htmlFor="respectWindowsCheck" className="text-[11px] text-zinc-200 cursor-pointer select-none font-medium">
                      Respeitar janelas horárias estritas
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* BLOCO TOTALMENTE INTEGRADO: MÉTRICAS + FILTROS + MATRIZ DE ROTAS (COLADOS SEM FOLGA) */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl overflow-hidden">
          {/* Linha 1: Barra de Métricas Contínua */}
          <div className="px-3 py-1.5 flex flex-wrap items-center justify-between gap-y-1 text-xs font-mono tabular-nums border-b border-zinc-800/80 bg-zinc-900/95">
            {/* Paragens */}
            <div className="flex items-center space-x-1.5">
              <span className="text-zinc-400 font-sans uppercase text-[10px] font-bold">Paragens:</span>
              <span className="text-zinc-100 font-bold">{globalKpis.totalDeliveries}</span>
              <span className="text-emerald-400 text-[11px]">({globalKpis.assignedCount} atrib.)</span>
              {globalKpis.pendingCount > 0 && (
                <span className="text-amber-400 font-bold text-[11px]">| {globalKpis.pendingCount} pendentes</span>
              )}
            </div>

            <div className="h-3 w-px bg-zinc-800 hidden sm:block" />

            {/* Distância */}
            <div className="flex items-center space-x-1.5">
              <span className="text-zinc-400 font-sans uppercase text-[10px] font-bold">Distância:</span>
              <span className="text-indigo-300 font-bold">{globalKpis.totalKm}</span>
              <span className="text-zinc-400 text-[11px]">km</span>
            </div>

            <div className="h-3 w-px bg-zinc-800 hidden sm:block" />

            {/* Frota */}
            <div className="flex items-center space-x-1.5">
              <span className="text-zinc-400 font-sans uppercase text-[10px] font-bold">Frota:</span>
              <span className="text-emerald-400 font-bold">{globalKpis.activeVehiclesCount}</span>
              <span className="text-zinc-400 text-[11px]">/ {globalKpis.totalVehiclesCount} viaturas</span>
              <span className="text-zinc-500 text-[10px]">({globalKpis.totalVehiclesCount - globalKpis.activeVehiclesCount} livres)</span>
            </div>

            <div className="h-3 w-px bg-zinc-800 hidden sm:block" />

            {/* Carga Total */}
            <div className="flex items-center space-x-1.5">
              <span className="text-zinc-400 font-sans uppercase text-[10px] font-bold">Carga Total:</span>
              <span className="text-zinc-100 font-bold">{Number(globalKpis.totalKg).toLocaleString("pt-PT")}</span>
              <span className="text-zinc-400 text-[11px]">kg</span>
            </div>

            <div className="h-3 w-px bg-zinc-800 hidden sm:block" />

            {/* Pontualidade */}
            <div className="flex items-center space-x-1.5">
              <span className="text-zinc-400 font-sans uppercase text-[10px] font-bold">Pontualidade:</span>
              <span className={`font-bold ${globalKpis.onTimeRate >= 95 ? "text-emerald-400" : "text-amber-400"}`}>
                {globalKpis.onTimeRate}%
              </span>
              {globalKpis.totalLate > 0 ? (
                <span className="text-rose-400 text-[11px]">({globalKpis.totalLate} atrasos)</span>
              ) : (
                <span className="text-emerald-500 text-[11px] font-sans">✓</span>
              )}
            </div>
          </div>

          {/* Linha 2: Barra de Pesquisa e Filtros (Colada às Métricas e à Tabela) */}
          <div className="p-2 flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs bg-zinc-950/70">
            <div className="flex items-center flex-wrap gap-2 flex-1">
              {/* Text Search */}
              <div className="relative min-w-[200px] max-w-sm flex-1">
                <input
                  type="text"
                  placeholder="Pesquisar cliente, código, morada, CP..."
                  value={searchQuery}
                  onChange={(e) => { const v = e.target.value; setSearchQuery(v); broadcastFilterSync(v, selectedWarehouseFilter, selectedStatusFilter); }}
                  className="w-full bg-zinc-900 border border-zinc-800 focus:border-indigo-500 rounded px-2.5 py-1 text-xs text-zinc-200 outline-none placeholder-zinc-500 transition-all pl-7"
                />
                <svg className="w-3.5 h-3.5 text-zinc-500 absolute left-2 top-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                {searchQuery && (
                  <button
                    onClick={() => { setSearchQuery(""); broadcastFilterSync("", selectedWarehouseFilter, selectedStatusFilter); }}
                    className="absolute right-1.5 top-1 text-zinc-400 hover:text-zinc-200 text-xs"
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
                  className="bg-zinc-900 border border-zinc-800 text-zinc-300 rounded px-2 py-1 text-xs outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="all">🏠 Todos os Armazéns ({uniqueWarehouseNames.length})</option>
                  {uniqueWarehouseNames.map((w) => (
                    <option key={w} value={w}>
                      🏠 {w}
                    </option>
                  ))}
                </select>
              )}

              {/* Status Filter */}
              <div className="flex items-center space-x-1 bg-zinc-900 p-0.5 rounded border border-zinc-800 text-[11px] font-medium">
                <button
                  onClick={() => { setSelectedStatusFilter("all"); broadcastFilterSync(searchQuery, selectedWarehouseFilter, "all"); }}
                  className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                    selectedStatusFilter === "all" ? "bg-zinc-800 text-zinc-100 font-semibold" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Todos ({vehicles.length})
                </button>
                <button
                  onClick={() => { setSelectedStatusFilter("active"); broadcastFilterSync(searchQuery, selectedWarehouseFilter, "active"); }}
                  className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                    selectedStatusFilter === "active" ? "bg-emerald-950 border border-emerald-800 text-emerald-300 font-semibold" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Com Carga ({globalKpis.activeVehiclesCount})
                </button>
                <button
                  onClick={() => { setSelectedStatusFilter("empty"); broadcastFilterSync(searchQuery, selectedWarehouseFilter, "empty"); }}
                  className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                    selectedStatusFilter === "empty" ? "bg-zinc-800 text-zinc-300 font-semibold" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Vazias ({globalKpis.totalVehiclesCount - globalKpis.activeVehiclesCount})
                </button>
                {hasPending && (
                  <button
                    onClick={() => { setSelectedStatusFilter("pending"); broadcastFilterSync(searchQuery, selectedWarehouseFilter, "pending"); }}
                    className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                      selectedStatusFilter === "pending" ? "bg-amber-950 border border-amber-800 text-amber-300 font-semibold" : "text-amber-400 hover:text-amber-300"
                    }`}
                  >
                    Por Distribuir ({globalKpis.pendingCount})
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-1.5">
              <button
                onClick={() => toggleAllRoutes(true)}
                className="px-2 py-0.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded text-xs transition-colors cursor-pointer"
              >
                ▼ Expandir
              </button>
              <button
                onClick={() => toggleAllRoutes(false)}
                className="px-2 py-0.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded text-xs transition-colors cursor-pointer"
              >
                ▲ Colapsar
              </button>
            </div>
          </div>

          {/* MAIN FULL-WIDTH ROUTES MATRIX: EXCEL DATA GRID TABLE (COLADA DIRETAMENTE ACIMA SEM QUALQUER INTERVALO) */}
          <div className="overflow-hidden bg-zinc-950/90 border-t border-zinc-800">
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

                      const totalKg = allStops.reduce((sum, item) => sum + (Number(item.Peso_KG) || 0), 0);
                      const totalVol = allStops.reduce((sum, item) => sum + (Number(item.Volume_m3) || 0), 0);
                      const kgPct = Math.round((totalKg / maxKg) * 100);
                      const volPct = Math.round((totalVol / maxVol) * 100);

                      const vObj = fleetList.find((f) => f.veiculo === routeName);
                      const returnsToDepot = vObj ? !["não", "nao", "false", "0", "no"].includes(String(vObj.regresso_armazem || "Sim").trim().toLowerCase()) : true;

                      let returnDist = 0.0;
                      let returnArrivalTimeStr = startTimeStr;
                      let totalRouteKm = 0.0;

                      if (allStops.length > 0) {
                        const lastStop = allStops[allStops.length - 1];
                        if (returnsToDepot) {
                          if (whData && whData.lat && whData.lon) {
                            returnDist = haversineDistance(lastStop.Latitude, lastStop.Longitude, whData.lat, whData.lon);
                          }
                          const returnTravelMin = (returnDist / speed) * 60.0;
                          returnArrivalTimeStr = addMinutesToTime(lastStop.Saida || "12:00", returnTravelMin);
                          totalRouteKm = (lastStop.Dist_Acum || 0) + returnDist;
                        } else {
                          returnDist = 0.0;
                          returnArrivalTimeStr = lastStop.Saida || lastStop.Chegada || startTimeStr;
                          totalRouteKm = lastStop.Dist_Acum || 0;
                        }
                      }

                      const totalDurationStr = allStops.length > 0 ? calculateDurationString(startTimeStr, returnArrivalTimeStr) : "0h 0m";
                      const routeAudit = auditData?.routes_status?.[routeName];
                      const hasRouteErrors = routeAudit && !routeAudit.is_valid && (routeAudit.errors_count || 0) > 0;
                      const hasRouteWarnings = routeAudit && (routeAudit.warnings_count || 0) > 0 && (routeAudit.errors_count || 0) === 0;

                      return (
                        <React.Fragment key={routeName}>
                          {/* MASTER ROUTE ROW (EXCEL DENSE ROW) */}
                          <tr
                            onClick={() => toggleRouteExpand(routeName)}
                            className={`group cursor-pointer border-b border-zinc-800/80 transition-colors duration-150 ${
                              hasRouteErrors
                                ? "bg-rose-950/20 hover:bg-rose-950/40"
                                : isPending
                                ? "bg-amber-950/20 hover:bg-amber-950/40"
                                : isExpanded
                                ? "bg-zinc-900 hover:bg-zinc-950"
                                : "bg-zinc-950 hover:bg-zinc-900"
                            }`}
                          >
                            {/* Selection Checkbox & Expand Indicator */}
                            <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-center space-x-1.5">
                                <input
                                  type="checkbox"
                                  checked={selectedRouteNames.includes(routeName)}
                                  onChange={() => toggleRouteSelection(routeName)}
                                  className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer border-zinc-600 bg-zinc-800"
                                  title="Selecionar para Re-Otimização Conjunta"
                                />
                                <span className="text-zinc-400 group-hover:text-zinc-100 font-bold text-xs cursor-pointer" onClick={() => toggleRouteExpand(routeName)}>
                                  {isExpanded ? "▼" : "▶"}
                                </span>
                              </div>
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
                                  className="text-[10px] px-2 py-0.5 rounded-full font-black bg-rose-600 hover:bg-rose-500 text-white shadow flex items-center justify-center gap-1 cursor-pointer mx-auto"
                                  title="Clique para ver relatório detalhado de erros"
                                >
                                  🚨 {routeAudit?.errors_count || 1} {(routeAudit?.errors_count || 1) === 1 ? "Erro" : "Erros"}
                                </button>
                              ) : hasRouteWarnings ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setAuditModalOpen(true);
                                  }}
                                  className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-600 hover:bg-amber-500 text-white shadow flex items-center justify-center gap-1 cursor-pointer mx-auto"
                                  title="Clique para ver avisos operacionais (ex: chegadas antecipadas com espera)"
                                >
                                  ⚠️ {routeAudit?.warnings_count} {routeAudit?.warnings_count === 1 ? "Aviso" : "Avisos"}
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

                                {!isPending && allStops.length > 0 && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const idx = cargo3DRoutes.findIndex(r => r.vehicle === routeName);
                                      setSelectedCargoRouteIdx(idx >= 0 ? idx : 0);
                                      setCargoLoadingModalOpen(true);
                                    }}
                                    className="bg-blue-950 hover:bg-blue-900 border border-blue-700/80 text-blue-300 hover:text-white px-2 py-1 rounded-lg text-[11px] font-bold transition-all flex items-center space-x-1 cursor-pointer shadow-sm"
                                    title="Visualizar arrumação 3D do baú desta viatura"
                                  >
                                    <span>📦 3D</span>
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
                              <td colSpan={12} className="p-3 bg-zinc-950/90 border-b border-zinc-800">
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
                                            <th className="py-2 px-2 text-center w-20 sticky top-0 bg-zinc-950 z-10">Tipo</th>
                                            <th className="py-2 px-3 min-w-[180px] sticky top-0 bg-zinc-950 z-10">Doc ID / Cliente</th>
                                            <th className="py-2 px-3 min-w-[220px] sticky top-0 bg-zinc-950 z-10">Morada & Localidade</th>
                                            <th className="py-2 px-2 min-w-[110px] text-center sticky top-0 bg-zinc-950 z-10">Contacto / Vend.</th>
                                            <th className="py-2 px-2 min-w-[100px] text-center sticky top-0 bg-zinc-950 z-10">Janela Horária</th>
                                            <th className="py-2 px-2 min-w-[110px] text-center sticky top-0 bg-zinc-950 z-10">Previsão Chegada</th>
                                            <th className="py-2 px-2 w-[115px] text-center sticky top-0 bg-zinc-950 z-10">Carga / A Bordo</th>
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
                                              <td className="py-2 px-2 text-center">
                                                <span className="font-mono text-[9px] font-bold text-indigo-400 bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-800/50">
                                                  DEPOT
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
                                              <td className="py-2 px-2 text-center font-mono text-zinc-350">
                                                <div className="font-semibold text-zinc-200">
                                                  {allStops.filter((s) => (s.Tipo_Operacao || "D") === "D").reduce((acc, s) => acc + (s.Peso_KG || 0), 0).toFixed(0)} kg
                                                </div>
                                                <div className="text-[9px] text-indigo-300 font-bold">Carga Inicial</div>
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
                                            const compliance = !isPending
                                              ? getDeliveryWindowCompliance(stop.Chegada, stop.Janela_Horaria)
                                              : { status: "on_time" as DeliveryComplianceStatus, label: "Livre", tooltip: "Pendente", badgeClass: "text-zinc-300 bg-zinc-900 border border-zinc-800", diffMinutes: 0 };
                                            const isLate = compliance.status !== "on_time";
                                            const actKey = stop.id ? `${stop.Cliente}_${stop.id}` : stop.Cliente;
                                            const stopKey = stop.id ? `${routeName}_${stop.id}` : `${routeName}_${stop.Cliente}_${idx}`;
                                            const isRowLoading = actionLoading === actKey;
                                            const isBeingDragged = draggedStopKey === stopKey;
                                            const isDropTarget = dragOverStopKey === stopKey && !isBeingDragged;

                                            return (
                                              <tr
                                                key={`${stop.Cliente}-${stop.id || idx}`}
                                                draggable={!isPending && !isRowLoading}
                                                onDragStart={(e) => {
                                                  e.dataTransfer.setData(
                                                    "text/plain",
                                                    JSON.stringify({
                                                      routeName,
                                                      clientCode: stop.Cliente,
                                                      order: stop.Ordem,
                                                      deliveryId: stop.id,
                                                      address: stop.Morada,
                                                    })
                                                  );
                                                  e.dataTransfer.effectAllowed = "move";
                                                  setDraggedStopKey(stopKey);
                                                }}
                                                onDragEnd={() => {
                                                  setDraggedStopKey(null);
                                                  setDragOverStopKey(null);
                                                }}
                                                onDragOver={(e) => {
                                                  e.preventDefault();
                                                  e.dataTransfer.dropEffect = "move";
                                                  if (draggedStopKey && draggedStopKey !== stopKey) {
                                                    setDragOverStopKey(stopKey);
                                                  }
                                                }}
                                                onDragLeave={() => {
                                                  if (dragOverStopKey === stopKey) {
                                                    setDragOverStopKey(null);
                                                  }
                                                }}
                                                onDrop={(e) => {
                                                  e.preventDefault();
                                                  setDraggedStopKey(null);
                                                  setDragOverStopKey(null);
                                                  try {
                                                    const raw = e.dataTransfer.getData("text/plain");
                                                    if (!raw) return;
                                                    const data = JSON.parse(raw);
                                                    if (data.routeName === routeName && data.order !== stop.Ordem) {
                                                      handleReorder(routeName, data.clientCode, stop.Ordem, "exact", data.deliveryId, data.address);
                                                    }
                                                  } catch (err) {
                                                    console.error("Drop error", err);
                                                  }
                                                }}
                                                className={`transition-colors duration-150 ${
                                                  isBeingDragged
                                                    ? "opacity-40 bg-indigo-950/40 border-2 border-dashed border-indigo-500"
                                                    : isDropTarget
                                                    ? "bg-indigo-900/40 border-t-2 border-indigo-400"
                                                    : compliance.status === "late"
                                                    ? "bg-rose-950/20 hover:bg-rose-950/35"
                                                    : compliance.status === "early"
                                                    ? "bg-amber-950/20 hover:bg-amber-950/35"
                                                    : "hover:bg-zinc-900"
                                                }`}
                                              >
                                                {/* # Ordem with Reorder Arrows & Drag Handle */}
                                                <td className="py-2.5 px-3.5 text-center">
                                                  <div className="flex items-center justify-center space-x-1.5">
                                                    {!isPending && (
                                                      <span
                                                        className="cursor-grab active:cursor-grabbing text-zinc-500 hover:text-indigo-400 select-none text-xs"
                                                        title="Arrastar para reordenar sequência"
                                                      >
                                                        ⋮⋮
                                                      </span>
                                                    )}
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

                                                {/* Tipo de Operação (D, P, From, To) */}
                                                <td className="py-2 px-2 text-center whitespace-nowrap">
                                                  {renderOperationTypeBadge(stop.Tipo_Operacao, stop.Par_ID)}
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

                                                {/* Previsão Chegada com Validação de Janela */}
                                                <td className="py-2 px-2 text-center">
                                                  <div
                                                    className="flex items-center justify-center space-x-1"
                                                    title={compliance.tooltip}
                                                  >
                                                    <span
                                                      className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded ${compliance.badgeClass}`}
                                                    >
                                                      {stop.Chegada || "--:--"}
                                                    </span>
                                                    {compliance.status === "late" && (
                                                      <span className="cursor-help text-xs" title={compliance.tooltip}>
                                                        ⚠️
                                                      </span>
                                                    )}
                                                    {compliance.status === "early" && (
                                                      <span className="cursor-help text-xs" title={compliance.tooltip}>
                                                        ⏳
                                                      </span>
                                                    )}
                                                  </div>
                                                </td>

                                                {/* Carga / A Bordo */}
                                                <td className="py-2 px-2 text-center font-mono text-zinc-300">
                                                  <div className="font-semibold text-zinc-100">{stop.Peso_KG || 0} kg</div>
                                                  <div className="text-[9px] text-indigo-300 font-bold" title="Carga física restante a bordo da viatura após esta paragem">
                                                    A Bordo: {stop.Carga_Acum !== undefined ? Math.round(stop.Carga_Acum) : Math.round(stop.Peso_KG || 0)} kg
                                                  </div>
                                                  <div className="text-[8px] text-zinc-500">{(stop.Volume_m3 || 0).toFixed(2)} m³</div>
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
                                          {!isPending && (returnsToDepot ? (
                                            <tr className="bg-emerald-950/20 border-t border-emerald-800/40 text-emerald-200 font-medium">
                                              <td className="py-2 px-3 text-center">
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-lg text-[9px] font-bold bg-emerald-900/90 text-emerald-300 border border-emerald-700/60 shadow-sm">
                                                  Regresso
                                                </span>
                                              </td>
                                              <td className="py-2 px-2 text-center">
                                                <span className="font-mono text-[9px] font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/50">
                                                  RECOLHAS
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
                                              <td className="py-2 px-2 text-center font-mono text-zinc-350">
                                                <div className="font-semibold text-zinc-200">
                                                  {allStops.length > 0 && allStops[allStops.length - 1].Carga_Acum !== undefined
                                                    ? Math.round(allStops[allStops.length - 1].Carga_Acum)
                                                    : allStops.filter((s) => s.Tipo_Operacao === "P").reduce((acc, s) => acc + (s.Peso_KG || 0), 0)} kg
                                                </div>
                                                <div className="text-[9px] text-emerald-300 font-bold">Retorno / Sucata</div>
                                              </td>
                                              <td className="py-2 px-2 text-center font-mono text-zinc-450">
                                                Acum: {totalRouteKm.toFixed(1)} km
                                              </td>
                                              <td className="py-2 px-3 text-center text-[10px] text-emerald-400 font-semibold">
                                                Fim de Turno
                                              </td>
                                            </tr>
                                          ) : (
                                            <tr className="bg-sky-950/20 border-t border-sky-800/40 text-sky-200 font-medium">
                                              <td className="py-2 px-3 text-center">
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-lg text-[9px] font-bold bg-sky-900/90 text-sky-300 border border-sky-700/60 shadow-sm">
                                                  Término
                                                </span>
                                              </td>
                                              <td className="py-2 px-2 text-center text-zinc-500 font-mono text-[9px]">--</td>
                                              <td className="py-2 px-3">
                                                <div className="font-bold text-sky-300">Última Paragem</div>
                                                <div className="text-[9px] text-sky-400/80 font-mono">Sem Regresso ao Armazém</div>
                                              </td>
                                              <td className="py-2 px-3">
                                                <div className="text-zinc-400 text-xs italic">A viatura pernoita fora / rota aberta</div>
                                              </td>
                                              <td className="py-2 px-2 text-center text-zinc-500 text-[10px] font-mono">
                                                --
                                              </td>
                                              <td className="py-2 px-2 text-center">
                                                <span className="font-mono text-sky-400 bg-zinc-900/80 px-1.5 py-0.5 rounded border border-zinc-800 text-[9px]">
                                                  Fim Turno
                                                </span>
                                              </td>
                                              <td className="py-2 px-2 text-center">
                                                <div className="font-mono text-xs font-bold text-sky-400">
                                                  {returnArrivalTimeStr}
                                                </div>
                                              </td>
                                              <td className="py-2 px-2 text-center font-mono text-zinc-450">
                                                --
                                              </td>
                                              <td className="py-2 px-2 text-center font-mono text-zinc-450">
                                                Acum: {totalRouteKm.toFixed(1)} km
                                              </td>
                                              <td className="py-2 px-3 text-center text-[10px] text-sky-400 font-semibold">
                                                Rota Aberta
                                              </td>
                                            </tr>
                                          ))}
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
      </div>
        {/* Quality Audit Modal */}
        <AgentChatDrawer
          isOpen={agentModalOpen}
          onClose={() => setAgentModalOpen(false)}
          projectId={Number(selectedProject?.id || 0)}
          onRefreshData={loadTacticalData}
        />

        <AgentCopilotModal
          isOpen={copilotModalOpen}
          onClose={() => setCopilotModalOpen(false)}
          projectId={Number(selectedProject?.id || 0)}
          onApplyAction={async (deliveryId, targetVehicle, clientCode) => {
            await handleReassign(clientCode || String(deliveryId), targetVehicle, deliveryId);
          }}
          onRunSolverWithParams={handleSolveRoutes}
          onRefreshData={loadTacticalData}
        />

        <AuditModal
          isOpen={auditModalOpen}
          onClose={() => setAuditModalOpen(false)}
          violations={auditData.all_violations}
          onFocusRoute={(rName) => {
            setExpandedRoutes((prev) => ({ ...prev, [rName]: true }));
          }}
        />

        {/* Big Picture Modal: Diagnóstico de Capacidade Temporal e Carga */}
        <BigPictureModal
          isOpen={bigPictureModalOpen}
          onClose={() => setBigPictureModalOpen(false)}
          deliveries={routes}
          vehicles={vehicles.map((v) => ({
            veiculo: v,
            armazem: vehicleMap[v]?.armazem,
            capacidade_kg: vehicleMap[v]?.capacidade_kg,
            capacidade_vol: vehicleMap[v]?.capacidade_vol,
            horario_inicio: vehicleMap[v]?.horario_inicio,
            horario_fim: vehicleMap[v]?.horario_fim,
          }))}
          initialZoneId={selectedBigPictureZone}
          onSelectZoneOnMap={(zId) => {
            setSelectedBigPictureZone(zId);
            setBigPictureModalOpen(false);
            handleOpenDetachedMap();
          }}
        />

        {/* Re-optimize Selected Routes Modal */}
        <ReoptimizeModal
          isOpen={reoptimizeModalOpen}
          onClose={() => setReoptimizeModalOpen(false)}
          selectedRoutes={selectedRouteNames}
          stopsCount={routes.filter(r => selectedRouteNames.includes(r.Rota)).length}
          totalKg={routes.filter(r => selectedRouteNames.includes(r.Rota)).reduce((sum, r) => sum + (Number(r.Peso_KG) || 0), 0)}
          onConfirm={handleReoptimizeSelected}
        />

        {/* Simulador de Carregamento 3D da Viatura (LIFO & Gravidade) */}
        <CargoLoading3DModal
          isOpen={cargoLoadingModalOpen}
          onClose={() => setCargoLoadingModalOpen(false)}
          routes={cargo3DRoutes}
          initialRouteIndex={selectedCargoRouteIdx}
          vehiclesData={fleetList}
        />

        {/* Floating Status Toast Notification (Sóbrio, alto contraste, sem piscar) */}
        {statusMsg && (
          <div className="fixed top-4 right-4 z-[99999] bg-zinc-900 border border-zinc-700 text-zinc-100 px-3.5 py-2 rounded-lg shadow-2xl flex items-center space-x-2.5 text-xs font-medium animate-in fade-in duration-150">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            <span className="text-zinc-200">{statusMsg}</span>
            <button
              onClick={() => setStatusMsg("")}
              className="text-zinc-400 hover:text-white text-xs ml-2 cursor-pointer p-0.5 rounded hover:bg-zinc-800 transition-colors"
              title="Fechar"
            >
              ✕
            </button>
          </div>
        )}

        {/* Reoptimizing Loading Overlay */}
        {actionLoading === "reoptimizing_subset" && (
          <div className="fixed inset-0 z-[99999] bg-black/60 backdrop-blur-xs flex items-center justify-center animate-in fade-in">
            <div className="bg-zinc-900 border border-indigo-500/40 rounded-2xl p-6 shadow-2xl flex flex-col items-center space-y-3 max-w-sm text-center">
              <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <h4 className="font-bold text-sm text-white">A Re-Otimizar Rotas Selecionadas</h4>
              <p className="text-xs text-zinc-400">O solver OR-Tools está a calcular o melhor trajeto conjunto e a re-equilibrar as entregas...</p>
            </div>
          </div>
        )}

        {/* Modal de Mensagens do Sistema (Substitui os alerts nativos do browser) */}
        {appAlert && appAlert.isOpen && (
          <div className="fixed inset-0 z-[100000] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-zinc-900 border border-zinc-700/90 rounded-2xl p-6 shadow-2xl max-w-md w-full text-zinc-100 flex flex-col space-y-4">
              <div className="flex items-start space-x-3.5">
                <div className={`p-2.5 rounded-xl border shrink-0 text-xl ${
                  appAlert.type === "success"
                    ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                    : appAlert.type === "warning"
                    ? "bg-amber-500/15 border-amber-500/30 text-amber-400"
                    : appAlert.type === "error"
                    ? "bg-rose-500/15 border-rose-500/30 text-rose-400"
                    : "bg-blue-500/15 border-blue-500/30 text-blue-400"
                }`}>
                  {appAlert.type === "success" && "🚀"}
                  {appAlert.type === "warning" && "⚠️"}
                  {appAlert.type === "error" && "❌"}
                  {appAlert.type === "info" && "ℹ️"}
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <h3 className="text-base font-bold text-white tracking-wide">
                    {appAlert.title}
                  </h3>
                  <p className="text-xs text-zinc-300 mt-1.5 leading-relaxed whitespace-pre-line">
                    {appAlert.message}
                  </p>
                </div>
              </div>
              <div className="flex justify-end pt-2 border-t border-zinc-800">
                <button
                  onClick={() => setAppAlert(null)}
                  className={`px-5 py-2 rounded-xl text-xs font-bold shadow-lg transition-all cursor-pointer ${
                    appAlert.type === "success"
                      ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30"
                      : appAlert.type === "error"
                      ? "bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30"
                      : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30"
                  }`}
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
