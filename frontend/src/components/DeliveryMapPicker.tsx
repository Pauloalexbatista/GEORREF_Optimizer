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
  const currentCenter: [number, number] = hasCoords ? [lat, lon] : [38.57, -7.91];
  
  const [query, setQuery] = useState(searchAddress);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  useEffect(() => {
    if (searchAddress) {
      setQuery(searchAddress);
    }
  }, [searchAddress]);

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
          "https://nominatim.openstreetmap.org/search?format=json&q=" + q + "&countrycodes=pt&limit=5",
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
        setSearchError("Nenhum local encontrado para '" + cleanTerm + "'. Tente simplificar o texto ou clique no mapa.");
      }
    } catch {
      setSearchError("Erro na pesquisa online. Clique diretamente no mapa.");
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
    <div className="flex flex-col h-full space-y-2">
      {/* Search Bar */}
      <div className="bg-zinc-950/95 p-2.5 rounded-xl border border-zinc-800 space-y-2">
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
              placeholder="Pesquisar nome do local (ex: Convento do Espinheiro)"
              className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
            <span className="absolute left-2.5 top-1.5 text-zinc-400 text-xs">✨</span>
          </div>

          <button
            type="button"
            onClick={() => executeSearch(query)}
            disabled={searching || !query.trim()}
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-300 text-white rounded-lg text-xs font-semibold transition-colors flex items-center space-x-1.5 shrink-0 cursor-pointer shadow"
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
        </div>

        {/* Coordinates Bar */}
        <div className="flex items-center justify-between text-[11px] px-1">
          <div className="flex items-center space-x-1.5">
            <span className="text-indigo-400 font-bold">️ Ponto GPS:</span>
            {hasCoords ? (
              <span className="font-mono text-emerald-400 font-semibold">
                {lat.toFixed(5)}, {lon.toFixed(5)}
              </span>
            ) : (
              <span className="text-amber-400/90 italic">Ponto não definido</span>
            )}
          </div>

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
        </div>
      </div>

      {/* Multiple Search Results Dropdown List */}
      {searchResults.length > 0 && (
        <div className="bg-zinc-900 border border-indigo-500/40 rounded-xl p-2 max-h-40 overflow-y-auto space-y-1 z-20 shadow-xl">
          <div className="text-[10px] font-bold uppercase text-indigo-400 px-1 mb-1">
            Locais Encontrados ({searchResults.length}):
          </div>
          {searchResults.map((res, i) => (
            <div
              key={i}
              onClick={() => handleSelectResult(res)}
              className="p-1.5 hover:bg-indigo-950/60 bg-zinc-950 border border-zinc-800/80 rounded-lg cursor-pointer text-xs text-zinc-200 transition-colors flex items-center justify-between gap-2"
            >
              <div className="truncate flex-1">
                <span className="text-zinc-100 font-semibold block truncate">{res.display_name}</span>
              </div>
              <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded font-mono shrink-0">
                Selecionar ➔
              </span>
            </div>
          ))}
        </div>
      )}

      {searchError && (
        <div className="text-[11px] text-amber-400 bg-amber-950/40 border border-amber-800/60 rounded-lg px-3 py-1.5">
          {searchError}
        </div>
      )}

      {/* Map Container */}
      <div className="flex-1 min-h-[340px] w-full rounded-xl overflow-hidden border border-zinc-800 relative z-0">
        <MapContainer
          center={currentCenter}
          zoom={hasCoords ? 15 : 8}
          className="w-full h-full"
          style={{ minHeight: "340px", height: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapController center={currentCenter} zoom={hasCoords ? 15 : undefined} />
          <MapContainerHandler onClick={(clickLat, clickLng) => onCoordsChange(clickLat, clickLng)} />
          {hasCoords && (
            <Marker position={[lat, lon]} icon={pinIcon} />
          )}
        </MapContainer>
      </div>

      <div className="text-[11px] text-zinc-400 flex items-center justify-between px-1">
        <span>✨ <b>Dica:</b> Digite o nome no campo acima ou clique em qualquer rua para posicionar.</span>
        {hasCoords && <span className="text-emerald-400 font-semibold">✓ Ponto Marcado</span>}
      </div>
    </div>
  );
}
