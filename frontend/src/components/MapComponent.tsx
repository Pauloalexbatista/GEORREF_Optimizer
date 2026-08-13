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
];

function getRouteColor(routeName: string, vehicleList: string[]) {
  if (routeName.includes("PENDENTE")) return "#6b7280"; // Gray
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
  const bg = isPending ? "#6b7280" : color;
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
        ${number}
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2]
  });
};;

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

  // Determine valid center coordinates
  const validWarehouses = warehouses.filter(w => w.lat && w.lon && Math.abs(w.lat - 39.5) > 0.01 && Math.abs(w.lon - (-8.0)) > 0.01);
  const validClients = clients.filter(c => c.Latitude && c.Longitude && Math.abs(c.Latitude - 39.5) > 0.01 && Math.abs(c.Longitude - (-8.0)) > 0.01);

  let center: [number, number] = [38.75, -9.2];
  if (validWarehouses.length > 0) {
    center = [validWarehouses[0].lat, validWarehouses[0].lon];
  } else if (validClients.length > 0) {
    center = [validClients[0].Latitude, validClients[0].Longitude];
  }

  // Group clients by route
  const routesMap: { [key: string]: MapClient[] } = {};
  clients.forEach(c => {
    if (c.Latitude !== 0.0 && c.Longitude !== 0.0) {
      if (!routesMap[c.Rota]) {
        routesMap[c.Rota] = [];
      }
      routesMap[c.Rota].push(c);
    }
  });

  // Sort stops by order inside each route
  Object.keys(routesMap).forEach(r => {
    routesMap[r].sort((a, b) => a.Ordem - b.Ordem);
  });

  // 3. FETCH REAL ROAD GEOMETRY FROM OSRM (OpenStreetMap Routing Machine)
  useEffect(() => {
    if (!isMounted) return;

    const fetchRoads = async () => {
      const newGeometries: Record<string, [number, number][]> = {};

      for (const rName of Object.keys(routesMap)) {
        if (rName.includes("PENDENTE")) continue;
        const stops = routesMap[rName];
        if (stops.length === 0) continue;

        // Resolve origin warehouse
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

        // OSRM accepts up to ~50 waypoints per request
        const coordString = waypoints.map(w => `${w[0]},${w[1]}`).join(";");
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`;

        try {
          const res = await fetch(osrmUrl);
          if (res.ok) {
            const data = await res.json();
            if (data.routes && data.routes[0]?.geometry?.coordinates) {
              // Convert OSRM [lon, lat] to Leaflet [lat, lon]
              const roadCoords: [number, number][] = data.routes[0].geometry.coordinates.map(
                (pt: [number, number]) => [pt[1], pt[0]]
              );
              newGeometries[rName] = roadCoords;
            }
          }
        } catch (e) {
          // Fallback straight lines handled in render
        }
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

  return (
    <div className="w-full h-full rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl relative z-10">
      <MapContainer key={center.join(",")} center={center} zoom={11} className="w-full h-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapController coords={center} />
        <MapTracker setZoom={setZoomLevel} />

        {/* 1. Warehouses Markers (House Icons) */}
        {warehouses.map(wh => (
          <Marker key={wh.name} position={[wh.lat, wh.lon]} icon={getWarehouseIcon(zoomLevel)}>
            <Popup>
              <div className="text-zinc-900 p-1 font-sans">
                <p className="font-bold text-xs flex items-center space-x-1">
                  <span>🏠</span> <span>{wh.name}</span>
                </p>
                <p className="text-[10px] text-zinc-600 mt-0.5">Armazém / Centro de Distribuição</p>
                <p className="text-[9px] text-zinc-500 mt-1 font-mono">{wh.address}</p>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* 2. Clients Markers (Numbered Circle Badges 1, 2, 3...) */}
        {clients.map(c => {
          if (c.Latitude === 0 || c.Longitude === 0) return null;
          
          const color = getRouteColor(c.Rota, vehicles);
          const isPending = c.Rota.includes("PENDENTE");
          const icon = createNumberedCircleIcon(c.Ordem, color, isPending, zoomLevel);

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
                <div className="text-zinc-900 min-w-[210px] p-1 font-sans">
                  <div className="flex items-center justify-between border-b pb-1.5 mb-2">
                    <span className="font-bold text-xs">📦 Cliente {c.Cliente}</span>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                      isPending ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"
                    }`}>
                      {isPending ? "Pendente" : `Paragem #${c.Ordem}`}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-600 mb-2"><b>Morada:</b> {c.Morada}</p>
                  
                  {/* Route assignment selector */}
                  <div>
                    <label className="block text-[9px] font-bold uppercase text-zinc-400 mb-1">Reatribuir Rota</label>
                    <select
                      value={c.Rota.includes("PENDENTE") ? "🚨 PENDENTE" : c.Rota}
                      onChange={e => {
                        const val = e.target.value;
                        onMoveClientRoute(c.Cliente, val === "🚨 PENDENTE" ? "🚨 PENDENTE" : val);
                      }}
                      className="w-full bg-white border border-zinc-300 rounded px-2 py-1 text-[10px] text-zinc-800 outline-none focus:border-indigo-500"
                    >
                      <option value="🚨 PENDENTE">🚨 PENDENTE</option>
                      {vehicles.map(v => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                  
                  <p className="text-[8px] text-zinc-400 mt-2 font-mono">Arraste esta bola numerada no mapa para ajustar a localização.</p>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* 3. Real Road Tracks (OSRM Geometry or Straight Line Fallback) */}
        {Object.keys(routesMap).map(r => {
          if (r.includes("PENDENTE")) return null;
          
          const clientsInRoute = routesMap[r];
          if (clientsInRoute.length === 0) return null;

          const color = getRouteColor(r, vehicles);
          const roadPoints = roadGeometries[r];

          // If OSRM road geometry is available, draw real road lines!
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

          // Fallback to straight lines if OSRM is loading or offline
          const routeWhName = clientsInRoute[0]?.Armazem;
          const validWhs = warehouses.filter(w => w.lat && w.lon && Math.abs(w.lat - 39.5) > 0.01 && Math.abs(w.lon - (-8.0)) > 0.01);
          let originWh = validWhs.find(w => w.name === routeWhName);
          if (!originWh && validWhs.length > 0) {
            originWh = validWhs[0];
          }

          const fallbackPoints: [number, number][] = [];
          if (originWh) {
            fallbackPoints.push([originWh.lat, originWh.lon]);
          }
          clientsInRoute.forEach(c => fallbackPoints.push([c.Latitude, c.Longitude]));
          if (originWh) {
            fallbackPoints.push([originWh.lat, originWh.lon]);
          }

          return (
            <Polyline
              key={`fallback-${r}`}
              positions={fallbackPoints}
              pathOptions={{
                color: color,
                weight: 4,
                opacity: 0.8,
                dashArray: "6, 6"
              }}
            />
          );
        })}
      </MapContainer>
    </div>
  );
}
