"use client";

import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface MapClient {
  id?: number;
  Armazem?: string;
  Cliente: string;
  Morada: string;
  CP?: string;
  Localidade?: string;
  Janela_Horaria?: string;
  Latitude: number;
  Longitude: number;
  Rota: string;
  Ordem: number;
  Carga_Acum?: number;
}

interface MapWarehouse {
  name: string;
  address: string;
  lat: number;
  lon: number;
}

interface MapComponentProps {
  clients: MapClient[];
  warehouses: MapWarehouse[];
  vehicles: string[];
  onMoveClientRoute: (clientName: string, newRoute: string) => void;
  onUpdateClientCoords: (clientName: string, lat: number, lon: number) => void;
}

function isPendingRoute(routeName: string) {
  if (!routeName) return true;
  const s = routeName.toUpperCase();
  return s.includes("PENDENTE") || s.includes("DISTRIBUIR");
}

// Helper to center the map when data changes
function MapController({ coords }: { coords: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    if (coords && coords[0] !== 0) {
      map.setView(coords, map.getZoom());
    }
  }, [coords, map]);
  return null;
}

// Color palette for vehicle routes
const routeColors = [
  "#6366f1", // Indigo
  "#ec4899", // Pink
  "#f59e0b", // Amber
  "#10b981", // Emerald
  "#3b82f6", // Blue
  "#ef4444", // Red
  "#8b5cf6", // Violet
  "#06b6d4", // Cyan
  "#f97316", // Orange
  "#14b8a6", // Teal
  "#a855f7", // Purple
  "#84cc16", // Lime
  "#0ea5e9", // Sky
  "#e11d48", // Rose
];

function getRouteColor(routeName: string, vehicleList: string[]) {
  if (isPendingRoute(routeName)) return "#f59e0b"; // Amber for pending
  const idx = vehicleList.indexOf(routeName);
  if (idx === -1) return routeColors[0];
  return routeColors[idx % routeColors.length];
}

// Custom 1. DYNAMIC WAREHOUSE ICON BASED ON ZOOM
const getWarehouseIcon = (zoom: number) => {
  const size = Math.max(20, Math.min(48, 38 + (zoom - 13) * 4));
  const strokeWidth = size > 30 ? 2.2 : 1.5;
  const svgSize = Math.max(12, Math.min(28, 22 + (zoom - 13) * 2));
  
  return L.divIcon({
    className: "custom-warehouse-icon",
    html: `
      <div style="
        background-color: #0f172a;
        color: #38bdf8;
        width: ${size}px;
        height: ${size}px;
        border-radius: ${size * 0.3}px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: ${size * 0.06}px solid #38bdf8;
        box-shadow: 0 4px 14px rgba(0,0,0,0.6);
        cursor: pointer;
      ">
        <svg width="${svgSize}" height="${svgSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2]
  });
};

// Custom 2. DYNAMIC NUMBERED CIRCULAR BADGE FOR CLIENTS
const createNumberedCircleIcon = (number: number, color: string, isPending: boolean, zoom: number) => {
  const bg = isPending ? "#f59e0b" : color;
  const size = Math.max(14, Math.min(40, 30 + (zoom - 13) * 3));
  const fontSize = Math.max(7, Math.min(14, 11 + (zoom - 13) * 0.8));
  
  return L.divIcon({
    className: "custom-number-badge",
    html: `
      <div style="
        background-color: ${bg};
        color: #ffffff;
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 800;
        font-family: sans-serif;
        font-size: ${fontSize}px;
        border: ${size * 0.07}px solid #ffffff;
        box-shadow: 0 3px 8px rgba(0,0,0,0.5);
        cursor: pointer;
        transition: all 0.2s ease-in-out;
      ">
        ${isPending ? "!" : number}
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2]
  });
};

const MapTracker = ({ setZoom }: { setZoom: (z: number) => void }) => {
  useMapEvents({
    zoomend(e) {
      setZoom(e.target.getZoom());
    }
  });
  return null;
};

