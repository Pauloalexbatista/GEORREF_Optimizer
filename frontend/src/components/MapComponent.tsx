"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface MapClient {
  id?: number;
  ID_Original?: number;
  Armazem?: string;
  Cliente: string;
  Nome_Cliente?: string;
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
  onMoveClientRoute?: (clientName: string, newRoute: string, deliveryId?: number, address?: string) => void;
  onUpdateClientCoords?: (clientName: string, lat: number, lon: number) => void;
}

function isPendingRoute(routeName: string) {
  if (!routeName) return true;
  const s = routeName.toUpperCase();
  return s.includes("PENDENTE") || s.includes("DISTRIBUIR");
}

// Controller that centers map only once on initial mount/data load, avoiding resetting view on zoom/pan
function MapInitialController({ coords }: { coords: [number, number] }) {
  const map = useMap();
  const initializedRef = useRef(false);
  const lastCenterStr = useRef("");

  useEffect(() => {
    const centerStr = coords.join(",");
    if (coords && coords[0] !== 0 && (!initializedRef.current || lastCenterStr.current !== centerStr)) {
      if (!initializedRef.current) {
        map.setView(coords, 11);
        initializedRef.current = true;
        lastCenterStr.current = centerStr;
      }
    }
  }, [coords, map]);

  return null;
}

// Button component inside map container to fit all visible bounds
function MapBoundsFitter({ triggerKey, points }: { triggerKey: string; points: [number, number][] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length > 0 && triggerKey) {
      try {
        const bounds = L.latLngBounds(points);
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      } catch (e) {}
    }
  }, [triggerKey, points, map]);

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
  if (isPendingRoute(routeName)) return "#f59e0b";
  const idx = vehicleList.indexOf(routeName);
  if (idx === -1) return routeColors[0];
  return routeColors[idx % routeColors.length];
}

