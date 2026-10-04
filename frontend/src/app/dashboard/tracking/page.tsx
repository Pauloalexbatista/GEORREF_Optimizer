"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import DashboardLayout from "@/components/DashboardLayout";
import { useProjects } from "@/context/ProjectContext";
import api from "@/utils/api";
import type { TrackingRoute, TrackingStop } from "@/components/TrackingMap";

// Dynamic import with SSR disabled for Leaflet compatibility
const TrackingMap = dynamic(() => import("@/components/TrackingMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex flex-col items-center justify-center p-8 opacity-70">
      <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      <span className="text-xs font-semibold mt-2">A carregar mapa em tempo real...</span>
    </div>
  ),
});

interface StopItem {
  sequence: number;
  tipo?: string;
  morada?: string;
  address?: string;
  cod_postal?: string;
  postal_code?: string;
  localidade?: string;
  locality?: string;
  cliente?: string;
  client_name?: string;
  telefone?: string;
  phone?: string;
  janela_inicio?: string;
  window_start?: string;
  janela_fim?: string;
  window_end?: string;
  status: string;
  hora_entrega_real?: string | null;
  actual_arrival_time?: string | null;
  motivo_falha?: string | null;
  fail_reason?: string | null;
  notas_motorista?: string | null;
  driver_notes?: string | null;
  lat: number | null;
  lng: number | null;
  peso_kg?: number;
  weight_kg?: number;
  volume_m3?: number;
}

interface RouteItem {
  route_id?: string;
  route_name?: string;
  vehicle_id?: string;
  vehicle?: string;
  driver_name?: string | null;
  has_driver?: boolean;
  warehouse?: string;
  warehouse_lat?: number | null;
  warehouse_lng?: number | null;
  status_operacional?: string;
  next_stop?: StopItem | null;
  last_finished_stop?: StopItem | null;
  total?: number;
  total_stops?: number;
  entregues?: number;
  falhadas?: number;
  pendentes?: number;
  percent_complete?: number;
  stops: StopItem[];
  color?: string;
  last_lat?: number | null;
  last_lng?: number | null;
  last_gps_time?: string;
  speed?: number;
}

