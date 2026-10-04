"use client";

import React, { useState, useEffect, useRef } from "react";
import { apiRequest } from "@/utils/api";

interface ActionItem {
  label: string;
  action: string;
}

interface OutlierItem {
  id: number;
  cliente: string;
  morada: string;
  cp: string;
  localidade: string;
  dist_km_armazem: number;
  motivo_suspeita: string;
}

interface ChatMessage {
  id: string;
  sender: "user" | "agent";
  text: string;
  outliers?: OutlierItem[];
  actions?: ActionItem[];
  timestamp: string;
}

interface AgentChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: number;
  onRefreshData?: () => void;
}

export default function AgentChatDrawer({
  isOpen,
  onClose,
  projectId,
  onRefreshData,
}: AgentChatDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      // Mensagem inicial de acolhimento do Co-Piloto
      sendMessage("Olá, analisa o plano de rotas atual e diz-me o que encontras.");
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async (textToSend: string) => {
    if (!textToSend.trim() || !projectId) return;

    const userMsg: ChatMessage = {
      id: String(Date.now()),
      sender: "user",
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText("");
    setLoading(true);

    try {
      const res: any = await apiRequest("/api/agent/chat", {
        method: "POST",
        body: JSON.stringify({
          project_id: projectId,
          message: textToSend,
        }),
      });

      const agentMsg: ChatMessage = {
        id: String(Date.now() + 1),
        sender: "agent",
        text: res.reply || "Não consegui processar a resposta neste momento.",
        outliers: res.outliers || [],
        actions: res.suggested_actions || [],
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setMessages((prev) => [...prev, agentMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: String(Date.now() + 1),
        sender: "agent",
        text: `⚠️ Erro na ligação ao assistente: ${err.message || "Falha de rede"}`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleActionClick = (act: ActionItem) => {
    if (act.action === "inspect_outliers") {
      sendMessage("Mostra-me os detalhes das entregas com coordenadas ou distâncias suspeitas.");
    } else if (act.action === "simulate_plus_10_percent") {
      sendMessage("Se aumentarmos o horário dos carros em 10%, quantas destas entregas pendentes conseguimos encaixar?");
    } else if (act.action === "filter_near_depot") {
      sendMessage("Quais são as entregas por distribuir que estão mais perto do armazém para resolvermos amanhã?");
    } else {
      sendMessage(act.label);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-slate-900 border-l border-indigo-500/30 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-indigo-950 via-slate-900 to-slate-900 border-b border-indigo-500/20">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-xl bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center text-indigo-300 shadow">
            <span className="text-lg">🤖</span>
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
              Co-Piloto de Tráfego
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
                Gemini 3.8
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">Diálogo operacional & auditoria inteligente</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Sugestões Rápidas no Topo */}
      <div className="px-4 py-2 bg-slate-950/70 border-b border-slate-800 flex items-center gap-2 overflow-x-auto no-scrollbar">
        <button
          onClick={() => sendMessage("Vê as entregas no mapa: temos algum ponto suspeito fora de zona?")}
          className="text-[11px] whitespace-nowrap px-2.5 py-1 rounded-full bg-slate-800 hover:bg-indigo-900/40 border border-slate-700 hover:border-indigo-500/50 text-slate-300 hover:text-indigo-200 transition-all cursor-pointer"
        >
          🔍 Pontos Suspeitos
        </button>
        <button
          onClick={() => sendMessage("E se dermos mais 10% de horário nos carros, resolvemos os pendentes?")}
          className="text-[11px] whitespace-nowrap px-2.5 py-1 rounded-full bg-slate-800 hover:bg-indigo-900/40 border border-slate-700 hover:border-indigo-500/50 text-slate-300 hover:text-indigo-200 transition-all cursor-pointer"
        >
          ⏱️ Simular +10% Turno
        </button>
        <button
          onClick={() => sendMessage("Quais entregas de fora estão mais perto do armazém para amanhã?")}
          className="text-[11px] whitespace-nowrap px-2.5 py-1 rounded-full bg-slate-800 hover:bg-indigo-900/40 border border-slate-700 hover:border-indigo-500/50 text-slate-300 hover:text-indigo-200 transition-all cursor-pointer"
        >
          🏠 Perto do Armazém
        </button>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3.5 bg-slate-900/60">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
          >
            <div
              className={`max-w-[90%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed shadow-sm ${
                msg.sender === "user"
                  ? "bg-indigo-600 text-white rounded-br-xs"
                  : "bg-slate-800 border border-slate-700/70 text-slate-200 rounded-bl-xs"
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.text}</div>

              {/* Cartões de Outliers / Pontos Suspeitos */}
              {msg.outliers && msg.outliers.length > 0 && (
                <div className="mt-3 pt-2.5 border-t border-slate-700 space-y-2">
                  <p className="font-semibold text-amber-300 text-[11px] flex items-center gap-1">
                    <span>⚠️ {msg.outliers.length} Ponto(s) Isolado(s) Detetado(s):</span>
                  </p>
                  {msg.outliers.map((o) => (
                    <div
                      key={o.id}
                      className="p-2 rounded-lg bg-amber-950/30 border border-amber-500/30 text-[11px] text-amber-200/90 space-y-0.5"
                    >
                      <div className="font-bold text-white flex justify-between">
                        <span>{o.cliente}</span>
                        <span className="text-amber-400 font-mono">~{o.dist_km_armazem} km</span>
                      </div>
                      <p className="text-slate-300">{o.morada} {o.cp ? `(${o.cp})` : ""}</p>
                      <p className="text-amber-300 text-[10px] italic">💡 {o.motivo_suspeita}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Ações sugeridas */}
              {msg.actions && msg.actions.length > 0 && (
                <div className="mt-2.5 pt-2 border-t border-slate-700 flex flex-wrap gap-1.5">
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
            <span className="text-[10px] text-slate-500 mt-1 px-1">{msg.timestamp}</span>
          </div>
        ))}

        {loading && (
          <div className="flex items-center space-x-2 text-xs text-indigo-300 bg-slate-800/80 border border-slate-700 rounded-xl px-3.5 py-2 max-w-[70%]">
            <div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            <span>O Co-Piloto está a raciocinar sobre o mapa...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <div className="p-3 bg-slate-950 border-t border-slate-800">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage(inputText);
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Pergunte ao Co-Piloto (ex: 'Porque ficou a entrega X de fora?')..."
            className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500 transition-colors"
          />
          <button
            type="submit"
            disabled={loading || !inputText.trim()}
            className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md transition-all cursor-pointer"
          >
            Enviar
          </button>
        </form>
      </div>
    </div>
  );
}
