"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { apiRequest } from "@/utils/api";

const DeliveryMapPicker = dynamic(() => import("@/components/DeliveryMapPicker"), { ssr: false });

interface WarehouseGeoModalProps {
  isOpen: boolean;
  warehouseName: string;
  initialAddress: string;
  initialCp: string;
  initialLocality: string;
  initialLat: number;
  initialLon: number;
  onConfirm: (address: string, cp: string, locality: string, lat: number, lon: number) => void;
  onClose: () => void;
}

export default function WarehouseGeoModal({
  isOpen,
  warehouseName,
  initialAddress,
  initialCp,
  initialLocality,
  initialLat,
  initialLon,
  onConfirm,
  onClose,
}: WarehouseGeoModalProps) {
  const [addr, setAddr] = useState(initialAddress || "");
  const [cp, setCp] = useState(initialCp || "");
  const [locality, setLocality] = useState(initialLocality || "");
  const [lat, setLat] = useState(initialLat || 0);
  const [lon, setLon] = useState(initialLon || 0);
  const [pastedCoords, setPastedCoords] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setAddr(initialAddress || "");
      setCp(initialCp || "");
      setLocality(initialLocality || "");
      setLat(initialLat || 0);
      setLon(initialLon || 0);
      setPastedCoords("");
      setSuggestions([]);
    }
  }, [isOpen, initialAddress, initialCp, initialLocality, initialLat, initialLon]);

  // Load CTT suggestions on change of address/CP/locality
  useEffect(() => {
    if (!isOpen) return;
    if (!addr && !cp && !locality) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSuggestionsLoading(true);
      try {
        const queryParams = new URLSearchParams();
        if (addr) queryParams.append("address", addr);
        if (cp) queryParams.append("cp", cp);
        if (locality) queryParams.append("city", locality);

        const data = await apiRequest(`/api/geocoding/suggestions?${queryParams.toString()}`);
        setSuggestions(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Failed to fetch CTT suggestions:", err);
      } finally {
        setSuggestionsLoading(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [addr, cp, locality, isOpen]);

  if (!isOpen) return null;

  const handlePasteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setPastedCoords(val);
    const cleaned = val.trim();
    if (!cleaned) return;

    const parts = cleaned.split(/[,;\s\t]+/).filter(Boolean);
    if (parts.length >= 2) {
      const pLat = parseFloat(parts[0].replace(",", "."));
      const pLon = parseFloat(parts[1].replace(",", "."));
      if (!isNaN(pLat) && !isNaN(pLon) && pLat >= -90 && pLat <= 90 && pLon >= -180 && pLon <= 180) {
        setLat(pLat);
        setLon(pLon);
      }
    }
  };

  const handleSelectSuggestion = (s: any) => {
    if (s.morada || s.address) setAddr(s.morada || s.address);
    if (s.cp) setCp(s.cp);
    if (s.concelho || s.localidade) setLocality(s.concelho || s.localidade);
    if (s.lat) setLat(s.lat);
    if (s.lon) setLon(s.lon);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(addr, cp, locality, lat, lon);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-5xl p-6 space-y-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div>
            <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
              <span>Georreferenciar Armazém:</span>
              <span className="text-indigo-400 font-semibold">{warehouseName || "Armazém"}</span>
            </h3>
            <p className="text-zinc-400 text-xs mt-0.5">
              Selecione uma sugestão CTT, cole coordenadas ou clique diretamente no mapa para posicionar a base logística.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 text-sm p-1.5 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Form & Suggestions */}
            <div className="lg:col-span-5 space-y-3">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1 text-[11px]">Morada do Armazém</label>
                <input
                  type="text"
                  value={addr}
                  onChange={(e) => setAddr(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1 text-[11px]">Código Postal</label>
                  <input
                    type="text"
                    value={cp}
                    onChange={(e) => setCp(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1 text-[11px]">Localidade / Concelho</label>
                  <input
                    type="text"
                    value={locality}
                    onChange={(e) => setLocality(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500 text-xs"
                  />
                </div>
              </div>

              {/* Paste Google Maps Coords Box */}
              <div className="bg-indigo-950/30 border border-indigo-500/30 rounded-xl p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold text-indigo-300">📋 Colar Coordenadas (Google Maps)</label>
                  <span className="text-[9px] text-zinc-400 font-mono">Ex: 38.78420, -9.12380</span>
                </div>
                <input
                  type="text"
                  value={pastedCoords}
                  placeholder="Cole aqui (ex: 38.78420, -9.12380)..."
                  onChange={handlePasteChange}
                  className="w-full bg-zinc-950 border border-indigo-500/40 rounded-lg px-3 py-1.5 text-xs text-emerald-400 font-mono outline-none focus:border-indigo-400 placeholder-zinc-600"
                />
              </div>

              {/* Coordinates Inputs */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1 text-[11px]">Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={lat}
                    onChange={(e) => setLat(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1 text-[11px]">Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={lon}
                    onChange={(e) => setLon(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500 font-mono text-xs"
                  />
                </div>
              </div>

              {/* CTT Database Suggestions List */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Sugestões da Base de Dados CTT:</span>
                  {suggestionsLoading && <span className="text-[10px] text-indigo-400 animate-pulse">A pesquisar...</span>}
                </div>

                {suggestions.length > 0 ? (
                  <div className="max-h-44 overflow-y-auto space-y-1.5 bg-zinc-950 p-2 border border-zinc-800 rounded-xl">
                    {suggestions.map((s, idx) => (
                      <div
                        key={idx}
                        onClick={() => handleSelectSuggestion(s)}
                        className="p-2 hover:bg-zinc-850 bg-zinc-900/60 border border-zinc-800/80 rounded-lg cursor-pointer text-xs text-zinc-300 transition-colors flex items-center justify-between gap-2"
                      >
                        <div className="truncate">
                          <div className="font-semibold text-zinc-200 truncate">{s.morada || s.address}</div>
                          <div className="text-[10px] text-zinc-400">{s.concelho || s.localidade}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-mono text-xs text-indigo-400 block">{s.cp}</span>
                          {s.score !== undefined && (
                            <span className="text-[9px] text-emerald-400 font-bold">{Math.round(s.score)}% match</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 text-[11px] text-zinc-500 bg-zinc-950/50 border border-zinc-800/50 rounded-xl italic text-center">
                    {suggestionsLoading ? "A procurar sugestões..." : "Sem sugestões exatas na BD. Use o mapa ao lado para pesquisar ou clicar."}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Interactive Leaflet Map */}
            <div className="lg:col-span-7 flex flex-col min-h-[380px]">
              <DeliveryMapPicker
                lat={lat}
                lon={lon}
                onCoordsChange={(nLat, nLon) => {
                  setLat(nLat);
                  setLon(nLon);
                }}
                searchAddress={`${addr} ${cp} ${locality}`}
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex justify-between items-center pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-300 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold cursor-pointer transition-all flex items-center space-x-2 shadow-lg shadow-indigo-600/20"
            >
              <span>Gravar Coordenadas do Armazém</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