export default function TrackingPage() {
  const { selectedProject } = useProjects();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);
  const [autoRefreshSecs, setAutoRefreshSecs] = useState<number>(15);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [expandedRoutes, setExpandedRoutes] = useState<Record<string, boolean>>({});
  const [searchFilter, setSearchFilter] = useState<string>("");
  const [viewMode, setViewMode] = useState<"split" | "map" | "table">("split");

  // Multi-seleção de Viaturas para exibição no Mapa
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([]);

  // Modal para registo de estado manual / intervenção
  const [editingStop, setEditingStop] = useState<{
    routeId: string;
    stop: StopItem;
  } | null>(null);
  const [editStatus, setEditStatus] = useState<string>("Entregue");
  const [editReason, setEditReason] = useState<string>("");
  const [editNotes, setEditNotes] = useState<string>("");
  const [updatingStop, setUpdatingStop] = useState<boolean>(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchTracking = useCallback(async (isSilent = false) => {
    if (!selectedProject?.id) {
      setData(null);
      setLoading(false);
      return;
    }
    if (!isSilent) setIsRefreshing(true);

    try {
      const res = await api.get(`/api/tracking/${selectedProject.id}`);
      const trackingData = res?.data || res;
      setData(trackingData);
      setLastUpdated(new Date().toLocaleTimeString("pt-PT"));

      // Se for a primeira carga e selectedRouteIds estiver vazio, seleciona todas por padrão
      setSelectedRouteIds((prev) => {
        if (prev.length > 0) return prev;
        const validRouteNames = (trackingData?.routes || [])
          .filter((r: any) => (r.total_stops || r.total || (r.stops && r.stops.length) || 0) > 0)
          .map((r: any) => r.route_name || r.route_id);
        return validRouteNames;
      });
    } catch (e: any) {
      console.error("Error loading tracking data:", e);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedProject?.id]);

  useEffect(() => {
    fetchTracking(false);
  }, [fetchTracking]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (autoRefreshSecs > 0) {
      timerRef.current = setInterval(() => {
        fetchTracking(true);
      }, autoRefreshSecs * 1000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoRefreshSecs, fetchTracking]);

  const toggleRoute = (routeId: string) => {
    setExpandedRoutes((prev) => ({
      ...prev,
      [routeId]: !prev[routeId],
    }));
  };

  const toggleSelectRoute = (routeId: string) => {
    setSelectedRouteIds((prev) =>
      prev.includes(routeId) ? prev.filter((id) => id !== routeId) : [...prev, routeId]
    );
  };

  const selectAllRoutes = () => {
    const allIds = activeRoutes.map((r) => r.route_name || r.route_id || "");
    setSelectedRouteIds(allIds);
  };

  const deselectAllRoutes = () => {
    setSelectedRouteIds([]);
  };

  const focusSingleRoute = (routeId: string) => {
    setSelectedRouteIds([routeId]);
  };

  const handleAssignDriver = async (routeName: string, driverName: string) => {
    if (!selectedProject?.id) return;
    try {
      await api.post(`/api/tracking/assign/${selectedProject.id}`, {
        route_name: routeName,
        driver_name: driverName,
      });
      fetchTracking(true);
    } catch (e: any) {
      alert("Erro ao atribuir motorista: " + (e?.message || e));
    }
  };

  const handleToggleActivateProject = async () => {
    if (!selectedProject?.id) return;
    setTogglingActive(true);
    try {
      if (data?.is_active) {
        await api.post(`/api/tracking/deactivate/${selectedProject.id}`);
      } else {
        await api.post(`/api/tracking/activate/${selectedProject.id}`);
      }
      await fetchTracking(true);
    } catch (e: any) {
      alert("Erro ao alterar estado das rotas: " + (e?.message || e));
    } finally {
      setTogglingActive(false);
    }
  };

  const handleAutoAssignAll = async () => {
    if (!selectedProject?.id) return;
    setAutoAssigning(true);
    try {
      await api.post(`/api/tracking/auto-assign/${selectedProject.id}`);
      await fetchTracking(true);
    } catch (e: any) {
      alert("Erro na atribuição automática: " + (e?.message || e));
    } finally {
      setAutoAssigning(false);
    }
  };

  const handleUpdateStopStatus = async (
    routeId: string,
    sequence: number,
    newStatus: string,
    reason?: string,
    notes?: string
  ) => {
    if (!selectedProject?.id) return;
    try {
      await api.post(`/api/tracking/stop/${selectedProject.id}`, {
        route_name: routeId,
        sequence: sequence,
        status: newStatus,
        fail_reason: reason || "",
        driver_notes: notes || "",
      });
      fetchTracking(true);
    } catch (e: any) {
      alert("Erro ao atualizar estado da paragem: " + (e?.message || e));
    }
  };

  const submitStopModal = async () => {
    if (!editingStop) return;
    setUpdatingStop(true);
    try {
      await handleUpdateStopStatus(
        editingStop.routeId,
        editingStop.stop.sequence,
        editStatus,
        editReason,
        editNotes
      );
      setEditingStop(null);
    } finally {
      setUpdatingStop(false);
    }
  };

  // Normalização de dados
  const rawRoutes: RouteItem[] = data?.routes || [];
  const activeRoutes: RouteItem[] = useMemo(() => {
    return rawRoutes
      .map((r, idx) => {
        const rName = r.route_name || r.route_id || `Rota_${idx + 1}`;
        const rVeh = r.vehicle_id || r.vehicle || "-";
        const rTot = Number(r.total_stops ?? r.total ?? r.stops?.length ?? 0);
        const rEnt = Number(r.entregues ?? 0);
        const rFal = Number(r.falhadas ?? 0);
        const rPen = Number(r.pendentes ?? Math.max(0, rTot - rEnt - rFal));
        const rPct = Number(r.percent_complete ?? (rTot > 0 ? Math.round((rEnt / rTot) * 100) : 0));
        const hasDrv = Boolean(r.has_driver && r.driver_name && r.driver_name.trim() !== "");

        return {
          ...r,
          route_name: rName,
          route_id: rName,
          vehicle_id: rVeh,
          vehicle: rVeh,
          has_driver: hasDrv,
          total_stops: rTot,
          total: rTot,
          entregues: rEnt,
          falhadas: rFal,
          pendentes: rPen,
          percent_complete: rPct,
          stops: (r.stops || []).map((s, sIdx) => ({
            ...s,
            sequence: Number(s.sequence ?? sIdx + 1),
            cliente: s.cliente || s.client_name || s.morada || s.address || `Paragem #${s.sequence || sIdx + 1}`,
            client_name: s.client_name || s.cliente || s.morada || s.address || `Paragem #${s.sequence || sIdx + 1}`,
            morada: s.morada || s.address || "",
            address: s.address || s.morada || "",
            localidade: s.localidade || s.locality || "",
            locality: s.locality || s.localidade || "",
            telefone: s.telefone || s.phone || "",
            phone: s.phone || s.telefone || "",
            status: s.status || "Pendente",
          })),
        };
      })
      .filter((r) => r.total_stops > 0); // Exclui veículos sem distribuição
  }, [rawRoutes]);

  const rawDrivers = data?.available_drivers || data?.drivers || [];
  const drivers: string[] = rawDrivers.map((d: any) => (typeof d === "string" ? d : d?.name)).filter(Boolean);

  const failReasons: string[] = data?.fail_reasons || data?.reasons || [
    "Cliente Ausente",
    "Morada Incorreta / Incompleta",
    "Recusado pelo Cliente",
    "Avaria na Viatura",
    "Fora de Horário",
    "Acesso Bloqueado",
    "Outro Motivo",
  ];

  const lastTelemetry: Record<string, any> = data?.last_telemetry || {};

  // Totais calculados
  const totalStops = activeRoutes.reduce((acc, r) => acc + (r.total_stops || 0), 0);
  const totalEntregues = activeRoutes.reduce((acc, r) => acc + (r.entregues || 0), 0);
  const totalFalhadas = activeRoutes.reduce((acc, r) => acc + (r.falhadas || 0), 0);
  const totalPendentes = activeRoutes.reduce((acc, r) => acc + (r.pendentes || 0), 0);
  const globalPercent = totalStops > 0 ? Math.round((totalEntregues / totalStops) * 100) : 0;
  const routesWithDriver = activeRoutes.filter((r) => r.has_driver).length;

  // Filtragem por pesquisa de texto
  const filteredTableRoutes = useMemo(() => {
    if (!searchFilter.trim()) return activeRoutes;
    const q = searchFilter.toLowerCase();
    return activeRoutes.filter(
      (r) =>
        (r.route_name || "").toLowerCase().includes(q) ||
        (r.vehicle_id || "").toLowerCase().includes(q) ||
        (r.driver_name || "").toLowerCase().includes(q) ||
        (r.next_stop?.cliente || "").toLowerCase().includes(q)
    );
  }, [activeRoutes, searchFilter]);

  const allSelected =
    activeRoutes.length > 0 && selectedRouteIds.length === activeRoutes.length;

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-[1700px] mx-auto pb-12">
        {/* Cabeçalho de Controlo */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-zinc-900 border border-zinc-800 p-5 rounded-2xl shadow-sm">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xl">📡</span>
              <h1 className="text-2xl font-bold tracking-tight">
                Torre de Controlo & Acompanhamento
              </h1>
              {data?.is_active ? (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                  <span>🟢 ROTAS ATIVAS NA RUA</span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-zinc-800 text-zinc-400 border border-zinc-700">
                  <span>⚪ EM PLANEAMENTO (INATIVO NA APP)</span>
                </span>
              )}
              {data?.company_key && (
                <div className="flex items-center gap-1.5 bg-purple-950/50 border border-purple-800/60 px-3 py-1 rounded-xl text-xs text-purple-300">
                  <span className="font-semibold text-[11px] uppercase tracking-wider text-purple-400">Chave da Empresa:</span>
                  <span className="font-mono font-bold text-white bg-purple-900/80 px-2 py-0.5 rounded border border-purple-700">{data.company_key}</span>
                  <button
                    onClick={() => {
                      if (navigator.clipboard) {
                        navigator.clipboard.writeText(data.company_key);
                        alert(`Chave da Empresa copiada: ${data.company_key}`);
                      }
                    }}
                    className="p-1 hover:text-white cursor-pointer transition-colors text-xs"
                    title="Copiar Chave para Motoristas"
                  >
                    📋
                  </button>
                </div>
              )}
            </div>
            <p className="text-sm opacity-80 mt-1">
              Painel de controlo da frota em distribuição, telemetria em tempo real e visualização geográfica filtrada.
            </p>
          </div>

          {/* Ferramentas de Controlo e Auto-Refresh */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Botão de Ativar / Desativar Rotas para Motoristas */}
            <button
              onClick={handleToggleActivateProject}
              disabled={togglingActive || !selectedProject?.id || activeRoutes.length === 0}
              className={`flex items-center gap-2 text-xs font-extrabold px-4 py-2.5 rounded-xl transition-all shadow-md cursor-pointer disabled:opacity-50 ${
                data?.is_active
                  ? "bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/30"
                  : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-900/30"
              }`}
            >
              {togglingActive ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>A Processar...</span>
                </>
              ) : data?.is_active ? (
                <>
                  <span>⏸️</span>
                  <span>Desativar Acesso Motoristas</span>
                </>
              ) : (
                <>
                  <span>🚀</span>
                  <span>Ativar Rotas (Lançar para a Rua)</span>
                </>
              )}
            </button>

            {/* Botão de Atribuição Automática de Motoristas */}
            <button
              onClick={handleAutoAssignAll}
              disabled={autoAssigning || !selectedProject?.id || activeRoutes.length === 0}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-all shadow-md shadow-indigo-900/30 cursor-pointer disabled:opacity-50"
            >
              {autoAssigning ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>A Atribuir Motoristas...</span>
                </>
              ) : (
                <>
                  <span className="text-sm">⚡</span>
                  <span>Atribuir Motoristas Auto</span>
                </>
              )}
            </button>

            {/* Seletor de Modo de Visualização */}
            <div className="flex bg-zinc-850 p-1 rounded-xl border border-zinc-700">
              <button
                onClick={() => setViewMode("split")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  viewMode === "split"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "opacity-70 hover:opacity-100"
                }`}
              >
                Dividido
              </button>
              <button
                onClick={() => setViewMode("map")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  viewMode === "map"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "opacity-70 hover:opacity-100"
                }`}
              >
                Apenas Mapa
              </button>
              <button
                onClick={() => setViewMode("table")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  viewMode === "table"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "opacity-70 hover:opacity-100"
                }`}
              >
                Apenas Tabela
              </button>
            </div>

            {/* Seletor de Intervalo */}
            <div className="flex items-center gap-2 bg-zinc-850 px-3 py-1.5 rounded-xl border border-zinc-700 text-xs">
              <span className="opacity-70 font-medium">Auto-Sync:</span>
              <select
                value={autoRefreshSecs}
                onChange={(e) => setAutoRefreshSecs(Number(e.target.value))}
                aria-label="Intervalo de Atualização Automática"
                className="bg-transparent font-bold focus:outline-none cursor-pointer"
              >
                <option value={10} className="bg-zinc-900 text-white">10s</option>
                <option value={15} className="bg-zinc-900 text-white">15s</option>
                <option value={30} className="bg-zinc-900 text-white">30s</option>
                <option value={60} className="bg-zinc-900 text-white">1 min</option>
                <option value={0} className="bg-zinc-900 text-white">Pausa</option>
              </select>
            </div>

            {/* Botão de Atualizar Agora */}
            <button
              onClick={() => fetchTracking(false)}
              disabled={isRefreshing}
              className="flex items-center gap-2 bg-zinc-850 hover:bg-zinc-800 text-xs font-semibold px-3.5 py-2 rounded-xl border border-zinc-700 transition-colors cursor-pointer"
            >
              <span className={`text-sm ${isRefreshing ? "animate-spin" : ""}`}>🔄</span>
              <span>{isRefreshing ? "A sincronizar..." : "Atualizar"}</span>
            </button>

            {lastUpdated && (
              <span className="text-[11px] opacity-60 hidden sm:inline font-mono">
                Sync: {lastUpdated}
              </span>
            )}
          </div>
        </div>

        {/* Resumo Global de KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
          <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
            <span className="text-xs opacity-70 font-medium block">Total Paragens</span>
            <span className="text-2xl font-black mt-1 block">{totalStops}</span>
            <span className="text-[11px] font-semibold text-indigo-500 mt-1 block">
              {routesWithDriver}/{activeRoutes.length} Viaturas Atribuídas
            </span>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold block">Entregues</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{totalEntregues}</span>
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold">{globalPercent}%</span>
            </div>
            <div className="h-1.5 w-full bg-zinc-800 rounded-full mt-2 overflow-hidden">
              <div
                style={{ width: `${globalPercent}%` }}
                className="h-full bg-emerald-500 rounded-full"
              />
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
            <span className="text-xs text-rose-600 dark:text-rose-400 font-semibold block">Insucessos / Falhadas</span>
            <span className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-1 block">{totalFalhadas}</span>
            <span className="text-[11px] opacity-70 mt-1 block">
              {totalStops > 0 ? Math.round((totalFalhadas / totalStops) * 100) : 0}% taxa de falha
            </span>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
            <span className="text-xs text-sky-600 dark:text-sky-400 font-semibold block">Pendentes / Em Rua</span>
            <span className="text-2xl font-black text-sky-600 dark:text-sky-400 mt-1 block">{totalPendentes}</span>
            <span className="text-[11px] opacity-70 mt-1 block">Próximas entregas na fila</span>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl col-span-2 sm:col-span-4 lg:col-span-1">
            <span className="text-xs opacity-70 font-medium block">Filtro no Mapa</span>
            <div className="flex items-center gap-1.5 mt-2">
              <span className="text-xs font-bold bg-indigo-500/10 text-indigo-500 border border-indigo-500/30 px-2 py-1 rounded-lg">
                {selectedRouteIds.length} / {activeRoutes.length} no mapa
              </span>
              <button
                onClick={allSelected ? deselectAllRoutes : selectAllRoutes}
                className="text-[11px] font-bold px-2 py-1 bg-zinc-850 hover:bg-zinc-800 rounded border border-zinc-700 cursor-pointer"
              >
                {allSelected ? "Limpar" : "Todos"}
              </button>
            </div>
          </div>
        </div>

        {/* Conteúdo Principal (Mapa + Tabela Tipo Excel) */}
        {!selectedProject?.id ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center opacity-70">
            <div className="text-4xl mb-3">📁</div>
            <h3 className="text-lg font-bold">Nenhum Projeto Selecionado</h3>
            <p className="text-sm mt-1">Por favor selecione um projeto no topo para carregar o mapa de acompanhamento.</p>
          </div>
        ) : activeRoutes.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center opacity-70">
            <div className="text-4xl mb-3">🗺️</div>
            <h3 className="text-lg font-bold">Nenhum Plano de Rotas Ativo</h3>
            <p className="text-sm mt-1">Gere um plano de rotas no módulo de Otimização Tática para iniciar o acompanhamento.</p>
          </div>
        ) : (
          <div
            className={`grid gap-6 ${
              viewMode === "split"
                ? "grid-cols-1 lg:grid-cols-12"
                : "grid-cols-1"
            }`}
          >
            {/* Visualização de Mapa (Limpo, sem armazéns poluentes) */}
            {viewMode !== "table" && (
              <div
                className={`bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-sm flex flex-col ${
                  viewMode === "split" ? "lg:col-span-6 h-[740px]" : "h-[800px]"
                }`}
              >
                <div className="p-3.5 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider">
                    <span className="text-base">🗺️</span>
                    <span>Mapa em Direto ({selectedRouteIds.length} Viaturas Selecionadas)</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-semibold">
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Entregue
                    </span>
                    <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" /> Falhada
                    </span>
                    <span className="flex items-center gap-1 text-sky-600 dark:text-sky-400">
                      <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block" /> Pendente
                    </span>
                  </div>
                </div>

                <div className="flex-1 w-full relative">
                  <TrackingMap
                    routes={activeRoutes as TrackingRoute[]}
                    selectedRouteIds={selectedRouteIds}
                    lastTelemetry={lastTelemetry}
                    onStatusUpdate={(routeId: string, seq: number, newStatus: string, reason?: string, notes?: string) =>
                      handleUpdateStopStatus(routeId, seq, newStatus, reason, notes)
                    }
                  />
                </div>
              </div>
            )}

            {/* Tabela Interativa de Viaturas / Rotas Tipo Excel */}
            {viewMode !== "map" && (
              <div
                className={`bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-sm flex flex-col ${
                  viewMode === "split" ? "lg:col-span-6 h-[740px]" : "h-auto"
                }`}
              >
                {/* Barra Superior da Tabela Tipo Excel */}
                <div className="p-3.5 bg-zinc-900 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-base">📊</span>
                    <h3 className="text-xs font-bold uppercase tracking-wider">
                      Tabela de Viaturas & Distribuição ({filteredTableRoutes.length})
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Pesquisa na Tabela */}
                    <input
                      type="text"
                      placeholder="Pesquisar rota, motorista..."
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className="bg-zinc-850 px-3 py-1.5 rounded-lg border border-zinc-700 text-xs font-medium focus:outline-none w-44"
                    />

                    {/* Ações de Seleção em Massa */}
                    <button
                      onClick={allSelected ? deselectAllRoutes : selectAllRoutes}
                      className="px-2.5 py-1.5 bg-zinc-850 hover:bg-zinc-800 text-[11px] font-bold rounded-lg border border-zinc-700 cursor-pointer"
                    >
                      {allSelected ? "Desmarcar Todos" : "Selecionar Todos"}
                    </button>
                  </div>
                </div>

                {/* Tabela Excel de Viaturas */}
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 bg-zinc-850 z-10 border-b border-zinc-700 text-[10px] font-black uppercase tracking-wider select-none">
                      <tr>
                        <th className="py-2.5 px-3 text-center w-10">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={allSelected ? deselectAllRoutes : selectAllRoutes}
                            className="rounded cursor-pointer"
                            title="Selecionar/Desmarcar Todas para o Mapa"
                          />
                        </th>
                        <th className="py-2.5 px-2 text-center w-8"></th>
                        <th className="py-2.5 px-3 min-w-[130px]">Rota / Viatura</th>
                        <th className="py-2.5 px-3 min-w-[160px]">Motorista</th>
                        <th className="py-2.5 px-3 min-w-[120px] text-center">Progresso</th>
                        <th className="py-2.5 px-3 min-w-[200px]">Próximo Cliente</th>
                        <th className="py-2.5 px-2 text-center w-20">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/80">
                      {filteredTableRoutes.map((route, routeIdx) => {
                        const rName = route.route_name || route.route_id || `Rota_${routeIdx + 1}`;
                        const isSelectedInMap = selectedRouteIds.includes(rName);
                        const isExpanded = expandedRoutes[rName] === true;
                        const nextStop = route.next_stop;
                        const hasDriver = route.has_driver;

                        return (
                          <React.Fragment key={`route-row-${rName}`}>
                            {/* Linha Principal da Viatura */}
                            <tr
                              className={`transition-colors ${
                                isSelectedInMap
                                  ? "bg-indigo-500/5 hover:bg-indigo-500/10"
                                  : "hover:bg-zinc-850/50"
                              }`}
                            >
                              {/* Checkbox para Exibir no Mapa */}
                              <td className="py-2.5 px-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={isSelectedInMap}
                                  onChange={() => toggleSelectRoute(rName)}
                                  className="rounded cursor-pointer"
                                  title={isSelectedInMap ? "Ocultar do Mapa" : "Mostrar no Mapa"}
                                />
                              </td>

                              {/* Botão de Expandir / Recolher Sub-tabela de Paragens */}
                              <td className="py-2.5 px-2 text-center">
                                <button
                                  onClick={() => toggleRoute(rName)}
                                  className="text-[11px] font-bold opacity-70 hover:opacity-100 p-1 cursor-pointer"
                                  title={isExpanded ? "Recolher paragens" : "Ver paragens detalhadas"}
                                >
                                  {isExpanded ? "▼" : "▶"}
                                </button>
                              </td>

                              {/* Rota / Viatura */}
                              <td className="py-2.5 px-3">
                                <div className="flex items-center gap-1.5">
                                  <span className="bg-indigo-600 text-white font-extrabold text-[11px] px-2 py-0.5 rounded shadow-sm">
                                    {rName}
                                  </span>
                                  <span className="font-mono text-[10px] opacity-75">
                                    {route.vehicle_id || "-"}
                                  </span>
                                </div>
                              </td>

                              {/* Motorista */}
                              <td className="py-2.5 px-3">
                                <select
                                  value={route.driver_name || ""}
                                  onChange={(e) => handleAssignDriver(rName, e.target.value)}
                                  aria-label={`Motorista da rota ${rName}`}
                                  className={`text-xs font-bold py-1 px-2 rounded border focus:outline-none cursor-pointer w-full max-w-[150px] ${
                                    hasDriver
                                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                                  }`}
                                >
                                  <option value="" className="bg-zinc-900 text-white">-- Sem Motorista --</option>
                                  {drivers.map((drv, drvIdx) => (
                                    <option key={`drv-sel-${rName}-${drvIdx}`} value={drv} className="bg-zinc-900 text-white">
                                      {drv}
                                    </option>
                                  ))}
                                </select>
                              </td>

                              {/* Progresso de Entregas */}
                              <td className="py-2.5 px-3 text-center">
                                <div className="flex flex-col items-center">
                                  <span className="font-black text-xs text-emerald-600 dark:text-emerald-400">
                                    {route.entregues}/{route.total_stops} ({route.percent_complete}%)
                                  </span>
                                  <div className="h-1.5 w-16 bg-zinc-800 rounded-full overflow-hidden mt-1 flex">
                                    <div
                                      style={{ width: `${route.percent_complete}%` }}
                                      className="bg-emerald-500"
                                    />
                                    <div
                                      style={{
                                        width: `${((route.falhadas || 0) / (route.total_stops || 1)) * 100}%`,
                                      }}
                                      className="bg-rose-500"
                                    />
                                  </div>
                                </div>
                              </td>

                              {/* Próximo Cliente a Entregar */}
                              <td className="py-2.5 px-3">
                                {!hasDriver ? (
                                  <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                                    🅿️ Aguarda Motorista
                                  </span>
                                ) : nextStop ? (
                                  <div className="flex items-center justify-between gap-1.5">
                                    <div className="truncate max-w-[140px]">
                                      <span className="font-extrabold text-[11px] text-sky-600 dark:text-sky-400">
                                        #{nextStop.sequence} {nextStop.cliente || nextStop.client_name}
                                      </span>
                                      <span className="block text-[10px] opacity-70 truncate">
                                        {nextStop.morada}
                                      </span>
                                    </div>
                                    <button
                                      onClick={() => {
                                        setEditingStop({ routeId: rName, stop: nextStop });
                                        setEditStatus("Entregue");
                                        setEditReason(failReasons[0]);
                                        setEditNotes("");
                                      }}
                                      className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-[10px] shrink-0 cursor-pointer"
                                      title="Marcar entrega concluída"
                                    >
                                      ✓ Entregar
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                                    🏁 Concluída
                                  </span>
                                )}
                              </td>

                              {/* Ações (Focar Mapa) */}
                              <td className="py-2.5 px-2 text-center">
                                <button
                                  onClick={() => focusSingleRoute(rName)}
                                  className="px-2 py-1 bg-zinc-850 hover:bg-zinc-800 text-[10px] font-bold rounded border border-zinc-700 cursor-pointer"
                                  title="Ver apenas esta viatura no mapa"
                                >
                                  🎯 Focar
                                </button>
                              </td>
                            </tr>

                            {/* Sub-tabela Expandida de Paragens da Rota */}
                            {isExpanded && (
                              <tr className="bg-zinc-950/60">
                                <td colSpan={7} className="p-3">
                                  <div className="rounded-xl border border-zinc-800 overflow-hidden">
                                    <div className="p-2 bg-zinc-850 border-b border-zinc-800 flex items-center justify-between text-[11px] font-bold">
                                      <span>📋 Sequência de Entregas da {rName} ({route.stops.length} Paragens)</span>
                                      <span className="opacity-75">
                                        Carga: {Math.round(route.stops.reduce((a, s) => a + (s.peso_kg || s.weight_kg || 0), 0))} kg
                                      </span>
                                    </div>

                                    <table className="w-full text-left text-xs border-collapse">
                                      <thead className="bg-zinc-900 border-b border-zinc-800 text-[10px] font-black uppercase tracking-wider opacity-75">
                                        <tr>
                                          <th className="py-2 px-3 text-center w-12">#</th>
                                          <th className="py-2 px-3">Cliente</th>
                                          <th className="py-2 px-3">Morada & Localidade</th>
                                          <th className="py-2 px-2 text-center">Janela</th>
                                          <th className="py-2 px-2 text-center">Estado</th>
                                          <th className="py-2 px-2 text-center">Ação</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-zinc-800/60">
                                        {route.stops.map((stop) => {
                                          const isDone = stop.status === "Entregue";
                                          const isFail = stop.status === "Não Entregue" || stop.status === "Nao Entregue";
                                          const isNext = nextStop?.sequence === stop.sequence;

                                          return (
                                            <tr
                                              key={`substop-${rName}-${stop.sequence}`}
                                              className={`hover:bg-zinc-850/40 transition-colors ${
                                                isNext ? "bg-sky-500/10" : ""
                                              }`}
                                            >
                                              <td className="py-2 px-3 text-center font-bold font-mono">
                                                <span
                                                  className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] font-black ${
                                                    isDone
                                                      ? "bg-emerald-500 text-white"
                                                      : isFail
                                                      ? "bg-rose-500 text-white"
                                                      : isNext
                                                      ? "bg-sky-500 text-white ring-2 ring-sky-300"
                                                      : "bg-zinc-800 opacity-80"
                                                  }`}
                                                >
                                                  {isDone ? "✓" : isFail ? "✕" : stop.sequence}
                                                </span>
                                              </td>

                                              <td className="py-2 px-3 font-bold">
                                                <div>{stop.cliente || stop.morada}</div>
                                                {stop.telefone && (
                                                  <a
                                                    href={`tel:${stop.telefone}`}
                                                    className="text-sky-600 dark:text-sky-400 text-[10px] font-semibold hover:underline"
                                                  >
                                                    📞 {stop.telefone}
                                                  </a>
                                                )}
                                              </td>

                                              <td className="py-2 px-3 text-[11px] opacity-80">
                                                {stop.morada}{stop.localidade ? `, ${stop.localidade}` : ""}
                                              </td>

                                              <td className="py-2 px-2 text-center text-[11px] font-mono opacity-80">
                                                {stop.janela_inicio || "08:00"} - {stop.janela_fim || "18:00"}
                                              </td>

                                              <td className="py-2 px-2 text-center">
                                                <span
                                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                                    isDone
                                                      ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                                                      : isFail
                                                      ? "bg-rose-500/20 text-rose-600 dark:text-rose-400"
                                                      : "bg-sky-500/20 text-sky-600 dark:text-sky-400"
                                                  }`}
                                                >
                                                  {stop.status}
                                                </span>
                                                {stop.hora_entrega_real && (
                                                  <span className="block text-[9px] opacity-60 font-mono">
                                                    {stop.hora_entrega_real.substring(11, 16)}
                                                  </span>
                                                )}
                                              </td>

                                              <td className="py-2 px-2 text-center">
                                                <button
                                                  onClick={() => {
                                                    setEditingStop({ routeId: rName, stop });
                                                    setEditStatus(stop.status || "Entregue");
                                                    setEditReason(stop.motivo_falha || failReasons[0]);
                                                    setEditNotes(stop.notas_motorista || "");
                                                  }}
                                                  className="px-2 py-0.5 bg-zinc-850 hover:bg-zinc-800 text-[10px] font-bold rounded border border-zinc-700 cursor-pointer"
                                                >
                                                  Editar
                                                </button>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Modal de Atualização de Estado / Intervenção */}
        {editingStop && (
          <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                <h3 className="text-base font-black">
                  Registar Estado da Paragem #{editingStop.stop.sequence}
                </h3>
                <button
                  onClick={() => setEditingStop(null)}
                  className="opacity-70 hover:opacity-100 text-sm font-bold cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="text-xs bg-zinc-850 p-3 rounded-xl border border-zinc-700">
                <p className="font-extrabold">{editingStop.stop.cliente || editingStop.stop.morada}</p>
                <p className="mt-0.5 opacity-80">{editingStop.stop.morada}{editingStop.stop.localidade ? `, ${editingStop.stop.localidade}` : ""}</p>
                <p className="mt-0.5 font-bold text-indigo-500">Rota: {editingStop.routeId}</p>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-bold mb-1">Estado da Entrega:</label>
                  <div className="grid grid-cols-3 gap-2">
                    {["Entregue", "Não Entregue", "Pendente"].map((st) => (
                      <button
                        key={`btn-status-${st}`}
                        type="button"
                        onClick={() => setEditStatus(st)}
                        className={`py-2 px-3 rounded-lg font-bold border text-center transition-colors cursor-pointer ${
                          editStatus === st
                            ? st === "Entregue"
                              ? "bg-emerald-600 text-white border-emerald-600 shadow"
                              : st === "Não Entregue"
                              ? "bg-rose-600 text-white border-rose-600 shadow"
                              : "bg-sky-600 text-white border-sky-600 shadow"
                            : "bg-zinc-850 border-zinc-700 hover:bg-zinc-800 opacity-80"
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>

                {(editStatus === "Não Entregue" || editStatus === "Nao Entregue") && (
                  <div>
                    <label className="block font-bold mb-1">Motivo do Insucesso:</label>
                    <select
                      value={editReason}
                      onChange={(e) => setEditReason(e.target.value)}
                      aria-label="Motivo do Insucesso"
                      className="w-full bg-zinc-850 font-semibold p-2 rounded-lg border border-zinc-700 focus:outline-none"
                    >
                      {failReasons.map((r, rIdx) => (
                        <option key={`fail-reason-${rIdx}`} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block font-bold mb-1">Notas / Observações:</label>
                  <textarea
                    rows={3}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Ex: Cliente pediu para deixar na portaria / Portão fechado..."
                    className="w-full bg-zinc-800 p-2.5 rounded-lg border border-zinc-700 focus:outline-none text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setEditingStop(null)}
                  className="px-4 py-2 bg-zinc-850 hover:bg-zinc-800 rounded-xl text-xs font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={submitStopModal}
                  disabled={updatingStop}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer"
                >
                  {updatingStop && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  <span>Guardar Alteração</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
