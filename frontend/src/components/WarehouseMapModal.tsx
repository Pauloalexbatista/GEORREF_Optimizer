"use client";

import React, { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix default icon issue in Leaflet
const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

interface WarehouseMapModalProps {
  isOpen: boolean;
  initialCoords: { lat: number; lon: number } | null;
  onConfirm: (lat: number, lon: number) => void;
  onClose: () => void;
}

export default function WarehouseMapModal({
  isOpen,
  initialCoords,
  onConfirm,
  onClose,
}: WarehouseMapModalProps) {
  const [clickedCoords, setClickedCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (initialCoords && initialCoords.lat !== 0 && initialCoords.lon !== 0) {
      setClickedCoords({ lat: initialCoords.lat, lng: initialCoords.lon });
    } else {
      setClickedCoords(null);
    }
  }, [initialCoords, isOpen]);

  if (!isOpen) return null;

  const center: [number, number] = clickedCoords 
    ? [clickedCoords.lat, clickedCoords.lng] 
    : [39.5, -8.0]; // Default Portugal center

  const MapEventsHandler = () => {
    useMapEvents({
      click(e) {
        setClickedCoords({ lat: e.latlng.lat, lng: e.latlng.lng });
      },
    });
    return null;
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 w-full max-w-lg rounded-2xl p-6 shadow-2xl space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-bold text-zinc-100">Selecionar Localização do Armazém</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200 cursor-pointer">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="h-[350px] w-full rounded-xl overflow-hidden border border-zinc-800 relative z-10">
          <MapContainer center={center} zoom={clickedCoords ? 14 : 7} className="w-full h-full">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapEventsHandler />
            {clickedCoords && (
              <Marker position={[clickedCoords.lat, clickedCoords.lng]} icon={defaultIcon} />
            )}
          </MapContainer>
        </div>

        <p className="text-[10px] text-zinc-400">
          {clickedCoords 
            ? `Coordenadas selecionadas: ${clickedCoords.lat.toFixed(6)}, ${clickedCoords.lng.toFixed(6)}`
            : "Clique em qualquer ponto do mapa para definir a localização do armazém."}
        </p>

        <div className="flex justify-end space-x-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!clickedCoords}
            onClick={() => {
              if (clickedCoords) {
                onConfirm(clickedCoords.lat, clickedCoords.lng);
              }
            }}
            className="bg-indigo-500 hover:bg-indigo-650 text-white px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirmar Ponto
          </button>
        </div>
      </div>
    </div>
  );
}
