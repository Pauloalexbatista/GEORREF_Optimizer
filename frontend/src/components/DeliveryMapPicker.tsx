"use client";

import React, { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const pinIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface SearchResult {
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  address?: {
    road?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    postcode?: string;
    county?: string;
    state?: string;
  };
}

interface DeliveryMapPickerProps {
  lat: number;
  lon: number;
  onCoordsChange: (lat: number, lon: number) => void;
  searchAddress?: string;
}

function MapController({ center, zoom }: { center: [number, number]; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom || map.getZoom());
  }, [center, zoom, map]);
  return null;
}

function MapContainerHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function DeliveryMapPicker({
  lat,
  lon,
  onCoordsChange,
  searchAddress = "",
}: DeliveryMapPickerProps) {
  const hasCoords = lat !== 0 && lon !== 0 && !isNaN(lat) && !isNaN(lon);
  const currentCenter: [number, number] = hasCoords ? [lat, lon] : [38.72, -9.14];
  
  const [query, setQuery] = useState(searchAddress);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [mapLayer, setMapLayer] = useState<"standard" | "google_sat" | "google_hybrid">("standard");

  useEffect(() => {
    if (searchAddress) {
      setQuery(searchAddress);
    }
  }, [searchAddress]);

  const openGoogleMaps = () => {
    const term = (query || searchAddress).trim();
    if (!term) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(term)}`;
    window.open(url, "_blank");
  };

  const executeSearch = async (searchTerm: string) => {
    const cleanTerm = searchTerm.trim();
    if (!cleanTerm) return;

    setSearching(true);
    setSearchError("");
    setSearchResults([]);

    const attempts = [
      cleanTerm + ", Portugal",
      cleanTerm.replace(/\b\d{4}(-\d{3})?\b/g, "").trim() + ", Portugal",
      cleanTerm.split(",")[0].trim() + ", Portugal",
    ];

    const uniqueAttempts = Array.from(new Set(attempts.filter(a => a.replace(", Portugal", "").trim().length > 2)));

    try {
      let foundData: SearchResult[] = [];

      for (const attempt of uniqueAttempts) {
        const q = encodeURIComponent(attempt);
        const res = await fetch(
          "https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=" + q + "&countrycodes=pt&limit=6",
          {
            headers: {
              "Accept-Language": "pt",
            },
          }
        );
        const data = await res.json();
        if (data && data.length > 0) {
          foundData = data;
          break;
        }
      }

      if (foundData.length === 1) {
        const item = foundData[0];
        const newLat = parseFloat(item.lat);
        const newLon = parseFloat(item.lon);
        onCoordsChange(newLat, newLon);
        setSearchResults([]);
      } else if (foundData.length > 1) {
        setSearchResults(foundData);
      } else {
        setSearchError("Nenhum local encontrado para '" + cleanTerm + "'. Tente simplificar o texto ou clique diretamente no mapa.");
      }
    } catch {
      setSearchError("Erro na pesquisa online. Use o botão do Google Maps ou clique no mapa.");
    } finally {
      setSearching(false);
    }
  };

  const handleSelectResult = (item: SearchResult) => {
    const newLat = parseFloat(item.lat);
    const newLon = parseFloat(item.lon);
    onCoordsChange(newLat, newLon);
    setSearchResults([]);
  };

  return (
    <div className="flex flex-col h-full space-y-2.5">
      {/* Search and Action Bar */}
      <div className="bg-zinc-950/95 p-3 rounded-2xl border border-zinc-800 space-y-2.5 shadow-xl">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  executeSearch(query);
                }
              }}
              placeholder="Pesquisar morada, rua ou local (ex: Rua Manuel António Rodrigues, Carnaxide)"
              className="w-full bg-zinc-900 border border-zinc-700/80 rounded-xl pl-8 pr-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-medium"
            />
            <span className="absolute left-2.5 top-2.5 text-zinc-400 text-xs">✨</span>
          </div>

          <button
            type="button"
            onClick={() => executeSearch(query)}
            disabled={searching || !query.trim()}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 shrink-0 cursor-pointer shadow-md shadow-indigo-600/20"
          >
            {searching ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>A pesquisar...</span>
              </>
            ) : (
              <span>Pesquisar</span>
            )}
          </button>

          {/* Direct Google Maps Button */}
          <button
            type="button"
            onClick={openGoogleMaps}
            className="px-3 py-2 bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 hover:text-rose-200 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 shrink-0 cursor-pointer shadow"
            title="Abrir pesquisa desta morada no Google Maps noutra janela"
          >
            <span>🗺️ Google Maps ↗</span>
          </button>
        </div>

        {/* Coordinates Bar & Layer Switcher */}
        <div className="flex items-center justify-between text-[11px] pt-0.5">
          <div className="flex items-center space-x-2">
            <span className="text-indigo-400 font-bold">📍 Ponto GPS:</span>
            {hasCoords ? (
              <span className="font-mono text-emerald-400 font-bold bg-emerald-950/60 border border-emerald-800/80 px-2 py-0.5 rounded-lg">
                {lat.toFixed(6)}, {lon.toFixed(6)}
              </span>
            ) : (
              <span className="text-amber-400 italic bg-amber-950/40 border border-amber-800/60 px-2 py-0.5 rounded-lg font-medium">
                Ponto não definido (clique no mapa)
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2">
            {searchAddress && searchAddress !== query && (
              <button
                type="button"
                onClick={() => {
                  setQuery(searchAddress);
                  executeSearch(searchAddress);
                }}
                className="text-[10px] text-zinc-400 hover:text-indigo-300 underline cursor-pointer"
              >
                Usar Morada do Cliente
              </button>
            )}

            {/* Layer switcher */}
            <div className="flex items-center space-x-1 bg-zinc-900 border border-zinc-800 p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => setMapLayer("standard")}
                className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${
                  mapLayer === "standard" ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                🗺️ Mapa
              </button>
              <button
                type="button"
                onClick={() => setMapLayer("google_sat")}
                className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${
                  mapLayer === "google_sat" ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                🛰️ Satélite
              </button>
              <button
                type="button"
                onClick={() => setMapLayer("google_hybrid")}
                className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${
                  mapLayer === "google_hybrid" ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                🏙️ Híbrido
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Multiple Search Results Dropdown List - FULL ADDRESS EXPANDED */}
      {searchResults.length > 0 && (
        <div className="bg-zinc-900 border border-indigo-500/50 rounded-2xl p-2.5 max-h-56 overflow-y-auto space-y-1.5 z-20 shadow-2xl">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase text-indigo-400 px-1 mb-1">
            <span>Locais Encontrados ({searchResults.length}):</span>
            <span className="text-[10px] font-normal text-zinc-400 lowercase">clique para selecionar e aplicar coordenadas</span>
          </div>
          {searchResults.map((res, i) => {
            const postcode = res.address?.postcode;
            const locality = res.address?.city || res.address?.town || res.address?.suburb || res.address?.village || res.address?.county;
            return (
              <div
                key={i}
                onClick={() => handleSelectResult(res)}
                className="p-2.5 hover:bg-indigo-950/70 bg-zinc-950 border border-zinc-800 hover:border-indigo-500/60 rounded-xl cursor-pointer text-xs text-zinc-200 transition-all flex items-start justify-between gap-3 group"
              >
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-zinc-100 font-semibold leading-relaxed break-words">
                    {res.display_name}
                  </p>
                  <div className="flex items-center flex-wrap gap-1.5 pt-0.5">
                    {postcode && (
                      <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono text-[10px] font-bold border border-indigo-500/30">
                        📮 CP {postcode}
                      </span>
                    )}
                    {locality && (
                      <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px] font-medium border border-zinc-700">
                        📍 {locality}
                      </span>
                    )}
                    <span className="text-[10px] text-zinc-500 font-mono">
                      GPS: {parseFloat(res.lat).toFixed(5)}, {parseFloat(res.lon).toFixed(5)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="px-2.5 py-1 bg-indigo-600/30 group-hover:bg-indigo-600 text-indigo-300 group-hover:text-white rounded-lg text-xs font-bold transition-all shrink-0 mt-0.5"
                >
                  Selecionar ➔
                </button>
              </div>
            );
          })}
        </div>
      )}

      {searchError && (
        <div className="text-xs text-amber-300 bg-amber-950/60 border border-amber-800/80 rounded-xl px-3.5 py-2 flex items-center justify-between">
          <span>{searchError}</span>
          <button
            type="button"
            onClick={openGoogleMaps}
            className="text-[11px] font-bold text-amber-200 hover:text-white underline ml-2 shrink-0 cursor-pointer"
          >
            Abrir Google Maps ↗
          </button>
        </div>
      )}

      {/* Map Container */}
      <div className="flex-1 min-h-[340px] w-full rounded-2xl overflow-hidden border border-zinc-800 relative z-0 shadow-xl">
        <MapContainer
          key={mapLayer}
          center={currentCenter}
          zoom={hasCoords ? 15 : 8}
          className="w-full h-full"
          style={{ minHeight: "340px", height: "100%" }}
        >
          <TileLayer
            attribution={
              mapLayer === "google_sat"
                ? '&copy; Google Satellite'
                : mapLayer === "google_hybrid"
                ? '&copy; Google Hybrid'
                : '&copy; OpenStreetMap contributors &copy; CARTO'
            }
            url={
              mapLayer === "google_sat"
                ? "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
                : mapLayer === "google_hybrid"
                ? "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
                : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            }
          />
          <MapController center={currentCenter} zoom={hasCoords ? 15 : undefined} />
          <MapContainerHandler onClick={(clickLat, clickLng) => onCoordsChange(clickLat, clickLng)} />
          {hasCoords && (
            <Marker position={[lat, lon]} icon={pinIcon} />
          )}
        </MapContainer>
      </div>

      <div className="text-[11px] text-zinc-400 flex items-center justify-between px-1">
        <span>✨ <b>Dica:</b> Clique em qualquer ponto do mapa para definir a localização exata.</span>
        {hasCoords && <span className="text-emerald-400 font-bold bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/60">✓ Ponto Marcado</span>}
      </div>
    </div>
  );
}
