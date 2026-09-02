"use client";

import React, { useState } from "react";

interface ReoptimizeModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedRoutes: string[];
  stopsCount: number;
  totalKg: number;
  onConfirm: (options: {
    selectedRoutes: string[];
    objective: "distance" | "group";
    balanceRoutes: boolean;
    respectTimeWindows: boolean;
  }) => Promise<void>;
}

export default function ReoptimizeModal({
  isOpen,
  onClose,
  selectedRoutes,
  stopsCount,
  totalKg,
  onConfirm,
}: ReoptimizeModalProps) {
  const [objective, setObjective] = useState<"distance" | "group">("distance");
  const [balanceRoutes, setBalanceRoutes] = useState<boolean>(true);
  const [respectTimeWindows, setRespectTimeWindows] = useState<boolean>(true);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleExecute = async () => {
    if (!selectedRoutes || selectedRoutes.length === 0) {
      setErrorMsg("Nenhuma rota selecionada.");
      return;
    }
    setErrorMsg(null);
    setLoading(true);
    try {
      await onConfirm({
        selectedRoutes,
        objective,
        balanceRoutes,
        respectTimeWindows,
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Erro desconhecido ao re-otimizar.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 p-5 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-white/20 rounded-xl backdrop-blur-md">
              <svg className="w-5 h-5 text-amber-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
            </div>
            <div>
              <h3 className="font-black text-base tracking-tight flex items-center gap-2">
                Re-Otimização Seletiva de Rotas
              </h3>
              <p className="text-xs text-indigo-100 font-medium">
                Re-planeamento conjunto das viaturas selecionadas
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-500 text-rose-200 text-xs font-bold flex items-center gap-2">
              <span>⚠️</span>
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Summary Box */}
          <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/60 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">Rotas Selecionadas:</span>
              <div className="flex flex-wrap gap-1.5">
                {selectedRoutes.map((r) => (
                  <span
                    key={r}
                    className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-600 text-white shadow-xs"
                  >
                    {r}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono font-bold text-indigo-800 dark:text-indigo-300">
              <span>📍 {stopsCount} Paragens</span>
              <span>⚖️ {Math.round(totalKg)} kg</span>
            </div>
          </div>

          {/* Question 1: Objective */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2.5 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              1. Qual é o Objetivo Principal?
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              
              {/* Option A: Menor Distancia */}
              <div
                onClick={() => setObjective("distance")}
                className={`p-3.5 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
                  objective === "distance"
                    ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/30 shadow-md ring-1 ring-indigo-500/30"
                    : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-850/50"
                }`}
              >
                <div className="flex items-start justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold">🎯 Menor Distância</span>
                  </div>
                  {objective === "distance" && (
                    <svg className="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-tight">
                  Minimiza os quilómetros e percursos combinados das viaturas envolvidas.
                </p>
              </div>

              {/* Option B: Agrupar & Compactar */}
              <div
                onClick={() => setObjective("group")}
                className={`p-3.5 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
                  objective === "group"
                    ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/30 shadow-md ring-1 ring-indigo-500/30"
                    : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-850/50"
                }`}
              >
                <div className="flex items-start justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold">📦 Agrupar e Compactar</span>
                  </div>
                  {objective === "group" && (
                    <svg className="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-tight">
                  Cria aglomerados densos e tenta libertar 1 viatura se houver capacidade.
                </p>
              </div>

            </div>
          </div>

          {/* Question 2: Balance */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2.5 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
              </svg>
              2. Deseja Equilibrar as Rotas?
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              
              {/* Option A: Sim, Equilibrar */}
              <div
                onClick={() => setBalanceRoutes(true)}
                className={`p-3.5 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
                  balanceRoutes
                    ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/30 shadow-md ring-1 ring-indigo-500/30"
                    : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-850/50"
                }`}
              >
                <div className="flex items-start justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold">⚖️ Sim, Equilibrar</span>
                  </div>
                  {balanceRoutes && (
                    <svg className="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-tight">
                  Distribui o número de entregas de forma uniforme entre os carros selecionados.
                </p>
              </div>

              {/* Option B: Nao, Livre */}
              <div
                onClick={() => setBalanceRoutes(false)}
                className={`p-3.5 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
                  !balanceRoutes
                    ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/30 shadow-md ring-1 ring-indigo-500/30"
                    : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-850/50"
                }`}
              >
                <div className="flex items-start justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold">⚡ Não, Preenchimento Livre</span>
                  </div>
                  {!balanceRoutes && (
                    <svg className="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-tight">
                  Prioridade absoluta à menor distância sem forçar número idêntico de paragens.
                </p>
              </div>

            </div>
          </div>

          {/* Time Windows Toggle */}
          <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">Respeitar Janelas Horárias</span>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Garante 0 atrasos nas entregas dos clientes</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={respectTimeWindows}
                onChange={(e) => setRespectTimeWindows(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-zinc-300 dark:bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded-xl text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleExecute}
            disabled={loading}
            className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-md hover:shadow-indigo-500/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {loading ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>A calcular subset OR-Tools...</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5 text-amber-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
                <span>Re-otimizar Agora</span>
                <span>→</span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
