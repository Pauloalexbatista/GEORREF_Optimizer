"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/context/I18nContext";

const MapComponent = dynamic(() => import("@/components/MapComponent"), { ssr: false });

export default function DetachedMapPage() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const [clients, setClients] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<string[]>([]);
  const [fleet, setFleet] = useState<any[]>([]);
  const [statusMsg, setStatusMsg] = useState("A aguardar sincronização...");

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
  };

  useEffect(() => {
    // 1. Initial load
    loadLocalData();

    // 2. BroadcastChannel listener
    const channel = new BroadcastChannel("georoute_map_sync");

    channel.onmessage = (event) => {
      if (event.data?.type === "MAP_UPDATE") {
        const { clients: c, warehouses: w, vehicles: v, fleet: f } = event.data;
        if (c) setClients(c);
        if (w) setWarehouses(w);
        if (v) setVehicles(v);
        if (f) setFleet(f);
        setStatusMsg(`Sincronizado em tempo real (${new Date().toLocaleTimeString()})`);
      }
    };

    // 3. Storage event listener fallback (for multi-tab / popup sync)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "georoute_map_state") {
        loadLocalData();
      }
    };

    window.addEventListener("storage", handleStorageChange);

    return () => {
      channel.close();
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

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
          <button
            onClick={() => {
              window.open("/dashboard/tactical/routes-matrix", "GeoRouteMatrixWindow", "width=1400,height=900,menubar=no,toolbar=no,location=no,status=no");
            }}
            className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-indigo-400 rounded-lg text-xs font-semibold border border-zinc-700 cursor-pointer transition-colors flex items-center space-x-1.5"
            title="Abrir a Matriz de Rotas no 3º Monitor"
          >
            <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
            <span>🖥️ {t.navigation.routesMatrix}</span>
          </button>
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

      {/* Main Fullscreen Map Container */}
      <div className="flex-1 w-full h-full relative">
        <MapComponent
          clients={clients}
          warehouses={warehouses}
          vehicles={vehicles}
          onMoveClientRoute={(clientName, newRoute, delivId, addr) => {
            const updated = clients.map((c) => {
              if (c.Cliente === clientName || (delivId && c.id === delivId)) {
                return { ...c, Rota: newRoute };
              }
              return c;
            });
            setClients(updated);
            const payload = { type: "MAP_UPDATE", clients: updated, warehouses, vehicles };
            try {
              const ch = new BroadcastChannel("georoute_map_sync");
              ch.postMessage(payload);
              localStorage.setItem("georoute_map_state", JSON.stringify(payload));
              ch.close();
            } catch (e) {}
          }}
          onUpdateClientCoords={(clientName, lat, lon) => {
            const updated = clients.map((c) => {
              if (c.Cliente === clientName) {
                return { ...c, Latitude: lat, Longitude: lon, Rota: "Por Distribuir" };
              }
              return c;
            });
            setClients(updated);
            const payload = { type: "MAP_UPDATE", clients: updated, warehouses, vehicles };
            try {
              const ch = new BroadcastChannel("georoute_map_sync");
              ch.postMessage(payload);
              localStorage.setItem("georoute_map_state", JSON.stringify(payload));
              ch.close();
            } catch (e) {}
          }}
        />
      </div>
    </div>
  );
}
