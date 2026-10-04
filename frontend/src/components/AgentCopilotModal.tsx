"use client";

import React, { useState, useEffect } from "react";
import { apiRequest } from "@/utils/api";

interface QuestionOption {
  tipo: string;
  texto: string;
  target_vehicle?: string;
  acao: string;
}

interface ProposalItem {
  delivery_id: number;
  client_name: string;
  morada: string;
  peso_kg: number;
  volume_m3: number;
  diagnostico: string[];
  perguntas: QuestionOption[];
}

interface DiagnosisResponse {
  status: string;
  unassigned_count: number;
  total_assigned: number;
  proposals: ProposalItem[];
}

interface AgentCopilotModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: number;
  onApplyAction: (deliveryId: number, targetVehicle: string, clientCode?: string) => Promise<void>;
  onRefreshData: () => void;
}

export default function AgentCopilotModal({
  isOpen,
  onClose,
  projectId,
  onApplyAction,
  onRefreshData,
}: AgentCopilotModalProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DiagnosisResponse | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && projectId) {
      loadDiagnosis();
    }
  }, [isOpen, projectId]);

  const loadDiagnosis = async () => {
    setLoading(true);
    setFeedbackSuccess(null);
    try {
      const res: any = await apiRequest(`/api/agent/diagnose/${projectId}`);
      setData(res);
    } catch (err) {
      console.error("Erro ao carregar diagnóstico do Agente:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteQuestion = async (
    deliveryId: number,
    opt: QuestionOption,
    clientName: string
  ) => {
    if (opt.acao === "keep_pending") {
      setFeedbackSuccess(`Cliente '${clientName}' mantido com segurança em 'Por Distribuir'.`);
      if (data) {
        setData({
          ...data,
          proposals: data.proposals.filter((p) => p.delivery_id !== deliveryId),
        });
      }
      return;
    }

    if (opt.acao === "reassign" && opt.target_vehicle) {
      setActionLoadingId(deliveryId);
      try {
        await onApplyAction(deliveryId, opt.target_vehicle, clientName);
        setFeedbackSuccess(`Cliente '${clientName}' atribuído com sucesso a '${opt.target_vehicle}'!`);
        if (data) {
          setData({
            ...data,
            proposals: data.proposals.filter((p) => p.delivery_id !== deliveryId),
            unassigned_count: Math.max(0, data.unassigned_count - 1),
          });
        }
        onRefreshData();
      } catch (err) {
        console.error("Falha ao aplicar ação:", err);
      } finally {
        setActionLoadingId(null);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-3xl bg-slate-900 border border-indigo-500/30 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-indigo-950/80 via-slate-900 to-slate-900 border-b border-indigo-500/20">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/30 border border-indigo-400/30 flex items-center justify-center text-indigo-400 shadow-inner">
              <span className="text-xl">🤖</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Agente Co-Piloto de Tráfego
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Assistente Autónomo
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Auditoria situacional de entregas em &quot;Por Distribuir&quot; e resolução de exceções
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {loading && (
            <div className="py-12 flex flex-col items-center justify-center space-y-3">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-slate-400">O Agente está a analisar o plano e a frota...</p>
            </div>
          )}

          {feedbackSuccess && (
            <div className="p-3 bg-emerald-950/60 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs flex items-center justify-between animate-in fade-in">
              <span>{feedbackSuccess}</span>
              <button
                onClick={() => setFeedbackSuccess(null)}
                className="text-emerald-400 hover:text-emerald-200 text-xs ml-2"
              >
                ✕
              </button>
            </div>
          )}

          {!loading && data && data.proposals.length === 0 && (
            <div className="py-12 text-center space-y-2">
              <div className="text-3xl">✨</div>
              <h3 className="text-sm font-semibold text-white">Todas as entregas estão distribuídas!</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Não existem clientes em &quot;Por Distribuir&quot;. O plano calculado respeita 100% das restrições e
                capacidades da frota.
              </p>
            </div>
          )}

          {!loading &&
            data &&
            data.proposals.map((item) => (
              <div
                key={item.delivery_id}
                className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-indigo-500/30 transition-all space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      {item.client_name}
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
                        #{item.delivery_id}
                      </span>
                    </h4>
                    <p className="text-xs text-slate-400 mt-0.5">{item.morada || "Sem morada especificada"}</p>
                  </div>
                  <div className="text-right text-[11px] font-mono text-slate-300">
                    <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700">
                      ⚖️ {item.peso_kg} kg | 📦 {item.volume_m3} m³
                    </span>
                  </div>
                </div>

                {/* Diagnóstico */}
                <div className="p-2.5 rounded-lg bg-amber-950/20 border border-amber-500/20 text-amber-200/90 text-xs space-y-1">
                  <div className="font-semibold text-[11px] text-amber-300 uppercase tracking-wide flex items-center gap-1">
                    <span>🔍 Diagnóstico do Agente:</span>
                  </div>
                  {item.diagnostico.map((d, dIdx) => (
                    <p key={dIdx} className="text-[11px] leading-relaxed">
                      • {d}
                    </p>
                  ))}
                </div>

                {/* Opções e Perguntas ao Utilizador */}
                <div className="pt-1 space-y-1.5">
                  <p className="text-[11px] font-semibold text-slate-300">Como prefere resolver?</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {item.perguntas.map((q, qIdx) => {
                      const isKeep = q.acao === "keep_pending";
                      return (
                        <button
                          key={qIdx}
                          disabled={actionLoadingId === item.delivery_id}
                          onClick={() => handleExecuteQuestion(item.delivery_id, q, item.client_name)}
                          className={`px-3 py-2 rounded-lg text-xs font-medium text-left transition-all border flex items-center justify-between cursor-pointer ${
                            isKeep
                              ? "bg-slate-900/80 hover:bg-slate-800 border-slate-700 text-slate-300 hover:text-white"
                              : "bg-indigo-600/20 hover:bg-indigo-600/30 border-indigo-500/40 text-indigo-200 hover:text-white"
                          }`}
                        >
                          <span className="line-clamp-2 leading-tight">{q.texto}</span>
                          <span className="ml-2 text-xs opacity-70">{isKeep ? "🛡️" : "⚡"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            {data ? `${data.unassigned_count} por distribuir analisados` : "A aguardar..."}
          </span>
          <div className="flex items-center space-x-2">
            <button
              onClick={loadDiagnosis}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
            >
              🔄 Reanalisar
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md transition-colors cursor-pointer"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
