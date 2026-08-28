"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { apiRequest } from "@/utils/api";

const DeliveryMapPicker = dynamic(() => import("@/components/DeliveryMapPicker"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[350px] bg-zinc-950 flex flex-col items-center justify-center text-zinc-400 space-y-2 rounded-2xl border border-zinc-800">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      <p className="text-xs font-medium">A carregar mapa interativo...</p>
    </div>
  ),
});

export interface GeocodingModalData {
  name?: string;
  address: string;
  cp: string;
  locality: string;
  lat: number;
  lon: number;
}

interface UnifiedGeocodingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { address: string; cp: string; locality: string; lat: number; lon: number }) => Promise<void> | void;
  title?: string;
  entityType?: "warehouse" | "delivery";
  initialData: GeocodingModalData;
}

export default function UnifiedGeocodingModal({
  isOpen,
  onClose,
  onSave,
  title,
  entityType = "delivery",
  initialData,
}: UnifiedGeocodingModalProps) {
  const [address, setAddress] = useState("");
  const [cp, setCp] = useState("");
  const [locality, setLocality] = useState("");
  const [lat, setLat] = useState(0);
  const [lon, setLon] = useState(0);
  const [googleCoordsInput, setGoogleCoordsInput] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && initialData) {
      setAddress(initialData.address || "");
      setCp(initialData.cp || "");
      setLocality(initialData.locality || "");
      setLat(initialData.lat || 0);
      setLon(initialData.lon || 0);
      setGoogleCoordsInput("");
      setSuggestions([]);
    }
  }, [isOpen, initialData]);

  // CTT Database Suggestions Search
  useEffect(() => {
    if (!isOpen) return;
    const term = address.trim();
    if (term.length < 3) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSuggestionsLoading(true);
      try {
        const query = `${term} ${cp} ${locality}`.trim();
        const res = await apiRequest(`/api/geocoding/suggest?q=${encodeURIComponent(query)}`);
        if (res && res.suggestions) {
          setSuggestions(res.suggestions);
        } else if (Array.isArray(res)) {
          setSuggestions(res);
        } else {
          setSuggestions([]);
        }
      } catch (err) {
        console.warn("Suggestions error:", err);
      } finally {
        setSuggestionsLoading(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [isOpen, address, cp, locality]);

  if (!isOpen) return null;

  const headerTitle =
    title ||
    (entityType === "warehouse"
      ? `Georreferenciação Manual do Armazém: ${initialData?.name || "Armazém"}`
      : `Georreferenciação Manual da Entrega: ${initialData?.name || "Cliente"}`);

  const handleApplyGoogleCoords = (val: string) => {
    setGoogleCoordsInput(val);
    const clean = val.trim();
    if (!clean) return;

    // Pattern for Google Maps URLs (e.g., .../@38.7222,-9.1393,17z...)
    const urlMatch = clean.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (urlMatch) {
      const pLat = parseFloat(urlMatch[1]);
      const pLon = parseFloat(urlMatch[2]);
      if (!isNaN(pLat) && !isNaN(pLon)) {
        setLat(pLat);
        setLon(pLon);
        return;
      }
    }

    // Pattern for direct Lat, Lon format (e.g., 38.872732, -9.053075 or 38,872732 -9,053075)
    const parts = clean.split(/[,;\s\t]+/).filter(Boolean);
    if (parts.length >= 2) {
      const pLat = parseFloat(parts[0].replace(",", "."));
      const pLon = parseFloat(parts[1].replace(",", "."));
      if (!isNaN(pLat) && !isNaN(pLon) && pLat >= -90 && pLat <= 90 && pLon >= -180 && pLon <= 180) {
        setLat(pLat);
        setLon(pLon);
      }
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        address: address.trim(),
        cp: cp.trim(),
        locality: locality.trim(),
        lat: Number(lat) || 0,
        lon: Number(lon) || 0,
      });
      onClose();
    } catch (err: any) {
      alert("Erro ao guardar georreferenciação: " + (err.message || "Erro desconhecido"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl w-full max-w-5xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-zinc-100 font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 bg-zinc-900/90">
          <div className="flex items-center space-x-2.5">
            <span className="text-xl">{entityType === "warehouse" ? "🏠" : "📍"}</span>
            <div>
              <h2 className="text-sm font-bold text-zinc-100 leading-tight">{headerTitle}</h2>
              <p className="text-[11px] text-zinc-400">
                Pesquise a morada, cole coordenadas ou arraste o marcador para a localização exata
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
            title="Fechar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal Body: 2 Columns Grid */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-4 sm:p-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left Column (5 cols): Form & CTT Suggestions */}
            <div className="lg:col-span-5 space-y-3">
              {/* 1. Address input */}
              <div>
                <label className="block text-zinc-300 font-semibold mb-1 text-[11px] uppercase tracking-wide">
                  Morada Completa <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Ex: Rua Direita, 123 ou Parque Industrial Lote 4"
                  className="w-full bg-zinc-950 border border-zinc-700/80 rounded-xl px-3 py-2 text-zinc-100 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-medium placeholder-zinc-500"
                  required
                />
              </div>

              {/* 2. CP and Locality */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-zinc-300 font-semibold mb-1 text-[11px] uppercase tracking-wide">
                    Código Postal
                  </label>
                  <input
                    type="text"
                    value={cp}
                    onChange={(e) => setCp(e.target.value)}
                    placeholder="Ex: 2625-441"
                    className="w-full bg-zinc-950 border border-zinc-700/80 rounded-xl px-3 py-2 text-zinc-100 font-mono text-xs outline-none focus:border-indigo-500 placeholder-zinc-500"
                  />
                </div>
                <div>
                  <label className="block text-zinc-300 font-semibold mb-1 text-[11px] uppercase tracking-wide">
                    Localidade
                  </label>
                  <input
                    type="text"
                    value={locality}
                    onChange={(e) => setLocality(e.target.value)}
                    placeholder="Ex: Forte da Casa"
                    className="w-full bg-zinc-950 border border-zinc-700/80 rounded-xl px-3 py-2 text-zinc-100 text-xs outline-none focus:border-indigo-500 placeholder-zinc-500"
                  />
                </div>
              </div>

              {/* 3. Google Maps Smart Paste */}
              <div className="bg-indigo-950/30 border border-indigo-500/30 rounded-xl p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold text-indigo-300">
                    📋 Colar Coordenadas (Google Maps)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const query = `${address} ${cp} ${locality}`.trim();
                      if (query) {
                        window.open(
                          `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
                          "_blank"
                        );
                      }
                    }}
                    className="text-[10px] font-bold text-rose-400 hover:text-rose-300 bg-rose-950/40 hover:bg-rose-950/80 border border-rose-800/60 px-2 py-0.5 rounded-lg transition-all flex items-center space-x-1 cursor-pointer"
                    title="Abrir pesquisa desta morada no Google Maps para ver no mapa e copiar coordenadas"
                  >
                    <span>🗺️ Abrir Google Maps ↗</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={googleCoordsInput}
                  placeholder="Cole aqui (ex: 38.872732, -9.053075 ou link)..."
                  onChange={(e) => handleApplyGoogleCoords(e.target.value)}
                  className="w-full bg-zinc-950 border border-indigo-500/40 rounded-lg px-3 py-1.5 text-xs text-emerald-400 font-mono outline-none focus:border-indigo-400 placeholder-zinc-500"
                />
              </div>

              {/* 4. Numeric Latitude / Longitude */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1 text-[11px]">Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={lat}
                    onChange={(e) => setLat(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-700/80 rounded-xl px-3 py-2 text-zinc-100 font-mono text-xs outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1 text-[11px]">Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={lon}
                    onChange={(e) => setLon(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-700/80 rounded-xl px-3 py-2 text-zinc-100 font-mono text-xs outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* 5. CTT Suggestions */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    Sugestões da Base de Dados CTT:
                  </span>
                  {suggestionsLoading && (
                    <span className="text-[10px] text-indigo-400 animate-pulse">A pesquisar...</span>
                  )}
                </div>
                {suggestions.length > 0 ? (
                  <div className="max-h-40 overflow-y-auto space-y-1.5 bg-zinc-950 p-2 border border-zinc-800 rounded-xl">
                    {suggestions.map((s, idx) => (
                      <div
                        key={idx}
                        onClick={() => {
                          setAddress(s.morada || s.address || address);
                          setCp(s.cp || s.codigo_postal || cp);
                          setLocality(s.concelho || s.localidade || locality);
                          if (s.lat && s.lon) {
                            setLat(Number(s.lat));
                            setLon(Number(s.lon));
                          }
                        }}
                        className="p-2 hover:bg-zinc-800 bg-zinc-900/80 border border-zinc-800 rounded-lg cursor-pointer text-xs text-zinc-300 transition-colors flex items-center justify-between gap-2"
                      >
                        <div className="truncate">
                          <div className="font-semibold text-zinc-200 truncate">{s.morada || s.address}</div>
                          <div className="text-[10px] text-zinc-400">{s.concelho || s.localidade}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-mono text-xs text-indigo-400 block">{s.cp || s.codigo_postal}</span>
                          {s.score !== undefined && (
                            <span className="text-[9px] text-emerald-400 font-bold">{Math.round(s.score)}% match</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-2.5 text-[11px] text-zinc-400 bg-zinc-950/60 border border-zinc-800/60 rounded-xl italic text-center">
                    {suggestionsLoading
                      ? "A procurar sugestões..."
                      : "Sem sugestões exatas na BD. Use o mapa ao lado para pesquisar ou clicar."}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column (7 cols): Interactive Leaflet Map */}
            <div className="lg:col-span-7 flex flex-col min-h-[380px] h-[480px]">
              <DeliveryMapPicker
                lat={lat}
                lon={lon}
                onCoordsChange={(newLat, newLon) => {
                  setLat(newLat);
                  setLon(newLon);
                }}
                searchAddress={`${address} ${cp} ${locality}`}
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex justify-between items-center pt-4 mt-4 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
            >
              Cancelar
            </button>
            <div className="flex items-center space-x-3">
              {lat !== 0 && lon !== 0 && (
                <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2.5 py-1 rounded-lg">
                  📍 {lat.toFixed(6)}, {lon.toFixed(6)}
                </span>
              )}
              <button
                type="submit"
                disabled={saving || !address.trim()}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 cursor-pointer transition-all flex items-center space-x-1.5"
              >
                {saving ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>A Guardar...</span>
                  </>
                ) : (
                  <>
                    <span>💾</span>
                    <span>Guardar Coordenadas</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
