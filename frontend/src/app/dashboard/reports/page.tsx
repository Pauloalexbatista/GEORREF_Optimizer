"use client";

import React, { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useProjects } from "@/context/ProjectContext";
import api from "@/utils/api";

export default function ReportsPage() {
  const { selectedProject } = useProjects();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  useEffect(() => {
    if (!selectedProject?.id) {
      setData(null);
      return;
    }

    const fetchSummary = async () => {
      setLoading(true);
      try {
        const res = await api.get(`/api/reports/${selectedProject.id}/summary`);
        setData(res?.data || res);
      } catch (e: any) {
        console.error("Error loading reports summary:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, [selectedProject?.id]);

  const [closing, setClosing] = useState(false);
  const [closeSuccess, setCloseSuccess] = useState(false);

  const handleCloseDistribution = async () => {
    if (!selectedProject?.id) return;
    if (!confirm("Tem a certeza que deseja fechar a distribuição do dia? Isto irá desativar o acesso das rotas aos motoristas.")) {
      return;
    }
    setClosing(true);
    try {
      await api.post(`/api/tracking/deactivate/${selectedProject.id}`);
      setCloseSuccess(true);
      setTimeout(() => setCloseSuccess(false), 6000);
    } catch (e: any) {
      alert("Erro ao fechar distribuição: " + (e?.message || e));
    } finally {
      setClosing(false);
    }
  };

  const handleExportFinal = async () => {
    if (!selectedProject?.id) return;
    setExporting(true);
    setExportSuccess(false);

    try {
      const filename = `GeoRoutePlan_Fecho_${(selectedProject.nome || "Projeto").replace(/\s+/g, "_")}.xlsx`;
      await api.download(`/api/reports/${selectedProject.id}/export`, filename);
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 5000);
    } catch (e: any) {
      console.error("Erro ao descarregar:", e);
      // Fallback: abrir em nova janela
      window.open(`/api/reports/${selectedProject.id}/export`, "_blank");
    } finally {
      setExporting(false);
    }
  };

  const totals = data?.totals || {
    total_stops: 0,
    entregues: 0,
    falhadas: 0,
    pendentes: 0,
    taxa_sucesso: 0,
    total_rotas: 0,
    total_peso: 0,
    total_volume: 0,
    primeira_entrega: null,
    ultima_entrega: null,
  };

  const byRoute = data?.by_route || [];
  const motivosFalha: Record<string, number> = data?.motivos_falha || {};

  const totalFalhas = Object.values(motivosFalha).reduce((a, b) => a + b, 0);

  return (
    <DashboardLayout>
      <div className="space-y-8 max-w-7xl mx-auto pb-16">
        {/* Cabeçalho da Página */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-900 border border-zinc-800 p-6 rounded-2xl shadow-sm">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">📊</span>
              <h1 className="text-2xl font-bold text-white tracking-tight">
                Relatório & Fecho Diário
              </h1>
              <span className="bg-emerald-500/10 text-emerald-400 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                Padrão 9 Abas
              </span>
            </div>
            <p className="text-sm text-zinc-400">
              Auditoria de desempenho da distribuição, análise de insucessos e exportação do dossier oficial.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleCloseDistribution}
              disabled={closing || !selectedProject?.id}
              className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 font-semibold px-4 py-3 rounded-xl transition-all shadow-md disabled:opacity-50 cursor-pointer"
            >
              {closing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>A Fechar Dia...</span>
                </>
              ) : (
                <>
                  <span className="text-lg">🏁</span>
                  <span>Concluir Distribuição</span>
                </>
              )}
            </button>

            <button
              onClick={handleExportFinal}
              disabled={exporting || !selectedProject?.id}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-5 py-3 rounded-xl transition-all shadow-lg shadow-emerald-900/30 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {exporting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>A Gerar Ficheiro...</span>
                </>
              ) : (
                <>
                  <span className="text-lg">📥</span>
                  <span>Fechar Dia & Exportar (9 Abas .xlsx)</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Notificação de Fecho de Distribuição */}
        {closeSuccess && (
          <div className="bg-purple-950/60 border border-purple-500/40 text-purple-200 p-4 rounded-xl flex items-center justify-between animate-fade-in">
            <div className="flex items-center gap-3">
              <span className="text-xl">🏁</span>
              <div>
                <p className="font-semibold text-sm">Distribuição do Dia Fechada com Sucesso!</p>
                <p className="text-xs text-purple-300/80">As rotas foram desativadas para a aplicação móvel dos motoristas e os dados arquivados.</p>
              </div>
            </div>
            <span className="text-xs text-purple-400 font-mono font-bold">STATUS: CONCLUÍDO</span>
          </div>
        )}

        {/* Notificação de Sucesso de Download */}
        {exportSuccess && (
          <div className="bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 p-4 rounded-xl flex items-center justify-between animate-fade-in">
            <div className="flex items-center gap-3">
              <span className="text-xl">✅</span>
              <div>
                <p className="font-semibold text-sm">Ficheiro Excel Canónico Descarregado com Sucesso!</p>
                <p className="text-xs text-emerald-400/80">O ficheiro contém todas as 9 abas preenchidas com dados de planeamento, execução e fecho.</p>
              </div>
            </div>
            <span className="text-xs text-emerald-500 font-mono">GeoRoutePlan.xlsx</span>
          </div>
        )}

        {!selectedProject?.id ? (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-12 text-center text-zinc-500">
            <div className="text-4xl mb-3">📁</div>
            <h3 className="text-lg font-semibold text-zinc-300">Nenhum Projeto Selecionado</h3>
            <p className="text-sm mt-1">Por favor selecione um projeto no topo para visualizar o relatório operacional.</p>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center p-16 gap-3 text-zinc-400">
            <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm">A compilar métricas operacionais e histórico de entregas...</p>
          </div>
        ) : (
          <>
            {/* Cartões de Indicadores Chave (KPIs) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
                <span className="text-xs text-zinc-400 font-medium block mb-1">Total Paragens</span>
                <span className="text-2xl font-bold text-white">{totals.total_stops}</span>
                <span className="text-xs text-zinc-500 block mt-1">{totals.total_rotas} Rotas Ativas</span>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
                <span className="text-xs text-emerald-400 font-medium block mb-1">Entregues</span>
                <span className="text-2xl font-bold text-emerald-400">{totals.entregues}</span>
                <span className="text-xs text-emerald-500/80 block mt-1">{totals.taxa_sucesso}% de Sucesso</span>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
                <span className="text-xs text-rose-400 font-medium block mb-1">Falhadas</span>
                <span className="text-2xl font-bold text-rose-400">{totals.falhadas}</span>
                <span className="text-xs text-rose-500/80 block mt-1">{totals.total_stops > 0 ? Math.round((totals.falhadas / totals.total_stops) * 100) : 0}% de Insucesso</span>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
                <span className="text-xs text-sky-400 font-medium block mb-1">Pendentes</span>
                <span className="text-2xl font-bold text-sky-400">{totals.pendentes}</span>
                <span className="text-xs text-sky-500/80 block mt-1">Em Trânsito / Rua</span>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
                <span className="text-xs text-zinc-400 font-medium block mb-1">Carga Total (kg)</span>
                <span className="text-2xl font-bold text-white">{Math.round(totals.total_peso).toLocaleString("pt-PT")}</span>
                <span className="text-xs text-zinc-500 block mt-1">{Math.round(totals.total_volume * 10) / 10} m³ Volume</span>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
                <span className="text-xs text-zinc-400 font-medium block mb-1">Horário Operacional</span>
                <span className="text-sm font-semibold text-zinc-200 block truncate">
                  {totals.primeira_entrega ? totals.primeira_entrega.substring(11, 16) : "--:--"} → {totals.ultima_entrega ? totals.ultima_entrega.substring(11, 16) : "--:--"}
                </span>
                <span className="text-xs text-zinc-500 block mt-1">1ª e Última Entrega</span>
              </div>
            </div>

            {/* Secção de Gráficos e Desempenho Visual */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Gráfico 1: Taxa Global de Sucesso */}
              <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <span>🎯</span> Taxa Global de Distribuição
                  </h3>

                  <div className="my-6">
                    {/* Barra de Progresso Visual Segmentada */}
                    <div className="h-6 w-full bg-zinc-800 rounded-full overflow-hidden flex border border-zinc-700/50">
                      {totals.total_stops > 0 ? (
                        <>
                          <div
                            style={{ width: `${(totals.entregues / totals.total_stops) * 100}%` }}
                            className="bg-emerald-500 hover:bg-emerald-400 transition-all relative group"
                            title={`Entregues: ${totals.entregues}`}
                          />
                          <div
                            style={{ width: `${(totals.falhadas / totals.total_stops) * 100}%` }}
                            className="bg-rose-500 hover:bg-rose-400 transition-all relative group"
                            title={`Falhadas: ${totals.falhadas}`}
                          />
                          <div
                            style={{ width: `${(totals.pendentes / totals.total_stops) * 100}%` }}
                            className="bg-sky-500 hover:bg-sky-400 transition-all relative group"
                            title={`Pendentes: ${totals.pendentes}`}
                          />
                        </>
                      ) : (
                        <div className="w-full bg-zinc-800" />
                      )}
                    </div>
                  </div>

                  {/* Legenda com Números */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-emerald-500" />
                        <span className="text-zinc-300">Entregues com Sucesso</span>
                      </div>
                      <span className="font-semibold text-white">
                        {totals.entregues} ({totals.total_stops > 0 ? Math.round((totals.entregues / totals.total_stops) * 100) : 0}%)
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-rose-500" />
                        <span className="text-zinc-300">Falhadas / Insucessos</span>
                      </div>
                      <span className="font-semibold text-white">
                        {totals.falhadas} ({totals.total_stops > 0 ? Math.round((totals.falhadas / totals.total_stops) * 100) : 0}%)
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-sky-500" />
                        <span className="text-zinc-300">Pendentes / Em Rua</span>
                      </div>
                      <span className="font-semibold text-white">
                        {totals.pendentes} ({totals.total_stops > 0 ? Math.round((totals.pendentes / totals.total_stops) * 100) : 0}%)
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-zinc-800 text-center">
                  <span className="text-3xl font-extrabold text-emerald-400">{totals.taxa_sucesso}%</span>
                  <span className="text-xs text-zinc-500 block mt-0.5">Eficácia Global do Dia</span>
                </div>
              </div>

              {/* Gráfico 2: Desempenho por Rota e Motorista */}
              <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl lg:col-span-2">
                <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <span>🚚</span> Desempenho por Rota & Motorista
                </h3>

                {byRoute.length === 0 ? (
                  <p className="text-sm text-zinc-500 py-8 text-center">Nenhuma rota registada para este projeto.</p>
                ) : (
                  <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                    {byRoute.map((r: any) => {
                      const rate = r.total > 0 ? Math.round((r.entregues / r.total) * 100) : 0;
                      return (
                        <div key={r.route_name} className="bg-zinc-950/60 p-3.5 rounded-xl border border-zinc-800/80">
                          <div className="flex items-center justify-between text-sm mb-2">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white">{r.route_name}</span>
                              <span className="text-zinc-400 text-xs">👤 {r.driver_name || "Sem Motorista"}</span>
                              <span className="text-zinc-600 text-xs">• {r.vehicle_id}</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs">
                              <span className="text-zinc-400">{r.entregues}/{r.total} Entregas</span>
                              <span className={`font-bold ${rate >= 90 ? "text-emerald-400" : rate >= 70 ? "text-amber-400" : "text-rose-400"}`}>
                                {rate}%
                              </span>
                            </div>
                          </div>

                          <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden flex">
                            <div
                              style={{ width: `${r.total > 0 ? (r.entregues / r.total) * 100 : 0}%` }}
                              className="bg-emerald-500 transition-all"
                            />
                            <div
                              style={{ width: `${r.total > 0 ? (r.falhadas / r.total) * 100 : 0}%` }}
                              className="bg-rose-500 transition-all"
                            />
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-zinc-500 mt-2">
                            <span>📦 Carga: {Math.round(r.peso_kg || 0)} kg | {Math.round((r.volume_m3 || 0) * 10) / 10} m³</span>
                            <span>{r.falhadas > 0 ? `⚠️ ${r.falhadas} insucessos` : "✨ Sem falhas"}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Secção de Auditoria de Falhas & Dossier */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Auditoria de Motivos de Falha */}
              <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
                <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <span>⚠️</span> Análise de Motivos de Insucesso
                </h3>

                {totalFalhas === 0 ? (
                  <div className="p-8 text-center text-zinc-500">
                    <span className="text-3xl block mb-2">🎉</span>
                    <p className="text-sm text-zinc-400 font-medium">Sem registo de falhas nas entregas!</p>
                    <p className="text-xs text-zinc-600 mt-1">Todas as paragens executadas foram concluídas com sucesso.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(motivosFalha).map(([motivo, count]) => {
                      const perc = Math.round((count / totalFalhas) * 100);
                      return (
                        <div key={motivo} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-300 font-medium">{motivo}</span>
                            <span className="text-zinc-400 font-mono">{count} ocorrências ({perc}%)</span>
                          </div>
                          <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              style={{ width: `${perc}%` }}
                              className="h-full bg-rose-500/80 rounded-full"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Cartão Informativo de Fecho Canónico de 9 Abas */}
              <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 p-6 rounded-2xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 text-xl font-bold">
                      9
                    </div>
                    <div>
                      <h4 className="text-base font-bold text-white">Exportação do Dossier Canónico de 9 Abas</h4>
                      <p className="text-xs text-zinc-400">Em conformidade com a especificação GeoRoutePlan.md</p>
                    </div>
                  </div>

                  <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                    Ao descarregar o ficheiro de fecho, o sistema gera uma pasta de trabalho Excel canónica completa com:
                  </p>

                  <div className="grid grid-cols-3 gap-2 text-[11px] text-zinc-300 font-mono mb-4">
                    <div className="bg-zinc-800/60 p-2 rounded border border-zinc-700/50">00_CONFIG</div>
                    <div className="bg-zinc-800/60 p-2 rounded border border-zinc-700/50">01_LOCAIS</div>
                    <div className="bg-zinc-800/60 p-2 rounded border border-zinc-700/50">02_FROTA</div>
                    <div className="bg-zinc-800/60 p-2 rounded border border-zinc-700/50">03_REGRAS</div>
                    <div className="bg-zinc-800/60 p-2 rounded border border-zinc-700/50">04_HORARIOS</div>
                    <div className="bg-zinc-800/60 p-2 rounded border border-zinc-700/50">05_MATRIZ</div>
                    <div className="bg-zinc-800/60 p-2 rounded border border-zinc-700/50">06_PLANO</div>
                    <div className="bg-zinc-800/60 p-2 rounded border border-zinc-700/50">07_ACOMP</div>
                    <div className="bg-zinc-800/60 p-2 rounded border border-zinc-700/50">08_FECHO</div>
                  </div>
                </div>

                <button
                  onClick={handleExportFinal}
                  disabled={exporting}
                  className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-emerald-400 text-xs font-semibold rounded-xl border border-zinc-700 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>📥 Descarregar Dossier Excel</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
