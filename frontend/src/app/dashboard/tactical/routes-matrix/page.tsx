"use client";

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
];

function getRouteColor(routeName: string, vehicleList: string[]) {
  if (!routeName || routeName.includes("PENDENTE")) return "#f59e0b"; // Amber for pending
  const idx = vehicleList.indexOf(routeName);
  if (idx === -1) return routeColors[0];
  return routeColors[idx % routeColors.length];
}



import React, { useState, useEffect, useRef } from "react";
import { apiRequest } from "@/utils/api";
import { useProjects } from "@/context/ProjectContext";

interface RouteStop {
  id?: number;
  Rota: string;
  Armazem: string;
  Ordem: number;
  Cliente: string;
  Morada: string;
  CP: string;
  Localidade: string;
  Janela_Horaria: string;
  Latitude: number;
  Longitude: number;
  Chegada: string;
  Tempo_Entrega: number;
  Saida: string;
  KM_Anterior: number;
  Dist_Acum: number;
  Carga_Acum: number;
  Carga_Vol_Acum: number;
}

export default function RoutesMatrixPage() {
  const { selectedProject } = useProjects();
  const [routes, setRoutes] = useState<RouteStop[]>([]);
  const [vehicles, setVehicles] = useState<string[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("A carregar...");

  const [expandedRoutes, setExpandedRoutes] = useState<Record<string, boolean>>({
    "🚨 PENDENTE": true
  });

  const channelRef = useRef<BroadcastChannel | null>(null);

  const broadcastUpdate = (updatedRoutes: RouteStop[], vList: string[], wList: any[]) => {
    const mappedClients = updatedRoutes.map(r => ({
      Cliente: r.Cliente,
      Morada: r.Morada,
      Latitude: r.Latitude,
      Longitude: r.Longitude,
      Rota: r.Rota,
      Ordem: r.Ordem,
      Janela_Horaria: r.Janela_Horaria,
      Chegada: r.Chegada,
      Saida: r.Saida,
      KM_Anterior: r.KM_Anterior
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
      const vList = (fleetData.fleet || []).map((v: any) => v.veiculo);
      setVehicles(vList);
      setWarehouses(fleetData.warehouses || []);

      const solveRes = await apiRequest(`/api/solver/${selectedProject.id}`);
      const rList: RouteStop[] = solveRes.routes || [];
      setRoutes(rList);

      const initialExpanded: Record<string, boolean> = { "🚨 PENDENTE": true };
      vList.forEach((v: string) => { initialExpanded[v] = true; });
      setExpandedRoutes(prev => ({ ...initialExpanded, ...prev }));

      setStatusMsg(`Atualizado às ${new Date().toLocaleTimeString()}`);
      broadcastUpdate(rList, vList, fleetData.warehouses || []);
    } catch (e: any) {
      setStatusMsg("Erro ao carregar dados");
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
    setExpandedRoutes(prev => ({ ...prev, [routeName]: !prev[routeName] }));
  };

  const expandAll = () => {
    const allState: Record<string, boolean> = { "🚨 PENDENTE": true };
    vehicles.forEach(v => { allState[v] = true; });
    setExpandedRoutes(allState);
  };

  const collapseAll = () => {
    setExpandedRoutes({});
  };

  const handleReassign = async (clientCode: string, newRouteName: string) => {
    if (!selectedProject) return;
    setActionLoading(`reassign-${clientCode}`);
    try {
      const res = await apiRequest("/api/solver/reassign", {
        method: "POST",
        body: JSON.stringify({
          project_id: selectedProject.id,
          client_code: clientCode,
          new_route: newRouteName
        })
      });

      if (res.routes) {
        setRoutes(res.routes);
        broadcastUpdate(res.routes, vehicles, warehouses);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(null);
    }
  };

    const handleOptimizeSingleRoute = async (routeName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedProject) return;
    setActionLoading(`opt-${routeName}`);
    try {
      const res = await apiRequest("/api/solver/optimize-single-route", {
        method: "POST",
        body: JSON.stringify({
          project_id: selectedProject.id,
          route_name: routeName,
        }),
      });
      if (res.routes) {
        setRoutes(res.routes);
        broadcastUpdate(res.routes, vehicles, warehouses);
      }
    } catch (err: any) {
      alert(err.message || "Erro ao otimizar trajeto da rota.");
    } finally {
      setActionLoading(null);
    }
  };

const handleReorder = async (routeName: string, clientCode: string, currentOrder: number, direction: "up" | "down") => {
    if (!selectedProject) return;
    const newOrder = direction === "up" ? Math.max(1, currentOrder - 1) : currentOrder + 1;
    if (newOrder === currentOrder) return;

    setActionLoading(`reorder-${clientCode}`);
    try {
      const res = await apiRequest("/api/solver/reorder", {
        method: "POST",
        body: JSON.stringify({
          project_id: selectedProject.id,
          route_name: routeName,
          client_code: clientCode,
          new_order: newOrder
        })
      });

      if (res.routes) {
        setRoutes(res.routes);
        broadcastUpdate(res.routes, vehicles, warehouses);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(null);
    }
  };

  const allRows = ["🚨 PENDENTE", ...vehicles];

  return (
    <div className="w-screen h-screen bg-zinc-950 flex flex-col overflow-hidden text-zinc-100 font-sans">
      {/* Header Bar */}
      <div className="bg-zinc-900/95 border-b border-zinc-800 px-6 py-3 flex items-center justify-between shrink-0 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <span className="w-3 h-3 rounded-full bg-indigo-500 animate-pulse"></span>
          <div>
            <h1 className="text-sm font-bold tracking-wider uppercase text-zinc-100">
              Matriz de Gestão de Rotas — Tabela Estilo Excel (3.º Monitor)
            </h1>
            <p className="text-[10px] text-zinc-400">
              Projeto: <span className="font-semibold text-zinc-200">{selectedProject?.nome || "Carregando..."}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={expandAll}
            className="bg-zinc-800 hover:bg-zinc-750 text-zinc-300 border border-zinc-700 px-3 py-1 rounded-lg text-xs font-medium cursor-pointer"
          >
            Expandir Todas
          </button>
          <button
            onClick={collapseAll}
            className="bg-zinc-800 hover:bg-zinc-750 text-zinc-300 border border-zinc-700 px-3 py-1 rounded-lg text-xs font-medium cursor-pointer"
          >
            Colapsar Todas
          </button>
          <span className="text-[10px] font-mono bg-zinc-850 px-3 py-1 rounded-full border border-zinc-800 text-zinc-400">
            {statusMsg}
          </span>
          <button
            onClick={loadData}
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all flex items-center space-x-1.5 cursor-pointer"
          >
            <svg className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Atualizar Tabela</span>
          </button>
        </div>
      </div>

      {/* Excel Tree Table Container */}
      <div className="flex-1 overflow-auto p-6">
        <div className="border border-zinc-800 rounded-2xl bg-zinc-900/60 overflow-hidden shadow-2xl">
          <table className="w-full text-left border-collapse">
            {/* Table Header */}
            <thead>
              <tr className="bg-zinc-900 border-b border-zinc-800 text-[11px] uppercase font-bold tracking-wider text-zinc-400">
                <th className="py-3 px-4 w-12 text-center">#</th>
                <th className="py-3 px-4 w-48">Rota / Cliente</th>
                <th className="py-3 px-4">Morada / Detalhes</th>
                <th className="py-3 px-4 w-32">Janela Horária</th>
                <th className="py-3 px-4 w-28 text-center">Horário Chegada</th>
                <th className="py-3 px-4 w-28 text-center">Horário Saída</th>
                <th className="py-3 px-4 w-28 text-right">KM Acumulado</th>
                <th className="py-3 px-4 w-48 text-center">Ação / Mover Rota</th>
              </tr>
            </thead>

            {/* Table Body (Group Rows for Routes + Detail Rows for Clients) */}
            <tbody className="divide-y divide-zinc-800/60 text-xs">
              {allRows.map((rowName) => {
                const isPending = rowName.includes("PENDENTE");
                const routeStops = routes.filter(r => isPending ? r.Rota.includes("PENDENTE") : r.Rota === rowName);
                routeStops.sort((a, b) => a.Ordem - b.Ordem);

                const isExpanded = !!expandedRoutes[rowName];
                const totalDist = routeStops.length > 0 ? routeStops[routeStops.length - 1].Dist_Acum : 0;
                const totalLoad = routeStops.reduce((acc, curr) => acc + (curr.Carga_Acum || 0), 0);
                const warehouseName = routeStops[0]?.Armazem || "Base";
                const routeColor = getRouteColor(rowName, vehicles);

                return (
                  <React.Fragment key={rowName}>
                    {/* ROUTE GROUP ROW (HEADER DO VEÍCULO / PENDENTE) */}
                    <tr
                      onClick={() => toggleRoute(rowName)}
                      className={`cursor-pointer select-none font-bold text-xs transition-colors ${
                        isPending
                          ? "bg-amber-950/40 hover:bg-amber-950/60 text-amber-300 border-t-2 border-amber-900/60"
                          : "bg-zinc-900/90 hover:bg-zinc-850 text-zinc-100 border-t border-zinc-750"
                      }`}
                      style={{ borderLeft: `6px solid ${routeColor}` }}
                    >
                      <td className="py-3.5 px-4 text-center font-mono">
                        {isExpanded ? "▼" : "▶"}
                      </td>
                      <td className="py-3.5 px-4 font-bold">
                        <div className="flex items-center space-x-2.5">
                          <span className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: routeColor }} />
                          <span>{isPending ? "🚨 Entregas PENDENTES (Ficaram de Fora)" : rowName}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-zinc-400 font-normal">
                        {!isPending ? (
                          <span>Armazém Origem: <b className="text-zinc-200">{warehouseName}</b></span>
                        ) : (
                          <span className="text-amber-400/80 italic">Clientes não alocados a nenhum veículo</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-zinc-400 font-mono text-[11px]">
                        {!isPending && <span>Carga: {totalLoad.toFixed(0)} kg</span>}
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono text-indigo-400">
                        {!isPending && routeStops.length > 0 && <span>Início: 08:00</span>}
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono text-zinc-300">
                        {!isPending && routeStops.length > 0 && <span>Fim: {routeStops[routeStops.length - 1].Saida}</span>}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-indigo-400">
                        {!isPending ? `${totalDist} km` : "-"}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span 
                          className="text-[10px] font-mono font-bold px-3 py-1 rounded-full border shadow-sm"
                          style={{
                            backgroundColor: `${routeColor}20`,
                            color: isPending ? "#fcd34d" : routeColor,
                            borderColor: `${routeColor}60`
                          }}
                        >
                          {routeStops.length} entregas
                        </span>
                      </td>
                    </tr>

                    {/* CLIENT ROWS INSIDE ROUTE */}
                    {isExpanded && (
                      routeStops.length === 0 ? (
                        <tr className="bg-zinc-950/40">
                          <td colSpan={8} className="py-4 text-center text-xs text-zinc-500 italic">
                            Nenhuma entrega atribuída a esta rota.
                          </td>
                        </tr>
                      ) : (
                        routeStops.map((stop, index) => {
                          const isBusy = actionLoading === `reorder-${stop.Cliente}` || actionLoading === `reassign-${stop.Cliente}`;

                          return (
                            <tr
                              key={stop.Cliente}
                              className={`bg-zinc-950/60 hover:bg-zinc-900/80 transition-colors border-b border-zinc-850/60 ${
                                isBusy ? "opacity-50 pointer-events-none" : ""
                              }`}
                            >
                              {/* Order & Reorder Buttons */}
                              <td className="py-2.5 px-4 text-center">
                                <div className="flex items-center justify-center space-x-1.5">
                                  <span 
                                    className="w-5.5 h-5.5 rounded flex items-center justify-center text-[11px] font-mono font-bold text-white shadow-sm"
                                    style={{ backgroundColor: routeColor }}
                                  >
                                    {stop.Ordem}
                                  </span>
                                  {!isPending && (
                                    <div className="flex flex-col space-y-0.5">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleReorder(rowName, stop.Cliente, stop.Ordem, "up");
                                        }}
                                        disabled={index === 0}
                                        className="w-4 h-3.5 bg-zinc-850 hover:bg-zinc-750 disabled:opacity-20 rounded text-[9px] text-zinc-300 flex items-center justify-center cursor-pointer"
                                        title="Subir paragem"
                                      >
                                        ▲
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleReorder(rowName, stop.Cliente, stop.Ordem, "down");
                                        }}
                                        disabled={index === routeStops.length - 1}
                                        className="w-4 h-3.5 bg-zinc-850 hover:bg-zinc-750 disabled:opacity-20 rounded text-[9px] text-zinc-300 flex items-center justify-center cursor-pointer"
                                        title="Descer paragem"
                                      >
                                        ▼
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </td>

                              {/* Client Code */}
                              <td className="py-2.5 px-4 font-bold text-zinc-200">
                                {stop.Cliente}
                              </td>

                              {/* Address */}
                              <td className="py-2.5 px-4 text-zinc-300 truncate max-w-md">
                                {stop.Morada} {stop.Localidade ? `, ${stop.Localidade}` : ""}
                              </td>

                              {/* Time Window */}
                              <td className="py-2.5 px-4 font-mono text-[11px] text-zinc-400">
                                {stop.Janela_Horaria || "Qualquer"}
                              </td>

                              {/* Arrival Time */}
                              <td className="py-2.5 px-4 text-center font-mono font-bold text-indigo-400">
                                {!isPending ? stop.Chegada : "00:00"}
                              </td>

                              {/* Departure Time */}
                              <td className="py-2.5 px-4 text-center font-mono text-zinc-300">
                                {!isPending ? stop.Saida : "00:00"}
                              </td>

                              {/* Distance */}
                              <td className="py-2.5 px-4 text-right font-mono text-zinc-400">
                                {!isPending ? `+${stop.KM_Anterior} km` : "0 km"}
                              </td>

                              {/* Reassign Selector */}
                              <td className="py-2.5 px-4 text-center">
                                <select
                                  value={stop.Rota.includes("PENDENTE") ? "PENDENTE" : stop.Rota}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    handleReassign(stop.Cliente, e.target.value === "PENDENTE" ? "🚨 PENDENTE" : e.target.value);
                                  }}
                                  className="bg-zinc-900 border border-zinc-750 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500 cursor-pointer"
                                >
                                  <option value="PENDENTE">🚨 PENDENTE (Fora)</option>
                                  {vehicles.map(v => (
                                    <option key={v} value={v}>{v}</option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          );
                        })
                      )
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
