"use client";

import React, { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useProjects } from "@/context/ProjectContext";
import { useI18n } from "@/context/I18nContext";
import { apiRequest } from "@/utils/api";
import dynamic from "next/dynamic";

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

  const totals = data?.totals || { total_stops: 0, entregues: 0, falhadas: 0, pendentes: 0, rate: 0 };
  const routes = data?.routes || [];

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
              Supervisão em tempo real de viaturas, picagens de entregas e resolução de ocorrências.
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
            <div className="text-2xl font-black text-zinc-400 mt-1">{totals.pendentes}</div>
          </div>
        </div>

        {/* Routes Progress Table with Accordion */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/40">
            <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
              <span>🚚</span> Progresso por Rota & Picagens
            </h2>
            <span className="text-xs text-zinc-400">
              {routes.length} rotas ativas
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/80 text-zinc-400 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">Rota</th>
                  <th className="py-3 px-4">Motorista</th>
                  <th className="py-3 px-4">Viatura</th>
                  <th className="py-3 px-4">Progresso</th>
                  <th className="py-3 px-4 text-center">Falhas</th>
                  <th className="py-3 px-4 text-center">Último Sinal</th>
                  <th className="py-3 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-medium">
                {routes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-zinc-400">
                      Nenhuma rota calculada para o projeto selecionado. Calcule as rotas no menu Planeamento.
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
                          <td className="py-3 px-4 text-zinc-200">{r.driver_name}</td>
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
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
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
                                  <span className="text-[11px] text-zinc-400 font-normal">Motorista: {r.driver_name} | Viatura: {r.vehicle}</span>
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
