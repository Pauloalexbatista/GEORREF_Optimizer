"use client";

import React, { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useProjects } from "@/context/ProjectContext";
import { useI18n } from "@/context/I18nContext";
import { apiRequest } from "@/utils/api";

export default function TrackingPage() {
  const { selectedProject } = useProjects();
  const { t } = useI18n();

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [expandedRoutes, setExpandedRoutes] = useState<Set<string>>(new Set());

  const fetchTracking = async () => {
    if (!selectedProject) return;
    try {
      const res = await apiRequest(`/api/tracking/${selectedProject.id}`);
      setData(res);
    } catch (err) {
      console.error("Failed to load tracking data", err);
    }
  };

  useEffect(() => {
    fetchTracking();
    const interval = setInterval(fetchTracking, 10000);
    return () => clearInterval(interval);
  }, [selectedProject]);

  const toggleRoute = (routeId: string) => {
    setExpandedRoutes((prev) => {
      const next = new Set(prev);
      if (next.has(routeId)) {
        next.delete(routeId);
      } else {
        next.add(routeId);
      }
      return next;
    });
  };

  const handleAssignDriver = async (routeName: string, driverName: string) => {
    if (!selectedProject) return;

    // Optimistic UI update
    setData((prev: any) => {
      if (!prev) return prev;
      const updatedRoutes = prev.routes.map((r: any) => {
        if (r.route_id === routeName) {
          return { ...r, driver_name: driverName || "Não Atribuído" };
        }
        return r;
      });
      return { ...prev, routes: updatedRoutes };
    });

    try {
      await apiRequest(`/api/tracking/assign/${selectedProject.id}`, {
        method: "POST",
        body: JSON.stringify({
          route_name: routeName,
          driver_name: driverName,
        }),
      });
    } catch (err: any) {
      console.error("Erro ao atribuir motorista à rota:", err);
      fetchTracking();
    }
  };

  const totals = data?.totals || { total_stops: 0, entregues: 0, falhadas: 0, pendentes: 0, rate: 0 };
  const routes = data?.routes || [];
  const drivers = data?.drivers || [];

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-900/60 p-6 rounded-2xl border border-zinc-800 backdrop-blur-xl">
          <div>
            <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
              <span>📱</span> 4. Acompanhamento das Rotas ao Vivo
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Supervisão em tempo real de viaturas, picagens de entregas e atribuição de motoristas às rotas planeadas.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchTracking}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border border-zinc-700"
            >
              🔄 Atualizar Agora
            </button>
            <a
              href="https://driver.testeweb.cloud"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/20 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              🚚 Abrir App Motoristas ↗
            </a>
          </div>
        </div>

        {/* Global KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
            <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Total Clientes</div>
            <div className="text-2xl font-black text-zinc-100 mt-1">{totals.total_stops}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
            <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Taxa de Sucesso</div>
            <div className="text-2xl font-black text-emerald-400 mt-1">{totals.rate}%</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
            <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Entregues</div>
            <div className="text-2xl font-black text-emerald-400 mt-1">{totals.entregues}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
            <div className="text-[11px] font-bold text-rose-400 uppercase tracking-wider">Falhadas</div>
            <div className="text-2xl font-black text-rose-400 mt-1">{totals.falhadas}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
            <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Pendentes</div>
            <div className="text-2xl font-black text-zinc-300 mt-1">{totals.pendentes}</div>
          </div>
        </div>

        {/* Live Routes Table */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/80">
            <div>
              <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                <span>🚚</span> Rotas em Execução & Atribuição de Motoristas ({routes.length})
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Selecione o motorista responsável por cada rota planeada e acompanhe o progresso das descargas.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/80 text-zinc-400 font-bold uppercase text-[10px]">
                  <th className="py-3 px-4">Rota / Plano</th>
                  <th className="py-3 px-4 w-60">Motorista Responsável</th>
                  <th className="py-3 px-4">Viatura / Matrícula</th>
                  <th className="py-3 px-4">Progresso Real</th>
                  <th className="py-3 px-4 text-center">Insucessos</th>
                  <th className="py-3 px-4 text-center">Último Sinal</th>
                  <th className="py-3 px-4 text-right">Detalhes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-sans">
                {routes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-zinc-500">
                      Nenhuma rota planeada encontrada para este projeto. Execute primeiro o cálculo no passo 3. Planeamento.
                    </td>
                  </tr>
                ) : (
                  routes.map((r: any) => {
                    const isExpanded = expandedRoutes.has(r.route_id);
                    const pct = r.total > 0 ? Math.round((r.entregues / r.total) * 100) : 0;

                    return (
                      <React.Fragment key={r.route_id}>
                        <tr
                          onClick={() => toggleRoute(r.route_id)}
                          className="hover:bg-zinc-850/50 transition-colors cursor-pointer"
                        >
                          <td className="py-3 px-4 font-bold text-indigo-400 flex items-center gap-2">
                            <span className="text-zinc-400 text-[10px]">{isExpanded ? "▼" : "▶"}</span>
                            <span>{r.route_id}</span>
                          </td>
                          <td
                            className="py-3 px-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <select
                              value={r.driver_name === "Não Atribuído" ? "" : r.driver_name}
                              onChange={(e) => handleAssignDriver(r.route_id, e.target.value)}
                              className={`bg-zinc-900 border text-xs font-semibold px-2.5 py-1.5 rounded-lg cursor-pointer transition-all outline-none w-full max-w-[220px] ${
                                r.driver_name && r.driver_name !== "Não Atribuído"
                                  ? "text-indigo-300 font-bold border-indigo-500/60 bg-indigo-950/20"
                                  : "text-amber-400 border-amber-500/50 bg-amber-950/20"
                              }`}
                            >
                              <option value="">⚠️ Não Atribuído</option>
                              {drivers.map((d: any) => (
                                <option key={d.name} value={d.name}>
                                  👤 {d.name} {d.matricula ? `[${d.matricula}]` : ""} {d.phone ? `(${d.phone})` : ""}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-3 px-4 text-zinc-300 font-mono text-[11px]">{r.vehicle}</td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2 w-36">
                              <div className="flex-1 bg-zinc-800 rounded-full h-2 overflow-hidden">
                                <div className="bg-emerald-500 h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[11px] font-bold text-zinc-300">{r.entregues}/{r.total} ({pct}%)</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center">
                            {r.falhadas > 0 ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border-rose-500/30">
                                {r.falhadas}
                              </span>
                            ) : (
                              <span className="text-zinc-400 font-mono">0</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center text-zinc-400 text-[11px] font-mono">
                            {r.last_gps_time || "Sem sinal"}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleRoute(r.route_id);
                              }}
                              className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-[11px] font-semibold border border-zinc-700 cursor-pointer"
                            >
                              {isExpanded ? "Ocultar" : "🔍 Ver Paragens"}
                            </button>
                          </td>
                        </tr>

                        {/* Expanded Stops Accordion */}
                        {isExpanded && (
                          <tr className="bg-zinc-950/60">
                            <td colSpan={7} className="p-4">
                              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                                <div className="p-2.5 bg-zinc-850 border-b border-zinc-800 flex justify-between items-center text-xs font-bold text-zinc-200">
                                  <span>📦 Lista de Clientes & Picagens ({r.stops.length} paragens)</span>
                                  <span className="text-[11px] text-zinc-400 font-normal">Motorista Atribuído: <strong className="text-indigo-400">{r.driver_name}</strong> | Viatura: {r.vehicle}</span>
                                </div>
                                <table className="w-full text-left text-xs border-collapse">
                                  <thead>
                                    <tr className="bg-zinc-900 text-zinc-400 uppercase text-[9px] border-b border-zinc-800">
                                      <th className="py-2 px-3 text-center">#</th>
                                      <th className="py-2 px-3">Cliente & Morada</th>
                                      <th className="py-2 px-3">Contacto</th>
                                      <th className="py-2 px-3">Janela Prevista</th>
                                      <th className="py-2 px-3">Picagem Real</th>
                                      <th className="py-2 px-3">Estado</th>
                                      <th className="py-2 px-3">Notas do Motorista</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-zinc-800/40">
                                    {r.stops.map((s: any) => {
                                      const isEntregue = s.status === "Entregue";
                                      const isFalhada = s.status === "Não Entregue";
                                      return (
                                        <tr key={s.sequence} className="hover:bg-zinc-850/30">
                                          <td className="py-2 px-3 text-center font-bold text-zinc-400">#{s.sequence}</td>
                                          <td className="py-2 px-3">
                                            <div className="font-bold text-zinc-100">{s.client_name}</div>
                                            <div className="text-[10px] text-zinc-400">{s.address} {s.postal_code}</div>
                                          </td>
                                          <td className="py-2 px-3 text-zinc-300 font-mono text-[11px]">{s.phone || "-"}</td>
                                          <td className="py-2 px-3 text-zinc-300 font-mono text-[11px]">{s.window_start} - {s.window_end}</td>
                                          <td className="py-2 px-3 font-mono text-[11px]">
                                            {s.actual_arrival_time ? (
                                              <span className="text-emerald-400 font-bold">⏱️ {s.actual_arrival_time}</span>
                                            ) : (
                                              <span className="text-zinc-400">Pendente</span>
                                            )}
                                          </td>
                                          <td className="py-2 px-3">
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                              isEntregue
                                                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                                : isFalhada
                                                ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                                                : "bg-zinc-800 text-zinc-400 border-zinc-700"
                                            }`}>
                                              {s.status}
                                            </span>
                                            {s.fail_reason && (
                                              <div className="text-[10px] text-rose-400 mt-0.5">{s.fail_reason}</div>
                                            )}
                                          </td>
                                          <td className="py-2 px-3 text-[11px] text-zinc-400 italic">
                                            {s.driver_notes ? `"${s.driver_notes}"` : "-"}
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
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
