"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";

const MapComponent = dynamic(() => import("@/components/MapComponent"), { ssr: false });

export default function DetachedMapPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<string[]>([]);
  const [statusMsg, setStatusMsg] = useState("A aguardar sincronização...");

  const loadLocalData = () => {
    const storedState = localStorage.getItem("georoute_map_state");
    if (storedState) {
      try {
        const parsed = JSON.parse(storedState);
        if (parsed.clients) setClients(parsed.clients);
        if (parsed.warehouses) setWarehouses(parsed.warehouses);
        if (parsed.vehicles) setVehicles(parsed.vehicles);
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
        const { clients: c, warehouses: w, vehicles: v } = event.data;
        if (c) setClients(c);
        if (w) setWarehouses(w);
        if (v) setVehicles(v);
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
            GeoRoute Pro — Mapa Independente (2.º Monitor)
          </h1>
        </div>

        <div className="flex items-center space-x-3">
          <span className="text-[10px] text-zinc-400 font-mono bg-zinc-850 px-2.5 py-1 rounded-full border border-zinc-800">
            {statusMsg}
          </span>
          <button
            onClick={loadLocalData}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded-lg text-xs font-semibold shadow-sm transition-all flex items-center space-x-1.5 cursor-pointer"
            title="Forçar atualização dos dados do mapa"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Atualizar Mapa</span>
          </button>
        </div>
      </div>

      {/* Main Fullscreen Map Container */}
      <div className="flex-1 w-full h-full relative">
        <MapComponent
          clients={clients}
          warehouses={warehouses}
          vehicles={vehicles}
          onMoveClientRoute={() => {}}
          onUpdateClientCoords={() => {}}
        />
      </div>
    </div>
  );
}
