"use client";

import React, { useState } from "react";

export interface ViolationItem {
  type: "time_window" | "shift_overtime" | "tag_rule" | "capacity_kg" | "capacity_vol" | "max_stops" | string;
  severity: "error" | "warning";
  route: string;
  client?: string;
  order?: number;
  title: string;
  message: string;
  arrival?: string;
  window_end?: string;
  delay_minutes?: number;
  return_time?: string;
  shift_end?: string;
  overtime_minutes?: number;
  total_kg?: number;
  max_kg?: number;
  excess_kg?: number;
  total_vol?: number;
  max_vol?: number;
  excess_vol?: number;
  required_tag?: string;
  vehicle_tag?: string;
}

interface AuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  violations: ViolationItem[];
  onFocusRoute?: (routeName: string, order?: number) => void;
}

export default function AuditModal({ isOpen, onClose, violations, onFocusRoute }: AuditModalProps) {
  const [filterType, setFilterType] = useState<string>("all");

  if (!isOpen) return null;

  const typeCounts = {
    all: violations.length,
    time_window: violations.filter((v) => v.type === "time_window").length,
    shift_overtime: violations.filter((v) => v.type === "shift_overtime").length,
    tag_rule: violations.filter((v) => v.type === "tag_rule").length,
    capacity_kg: violations.filter((v) => v.type === "capacity_kg").length,
    capacity_vol: violations.filter((v) => v.type === "capacity_vol").length,
    max_stops: violations.filter((v) => v.type === "max_stops").length,
  };

  const filteredViolations = filterType === "all" ? violations : violations.filter((v) => v.type === filterType);

  const getIconForType = (type: string) => {
    switch (type) {
      case "time_window":
        return "⏰";
      case "shift_overtime":
        return "🛑";
      case "tag_rule":
        return "🏷️";
      case "capacity_kg":
        return "⚖️";
      case "capacity_vol":
        return "📦";
      case "max_stops":
        return "🔢";
      default:
        return "⚠️";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-zinc-950 border border-zinc-800 rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/90">
          <div className="flex items-center space-x-3">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-lg ${
              violations.length === 0 ? "bg-emerald-950/80 text-emerald-400 border border-emerald-700/50" : "bg-rose-950/80 text-rose-400 border border-rose-700/50"
            }`}>
              {violations.length === 0 ? "✅" : "🚨"}
            </div>
            <div>
              <h2 className="text-base font-black text-zinc-100 flex items-center gap-2">
                Auditoria de Qualidade & Conformidade da Distribuição
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                {violations.length === 0
                  ? "Todas as rotas cumprem rigorosamente os limites de horários, fim de turnos, tags e capacidades."
                  : `${violations.length} ${violations.length === 1 ? "inconformidade detetada" : "inconformidades detetadas"} nas rotas calculadas ou editadas manualmente.`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100 p-2 rounded-xl hover:bg-zinc-800 transition-colors cursor-pointer text-lg font-bold"
          >
            ✕
          </button>
        </div>

        {/* Filter Pills */}
        <div className="p-3 bg-zinc-900/50 border-b border-zinc-800 flex items-center gap-1.5 overflow-x-auto text-xs">
          <button
            onClick={() => setFilterType("all")}
            className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
              filterType === "all" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Todos ({typeCounts.all})
          </button>

          {typeCounts.time_window > 0 && (
            <button
              onClick={() => setFilterType("time_window")}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                filterType === "time_window" ? "bg-rose-600 text-white shadow-md" : "bg-zinc-900 text-rose-300 hover:bg-zinc-850"
              }`}
            >
              <span>⏰</span> Janelas ({typeCounts.time_window})
            </button>
          )}

          {typeCounts.shift_overtime > 0 && (
            <button
              onClick={() => setFilterType("shift_overtime")}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                filterType === "shift_overtime" ? "bg-rose-600 text-white shadow-md" : "bg-zinc-900 text-rose-300 hover:bg-zinc-850"
              }`}
            >
              <span>🛑</span> Fim de Turno ({typeCounts.shift_overtime})
            </button>
          )}

          {typeCounts.tag_rule > 0 && (
            <button
              onClick={() => setFilterType("tag_rule")}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                filterType === "tag_rule" ? "bg-amber-600 text-white shadow-md" : "bg-zinc-900 text-amber-300 hover:bg-zinc-850"
              }`}
            >
              <span>🏷️</span> Tags / Regras ({typeCounts.tag_rule})
            </button>
          )}

          {(typeCounts.capacity_kg > 0 || typeCounts.capacity_vol > 0) && (
            <button
              onClick={() => setFilterType("capacity_kg")}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                filterType === "capacity_kg" || filterType === "capacity_vol" ? "bg-purple-600 text-white shadow-md" : "bg-zinc-900 text-purple-300 hover:bg-zinc-850"
              }`}
            >
              <span>⚖️</span> Carga / Volume ({typeCounts.capacity_kg + typeCounts.capacity_vol})
            </button>
          )}

          {typeCounts.max_stops > 0 && (
            <button
              onClick={() => setFilterType("max_stops")}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                filterType === "max_stops" ? "bg-orange-600 text-white shadow-md" : "bg-zinc-900 text-orange-300 hover:bg-zinc-850"
              }`}
            >
              <span>🔢</span> Excesso de Paragens ({typeCounts.max_stops})
            </button>
          )}
        </div>

        {/* Violations List Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-3">
          {violations.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-emerald-950/80 border border-emerald-600/50 flex items-center justify-center mx-auto text-3xl">
                ✨
              </div>
              <h3 className="text-base font-bold text-emerald-400">Plano de Rotas 100% Conforme</h3>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                Não foi detetada qualquer infração nas variáveis estipuladas (capacidades, horários de turnos e janelas de clientes e matriz de regras).
              </p>
            </div>
          ) : filteredViolations.length === 0 ? (
            <div className="py-12 text-center text-zinc-500 text-xs">
              Nenhuma inconformidade na categoria selecionada.
            </div>
          ) : (
            filteredViolations.map((v, idx) => (
              <div
                key={idx}
                className="bg-zinc-900/80 border border-rose-800/40 hover:border-rose-600 rounded-2xl p-4 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg shadow-black/20"
              >
                <div className="flex items-start space-x-3.5">
                  <div className="w-9 h-9 rounded-xl bg-rose-950/80 border border-rose-700/60 flex items-center justify-center text-lg shrink-0 mt-0.5">
                    {getIconForType(v.type)}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-full text-[10.5px] font-black bg-indigo-950 text-indigo-300 border border-indigo-700/50">
                        🚚 {v.route}
                      </span>
                      {v.order && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-800 text-zinc-300">
                          Paragem #{v.order}
                        </span>
                      )}
                      <h4 className="text-xs font-black text-zinc-100">{v.title}</h4>
                    </div>
                    <p className="text-xs text-zinc-300 leading-relaxed">{v.message}</p>
                  </div>
                </div>

                {onFocusRoute && (
                  <button
                    onClick={() => {
                      onFocusRoute(v.route, v.order);
                      onClose();
                    }}
                    className="px-3.5 py-1.5 bg-zinc-800 hover:bg-indigo-600 text-zinc-200 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 border border-zinc-700 flex items-center justify-center gap-1.5"
                  >
                    <span>🔍</span> Ver nesta Rota
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-zinc-900 border-t border-zinc-800 flex items-center justify-between text-xs">
          <span className="text-zinc-400">
            Regra de Ouro: As rotas devem cumprir 100% das variáveis de distribuição sem erros.
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-colors cursor-pointer shadow-md"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
