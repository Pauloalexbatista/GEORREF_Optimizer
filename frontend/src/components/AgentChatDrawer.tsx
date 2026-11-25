"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAgentChat, OutlierItem, ActionItem } from "@/context/AgentChatContext";
import { useProjects } from "@/context/ProjectContext";

export default function AgentChatDrawer() {
  const {
    isOpen,
    closeChat,
    messages,
    loading,
    sendMessage,
    clearHistory,
    pendingOutliersCount,
  } = useAgentChat();
  const { selectedProject } = useProjects();
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading, isOpen]);

  if (!isOpen) return null;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || loading) return;
    const msg = inputText;
    setInputText("");
    sendMessage(msg);
  };

  const handleActionClick = (action: ActionItem) => {
    if (action.action === "inspect_outliers") {
      sendMessage("Mostra-me os clientes com problemas de coordenadas ou georreferenciação suspeita.");
    } else if (action.action === "slots_distribution") {
      sendMessage("Qual é a distribuição das janelas horárias da manhã vs tarde?");
    } else if (action.action === "filter_near_depot") {
      sendMessage("Quais entregas pendentes estão mais perto do armazém para deixar para amanhã?");
    } else if (action.action === "simulate_plus_10_percent") {
      sendMessage("Se aumentarmos o turno em 10%, quantas paragens pendentes conseguimos absorver?");
    } else {
      sendMessage(action.label);
    }
  };

  const handleGoToGeoreferencing = (cliente: string) => {
    router.push(`/dashboard/georeferencing?search=${encodeURIComponent(cliente)}`);
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[440px] md:w-[480px] z-50 flex flex-col bg-zinc-900 border-l border-zinc-800 shadow-2xl transition-all duration-300 backdrop-blur-xl">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800 bg-zinc-950/80 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
            <span className="text-sm font-bold">✨</span>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-xs font-bold text-white tracking-wide">Agente Co-Piloto IA</h3>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                Google Gemini
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 truncate max-w-[240px]">
              {selectedProject?.nome || "Nenhum projeto ativo"}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-1.5">
          {pendingOutliersCount > 0 && (
            <span
              className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold"
              title={`${pendingOutliersCount} cliente(s) sinalizados`}
            >
              ⚠️ {pendingOutliersCount}
            </span>
          )}

          <button
            type="button"
            onClick={clearHistory}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
            title="Limpar histórico de conversa"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>

          <button
            type="button"
            onClick={closeChat}
            className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
            title="Fechar Agente"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Barra de Sugestões Rápidas */}
      <div className="px-3 py-2 bg-zinc-950/40 border-b border-zinc-800 flex items-center space-x-1.5 overflow-x-auto no-scrollbar shrink-0 text-[11px]">
        <button
          onClick={() => sendMessage("Mostra-me os clientes com problemas de coordenadas ou georreferenciação suspeita.")}
          className="whitespace-nowrap px-2.5 py-1 rounded-full bg-zinc-800 hover:bg-indigo-900/40 border border-zinc-700 hover:border-indigo-500/50 text-zinc-300 hover:text-indigo-200 transition-all cursor-pointer font-medium"
        >
          🔍 Coordenadas & Suspeitas
        </button>
        <button
          onClick={() => sendMessage("Qual é a distribuição das janelas horárias da manhã vs tarde?")}
          className="whitespace-nowrap px-2.5 py-1 rounded-full bg-zinc-800 hover:bg-indigo-900/40 border border-zinc-700 hover:border-indigo-500/50 text-zinc-300 hover:text-indigo-200 transition-all cursor-pointer font-medium"
        >
          📊 Janelas Manhã/Tarde
        </button>
        <button
          onClick={() => sendMessage("Quais entregas de fora estão mais perto do armazém para amanhã?")}
          className="whitespace-nowrap px-2.5 py-1 rounded-full bg-zinc-800 hover:bg-indigo-900/40 border border-zinc-700 hover:border-indigo-500/50 text-zinc-300 hover:text-indigo-200 transition-all cursor-pointer font-medium"
        >
          📦 Perto do Armazém
        </button>
        <button
          onClick={() => sendMessage("Faz um diagnóstico geral da frota e do plano atual.")}
          className="whitespace-nowrap px-2.5 py-1 rounded-full bg-zinc-800 hover:bg-indigo-900/40 border border-zinc-700 hover:border-indigo-500/50 text-zinc-300 hover:text-indigo-200 transition-all cursor-pointer font-medium"
        >
          📋 Diagnóstico Geral
        </button>
      </div>

      {/* Feed de Mensagens */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3.5 bg-zinc-950/60">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
          >
            <div
              className={`max-w-[90%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed shadow-sm ${
                msg.sender === "user"
                  ? "bg-indigo-600 text-white rounded-br-xs"
                  : msg.isError
                  ? "bg-rose-950/50 border border-rose-500/40 text-rose-200 rounded-bl-xs"
                  : "bg-zinc-850 border border-zinc-750 text-zinc-200 rounded-bl-xs"
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.text}</div>

              {/* Cartões de Outliers e Clientes com Problemas */}
              {msg.outliers && msg.outliers.length > 0 && (
                <div className="mt-3 pt-2.5 border-t border-zinc-700/60 space-y-2">
                  <p className="font-semibold text-amber-300 text-[11px] flex items-center justify-between">
                    <span>⚠️ {msg.outliers.length} Cliente(s) com Problemas:</span>
                    <Link
                      href="/dashboard/georeferencing"
                      className="text-[10px] text-indigo-400 hover:underline font-normal"
                    >
                      Abrir Georreferenciação ➡️
                    </Link>
                  </p>
                  {msg.outliers.map((o: OutlierItem, idx: number) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/30 text-[11px] text-amber-200/90 space-y-1.5"
                    >
                      <div className="font-bold text-white flex justify-between items-center">
                        <span className="truncate pr-2">{o.cliente}</span>
                        {o.dist_km_armazem > 0 ? (
                          <span className="text-amber-400 font-mono text-[10px] shrink-0 bg-amber-500/20 px-1.5 py-0.2 rounded">
                            +{o.dist_km_armazem} km desvio
                          </span>
                        ) : (
                          <span className="text-rose-400 font-mono text-[10px] shrink-0 bg-rose-500/20 px-1.5 py-0.2 rounded">
                            Sem Coordenadas
                          </span>
                        )}
                      </div>
                      <p className="text-zinc-300 text-[10px]">
                        {o.morada} {o.cp ? `(${o.cp})` : ""} {o.localidade ? `- ${o.localidade}` : ""}
                      </p>
                      <p className="text-amber-300 text-[10px] italic">
                        {o.motivo_suspeita}
                      </p>

                      <div className="flex items-center gap-1.5 pt-1 border-t border-amber-500/20">
                        <button
                          type="button"
                          onClick={() => handleGoToGeoreferencing(o.cliente)}
                          className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-[10px] font-semibold cursor-pointer transition-colors flex items-center gap-1"
                        >
                          <span>📍</span>
                          <span>Corrigir em Georreferenciação</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => sendMessage(`Regeorreferenciar cliente ${o.cliente}`)}
                          className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-[10px] font-medium cursor-pointer transition-colors"
                        >
                          ⚡ Tentar Resolver
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Botões de Ações Rápidas Sugeridas */}
              {msg.actions && msg.actions.length > 0 && (
                <div className="mt-2.5 pt-2 border-t border-zinc-700/60 flex flex-wrap gap-1.5">
                  {msg.actions.map((act, aIdx) => (
                    <button
                      key={aIdx}
                      onClick={() => handleActionClick(act)}
                      className="text-[10px] px-2.5 py-1 rounded-md bg-indigo-950 hover:bg-indigo-900 border border-indigo-500/40 text-indigo-300 font-semibold cursor-pointer transition-all"
                    >
                      {act.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="text-[10px] text-zinc-500 mt-1 px-1">{msg.timestamp}</span>
          </div>
        ))}

        {loading && (
          <div className="flex items-center space-x-2 text-xs text-indigo-300 bg-zinc-850 border border-zinc-750 rounded-2xl px-3.5 py-2.5 max-w-[80%] shadow-sm">
            <div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0" />
            <span>O Co-Piloto Gemini está a raciocinar sobre o mapa...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Caixa de Input Inferior */}
      <div className="p-3 bg-zinc-950 border-t border-zinc-800 shrink-0">
        <form onSubmit={handleSend} className="flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Pergunte ao Co-Piloto (ex: 'Passa a entrega X para a viatura Y')..."
            disabled={loading || !selectedProject}
            className="flex-1 bg-zinc-900 border border-zinc-750 rounded-xl px-3.5 py-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-indigo-500 transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !inputText.trim() || !selectedProject}
            className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md transition-all cursor-pointer shrink-0"
          >
            Enviar
          </button>
        </form>
      </div>
    </div>
  );
}
