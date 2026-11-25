"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { apiRequest } from "@/utils/api";
import { useProjects } from "./ProjectContext";

export interface OutlierItem {
  id: string | number;
  cliente: string;
  morada: string;
  cp: string;
  localidade: string;
  dist_km_armazem: number;
  motivo_suspeita: string;
  rota_atual?: string;
  lat?: number;
  lon?: number;
}

export interface ActionItem {
  label: string;
  action: string;
}

export interface ChatMessage {
  id: string;
  sender: "user" | "agent";
  text: string;
  outliers?: OutlierItem[];
  actions?: ActionItem[];
  timestamp: string;
  isError?: boolean;
}

interface AgentChatContextType {
  isOpen: boolean;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  messages: ChatMessage[];
  loading: boolean;
  sendMessage: (text: string) => Promise<void>;
  clearHistory: () => void;
  executeCommandAction: (commandTag: string) => Promise<void>;
  pendingOutliersCount: number;
}

const AgentChatContext = createContext<AgentChatContextType | undefined>(undefined);

export function AgentChatProvider({ children }: { children: React.ReactNode }) {
  const { selectedProject } = useProjects();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  // Carregar histórico de mensagens persistente para o projeto selecionado
  useEffect(() => {
    if (!selectedProject?.id) {
      setMessages([]);
      return;
    }

    try {
      const storageKey = `georoute_agent_chat_${selectedProject.id}`;
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          return;
        }
      }
    } catch (e) {
      console.warn("Falha ao carregar histórico de chat:", e);
    }

    // Se não houver histórico, iniciar com saudação tática do Agente IA
    const initialGreeting: ChatMessage = {
      id: "init_greeting",
      sender: "agent",
      text: `Olá! Sou o seu **Co-Piloto Inteligente de Tráfego** (Google Gemini). Estou a monitorizar o plano **"${selectedProject.nome}"**.\n\nPosso auditar coordenadas suspeitas, verificar janelas horárias, transferir paragens entre carrinhas ou sequenciar rotas. Como posso ajudar?`,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      actions: [
        { label: "🔍 Verificar Coordenadas", action: "inspect_outliers" },
        { label: "📊 Janelas Manhã/Tarde", action: "slots_distribution" },
        { label: "📦 Perto do Armazém", action: "filter_near_depot" },
      ],
    };
    setMessages([initialGreeting]);
  }, [selectedProject?.id, selectedProject?.nome]);

  // Persistir mensagens sempre que forem atualizadas
  useEffect(() => {
    if (!selectedProject?.id || messages.length === 0) return;
    try {
      const storageKey = `georoute_agent_chat_${selectedProject.id}`;
      localStorage.setItem(storageKey, JSON.stringify(messages));
    } catch (e) {
      console.warn("Falha ao gravar histórico de chat:", e);
    }
  }, [messages, selectedProject?.id]);

  const openChat = useCallback(() => setIsOpen(true), []);
  const closeChat = useCallback(() => setIsOpen(false), []);
  const toggleChat = useCallback(() => setIsOpen((prev) => !prev), []);

  const clearHistory = useCallback(() => {
    if (!selectedProject?.id) return;
    try {
      localStorage.removeItem(`georoute_agent_chat_${selectedProject.id}`);
    } catch (e) {}

    const resetMsg: ChatMessage = {
      id: String(Date.now()),
      sender: "agent",
      text: "Histórico limpo. Estou pronto para uma nova análise.",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages([resetMsg]);
  }, [selectedProject?.id]);

  const executeCommandAction = async (commandTag: string) => {
    if (!selectedProject?.id) return;

    // 1. Reatribuir paragem
    const cmdReassign = commandTag.match(/\[COMANDO:REATRIBUIR\|CLIENTE:(.*?)\|VIATURA:(.*?)\]/);
    if (cmdReassign) {
      const clientCode = cmdReassign[1].trim();
      const targetVehicle = cmdReassign[2].trim();
      try {
        await apiRequest("/api/solver/reassign", {
          method: "POST",
          body: JSON.stringify({
            project_id: selectedProject.id,
            client_code: clientCode,
            target_route: targetVehicle,
          }),
        });
        const confirmMsg: ChatMessage = {
          id: String(Date.now()),
          sender: "agent",
          text: `✅ **Ação Executada:** A paragem **${clientCode}** foi atribuída com sucesso a **${targetVehicle}**.`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages((prev) => [...prev, confirmMsg]);
      } catch (err: any) {
        const errorMsg: ChatMessage = {
          id: String(Date.now()),
          sender: "agent",
          text: `⚠️ Não foi possível reatribuir: ${err?.message || "Erro"}`,
          isError: true,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages((prev) => [...prev, errorMsg]);
      }
      return;
    }

    // 2. Ordenar e sequenciar todos os carros automaticamente
    if (commandTag.includes("[COMANDO:OTIMIZAR_TODAS_SEQUENCIAS]")) {
      try {
        await apiRequest("/api/solver/optimize-all-sequences", {
          method: "POST",
          body: JSON.stringify({ project_id: selectedProject.id }),
        });
        const confirmMsg: ChatMessage = {
          id: String(Date.now()),
          sender: "agent",
          text: "⚡ **Ação Executada:** A sequência e horários de todas as rotas foram reotimizados!",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages((prev) => [...prev, confirmMsg]);
      } catch (err: any) {
        const errorMsg: ChatMessage = {
          id: String(Date.now()),
          sender: "agent",
          text: `⚠️ Falha ao reordenar rotas: ${err?.message || "Erro"}`,
          isError: true,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages((prev) => [...prev, errorMsg]);
      }
      return;
    }

    // 3. Re-georreferenciar cliente
    const cmdGeo = commandTag.match(/\[COMANDO:REGEORREFERENCIAR\|CLIENTE:(.*?)\]/);
    if (cmdGeo) {
      const clientTarget = cmdGeo[1].trim();
      try {
        await apiRequest("/api/geocoding/resolve", {
          method: "POST",
          body: JSON.stringify({
            projeto_id: selectedProject.id,
            cliente: clientTarget,
          }),
        });
        const confirmMsg: ChatMessage = {
          id: String(Date.now()),
          sender: "agent",
          text: `📍 **Ação Executada:** Georreferenciação recalculada para **${clientTarget}**.`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages((prev) => [...prev, confirmMsg]);
      } catch (err: any) {
        const errorMsg: ChatMessage = {
          id: String(Date.now()),
          sender: "agent",
          text: `⚠️ Falha ao regeorreferenciar: ${err?.message || "Erro"}`,
          isError: true,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages((prev) => [...prev, errorMsg]);
      }
    }
  };

  const sendMessage = async (textToSend: string) => {
    if (!textToSend.trim() || !selectedProject?.id) return;

    const userMsg: ChatMessage = {
      id: String(Date.now()),
      sender: "user",
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res: any = await apiRequest("/api/agent/chat", {
        method: "POST",
        body: JSON.stringify({
          project_id: selectedProject.id,
          message: textToSend,
        }),
      });

      const agentReplyText = res.reply || "Análise concluída.";
      const outliers = res.outliers || [];
      const actions = res.suggested_actions || [];

      const agentMsg: ChatMessage = {
        id: String(Date.now() + 1),
        sender: "agent",
        text: agentReplyText,
        outliers: outliers,
        actions: actions,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setMessages((prev) => [...prev, agentMsg]);

      // Se a resposta contiver comandos operacionais autónomos, executá-los
      const cmdReassign = agentReplyText.match(/\[COMANDO:REATRIBUIR\|CLIENTE:(.*?)\|VIATURA:(.*?)\]/);
      if (cmdReassign) {
        await executeCommandAction(cmdReassign[0]);
      }
      if (agentReplyText.includes("[COMANDO:OTIMIZAR_TODAS_SEQUENCIAS]")) {
        await executeCommandAction("[COMANDO:OTIMIZAR_TODAS_SEQUENCIAS]");
      }
      const cmdGeo = agentReplyText.match(/\[COMANDO:REGEORREFERENCIAR\|CLIENTE:(.*?)\]/);
      if (cmdGeo) {
        await executeCommandAction(cmdGeo[0]);
      }
    } catch (err: any) {
      console.error("Erro no chat do Agente IA:", err);
      const errorMsg: ChatMessage = {
        id: String(Date.now() + 1),
        sender: "agent",
        text: `⚠️ **Aviso do Agente:** Não foi possível contactar o serviço de IA. ${err?.message || "Tente novamente."}`,
        isError: true,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  // Contar outliers pendentes da última mensagem do agente
  const lastMsgWithOutliers = [...messages].reverse().find((m) => m.outliers && m.outliers.length > 0);
  const pendingOutliersCount = lastMsgWithOutliers?.outliers?.length || 0;

  return (
    <AgentChatContext.Provider
      value={{
        isOpen,
        openChat,
        closeChat,
        toggleChat,
        messages,
        loading,
        sendMessage,
        clearHistory,
        executeCommandAction,
        pendingOutliersCount,
      }}
    >
      {children}
    </AgentChatContext.Provider>
  );
}

export function useAgentChat() {
  const context = useContext(AgentChatContext);
  if (!context) {
    throw new Error("useAgentChat deve ser usado dentro de um AgentChatProvider");
  }
  return context;
}
