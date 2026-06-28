"use client";

import React, { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet marker icons in Next.js
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
});

interface MapClient {
  id?: number;
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

// Generate distinct colors for route lines
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
  if (routeName.includes("PENDENTE")) return "#9ca3af"; // Gray for pending
  const idx = vehicleList.indexOf(routeName);
  if (idx === -1) return routeColors[0];
  return routeColors[idx % routeColors.length];
}

export default function MapComponent({
  clients,
  warehouses,
  vehicles,
  onMoveClientRoute,
  onUpdateClientCoords,
}: MapComponentProps) {
  // Determine center coordinates
  let center: [number, number] = [39.5, -8.0]; // Default Portugal
  if (warehouses.length > 0) {
    center = [warehouses[0].lat, warehouses[0].lon];
  } else if (clients.length > 0 && clients[0].Latitude !== 0) {
    center = [clients[0].Latitude, clients[0].Longitude];
  }

  // Create custom marker icons
  const warehouseIcon = new L.Icon({
    iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-black.png",
    shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });

  const clientIcon = (color: string) => {
    // We can use a simple SVG or a colored Leaflet marker pin
    // Mapping route colors to leaflet-color-markers colors
    let colorName = "blue";
    if (color === "#6366f1") colorName = "violet";
    else if (color === "#ec4899") colorName = "pink";
    else if (color === "#f59e0b") colorName = "gold";
    else if (color === "#10b981") colorName = "green";
    else if (color === "#3b82f6") colorName = "blue";
    else if (color === "#ef4444") colorName = "red";
    else if (color === "#8b5cf6") colorName = "violet";
    else if (color === "#06b6d4") colorName = "orange";
    else if (color === "#f97316") colorName = "orange";
    else if (color === "#14b8a6") colorName = "green";
    else colorName = "grey";

    return new L.Icon({
      iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${colorName}.png`,
      shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41]
    });
  };

  // Group clients by route to draw polyline tracks
  const routesMap: { [key: string]: MapClient[] } = {};
  clients.forEach(c => {
    if (c.Latitude !== 0.0 && c.Longitude !== 0.0) {
      if (!routesMap[c.Rota]) {
        routesMap[c.Rota] = [];
      }
      routesMap[c.Rota].push(c);
    }
  });

  // Sort each route's clients by order
  Object.keys(routesMap).forEach(r => {
    routesMap[r].sort((a, b) => a.Ordem - b.Ordem);
  });

  return (
    <div className="w-full h-full rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl relative z-10">
      <MapContainer center={center} zoom={11} className="w-full h-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapController coords={center} />

        {/* Warehouses Markers */}
        {warehouses.map(wh => (
          <Marker key={wh.name} position={[wh.lat, wh.lon]} icon={warehouseIcon}>
            <Popup>
              <div className="text-zinc-900 p-1">
                <p className="font-bold text-sm">📍 {wh.name}</p>
                <p className="text-xs text-zinc-650 mt-0.5">Armazém de Origem</p>
                <p className="text-[10px] text-zinc-550 mt-1">{wh.address}</p>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Clients Markers */}
        {clients.map(c => {
          if (c.Latitude === 0 || c.Longitude === 0) return null;
          
          const color = getRouteColor(c.Rota, vehicles);
          const icon = clientIcon(color);
          const isPending = c.Rota.includes("PENDENTE");

          return (
            <Marker
              key={c.Cliente}
              position={[c.Latitude, c.Longitude]}
              icon={icon}
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
                <div className="text-zinc-900 min-w-[200px] p-1">
                  <div className="flex items-center justify-between border-b pb-1.5 mb-2">
                    <span className="font-bold text-xs">📦 Cliente {c.Cliente}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                      isPending ? "bg-zinc-100 text-zinc-500" : "bg-indigo-50 text-indigo-600"
                    }`}>
                      {isPending ? "Pendente" : c.Rota}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-550 mb-2"><b>Morada:</b> {c.Morada}</p>
                  
                  {/* Route assignment selector */}
                  <div>
                    <label className="block text-[9px] font-bold uppercase text-zinc-400 mb-1">Reatribuir Rota</label>
                    <select
                      value={c.Rota}
                      onChange={e => onMoveClientRoute(c.Cliente, e.target.value)}
                      className="w-full bg-white border border-zinc-300 rounded px-1.5 py-1 text-[10px] text-zinc-800 outline-none"
                    >
                      <option value="⚠️ PENDENTE">⚠️ PENDENTE</option>
                      {vehicles.map(v => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                  
                  <p className="text-[8px] text-zinc-400 mt-2 font-mono">Arraste este pin no mapa para corrigir as suas coordenadas geograficas.</p>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Polylines representing vehicle tracks */}
        {Object.keys(routesMap).map(r => {
          if (r.includes("PENDENTE")) return null;
          
          const clientsInRoute = routesMap[r];
          if (clientsInRoute.length === 0) return null;

          // Find the warehouse origin of the vehicle
          // In this implementation, the route always starts from the warehouse associated with the vehicle
          // Let's draw polyline tracks from the first warehouse if we can find it
          const firstClient = clientsInRoute[0];
          // Or draw simply connecting all clients
          const points: [number, number][] = [];
          
          // Try to append warehouse depot at the beginning of polyline
          if (warehouses.length > 0) {
            points.push([warehouses[0].lat, warehouses[0].lon]);
          }
          
          clientsInRoute.forEach(c => {
            points.push([c.Latitude, c.Longitude]);
          });
          
          if (warehouses.length > 0) {
            // Return to warehouse depot at the end of route
            points.push([warehouses[0].lat, warehouses[0].lon]);
          }

          const color = getRouteColor(r, vehicles);
          return (
            <Polyline
              key={`line-${r}`}
              positions={points}
              color={color}
              weight={3}
              opacity={0.8}
              dashArray="5, 8"
            />
          );
        })}
      </MapContainer>
    </div>
  );
}
