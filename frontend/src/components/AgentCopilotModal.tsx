"use client";

import React, { useState, useEffect } from "react";
import { apiRequest } from "@/utils/api";

interface QuestionOption {
  tipo: string;
  texto: string;
  target_vehicle?: string;
  acao: string;
  delta_km?: number;
  tw_violation_min?: number;
}

interface ProposalItem {
  delivery_id: number;
  client_name: string;
  morada: string;
  janela_horaria?: string;
  tipo_operacao?: string;
  par_id?: string;
  peso_kg: number;
  volume_m3: number;
  diagnostico: string[];
  perguntas: QuestionOption[];
}

interface BorderSwapItem {
  delivery_id: number;
  client_name: string;
  cp: string;
  localidade: string;
  from_route: string;
  to_route: string;
  best_pos: number;
  arrival_str: string;
  saved_km: number;
  saved_eur: number;
  reason: string;
}

interface FleetConsolidationAssignment {
  delivery_id: number;
  client_name: string;
  target_vehicle: string;
  delta_km: number;
  tw_violation_min: number;
}

interface FleetConsolidationItem {
  donor_vehicle: string;
  stops_count: number;
  requires_tw_tolerance_min: number;
  assignments: FleetConsolidationAssignment[];
  summary: string;
}

interface HiddenNoteItem {
  delivery_id: number;
  client_name: string;
  route: string;
  original_note: string;
  current_window: string;
  proposed_win_start?: string | null;
  proposed_win_end?: string | null;
  current_rules: string;
  proposed_tags: string[];
  new_rules_combined: string;
  reasons: string[];
}

interface DiagnosisResponse {
  status: string;
  unassigned_count: number;
  total_assigned: number;
  proposals: ProposalItem[];
  border_swaps: BorderSwapItem[];
  fleet_consolidations: FleetConsolidationItem[];
  hidden_notes: HiddenNoteItem[];
}

interface ParsedRuleItem {
  Tag_Veiculo: string;
  Permissao: string;
  Tag_Entrega: string;
  Descricao: string;
}

interface AgentCopilotModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: number;
  onApplyAction: (deliveryId: number, targetVehicle: string, clientCode?: string) => Promise<void>;
  onRunSolverWithParams?: (customParams: Record<string, any>, modeLabel: string) => Promise<void>;
  onRefreshData: () => void;
}

