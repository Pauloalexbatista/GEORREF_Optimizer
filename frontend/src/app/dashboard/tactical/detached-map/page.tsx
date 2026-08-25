"use client";

import React, { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/context/I18nContext";
import { useProjects } from "@/context/ProjectContext";
import { apiRequest } from "@/utils/api";
import { MapFilterState } from "@/components/MapComponent";

const MapComponent = dynamic(() => import("@/components/MapComponent"), { ssr: false });

function isPendingRoute(routeName?: string) {
  if (!routeName) return true;
  const s = String(routeName).toUpperCase();
  return s.includes("PENDENTE") || s.includes("DISTRIBUIR");
}

export default function DetachedMapPage() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const { selectedProject } = useProjects();
  const [clients, setClients] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<string[]>([]);
  const [fleet, setFleet] = useState<any[]>([]);
  const [statusMsg, setStatusMsg] = useState("A aguardar sincronização...");

  // Synchronized Filter State (Bidirectional with 1st Screen)
  const [filters, setFilters] = useState<MapFilterState>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("georoute_active_filters");
        if (stored) return JSON.parse(stored);
      } catch (e) {}
    }
    return {
      searchQuery: "",
      selectedWarehouse: "all",
      statusFilter: "all",
      selectedRoutes: [],
    };
  });

  const channelRef = useRef<BroadcastChannel | null>(null);
  const lastMutationTimeRef = useRef<number>(0);

  const loadLocalData = () => {
    const storedState = localStorage.getItem("georoute_map_state");
    if (storedState) {
      try {
        const parsed = JSON.parse(storedState);
        if (parsed.clients) setClients(parsed.clients);
        if (parsed.warehouses) setWarehouses(parsed.warehouses);
        if (parsed.vehicles) setVehicles(parsed.vehicles);
        if (parsed.fleet) setFleet(parsed.fleet);
        setStatusMsg(`Atualizado às ${new Date().toLocaleTimeString()}`);
      } catch (e) {}
    }
    try {
      const storedFilters = localStorage.getItem("georoute_active_filters");
      if (storedFilters) {
        setFilters(JSON.parse(storedFilters));
      }
    } catch (e) {}
  };

  useEffect(() => {
    // 1. Initial load from localStorage
    loadLocalData();

    // 2. BroadcastChannel listener for live data & filter sync
    const channel = new BroadcastChannel("georoute_map_sync");
    channelRef.current = channel;

    channel.onmessage = (event) => {
      if (event.data?.type === "MAP_UPDATE") {
        if (event.data.timestamp && event.data.timestamp < lastMutationTimeRef.current) return;
        const { clients: c, warehouses: w, vehicles: v, fleet: f } = event.data;
        if (c) setClients(c);
        if (w) setWarehouses(w);
        if (v) setVehicles(v);
        if (f) setFleet(f);
        setStatusMsg(`Sincronizado em tempo real (${new Date().toLocaleTimeString()})`);
      } else if (event.data?.type === "FILTER_SYNC" && event.data?.sender !== "DETACHED_MAP") {
        if (event.data?.filters) {
          setFilters(event.data.filters);
          setStatusMsg(`Filtros sincronizados (${new Date().toLocaleTimeString()})`);
        }
      }
    };

    // 3. Storage event listener fallback (for multi-tab / popup sync)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "georoute_map_state" && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed.clients) setClients(parsed.clients);
          if (parsed.warehouses) setWarehouses(parsed.warehouses);
          if (parsed.vehicles) setVehicles(parsed.vehicles);
          if (parsed.fleet) setFleet(parsed.fleet);
          setStatusMsg(`Sincronizado às ${new Date().toLocaleTimeString()}`);
        } catch (err) {}
      } else if (e.key === "georoute_active_filters" && e.newValue) {
        try {
          setFilters(JSON.parse(e.newValue));
        } catch (err) {}
      }
    };

    window.addEventListener("storage", handleStorageChange);

    return () => {
      channel.close();
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  const handleFilterChange = (newFilters: MapFilterState) => {
    setFilters(newFilters);
    try {
      localStorage.setItem("georoute_active_filters", JSON.stringify(newFilters));
      channelRef.current?.postMessage({
        type: "FILTER_SYNC",
        sender: "DETACHED_MAP",
        filters: newFilters,
        timestamp: Date.now(),
      });
    } catch (e) {}
  };

  const handleMoveClientRoute = async (clientName: string, newRoute: string, delivId?: number, address?: string) => {
    const projId = selectedProject?.id || parseInt(localStorage.getItem("georoute_selected_project_id") || "0", 10);
    lastMutationTimeRef.current = Date.now();
    const targetRoute = isPendingRoute(newRoute) ? "Por Distribuir" : newRoute;

    // Optimistic state update
    const updated = clients.map((c) => {
      if (c.Cliente === clientName || (delivId && (c.id === delivId || c.ID_Original === delivId))) {
        return { ...c, Rota: targetRoute };
      }
      return c;
    });
    setClients(updated);
    setStatusMsg(`A guardar reatribuição para ${targetRoute}...`);

    if (!projId) {
      const payload = { type: "MAP_UPDATE", clients: updated, warehouses, vehicles, fleet, timestamp: Date.now() };
      try {
        channelRef.current?.postMessage(payload);
        localStorage.setItem("georoute_map_state", JSON.stringify(payload));
      } catch (e) {}
      return;
    }

    try {
      const res = await apiRequest("/api/solver/reassign", {
        method: "POST",
        body: JSON.stringify({
          project_id: projId,
          client_code: clientName,
          delivery_id: delivId,
          address: address,
          new_route: targetRoute,
        }),
      });

      if (res && res.routes) {
        const mappedClients = res.routes.map((r: any) => ({
          ...r,
          id: r.id || r.ID_Original,
          ID_Original: r.id || r.ID_Original,
          Doc_ID: r.Doc_ID || r.doc_id || "",
          Codigo_Cliente: r.Codigo_Cliente || r.codigo_cliente || "",
          Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
          Nome_Cliente: r.Nome_Cliente || r.Cliente,
          Telefone: r.Telefone || r.Telefone_Cliente || "",
          Observacoes: r.Observacoes || "",
        }));
        setClients(mappedClients);
        setStatusMsg(`Guardado às ${new Date().toLocaleTimeString()}`);

        const payload = {
          type: "MAP_UPDATE",
          clients: mappedClients,
          warehouses,
          vehicles,
          fleet,
          timestamp: Date.now(),
        };
        try {
          channelRef.current?.postMessage(payload);
          localStorage.setItem("georoute_map_state", JSON.stringify(payload));
        } catch (e) {}
      }
    } catch (err: any) {
      console.error("Reassign error from map:", err);
      setStatusMsg(`Erro ao guardar: ${err.message || "Tente novamente"}`);
      loadLocalData();
    }
  };

  const handleBulkReassign = async (items: { clientName: string; deliveryId?: number; address?: string }[], newRoute: string) => {
    const projId = selectedProject?.id || parseInt(localStorage.getItem("georoute_selected_project_id") || "0", 10);
    lastMutationTimeRef.current = Date.now();
    const targetRoute = isPendingRoute(newRoute) ? "Por Distribuir" : newRoute;
    if (!projId || items.length === 0) return;

    setStatusMsg(`A transferir ${items.length} paragens para ${targetRoute}...`);
    try {
      const res = await apiRequest("/api/solver/reassign-bulk", {
        method: "POST",
        body: JSON.stringify({
          project_id: projId,
          items: items.map(it => ({
            client_code: it.clientName,
            delivery_id: it.deliveryId,
            address: it.address,
          })),
          new_route: targetRoute,
        }),
      });

      if (res && res.routes) {
        const mappedClients = res.routes.map((r: any) => ({
          ...r,
          id: r.id || r.ID_Original,
          ID_Original: r.id || r.ID_Original,
          Doc_ID: r.Doc_ID || r.doc_id || "",
          Codigo_Cliente: r.Codigo_Cliente || r.codigo_cliente || "",
          Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
          Nome_Cliente: r.Nome_Cliente || r.Cliente,
          Telefone: r.Telefone || r.Telefone_Cliente || "",
          Observacoes: r.Observacoes || "",
        }));
        setClients(mappedClients);
        setStatusMsg(`Transferidas ${items.length} paragens às ${new Date().toLocaleTimeString()}`);

        const payload = {
          type: "MAP_UPDATE",
          clients: mappedClients,
          warehouses,
          vehicles,
          fleet,
          timestamp: Date.now(),
        };
        try {
          channelRef.current?.postMessage(payload);
          localStorage.setItem("georoute_map_state", JSON.stringify(payload));
        } catch (e) {}
      }
    } catch (err: any) {
      console.error("Bulk reassign error:", err);
      setStatusMsg(`Erro ao transferir em massa: ${err.message || "Tente novamente"}`);
      loadLocalData();
    }
  };

  const handleUpdateClientCoords = async (clientName: string, lat: number, lon: number) => {
    const projId = selectedProject?.id || parseInt(localStorage.getItem("georoute_selected_project_id") || "0", 10);
    const target = clients.find((c) => c.Cliente === clientName);
    const delivId = target?.id || target?.ID_Original;

    const updated = clients.map((c) => {
      if (c.Cliente === clientName || (delivId && (c.id === delivId || c.ID_Original === delivId))) {
        return { ...c, Latitude: lat, Longitude: lon, Rota: "Por Distribuir" };
      }
      return c;
    });
    setClients(updated);
    setStatusMsg(`A atualizar coordenadas de ${clientName}...`);

    if (!projId) return;

    try {
      if (delivId) {
        try {
          await apiRequest(`/api/geocoding/delivery/${delivId}`, {
            method: "PUT",
            body: JSON.stringify({
              morada: target?.Morada || "",
              codigo_postal: target?.CP || "",
              concelho: target?.Localidade || "",
              latitude: lat,
              longitude: lon,
            }),
          });
        } catch (e) {
          console.warn("Geocoding correction update error:", e);
        }
      }

      const res = await apiRequest("/api/solver/reassign", {
        method: "POST",
        body: JSON.stringify({
          project_id: projId,
          client_code: clientName,
          delivery_id: delivId,
          address: target?.Morada,
          new_route: "Por Distribuir",
        }),
      });

      if (res && res.routes) {
        const mappedClients = res.routes.map((r: any) => ({
          ...r,
          id: r.id || r.ID_Original,
          ID_Original: r.id || r.ID_Original,
          Doc_ID: r.Doc_ID || r.doc_id || "",
          Codigo_Cliente: r.Codigo_Cliente || r.codigo_cliente || "",
          Rota: isPendingRoute(r.Rota) ? "Por Distribuir" : r.Rota,
          Nome_Cliente: r.Nome_Cliente || r.Cliente,
          Telefone: r.Telefone || r.Telefone_Cliente || "",
          Observacoes: r.Observacoes || "",
        }));
        setClients(mappedClients);
        setStatusMsg(`Coordenadas atualizadas (${new Date().toLocaleTimeString()})`);

        const payload = {
          type: "MAP_UPDATE",
          clients: mappedClients,
          warehouses,
          vehicles,
          fleet,
          timestamp: Date.now(),
        };
        try {
          channelRef.current?.postMessage(payload);
          localStorage.setItem("georoute_map_state", JSON.stringify(payload));
        } catch (e) {}
      }
    } catch (err: any) {
      console.error("Coords update error:", err);
      setStatusMsg(`Erro ao atualizar coordenadas: ${err.message || "Tente novamente"}`);
    }
  };

  return (
    <div className="w-screen h-screen bg-zinc-950 flex flex-col overflow-hidden">
      {/* Top Bar for Detached Window */}
      <div className="bg-zinc-900/95 border-b border-zinc-800 px-4 py-2 flex items-center justify-between z-20 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <h1 className="text-xs font-bold text-zinc-100 tracking-wide uppercase">
            {t.common.appName} — {t.navigation.detachedMap}
          </h1>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 cursor-pointer transition-colors flex items-center justify-center"
            title={theme === "dark" ? "Mudar para Modo Claro" : "Mudar para Modo Escuro"}
          >
            {theme === "dark" ? (
              <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
          <span className="text-[10px] text-zinc-400 font-mono bg-zinc-850 px-2.5 py-1 rounded-full border border-zinc-800">
            {statusMsg}
          </span>
          <a
            href="/dashboard/tactical"
            className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-semibold border border-zinc-700 cursor-pointer transition-colors flex items-center space-x-1"
          >
            <span>📊 {t.navigation.dashboard}</span>
          </a>
          <button
            onClick={loadLocalData}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded-lg text-xs font-semibold shadow-sm transition-all flex items-center space-x-1.5 cursor-pointer"
            title="Forçar atualização dos dados do mapa"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{t.common.refresh}</span>
          </button>
        </div>
      </div>

      {/* Main Fullscreen Map Container with live synchronized filter state */}
      <div className="flex-1 w-full h-full relative">
        <MapComponent
          clients={clients}
          warehouses={warehouses}
          vehicles={vehicles}
          fleet={fleet}
          filterState={filters}
          onFilterChange={handleFilterChange}
          onMoveClientRoute={handleMoveClientRoute}
          onBulkReassign={handleBulkReassign}
          onUpdateClientCoords={handleUpdateClientCoords}
        />
      </div>
    </div>
  );
}
