"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { apiRequest } from "@/utils/api";
import { useI18n } from "@/context/I18nContext";

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
  const { t } = useI18n();
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

  const handleCoordsChange = (newLat: number, newLon: number) => {
    setLat(newLat);
    setLon(newLon);
  };

  const handlePasteParse = () => {
    if (!pastedCoords.trim()) return;
    const str = pastedCoords.trim();

    // 1. Google Maps URL regex: @lat,lon
    const urlMatch = str.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (urlMatch) {
      setLat(parseFloat(urlMatch[1]));
      setLon(parseFloat(urlMatch[2]));
      return;
    }

    // 2. Direct Lat, Lon pair regex
    const pairMatch = str.match(/(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/);
    if (pairMatch) {
      setLat(parseFloat(pairMatch[1]));
      setLon(parseFloat(pairMatch[2]));
      return;
    }

    alert("Formato de coordenadas inválido. Cole valores no formato '40.2033, -8.4103' ou um link do Google Maps.");
  };

  const handleSearchSuggestions = async () => {
    if (!addr && !cp) return;
    setSuggestionsLoading(true);
    try {
      const q = `${addr} ${cp} ${locality}`.trim();
      const res = await apiRequest(`/api/maps/search-ctt?q=${encodeURIComponent(q)}`);
      if (res && res.suggestions) {
        setSuggestions(res.suggestions);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const applySuggestion = (s: any) => {
    if (s.morada) setAddr(s.morada);
    if (s.cp) setCp(s.cp);
    if (s.localidade) setLocality(s.localidade);
    if (s.latitude && s.longitude) {
      setLat(s.latitude);
      setLon(s.longitude);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/40">
          <div>
            <h3 className="text-sm font-bold text-zinc-100 flex items-center space-x-2">
              <span>🏢</span>
              <span>{t.modal.geoPickerTitle}: {warehouseName}</span>
            </h3>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              {t.modal.dragPinHint}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto">
          {/* Left: Interactive Map */}
          <div className="flex flex-col space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Posição no Mapa (Arrastar Pin)
            </label>
            <div className="h-72 w-full rounded-xl overflow-hidden border border-zinc-800 relative shadow-inner">
              <DeliveryMapPicker
                lat={lat || 39.5}
                lon={lon || -8.0}
                onCoordsChange={handleCoordsChange}
              />
            </div>
            <div className="flex items-center space-x-2 text-[11px] text-zinc-400 font-mono bg-zinc-950 p-2 rounded-lg border border-zinc-800">
              <span>Lat: <strong className="text-indigo-400">{lat ? lat.toFixed(6) : "0.000000"}</strong></span>
              <span>Lon: <strong className="text-indigo-400">{lon ? lon.toFixed(6) : "0.000000"}</strong></span>
            </div>
          </div>

          {/* Right: Manual Inputs & Paste box */}
          <div className="flex flex-col space-y-3">
            {/* Quick Paste from Google Maps */}
            <div className="bg-indigo-950/20 border border-indigo-500/20 p-3 rounded-xl space-y-1.5">
              <label className="block text-[11px] font-bold text-indigo-300 uppercase tracking-wider">
                {t.modal.pasteCoordsLabel}
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={pastedCoords}
                  onChange={(e) => setPastedCoords(e.target.value)}
                  placeholder={t.modal.pasteCoordsPlaceholder}
                  className="flex-1 bg-zinc-950 border border-indigo-500/30 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-indigo-400"
                />
                <button
                  type="button"
                  onClick={handlePasteParse}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all cursor-pointer shrink-0"
                >
                  {t.modal.applyCoords}
                </button>
              </div>
            </div>

            {/* Address fields */}
            <div>
              <label className="block text-[10px] font-semibold text-zinc-400 uppercase mb-1">
                {t.fleet.whAddressLabel}
              </label>
              <input
                type="text"
                value={addr}
                onChange={(e) => setAddr(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-zinc-400 uppercase mb-1">
                  {t.fleet.whCpLabel}
                </label>
                <input
                  type="text"
                  value={cp}
                  onChange={(e) => setCp(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-zinc-400 uppercase mb-1">
                  {t.fleet.whLocalityLabel}
                </label>
                <input
                  type="text"
                  value={locality}
                  onChange={(e) => setLocality(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* CTT suggestions button & list */}
            <div>
              <button
                type="button"
                onClick={handleSearchSuggestions}
                disabled={suggestionsLoading}
                className="w-full bg-zinc-850 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center justify-center space-x-1.5"
              >
                <span>🔍</span>
                <span>{suggestionsLoading ? t.common.loading : t.modal.cttSuggestions}</span>
              </button>

              {suggestions.length > 0 && (
                <div className="mt-2 max-h-32 overflow-y-auto space-y-1 bg-zinc-950 p-2 rounded-lg border border-zinc-800">
                  {suggestions.map((s, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => applySuggestion(s)}
                      className="w-full text-left p-1.5 rounded bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 hover:border-zinc-700 text-[10px] text-zinc-300 transition-colors cursor-pointer flex items-center justify-between"
                    >
                      <span className="truncate">{s.morada || s.cp_completo} - {s.localidade}</span>
                      <span className="text-emerald-400 font-mono shrink-0 ml-2">Escolher</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 flex items-center justify-end space-x-2.5 bg-zinc-950/40">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl border border-zinc-800 text-zinc-400 hover:text-zinc-200 bg-zinc-850 hover:bg-zinc-800 text-xs font-semibold transition-colors cursor-pointer"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm(addr, cp, locality, lat, lon);
              onClose();
            }}
            className="px-5 py-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white text-xs font-semibold shadow-md shadow-indigo-500/10 transition-all cursor-pointer"
          >
            {t.common.save}
          </button>
        </div>
      </div>
    </div>
  );
}
