"use client";

import React, { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useProjects } from "@/context/ProjectContext";
import { useI18n } from "@/context/I18nContext";
import { apiRequest } from "@/utils/api";

export default function ReportsPage() {
  const { selectedProject } = useProjects();
  const { t } = useI18n();

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);

  const fetchReports = async () => {
    if (!selectedProject) return;
    try {
      setLoading(true);
      const res = await apiRequest(`/api/reports/${selectedProject.id}/summary`);
      setData(res);
    } catch (err) {
      console.error("Failed to load reports summary", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [selectedProject]);

  const handleExportFinal = async () => {
    if (!selectedProject) return;
    try {
      const token = localStorage.getItem("georoute_token") || localStorage.getItem("token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`/api/reports/${selectedProject.id}/export`, { headers });
      if (!res.ok) {
        // Fallback direct download
        window.open(`/api/reports/${selectedProject.id}/export`, "_blank");
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const projClean = (selectedProject.nome || `Projeto_${selectedProject.id}`).replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
      a.download = `Relatorio_Final_${projClean}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e: any) {
      window.open(`/api/reports/${selectedProject.id}/export`, "_blank");
    }
  };

  const totals = data?.totals || {
    total_stops: 0,
    entregues: 0,
    falhadas: 0,
    pendentes: 0,
    rate: 0,
    total_km: 0,
    total_weight: 0,
    total_packages: 0,
    total_routes: 0
  };
  const routes = data?.routes || [];
  const reasons = data?.reasons || {};

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-900/60 p-6 rounded-2xl border border-zinc-800 backdrop-blur-xl">
          <div>
            <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
              <span>📊</span> 5. Relatório & Fecho do Dia
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Consolidação executiva de performance, quilómetros percorridos, peso entregue e auditoria final.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleExportFinal}
              className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-500/20 flex items-center gap-2 transition-all cursor-pointer border border-indigo-400/30"
            >
              <span>📤</span> Fechar Dia & Baixar Relatório (.xlsx)
            </button>
          </div>
        </div>

        {/* Global Performance Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-2xl">
            <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Total de Entregas</div>
            <div className="text-3xl font-black text-zinc-100 mt-1">{totals.total_stops}</div>
            <div className="text-[11px] text-zinc-400 mt-1 font-mono">{totals.entregues} entregues | {totals.falhadas} falhas</div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-2xl">
            <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Taxa de Sucesso</div>
            <div className="text-3xl font-black text-emerald-400 mt-1">{totals.rate}%</div>
            <div className="text-[11px] text-zinc-400 mt-1">Meta diária: ≥ 95%</div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-2xl">
            <div className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider">Quilómetros Totais</div>
            <div className="text-3xl font-black text-indigo-400 mt-1">{totals.total_km} <span className="text-sm font-semibold">km</span></div>
            <div className="text-[11px] text-zinc-400 mt-1">{totals.total_routes} viaturas na rua</div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-2xl">
            <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">Peso Distribuído</div>
            <div className="text-3xl font-black text-amber-400 mt-1">{totals.total_weight} <span className="text-sm font-semibold">kg</span></div>
            <div className="text-[11px] text-zinc-400 mt-1 font-mono">{totals.total_packages} volumes totais</div>
          </div>
        </div>

        {/* Route Performance Grid & Reasons */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Routes Table */}
          <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-zinc-800 bg-zinc-950/40">
              <h2 className="text-sm font-bold text-zinc-100">Performance por Rota</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-950/80 text-zinc-400 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Rota</th>
                    <th className="py-3 px-4 text-center">Entregas</th>
                    <th className="py-3 px-4 text-center">Sucesso %</th>
                    <th className="py-3 px-4 text-right">Quilómetros</th>
                    <th className="py-3 px-4 text-right">Peso (kg)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 font-medium">
                  {routes.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-zinc-400">
                        Sem rotas para consolidar no projeto atual.
                      </td>
                    </tr>
                  ) : (
                    routes.map((r: any) => (
                      <tr key={r.route_name} className="hover:bg-zinc-850/40">
                        <td className="py-3 px-4 font-bold text-zinc-100">{r.route_name}</td>
                        <td className="py-3 px-4 text-center font-mono">{r.entregues}/{r.total}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            r.rate >= 90 ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : "bg-amber-500/20 text-amber-300 border-amber-500/30"
                          }`}>
                            {r.rate}%
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-zinc-300">{r.km} km</td>
                        <td className="py-3 px-4 text-right font-mono text-zinc-300">{r.weight} kg</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Failure Reasons Breakdown */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between">
            <div>
              <h2 className="text-sm font-bold text-zinc-100 mb-4 flex items-center gap-2">
                <span>⚠️</span> Motivos de Não Entrega
              </h2>
              {Object.keys(reasons).length === 0 ? (
                <div className="p-6 text-center text-xs text-zinc-400 bg-zinc-950/40 rounded-xl border border-zinc-800">
                  Nenhuma falha registada hoje.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {Object.entries(reasons).map(([reason, count]: any) => (
                    <div key={reason} className="flex justify-between items-center bg-zinc-950/50 p-2.5 rounded-xl border border-zinc-800 text-xs">
                      <span className="text-zinc-300">{reason}</span>
                      <span className="px-2 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold rounded-lg text-[10px]">
                        {count} {count === 1 ? "caso" : "casos"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-zinc-800 text-center">
              <button
                onClick={handleExportFinal}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
              >
                📥 Exportar Ficheiro Excel Completo
              </button>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