export default function MapComponent({
  clients,
  warehouses,
  vehicles,
  onMoveClientRoute,
  onUpdateClientCoords,
}: MapComponentProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(11);
  const [roadGeometries, setRoadGeometries] = useState<Record<string, [number, number][]>>({});

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const validWarehouses = warehouses.filter(w => w.lat && w.lon && Math.abs(w.lat - 39.5) > 0.01 && Math.abs(w.lon - (-8.0)) > 0.01);
  const validClients = clients.filter(c => c.Latitude && c.Longitude && Math.abs(c.Latitude - 39.5) > 0.01 && Math.abs(c.Longitude - (-8.0)) > 0.01);

  let center: [number, number] = [38.75, -9.2];
  if (validWarehouses.length > 0) {
    center = [validWarehouses[0].lat, validWarehouses[0].lon];
  } else if (validClients.length > 0) {
    center = [validClients[0].Latitude, validClients[0].Longitude];
  }

  const routesMap: { [key: string]: MapClient[] } = {};
  clients.forEach(c => {
    if (c.Latitude !== 0.0 && c.Longitude !== 0.0) {
      const rKey = isPendingRoute(c.Rota) ? "Por Distribuir" : c.Rota;
      if (!routesMap[rKey]) {
        routesMap[rKey] = [];
      }
      routesMap[rKey].push(c);
    }
  });

  Object.keys(routesMap).forEach(r => {
    routesMap[r].sort((a, b) => a.Ordem - b.Ordem);
  });

  useEffect(() => {
    if (!isMounted) return;

    const fetchRoads = async () => {
      const newGeometries: Record<string, [number, number][]> = {};

      for (const rName of Object.keys(routesMap)) {
        if (isPendingRoute(rName)) continue;
        const stops = routesMap[rName];
        if (stops.length === 0) continue;

        const routeWhName = stops[0]?.Armazem;
        const validWhs = warehouses.filter(w => w.lat && w.lon && Math.abs(w.lat - 39.5) > 0.01 && Math.abs(w.lon - (-8.0)) > 0.01);
        let originWh = validWhs.find(w => w.name === routeWhName);
        if (!originWh && validWhs.length > 0) {
          originWh = validWhs[0];
        }

        const waypoints: [number, number][] = [];
        if (originWh) {
          waypoints.push([originWh.lon, originWh.lat]);
        }
        stops.forEach(s => waypoints.push([s.Longitude, s.Latitude]));
        if (originWh) {
          waypoints.push([originWh.lon, originWh.lat]);
        }

        if (waypoints.length < 2) continue;

        const coordString = waypoints.map(w => `${w[0]},${w[1]}`).join(";");
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`;

        try {
          const res = await fetch(osrmUrl);
          if (res.ok) {
            const data = await res.json();
            if (data.routes && data.routes[0]?.geometry?.coordinates) {
              const roadCoords: [number, number][] = data.routes[0].geometry.coordinates.map(
                (pt: [number, number]) => [pt[1], pt[0]]
              );
              newGeometries[rName] = roadCoords;
            }
          }
        } catch (e) {}
      }

      setRoadGeometries(newGeometries);
    };

    fetchRoads();
  }, [clients, warehouses, isMounted]);

  if (!isMounted) {
    return (
      <div className="w-full h-full rounded-2xl border border-zinc-800 bg-zinc-950 flex items-center justify-center text-zinc-500 text-xs font-mono">
        A carregar mapa interativo...
      </div>
    );
  }

  const allVehicleOptions = ["Por Distribuir", ...vehicles];

  return (
    <div className="w-full h-full rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl relative z-10">
      <MapContainer key={center.join(",")} center={center} zoom={11} className="w-full h-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapController coords={center} />
        <MapTracker setZoom={setZoomLevel} />

        {/* Warehouses */}
        {warehouses.map(wh => (
          <Marker key={wh.name} position={[wh.lat, wh.lon]} icon={getWarehouseIcon(zoomLevel)}>
            <Popup>
              <div className="text-zinc-900 p-1 font-sans">
                <p className="font-bold text-xs flex items-center space-x-1">
                  <span>🏬</span> <span>{wh.name}</span>
                </p>
                <p className="text-[10px] text-zinc-600 mt-0.5">Armazém / Centro de Distribuição</p>
                <p className="text-[9px] text-zinc-500 mt-1 font-mono">{wh.address}</p>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Clients */}
        {clients.map(c => {
          if (c.Latitude === 0 || c.Longitude === 0) return null;
          
          const isPending = isPendingRoute(c.Rota);
          const color = getRouteColor(c.Rota, vehicles);

          return (
            <Marker
              key={c.Cliente}
              position={[c.Latitude, c.Longitude]}
              icon={createNumberedCircleIcon(c.Ordem, color, isPending, zoomLevel)}
              draggable={true}
              eventHandlers={{
                dragend: (e) => {
                  const marker = e.target;
                  const position = marker.getLatLng();
                  onUpdateClientCoords(c.Cliente, position.lat, position.lng);
                }
              }}
            >
              <Popup>
                <div className="text-zinc-900 min-w-[230px] p-1 font-sans">
                  {/* Header */}
                  <div className="flex items-center justify-between border-b border-zinc-200 pb-1.5 mb-2">
                    <div className="flex items-center space-x-1.5">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: isPending ? "#f59e0b" : color }} />
                      <span className="font-bold text-xs text-zinc-900">Cliente {c.Cliente}</span>
                    </div>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                      isPending ? "bg-amber-100 text-amber-800 border border-amber-300/60 font-semibold" : "bg-indigo-100 text-indigo-800 border border-indigo-300/60"
                    }`}>
                      {isPending ? "⚠️ Por Distribuir" : `Paragem #${c.Ordem}`}
                    </span>
                  </div>

                  {/* Client details */}
                  <div className="space-y-1 text-[11px] mb-2.5">
                    <p className="leading-snug">
                      <span className="font-semibold text-zinc-500 text-[10px] uppercase">Morada:</span>{" "}
                      <span className="text-zinc-800 font-medium">{c.Morada || "N/A"}</span>
                    </p>
                    
                    <div className="flex items-center justify-between text-[10px] bg-zinc-50 border border-zinc-200 rounded px-2 py-1">
                      <span>
                        <b className="text-zinc-500 font-semibold">CP:</b>{" "}
                        <span className="font-mono font-medium text-zinc-800">{c.CP || "N/A"}</span>
                      </span>
                      {c.Localidade && (
                        <span>
                          <b className="text-zinc-500 font-semibold">Loc:</b>{" "}
                          <span className="text-zinc-800 font-medium">{c.Localidade}</span>
                        </span>
                      )}
                    </div>

                    <div className="text-[10px] bg-indigo-50/70 border border-indigo-100 rounded px-2 py-1 flex items-center justify-between">
                      <span className="text-indigo-900 font-semibold">Janela Horária:</span>
                      <span className="font-mono font-bold text-indigo-700">
                        {c.Janela_Horaria || "Qualquer"}
                      </span>
                    </div>
                  </div>
                  
                  {/* Reassign dropdown */}
                  <div className="pt-1.5 border-t border-zinc-100">
                    <label className="block text-[9px] font-bold uppercase text-zinc-500 mb-1">
                      Reatribuir Rota
                    </label>
                    <select
                      value={isPending ? "Por Distribuir" : c.Rota}
                      onChange={e => onMoveClientRoute(c.Cliente, e.target.value)}
                      className="w-full bg-white border border-zinc-300 rounded px-2 py-1 text-xs text-zinc-800 font-medium outline-none focus:border-indigo-500 cursor-pointer shadow-sm"
                    >
                      {allVehicleOptions.map(v => (
                        <option key={v} value={v}>
                          {isPendingRoute(v) ? "⚠️ Por Distribuir" : v}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Real Road Tracks */}
        {Object.keys(routesMap).map(r => {
          if (isPendingRoute(r)) return null;
          
          const clientsInRoute = routesMap[r];
          if (clientsInRoute.length === 0) return null;

          const color = getRouteColor(r, vehicles);
          const roadPoints = roadGeometries[r];

          if (roadPoints && roadPoints.length > 0) {
            return (
              <Polyline
                key={`road-${r}`}
                positions={roadPoints}
                pathOptions={{
                  color: color,
                  weight: 5,
                  opacity: 0.85,
                  lineJoin: "round"
                }}
              />
            );
          }

          const routeWhName = clientsInRoute[0]?.Armazem;
          const originWh = warehouses.find(w => w.name === routeWhName) || warehouses[0];
          const straightPoints: [number, number][] = [];
          if (originWh) straightPoints.push([originWh.lat, originWh.lon]);
          clientsInRoute.forEach(c => straightPoints.push([c.Latitude, c.Longitude]));
          if (originWh) straightPoints.push([originWh.lat, originWh.lon]);

          return (
            <Polyline
              key={`line-${r}`}
              positions={straightPoints}
              pathOptions={{
                color: color,
                weight: 4,
                opacity: 0.6,
                dashArray: "6, 6"
              }}
            />
          );
        })}
      </MapContainer>
    </div>
  );
}
