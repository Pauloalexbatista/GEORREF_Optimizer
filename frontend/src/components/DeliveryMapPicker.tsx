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
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  const handleOnlineSearch = async () => {
    if (!searchAddress.trim()) return;
    setSearching(true);
    setSearchError("");

    try {
      const q = encodeURIComponent(searchAddress.trim() + ", Portugal");
      const res = await fetch("https://nominatim.openstreetmap.org/search?format=json&q=" + q + "&countrycodes=pt&limit=1", {
        headers: {
          "Accept-Language": "pt",
        },
      });
      const data = await res.json();

      if (data && data.length > 0) {
        const foundLat = parseFloat(data[0].lat);
        const foundLon = parseFloat(data[0].lon);
        onCoordsChange(foundLat, foundLon);
      } else {
        setSearchError("Nenhum local encontrado online com este texto. Clique diretamente no mapa.");
      }
    } catch {
      setSearchError("Erro ao pesquisar online. Clique diretamente no mapa.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="flex flex-col h-full space-y-2">
      <div className="flex items-center justify-between gap-2 bg-zinc-950/90 p-2.5 rounded-xl border border-zinc-800">
        <div className="text-[11px] text-zinc-300 truncate flex-1 flex items-center space-x-1.5">
          <span className="text-indigo-400 font-bold">Ponto:</span>
          {hasCoords ? (
            <span className="font-mono text-emerald-400 font-semibold text-xs">
              {lat.toFixed(5)}, {lon.toFixed(5)}
            </span>
          ) : (
            <span className="text-amber-400/90 italic text-xs">Ponto nao definido (clique no mapa)</span>
          )}
        </div>

        <button
          type="button"
          onClick={handleOnlineSearch}
          disabled={searching || !searchAddress.trim()}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-lg text-xs font-semibold transition-colors flex items-center space-x-1.5 shrink-0 cursor-pointer shadow"
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
            <>
              <span>Pesquisar no Mapa</span>
            </>
          )}
        </button>
      </div>

      {searchError && (
        <div className="text-[11px] text-amber-400 bg-amber-950/40 border border-amber-800/60 rounded-lg px-3 py-1.5">
          {searchError}
        </div>
      )}

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
        <span>Dica: Clique em qualquer rua do mapa para colocar o marcador.</span>
        {hasCoords && <span className="text-emerald-400 font-semibold">Ponto Marcado</span>}
      </div>
    </div>
  );
}