function createNumberedCircleIcon(number: number, color: string, isPending: boolean = false, zoomLevel: number = 11) {
  let size = 26;
  let fontSize = 11;
  let borderWidth = 2;

  if (zoomLevel >= 15) {
    size = 32;
    fontSize = 13;
    borderWidth = 2.5;
  } else if (zoomLevel <= 10) {
    size = 18;
    fontSize = 9;
    borderWidth = 1.5;
  }

  const displayText = isPending ? "•" : number;

  const html = `
    <div style="
      background-color: ${color};
      color: white;
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, sans-serif;
      font-weight: 800;
      font-size: ${fontSize}px;
      border: ${borderWidth}px solid rgba(255, 255, 255, 0.95);
      box-shadow: 0 3px 6px rgba(0,0,0,0.4);
      cursor: pointer;
      user-select: none;
      transition: transform 0.15s ease;
    " onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1.0)'">
      ${displayText}
    </div>
  `;

  return L.divIcon({
    html: html,
    className: "custom-leaflet-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function getWarehouseIcon(zoomLevel: number = 11) {
  let size = 32;
  if (zoomLevel >= 15) size = 40;
  else if (zoomLevel <= 10) size = 24;

  const html = `
    <div style="
      background-color: #0f172a;
      color: #38bdf8;
      width: ${size}px;
      height: ${size}px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid #38bdf8;
      box-shadow: 0 4px 8px rgba(0,0,0,0.6);
      font-size: ${Math.round(size * 0.55)}px;
    ">
      🏠
    </div>
  `;

  return L.divIcon({
    html: html,
    className: "warehouse-leaflet-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function MapTracker({ setZoom }: { setZoom: (z: number) => void }) {
  const map = useMapEvents({
    zoomend: () => {
      setZoom(map.getZoom());
    },
  });
  return null;
}

export default function MapComponent({
  clients,
  warehouses,
  vehicles,
  onMoveClientRoute,
  onUpdateClientCoords
}: MapComponentProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(11);
  const [roadGeometries, setRoadGeometries] = useState<Record<string, [number, number][]>>({});
  
  // Interactive Route Selector: empty array means ALL routes visible
  const [selectedRoutes, setSelectedRoutes] = useState<string[]>([]);
  const [fitTrigger, setFitTrigger] = useState("");

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const center: [number, number] = useMemo(() => {
    if (warehouses && warehouses.length > 0 && warehouses[0].lat && warehouses[0].lon) {
      return [warehouses[0].lat, warehouses[0].lon];
    }
    return [38.6593, -9.1758]; // Default Lisboa / Alverca
  }, [warehouses]);

  // Fetch real road geometries via OSRM for assigned routes
  useEffect(() => {
    if (!isMounted || clients.length === 0) return;

    const fetchRoads = async () => {
      const activeRoutes = Array.from(new Set(clients.map(c => c.Rota))).filter(
        r => !isPendingRoute(r)
      );

      const newGeometries: Record<string, [number, number][]> = {};
      const validWhs = warehouses.filter(w => w.lat && w.lon);

      for (const rName of activeRoutes) {
        const stops = clients
          .filter(c => c.Rota === rName && c.Latitude !== 0 && c.Longitude !== 0)
          .sort((a, b) => a.Ordem - b.Ordem);

        if (stops.length === 0) continue;

        const routeWhName = stops[0].Armazem;
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

  // Filter clients based on selected route pills
  const visibleClients = useMemo(() => {
    return clients.filter(c => {
      if (c.Latitude === 0 || c.Longitude === 0) return false;
      if (selectedRoutes.length === 0) return true;
      if (isPendingRoute(c.Rota)) {
        return selectedRoutes.includes("Por Distribuir");
      }
      return selectedRoutes.includes(c.Rota);
    });
  }, [clients, selectedRoutes]);

  // Points for auto fit bounds
  const visiblePoints: [number, number][] = useMemo(() => {
    const pts: [number, number][] = [];
    warehouses.forEach(w => {
      if (w.lat && w.lon) pts.push([w.lat, w.lon]);
    });
    visibleClients.forEach(c => {
      pts.push([c.Latitude, c.Longitude]);
    });
    return pts;
  }, [warehouses, visibleClients]);

  const handleFitAll = () => {
    setFitTrigger(Date.now().toString());
  };

  const toggleRouteFilter = (v: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (selectedRoutes.includes(v)) {
        const next = selectedRoutes.filter(r => r !== v);
        setSelectedRoutes(next);
      } else {
        setSelectedRoutes(selectedRoutes.length === 0 ? [v] : [...selectedRoutes, v]);
      }
    } else {
      if (selectedRoutes.length === 1 && selectedRoutes[0] === v) {
        setSelectedRoutes([]); // Reset to all
      } else {
        setSelectedRoutes([v]); // Select only this one
      }
    }
  };

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
      
      {/* FLOATING ROUTE FILTER SELECTOR BAR */}
      <div className="absolute top-3 left-12 right-12 z-[1000] flex items-center justify-between gap-2 pointer-events-none">
        <div className="flex items-center flex-wrap gap-1 bg-zinc-950/90 backdrop-blur-md p-1.5 rounded-xl border border-zinc-800 shadow-xl pointer-events-auto max-h-24 overflow-y-auto">
          {/* Todas button */}
          <button
            onClick={() => setSelectedRoutes([])}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
              selectedRoutes.length === 0
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-zinc-850 text-zinc-300 hover:bg-zinc-750 hover:text-white"
            }`}
          >
            ✨ Todas ({clients.length})
          </button>

          {/* Individual Vehicle Route Chips */}
          {vehicles.map((v, i) => {
            const routeColor = routeColors[i % routeColors.length];
            const isSelected = selectedRoutes.length === 0 || selectedRoutes.includes(v);
            const isExclusive = selectedRoutes.length === 1 && selectedRoutes[0] === v;
            const count = clients.filter(c => c.Rota === v).length;

            return (
              <button
                key={v}
                onClick={(e) => toggleRouteFilter(v, e)}
                title={`Clique para ver só ${v} (Ctrl+Clique para seleção múltipla)`}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold transition-all flex items-center space-x-1.5 cursor-pointer border ${
                  isExclusive
                    ? "border-indigo-400 bg-indigo-950/90 text-indigo-100 shadow-sm ring-1 ring-indigo-400/50"
                    : isSelected
                    ? "border-zinc-700 bg-zinc-850/90 text-zinc-200"
                    : "border-transparent bg-zinc-900/40 text-zinc-500 opacity-40 hover:opacity-80"
                }`}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: routeColor }} />
                <span>{v}</span>
                <span className="text-[9px] text-zinc-400 font-mono">({count})</span>
              </button>
            );
          })}

          {/* Pending deliveries button */}
          {clients.some(c => isPendingRoute(c.Rota)) && (
            <button
              onClick={(e) => toggleRouteFilter("Por Distribuir", e)}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold transition-all flex items-center space-x-1 cursor-pointer border ${
                selectedRoutes.length === 1 && selectedRoutes[0] === "Por Distribuir"
                  ? "border-amber-400 bg-amber-950 text-amber-200 ring-1 ring-amber-400/50"
                  : selectedRoutes.length === 0 || selectedRoutes.includes("Por Distribuir")
                  ? "border-amber-800/80 bg-amber-950/40 text-amber-300"
                  : "border-transparent bg-zinc-900/40 text-zinc-500 opacity-40 hover:opacity-80"
              }`}
            >
              <span>📦 Pendentes</span>
              <span className="text-[9px] font-mono">({clients.filter(c => isPendingRoute(c.Rota)).length})</span>
            </button>
          )}

          {/* Clear filter button */}
          {selectedRoutes.length > 0 && (
            <button
              onClick={() => setSelectedRoutes([])}
              className="px-2 py-0.5 rounded-lg text-[9px] font-semibold bg-rose-950/80 text-rose-300 hover:bg-rose-900 border border-rose-800/60 transition-all cursor-pointer"
              title="Mostrar todas as rotas"
            >
              ✕ Limpar Filtro
            </button>
          )}
        </div>

        {/* Fit Bounds Button */}
        <div className="pointer-events-auto shrink-0">
          <button
            onClick={handleFitAll}
            className="bg-zinc-950/90 hover:bg-zinc-850 text-zinc-200 border border-zinc-700 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold shadow-xl flex items-center space-x-1.5 cursor-pointer backdrop-blur-md transition-all"
            title="Enquadrar todas as paragens visíveis no ecrã"
          >
            <span>🎯 Enquadrar</span>
          </button>
        </div>
      </div>

      <MapContainer center={center} zoom={11} className="w-full h-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapInitialController coords={center} />
        <MapBoundsFitter triggerKey={fitTrigger} points={visiblePoints} />
        <MapTracker setZoom={setZoomLevel} />

        {/* Warehouses */}
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

        {/* Visible Clients */}
        {visibleClients.map((c, idx) => {
          const isPending = isPendingRoute(c.Rota);
          const color = getRouteColor(c.Rota, vehicles);

          return (
            <Marker
              key={"marker-" + String(c.Cliente) + "-" + String(c.ID_Original || c.id || idx)}
              position={[c.Latitude, c.Longitude]}
              icon={createNumberedCircleIcon(c.Ordem, color, isPending, zoomLevel)}
              draggable={true}
              eventHandlers={{
                dragend: (e) => {
                  const marker = e.target;
                  const position = marker.getLatLng();
                  if (onUpdateClientCoords) {
                    onUpdateClientCoords(c.Cliente, position.lat, position.lng);
                  }
                }
              }}
            >
              <Popup>
                <div className="text-zinc-900 min-w-[230px] p-1 font-sans">
                  {/* Header */}
                  <div className="flex items-center justify-between border-b border-zinc-200 pb-1.5 mb-2">
                    <div className="flex items-center space-x-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                      <span className="font-bold text-xs">
                        {isPending ? "Pendente" : `Paragem #${c.Ordem}`}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded border border-zinc-200">
                      {c.Cliente}
                    </span>
                  </div>

                  {/* Body */}
                  <div className="space-y-1 text-xs">
                    {c.Nome_Cliente && c.Nome_Cliente !== c.Cliente && (
                      <p className="font-bold text-zinc-800">{c.Nome_Cliente}</p>
                    )}
                    <p className="text-zinc-700 font-medium">{c.Morada}</p>
                    <p className="text-zinc-500 text-[10px]">{c.CP} {c.Localidade}</p>
                    
                    <div className="pt-1 flex items-center justify-between text-[11px] text-zinc-600 border-t border-zinc-100">
                      <span>Janela: <b>{c.Janela_Horaria || "Qualquer"}</b></span>
                      <span>Carga: <b>{c.Carga_Acum || 0} kg</b></span>
                    </div>
                  </div>

                  {/* Route Reassignment Selector inside Popup */}
                  {onMoveClientRoute && (
                    <div className="mt-2.5 pt-2 border-t border-zinc-200 flex items-center justify-between">
                      <label className="text-[10px] font-semibold text-zinc-500">Mover para:</label>
                      <select
                        value={isPending ? "Por Distribuir" : c.Rota}
                        onChange={(e) => onMoveClientRoute(c.Cliente, e.target.value, c.id || c.ID_Original, c.Morada)}
                        className="text-[10px] bg-zinc-50 border border-zinc-300 rounded px-1.5 py-0.5 font-medium text-zinc-800 outline-none focus:border-indigo-500 cursor-pointer"
                      >
                        {allVehicleOptions.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Real OSRM Road Geometries (Filtered) */}
        {Object.entries(roadGeometries).map(([rName, coords]) => {
          if (coords.length < 2) return null;
          if (selectedRoutes.length > 0 && !selectedRoutes.includes(rName)) return null;
          const color = getRouteColor(rName, vehicles);
          return (
            <Polyline
              key={`road-${rName}`}
              positions={coords}
              pathOptions={{
                color: color,
                weight: 4,
                opacity: 0.85,
                lineJoin: "round",
                lineCap: "round"
              }}
            />
          );
        })}
      </MapContainer>
    </div>
  );
}