export default function AgentCopilotModal({
  isOpen,
  onClose,
  projectId,
  onApplyAction,
  onRunSolverWithParams,
  onRefreshData,
}: AgentCopilotModalProps) {
  const [activeTab, setActiveTab] = useState<"rescue" | "swaps" | "notes" | "planner">("rescue");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DiagnosisResponse | null>(null);
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);

  // Estado para o Tradutor de Regras em Linguagem Natural (Folha 4)
  const [ruleInputText, setRuleInputText] = useState("");
  const [parsingRules, setParsingRules] = useState(false);
  const [parsedRules, setParsedRules] = useState<ParsedRuleItem[]>([]);

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
      // Selecionar automaticamente a primeira aba com sugestões relevantes se 'rescue' estiver vazia
      if (res) {
        if ((res.proposals?.length || 0) > 0) {
          setActiveTab("rescue");
        } else if ((res.border_swaps?.length || 0) > 0 || (res.fleet_consolidations?.length || 0) > 0) {
          setActiveTab("swaps");
        } else if ((res.hidden_notes?.length || 0) > 0) {
          setActiveTab("notes");
        }
      }
    } catch (err) {
      console.error("Erro ao carregar diagnóstico do Copiloto IA:", err);
    } finally {
      setLoading(false);
    }
  };

  // 1. Executar escolha individual em "Por Distribuir"
  const handleExecuteQuestion = async (
    deliveryId: number,
    opt: QuestionOption,
    clientName: string
  ) => {
    if (opt.acao === "keep_pending") {
      setFeedbackSuccess(`Cliente '${clientName}' mantido em 'Por Distribuir' por tua decisão.`);
      if (data) {
        setData({
          ...data,
          proposals: data.proposals.filter((p) => p.delivery_id !== deliveryId),
        });
      }
      return;
    }

    if (opt.acao === "reassign" && opt.target_vehicle) {
      setActionLoadingKey(`rescue-${deliveryId}`);
      try {
        await onApplyAction(deliveryId, opt.target_vehicle, clientName);
        setFeedbackSuccess(`✅ Cliente '${clientName}' encaixado na rota '${opt.target_vehicle}'!`);
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
        setActionLoadingKey(null);
      }
    }
  };

  // 2. Executar Troca de Fronteira (Swap 1-para-1 / Doação)
  const handleApplyBorderSwap = async (swap: BorderSwapItem) => {
    setActionLoadingKey(`swap-${swap.delivery_id}`);
    try {
      await onApplyAction(swap.delivery_id, swap.to_route, swap.client_name);
      setFeedbackSuccess(
        `✅ Troca aplicada: '${swap.client_name}' movido de '${swap.from_route}' para '${swap.to_route}' (-${swap.saved_km} km poupados)!`
      );
      if (data) {
        setData({
          ...data,
          border_swaps: data.border_swaps.filter((s) => s.delivery_id !== swap.delivery_id),
        });
      }
      onRefreshData();
    } catch (err) {
      console.error("Erro ao aplicar troca:", err);
    } finally {
      setActionLoadingKey(null);
    }
  };

  // 3. Executar Consolidação de Viatura Subocupada
  const handleApplyConsolidation = async (cons: FleetConsolidationItem) => {
    setActionLoadingKey(`cons-${cons.donor_vehicle}`);
    try {
      for (const a of cons.assignments) {
        await onApplyAction(a.delivery_id, a.target_vehicle, a.client_name);
      }
      setFeedbackSuccess(
        `✅ Viatura '${cons.donor_vehicle}' libertada! As suas ${cons.stops_count} paragens foram absorvidas.`
      );
      if (data) {
        setData({
          ...data,
          fleet_consolidations: data.fleet_consolidations.filter(
            (c) => c.donor_vehicle !== cons.donor_vehicle
          ),
        });
      }
      onRefreshData();
    } catch (err) {
      console.error("Erro ao consolidar viatura:", err);
    } finally {
      setActionLoadingKey(null);
    }
  };

  // 4. Aplicar sugestão extraída das Notas / Observações
  const handleApplyNoteSuggestion = async (note: HiddenNoteItem) => {
    setActionLoadingKey(`note-${note.delivery_id}`);
    try {
      await apiRequest("/api/agent/apply-note-suggestion", {
        method: "POST",
        body: JSON.stringify({
          project_id: projectId,
          delivery_id: note.delivery_id,
          proposed_win_start: note.proposed_win_start,
          proposed_win_end: note.proposed_win_end,
          new_rules_combined: note.new_rules_combined,
        }),
      });
      setFeedbackSuccess(
        `✅ Regra/Janela oculta aplicada à entrega '${note.client_name}' (#${note.delivery_id})!`
      );
      if (data) {
        setData({
          ...data,
          hidden_notes: data.hidden_notes.filter((n) => n.delivery_id !== note.delivery_id),
        });
      }
      onRefreshData();
    } catch (err) {
      console.error("Erro ao aplicar nota oculta:", err);
    } finally {
      setActionLoadingKey(null);
    }
  };

  // 5. Traduzir regra em linguagem natural para a Folha 4
  const handleParseNaturalRule = async () => {
    if (!ruleInputText.trim()) return;
    setParsingRules(true);
    try {
      const lines = ruleInputText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const res: any = await apiRequest("/api/agent/parse-rules", {
        method: "POST",
        body: JSON.stringify({ rules_text: lines }),
      });
      setParsedRules(res?.rules || []);
    } catch (err) {
      console.error("Erro ao interpretar regra:", err);
    } finally {
      setParsingRules(false);
    }
  };

  const handleSaveParsedRuleToSheet4 = async (rule: ParsedRuleItem, idx: number) => {
    setActionLoadingKey(`rule-${idx}`);
    try {
      await apiRequest("/api/agent/add-rule", {
        method: "POST",
        body: JSON.stringify({
          project_id: projectId,
          Tag_Veiculo: rule.Tag_Veiculo,
          Permissao: rule.Permissao,
          Tag_Entrega: rule.Tag_Entrega,
          Descricao: rule.Descricao,
        }),
      });
      setFeedbackSuccess(
        `✅ Regra [${rule.Tag_Veiculo} | ${rule.Permissao} | ${rule.Tag_Entrega}] adicionada à Folha 4 (Regras)!`
      );
      setParsedRules((prev) => prev.filter((_, i) => i !== idx));
      onRefreshData();
    } catch (err) {
      console.error("Erro ao gravar regra:", err);
    } finally {
      setActionLoadingKey(null);
    }
  };

  if (!isOpen) return null;

  const rescueCount = data?.proposals?.length || 0;
  const swapsCount = (data?.border_swaps?.length || 0) + (data?.fleet_consolidations?.length || 0);
  const notesCount = data?.hidden_notes?.length || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-indigo-500/30 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-indigo-950/90 via-slate-900 to-slate-900 border-b border-indigo-500/20">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center text-indigo-300 shadow-inner">
              <span className="text-xl">✨</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Copiloto IA &amp; Negociador Tático de Rotas
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  100% Decisão do Utilizador
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Analisa opções de poupança, negociação de janelas e regras ocultas — tu escolhes quais aplicar num clique.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 px-6 pt-3 bg-slate-950/60 border-b border-slate-800 overflow-x-auto">
          <button
            onClick={() => setActiveTab("rescue")}
            className={`px-3.5 py-2.5 text-xs font-semibold rounded-t-xl border-b-2 transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
              activeTab === "rescue"
                ? "border-indigo-400 text-indigo-300 bg-indigo-950/40"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <span>🤝 1. Resgate &amp; Janelas</span>
            <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-slate-800 text-slate-300">
              {rescueCount}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("swaps")}
            className={`px-3.5 py-2.5 text-xs font-semibold rounded-t-xl border-b-2 transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
              activeTab === "swaps"
                ? "border-emerald-400 text-emerald-300 bg-emerald-950/30"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <span>🔄 2. Trocas Vizinhas &amp; Frota</span>
            <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-slate-800 text-emerald-300">
              {swapsCount}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("notes")}
            className={`px-3.5 py-2.5 text-xs font-semibold rounded-t-xl border-b-2 transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
              activeTab === "notes"
                ? "border-amber-400 text-amber-300 bg-amber-950/30"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <span>🔍 3. Notas Ocultas &amp; Regras (Folha 4)</span>
            <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-slate-800 text-amber-300">
              {notesCount}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("planner")}
            className={`px-3.5 py-2.5 text-xs font-semibold rounded-t-xl border-b-2 transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
              activeTab === "planner"
                ? "border-purple-400 text-purple-300 bg-purple-950/30"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <span>🧠 4. Modos de Planeamento (Clássico vs IA)</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {loading && (
            <div className="py-12 flex flex-col items-center justify-center space-y-3">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-slate-400">
                O Copiloto IA está a simular encaixes, fronteiras de rotas e observações...
              </p>
            </div>
          )}

          {feedbackSuccess && (
            <div className="p-3 bg-emerald-950/70 border border-emerald-500/40 rounded-xl text-emerald-200 text-xs flex items-center justify-between animate-in fade-in">
              <span>{feedbackSuccess}</span>
              <button
                onClick={() => setFeedbackSuccess(null)}
                className="text-emerald-400 hover:text-emerald-200 text-xs ml-2 cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* ================================================================= */}
          {/* ABA 1: RESGATE DE POR DISTRIBUIR & NEGOCIADOR DE JANELAS          */}
          {/* ================================================================= */}
          {!loading && activeTab === "rescue" && (
            <>
              {rescueCount === 0 ? (
                <div className="py-12 text-center space-y-2">
                  <div className="text-3xl">🎉</div>
                  <h3 className="text-sm font-semibold text-white">
                    Zero entregas pendentes em &quot;Por Distribuir&quot;!
                  </h3>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Todas as encomendas estão atribuídas às viaturas. Espreita a aba{" "}
                    <strong>&quot;2. Trocas Vizinhas &amp; Frota&quot;</strong> para veres se podes poupar quilómetros ou viaturas!
                  </p>
                </div>
              ) : (
                data?.proposals.map((item) => (
                  <div
                    key={item.delivery_id}
                    className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/70 hover:border-indigo-500/40 transition-all space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">
                          {item.client_name}
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
                            #{item.delivery_id}
                          </span>
                          {item.tipo_operacao && item.tipo_operacao !== "D" && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                              Movimento: {item.tipo_operacao} {item.par_id ? `(${item.par_id})` : ""}
                            </span>
                          )}
                        </h4>
                        <p className="text-xs text-slate-400 mt-0.5">{item.morada}</p>
                      </div>
                      <div className="text-right text-[11px] font-mono text-slate-300 flex flex-col items-end gap-1">
                        <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700">
                          ⚖️ {item.peso_kg} kg | 📦 {item.volume_m3} m³
                        </span>
                        <span className="text-[10px] text-indigo-300">
                          🕒 Janela: {item.janela_horaria || "Qualquer"}
                        </span>
                      </div>
                    </div>

                    {/* Diagnóstico Causa-Raiz */}
                    <div className="p-2.5 rounded-lg bg-amber-950/25 border border-amber-500/25 text-amber-200/90 text-xs space-y-1">
                      <div className="font-semibold text-[11px] text-amber-300 uppercase tracking-wide">
                        🔍 Causa-Raiz Detetada:
                      </div>
                      {item.diagnostico.map((d, dIdx) => (
                        <p key={dIdx} className="text-[11px] leading-relaxed">
                          • {d}
                        </p>
                      ))}
                    </div>

                    {/* Opções para o Utilizador Decidir */}
                    <div className="pt-1 space-y-1.5">
                      <p className="text-[11px] font-semibold text-slate-300">
                        Escolhe a opção que pretendes aplicar:
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {item.perguntas.map((q, qIdx) => {
                          const isKeep = q.acao === "keep_pending";
                          return (
                            <button
                              key={qIdx}
                              disabled={actionLoadingKey === `rescue-${item.delivery_id}`}
                              onClick={() => handleExecuteQuestion(item.delivery_id, q, item.client_name)}
                              className={`px-3 py-2 rounded-lg text-xs font-medium text-left transition-all border flex items-center justify-between cursor-pointer ${
                                isKeep
                                  ? "bg-slate-900/80 hover:bg-slate-800 border-slate-700 text-slate-300 hover:text-white"
                                  : "bg-indigo-600/20 hover:bg-indigo-600/35 border-indigo-500/40 text-indigo-200 hover:text-white"
                              }`}
                            >
                              <span className=" leading-tight">{q.texto}</span>
                              <span className="ml-2 text-xs opacity-80">{isKeep ? "🛡️" : "👉"}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </>
          )}

          {/* ================================================================= */}
          {/* ABA 2: TROCAS ENTRE ROTAS VIZINHAS & POUPANÇA DE FROTA            */}
          {/* ================================================================= */}
          {!loading && activeTab === "swaps" && (
            <div className="space-y-4">
              {/* Consolidações de Frota (Eliminar Viatura Subocupada) */}
              {data?.fleet_consolidations && data.fleet_consolidations.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                    <span>🚚 Oportunidades de Libertar Viatura Completa</span>
                  </h3>
                  {data.fleet_consolidations.map((cons, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="text-sm font-bold text-white flex items-center gap-2">
                          <span>Eliminar &quot;{cons.donor_vehicle}&quot;</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            Poupa 1 Viatura ({cons.stops_count} paragens)
                          </span>
                        </div>
                        <p className="text-xs text-slate-300">{cons.summary}</p>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {cons.assignments.map((a, aIdx) => (
                            <span
                              key={aIdx}
                              className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700"
                            >
                              {a.client_name} ➔ <strong>{a.target_vehicle}</strong> (+{a.delta_km} km)
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleApplyConsolidation(cons)}
                          disabled={actionLoadingKey === `cons-${cons.donor_vehicle}`}
                          className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow cursor-pointer transition-colors"
                        >
                          ⚡ Absorver &amp; Libertar Carro
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Trocas de Fronteira (Swaps / Doações) */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
                  <span>🔄 Trocas Inteligentes entre Rotas Vizinhas (Cirurgião de Fronteiras)</span>
                </h3>
                {(!data?.border_swaps || data.border_swaps.length === 0) &&
                (!data?.fleet_consolidations || data.fleet_consolidations.length === 0) ? (
                  <div className="py-10 text-center space-y-2 bg-slate-800/30 rounded-xl border border-slate-800">
                    <div className="text-2xl">✅</div>
                    <p className="text-xs text-slate-300 font-medium">
                      As fronteiras entre rotas vizinhas já estão otimizadas!
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Não foram detetadas paragens onde a transferência para outro veículo poupe quilómetros líquidos.
                    </p>
                  </div>
                ) : (
                  data?.border_swaps?.map((swap) => (
                    <div
                      key={swap.delivery_id}
                      className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/70 hover:border-emerald-500/40 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-white">{swap.client_name}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
                            {swap.cp} {swap.localidade}
                          </span>
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            Poupa {swap.saved_km} km (~€{swap.saved_eur.toFixed(2)})
                          </span>
                        </div>
                        <p className="text-xs text-slate-300">
                          Mover de <strong className="text-amber-300">{swap.from_route}</strong> ➔{" "}
                          <strong className="text-emerald-300">{swap.to_route}</strong> ({swap.best_pos}ª posição, chegada às{" "}
                          {swap.arrival_str})
                        </p>
                        <p className="text-[11px] text-slate-400">{swap.reason}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleApplyBorderSwap(swap)}
                          disabled={actionLoadingKey === `swap-${swap.delivery_id}`}
                          className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow cursor-pointer transition-colors"
                        >
                          ✅ Aplicar Esta Troca
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* ABA 3: DETETIVE DE NOTAS OCULTAS & TRADUTOR DE REGRAS (FOLHA 4)   */}
          {/* ================================================================= */}
          {!loading && activeTab === "notes" && (
            <div className="space-y-6">
              {/* Secção A: Tradutor de Regras em Linguagem Natural para a Folha 4 */}
              <div className="p-4 rounded-xl bg-slate-800/70 border border-indigo-500/30 space-y-3">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300">
                    ✍️ Criar Regra da Folha 4 em Linguagem Natural
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Escreve uma regra em Português (ex: &quot;Pesados não podem entrar em Sintra CP 2710 a 2749&quot; ou &quot;Carrinha 01 proibida na Margem Sul&quot;). A IA converte-a e tu decides se a gravas na Folha 4.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={ruleInputText}
                    onChange={(e) => setRuleInputText(e.target.value)}
                    placeholder="Ex: Viaturas PESADO não entram no código postal 1100 a 1299..."
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={handleParseNaturalRule}
                    disabled={parsingRules || !ruleInputText.trim()}
                    className="px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white cursor-pointer transition-colors whitespace-nowrap"
                  >
                    {parsingRules ? "A interpretar..." : "✨ Interpretar Regra"}
                  </button>
                </div>

                {parsedRules.length > 0 && (
                  <div className="space-y-2 pt-2">
                    {parsedRules.map((r, rIdx) => (
                      <div
                        key={rIdx}
                        className="p-3 rounded-lg bg-slate-900 border border-indigo-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="text-xs space-y-1">
                          <div className="flex items-center gap-2 font-mono">
                            <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              Viatura: {r.Tag_Veiculo}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded font-bold ${
                                r.Permissao === "PROIBIR"
                                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                                  : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                              }`}
                            >
                              {r.Permissao}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              Entrega: {r.Tag_Entrega}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400">{r.Descricao}</p>
                        </div>
                        <button
                          onClick={() => handleSaveParsedRuleToSheet4(r, rIdx)}
                          disabled={actionLoadingKey === `rule-${rIdx}`}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer shrink-0"
                        >
                          ➕ Gravar na Folha 4
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Secção B: Notas Ocultas nas Observações das Entregas */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300">
                  🔍 Restrições Ocultas Detetadas nas &quot;Observações&quot; das Entregas ({notesCount})
                </h3>
                {notesCount === 0 ? (
                  <div className="py-8 text-center bg-slate-800/30 rounded-xl border border-slate-800 space-y-1">
                    <div className="text-2xl">✨</div>
                    <p className="text-xs text-slate-300">
                      Todas as observações estão alinhadas com as janelas horárias e tags atuais!
                    </p>
                  </div>
                ) : (
                  data?.hidden_notes?.map((note) => (
                    <div
                      key={note.delivery_id}
                      className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-white">{note.client_name}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
                            #{note.delivery_id} ({note.route})
                          </span>
                        </div>
                        <p className="text-xs italic text-amber-200/90 bg-amber-950/30 px-2.5 py-1 rounded border border-amber-500/20">
                          📝 Nota: &quot;{note.original_note}&quot;
                        </p>
                        <div className="text-[11px] text-slate-300 space-y-0.5">
                          {note.reasons.map((r, i) => (
                            <p key={i}>• {r}</p>
                          ))}
                        </div>
                      </div>
                      <button
                        onClick={() => handleApplyNoteSuggestion(note)}
                        disabled={actionLoadingKey === `note-${note.delivery_id}`}
                        className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white shadow cursor-pointer shrink-0 transition-colors"
                      >
                        ⚡ Aplicar à Entrega
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* ABA 4: MODOS DE PLANEAMENTO (CLÁSSICO ESTRITO VS IA FLEXÍVEL)     */}
          {/* ================================================================= */}
          {!loading && activeTab === "planner" && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-500/30 text-xs text-slate-300">
                💡 <strong>Tu decides como o motor calcula as rotas:</strong> podes correr o{" "}
                <strong>Modo Clássico Estrito</strong> (tolerância zero nas janelas) ou pedir ao{" "}
                <strong>Modo IA</strong> para aplicar tolerância inteligente nas janelas e maximizar a poupança de carros, respeitando sempre 100% das tuas regras da Folha 4 e Códigos Postais.
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Modo 1: Clássico Estrito */}
                <div className="p-4 rounded-xl bg-slate-800/70 border border-slate-700 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="text-lg">🎯</div>
                    <h4 className="text-sm font-bold text-white">1. Modo Clássico Estrito</h4>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Cumpre as janelas horárias ao minuto (<strong>Tolerância = 0 min</strong>) com buffer preventivo de 5 min. Ideal quando nenhum cliente aceita atrasos.
                    </p>
                    <ul className="text-[11px] text-slate-300 space-y-1 pt-1">
                      <li>• Regras Folha 4 &amp; CPs: <strong>100% Estrito</strong></li>
                      <li>• Tolerância Janelas: <strong>0 min</strong></li>
                      <li>• Curva Carga D/P/From/To: <strong>Ativa</strong></li>
                    </ul>
                  </div>
                  {onRunSolverWithParams && (
                    <button
                      onClick={() => {
                        onClose();
                        onRunSolverWithParams(
                          { respect_time_windows: true, soft_tw_tolerance_min: 0, balance_routes: false },
                          "Modo Clássico Estrito"
                        );
                      }}
                      className="w-full py-2 rounded-lg text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-white cursor-pointer transition-colors"
                    >
                      Executar Modo Estrito
                    </button>
                  )}
                </div>

                {/* Modo 2: IA Poupança Máxima de Frota */}
                <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/40 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-lg">🧠</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        Recomendado p/ Poupar Carros
                      </span>
                    </div>
                    <h4 className="text-sm font-bold text-white">2. Modo IA — Poupança de Frota</h4>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Permite até <strong>15 min de flexibilidade</strong> nas janelas se isso evitar abrir mais um carro ou evitar deixar um cliente de fora, priorizando viaturas com menor custo/km.
                    </p>
                    <ul className="text-[11px] text-indigo-200 space-y-1 pt-1">
                      <li>• Regras Folha 4 &amp; CPs: <strong>100% Estrito</strong></li>
                      <li>• Tolerância Soft Janelas: <strong>Até +15 min</strong></li>
                      <li>• Absorção de Carros Vazios: <strong>Máxima</strong></li>
                    </ul>
                  </div>
                  {onRunSolverWithParams && (
                    <button
                      onClick={() => {
                        onClose();
                        onRunSolverWithParams(
                          { respect_time_windows: true, soft_tw_tolerance_min: 15, balance_routes: false },
                          "Modo IA — Poupança de Frota"
                        );
                      }}
                      className="w-full py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md cursor-pointer transition-colors"
                    >
                      ✨ Executar Modo IA Poupança
                    </button>
                  )}
                </div>

                {/* Modo 3: IA Equilíbrio & Zonas Compactas */}
                <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/30 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="text-lg">🗺️</div>
                    <h4 className="text-sm font-bold text-white">3. Modo IA — Equilíbrio Zonal</h4>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Distribui o trabalho de forma equilibrada entre a frota ativa com <strong>5 min de tolerância soft</strong>, criando manchas geográficas compactas por equipa.
                    </p>
                    <ul className="text-[11px] text-emerald-200 space-y-1 pt-1">
                      <li>• Regras Folha 4 &amp; CPs: <strong>100% Estrito</strong></li>
                      <li>• Tolerância Soft Janelas: <strong>Até +5 min</strong></li>
                      <li>• Balanceamento de Frota: <strong>Ativo</strong></li>
                    </ul>
                  </div>
                  {onRunSolverWithParams && (
                    <button
                      onClick={() => {
                        onClose();
                        onRunSolverWithParams(
                          { respect_time_windows: true, soft_tw_tolerance_min: 5, balance_routes: true },
                          "Modo IA — Equilíbrio Zonal"
                        );
                      }}
                      className="w-full py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md cursor-pointer transition-colors"
                    >
                      🗺️ Executar Modo IA Zonal
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            {data
              ? `${rescueCount} resgates | ${swapsCount} otimizações de frota/fronteira | ${notesCount} notas ocultas`
              : "A aguardar análise..."}
          </span>
          <div className="flex items-center space-x-2">
            <button
              onClick={loadDiagnosis}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
            >
              🔄 Reanalisar Plano
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
