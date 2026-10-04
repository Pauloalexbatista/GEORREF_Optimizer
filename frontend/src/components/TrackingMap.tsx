"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const ROUTE_COLORS = [
  "#4F46E5", // Indigo
  "#059669", // Emerald
  "#D97706", // Amber
  "#7C3AED", // Violet
  "#0891B2", // Cyan
  "#DB2777", // Pink
  "#2563EB", // Blue
  "#EA580C", // Orange
  "#0D9488", // Teal
  "#65A30D", // Lime
  "#DC2626", // Red
  "#9333EA", // Purple
];

export interface TrackingStop {
  id?: number;
  sequence: number;
  client_name?: string;
  cliente?: string;
  address?: string;
  morada?: string;
  postal_code?: string;
  cod_postal?: string;
  locality?: string;
  localidade?: string;
  phone?: string;
  telefone?: string;
  window_start?: string;
  janela_inicio?: string;
  window_end?: string;
  janela_fim?: string;
  expected_arrival?: string;
  actual_arrival_time?: string | null;
  hora_entrega_real?: string | null;
  status: string; // "Entregue", "Não Entregue", "Pendente"
  fail_reason?: string | null;
  motivo_falha?: string | null;
  driver_notes?: string | null;
  notas_motorista?: string | null;
  weight_kg?: number;
  peso_kg?: number;
  volume_m3?: number;
  packages?: number;
  lat: number | null;
  lng: number | null;
}

export interface TrackingRoute {
  route_id?: string;
  route_name?: string;
  driver_name?: string | null;
  has_driver?: boolean;
  vehicle?: string;
  vehicle_id?: string;
  warehouse?: string;
  warehouse_lat?: number | null;
  warehouse_lng?: number | null;
  status_operacional?: string;
  next_stop?: TrackingStop | null;
  last_finished_stop?: TrackingStop | null;
  total?: number;
  total_stops?: number;
  entregues?: number;
  falhadas?: number;
  pendentes?: number;
  percent_complete?: number;
  stops: TrackingStop[];
  last_lat?: number | null;
  last_lng?: number | null;
  last_gps_time?: string;
  speed?: number;
  color?: string;
}

export interface TrackingMapProps {
  routes: TrackingRoute[];
  selectedRouteIds?: string[];
  statusFilter?: string;
  lastTelemetry?: Record<string, any>;
  onUpdateStop?: (routeId: string, sequence: number, newStatus: string, reason?: string, notes?: string) => void;
  onStatusUpdate?: (routeId: string, sequence: number, newStatus: string, reason?: string, notes?: string) => void;
  onSelectRoute?: (routeId: string) => void;
}

function MapBoundsController({
  routes,
}: {
  routes: TrackingRoute[];
}) {
  const map = useMap();

  useEffect(() => {
    const latLngs: L.LatLngExpression[] = [];

    // Adiciona todas as paragens e pontos de GPS das rotas visíveis
    routes.forEach((r) => {
      r.stops.forEach((s) => {
        if (s.lat && s.lng && s.lat !== 0 && s.lng !== 0) {
          latLngs.push([s.lat, s.lng]);
        }
      });

      if (r.last_lat && r.last_lng && r.last_lat !== 0 && r.last_lng !== 0) {
        latLngs.push([r.last_lat, r.last_lng]);
      }
    });

    if (latLngs.length > 0) {
      try {
        const bounds = L.latLngBounds(latLngs);
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
      } catch (err) {
        console.error("Error fitting map bounds:", err);
      }
    }
  }, [map, routes]);

  return null;
}

// Ícone para Paragens de Entrega
function createStopIcon(status: string, sequence: number, color: string) {
  let bgColor = color || "#3B82F6";
  let iconContent = `${sequence}`;
  let borderColor = "#FFFFFF";

  if (status === "Entregue") {
    bgColor = "#10B981"; // Verde
    iconContent = `✓ ${sequence}`;
  } else if (status === "Não Entregue" || status === "Nao Entregue") {
    bgColor = "#EF4444"; // Vermelho
    iconContent = `✕ ${sequence}`;
  } else {
    // Pendente / Próxima
    bgColor = color || "#3B82F6";
    iconContent = `${sequence}`;
  }

  const html = `
    <div style="position: relative; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;">
      <div style="
        background-color: ${bgColor};
        color: #FFFFFF;
        border: 2px solid ${borderColor};
        border-radius: 9999px;
        font-weight: 800;
        font-size: 11px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -2px rgba(0, 0, 0, 0.3);
      ">
        ${iconContent}
      </div>
    </div>
  `;

  return L.divIcon({
    html: html,
    className: "custom-stop-icon",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

// Ícone para Viatura no Mapa
function createVehicleIcon(
  driverName: string,
  vehicle: string,
  color: string,
  nextClient: string
) {
  const labelText = nextClient ? `👤 ${driverName} ➔ 🎯 ${nextClient}` : `👤 ${driverName} (${vehicle})`;

  const htmlActive = `
    <div style="position: relative; display: flex; flex-direction: column; align-items: center; cursor: pointer;">
      <!-- Pulso Animado de Radar -->
      <div style="
        position: absolute;
        top: 3px;
        width: 38px;
        height: 38px;
        border-radius: 50%;
        background-color: ${color};
        opacity: 0.45;
        animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
      "></div>
      
      <!-- Distintivo Principal da Viatura -->
      <div style="
        position: relative;
        background: linear-gradient(135deg, ${color}, #0F172A);
        color: #FFFFFF;
        border: 2.5px solid #FFFFFF;
        border-radius: 50%;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 17px;
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.6);
      ">
        🚚
      </div>

      <!-- Etiqueta com Motorista e Próximo Destino -->
      <div style="
        margin-top: 2px;
        background-color: rgba(9, 9, 11, 0.95);
        color: #F4F4F5;
        border: 1px solid ${color};
        border-radius: 6px;
        padding: 2px 6px;
        font-size: 10px;
        font-weight: 700;
        white-space: nowrap;
        box-shadow: 0 4px 6px rgba(0,0,0,0.5);
      ">
        ${labelText}
      </div>
    </div>
    <style>
      @keyframes ping {
        75%, 100% {
          transform: scale(1.8);
          opacity: 0;
        }
      }
    </style>
  `;

  return L.divIcon({
    html: htmlActive,
    className: "custom-vehicle-active",
    iconSize: [110, 54],
    iconAnchor: [55, 18],
    popupAnchor: [0, -18],
  });
}

export default function TrackingMap({
  routes,
  selectedRouteIds = [],
  statusFilter = "all",
  lastTelemetry = {},
  onUpdateStop,
  onStatusUpdate,
}: TrackingMapProps) {
  // Centro de Portugal
  const defaultCenter: [number, number] = [38.75, -9.15];

  // Callback wrapper
  const handleStatusChange = (
    routeId: string,
    sequence: number,
    newStatus: string,
    reason?: string,
    notes?: string
  ) => {
    if (onStatusUpdate) {
      onStatusUpdate(routeId, sequence, newStatus, reason, notes);
    } else if (onUpdateStop) {
      onUpdateStop(routeId, sequence, newStatus, reason, notes);
    }
  };

  // Mapa de cores fixas por rota
  const routeColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    routes.forEach((r, idx) => {
      const rId = r.route_name || r.route_id || `Rota_${idx + 1}`;
      map[rId] = r.color || ROUTE_COLORS[idx % ROUTE_COLORS.length];
    });
    return map;
  }, [routes]);

  // Filtragem estrita: Apenas rotas COM distribuição (paragens > 0) E selecionadas pelo utilizador
  const visibleRoutes = useMemo(() => {
    return routes.filter((r) => {
      const rId = r.route_name || r.route_id || "";
      const hasStops = (r.stops && r.stops.length > 0) || (r.total_stops || 0) > 0;
      if (!hasStops) return false;

      // Se não houver seleção explícita, mostra todas com distribuição
      if (!selectedRouteIds || selectedRouteIds.length === 0) {
        return true;
      }
      return selectedRouteIds.includes(rId);
    });
  }, [routes, selectedRouteIds]);

  return (
    <div className="w-full h-full relative z-0">
      <MapContainer
        center={defaultCenter}
        zoom={10}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%", backgroundColor: "#18181B" }}
      >
        <TileLayer
          attribution='&copy; Google Maps'
          url="https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
          maxZoom={19}
        />

        <MapBoundsController routes={visibleRoutes} />

        {/* 1. Traçados de Rotas Selecionadas */}
        {visibleRoutes.map((route) => {
          const rId = route.route_name || route.route_id || "Rota";
          const color = routeColorMap[rId] || "#3B82F6";

          // Obter coordenadas das paragens válidas da rota
          const validStops = route.stops.filter((s) => s.lat && s.lng && s.lat !== 0 && s.lng !== 0);
          if (validStops.length === 0) return null;

          const polylineCoords: [number, number][] = validStops.map((s) => [s.lat!, s.lng!]);
          if (polylineCoords.length < 2) return null;

          return (
            <Polyline
              key={`line-${rId}`}
              positions={polylineCoords}
              pathOptions={{
                color: color,
                weight: 4.5,
                opacity: 0.85,
                lineJoin: "round",
                lineCap: "round",
              }}
            />
          );
        })}

        {/* 2. Marcadores de Paragens de Entrega das Rotas Selecionadas */}
        {visibleRoutes.map((route) => {
          const rId = route.route_name || route.route_id || "Rota";
          const color = routeColorMap[rId] || "#3B82F6";

          return route.stops.map((stop) => {
            if (!stop.lat || !stop.lng || stop.lat === 0 || stop.lng === 0) return null;

            // Filtro de estado
            if (statusFilter && statusFilter !== "all" && stop.status !== statusFilter) {
              return null;
            }

            const isDone = stop.status === "Entregue";
            const isFail = stop.status === "Não Entregue" || stop.status === "Nao Entregue";
            const clientName = stop.cliente || stop.client_name || stop.morada || stop.address || `Paragem #${stop.sequence}`;
            const address = stop.morada || stop.address || "";
            const locality = stop.localidade || stop.locality || "";
            const phone = stop.telefone || stop.phone;
            const wStart = stop.janela_inicio || stop.window_start || "08:00";
            const wEnd = stop.janela_fim || stop.window_end || "18:00";
            const actualTime = stop.hora_entrega_real || stop.actual_arrival_time;
            const failReason = stop.motivo_falha || stop.fail_reason;
            const notes = stop.notas_motorista || stop.driver_notes;

            return (
              <Marker
                key={`stop-${rId}-${stop.sequence}`}
                position={[stop.lat, stop.lng]}
                icon={createStopIcon(stop.status, stop.sequence, color)}
              >
                <Popup className="custom-leaflet-popup" minWidth={270} maxWidth={330}>
                  <div className="p-2 space-y-2 text-xs">
                    {/* Header do Popup */}
                    <div className="flex items-center justify-between border-b pb-1.5">
                      <div className="flex items-center gap-1.5 font-bold text-zinc-900">
                        <span
                          className="w-2.5 h-2.5 rounded-full inline-block"
                          style={{ backgroundColor: color }}
                        />
                        <span>{rId} • Paragem #{stop.sequence}</span>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isDone
                            ? "bg-emerald-100 text-emerald-700"
                            : isFail
                            ? "bg-rose-100 text-rose-700"
                            : "bg-sky-100 text-sky-700"
                        }`}
                      >
                        {stop.status}
                      </span>
                    </div>

                    {/* Dados do Cliente e Morada */}
                    <div>
                      <div className="font-bold text-zinc-900 text-sm">{clientName}</div>
                      <div className="text-zinc-600 text-xs mt-0.5">
                        {address}{locality ? `, ${locality}` : ""}
                      </div>
                      {phone && (
                        <div className="mt-1">
                          <a
                            href={`tel:${phone}`}
                            className="text-sky-600 hover:text-sky-800 font-semibold flex items-center gap-1 text-[11px]"
                          >
                            <span>📞</span> {phone}
                          </a>
                        </div>
                      )}
                    </div>

                    {/* Janela e Horário */}
                    <div className="bg-zinc-50 p-2 rounded border border-zinc-200 text-[11px] space-y-0.5">
                      <div className="text-zinc-600">
                        <span className="font-medium">Janela Prevista:</span> {wStart} - {wEnd}
                      </div>
                      {actualTime && (
                        <div className="text-emerald-700 font-semibold">
                          <span>✓ Concluído às:</span> {actualTime.substring(11, 16) || actualTime}
                        </div>
                      )}
                      {failReason && (
                        <div className="text-rose-700 font-semibold">
                          <span>✕ Motivo de Falha:</span> {failReason}
                        </div>
                      )}
                      {notes && (
                        <div className="text-zinc-600 italic">
                          <span>Notas:</span> {notes}
                        </div>
                      )}
                    </div>

                    {/* Ações Rápidas no Mapa */}
                    <div className="pt-1 flex items-center gap-1.5">
                      {!isDone && (
                        <button
                          onClick={() => handleStatusChange(rId, stop.sequence, "Entregue")}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-1 px-2 rounded text-[11px] transition-colors cursor-pointer"
                        >
                          ✓ Marcar Entregue
                        </button>
                      )}
                      {!isFail && (
                        <button
                          onClick={() =>
                            handleStatusChange(
                              rId,
                              stop.sequence,
                              "Não Entregue",
                              "Cliente Ausente"
                            )
                          }
                          className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-semibold py-1 px-2 rounded text-[11px] transition-colors cursor-pointer"
                        >
                          ✕ Marcar Falhada
                        </button>
                      )}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          });
        })}

        {/* 3. Marcadores de Veículos das Rotas Selecionadas */}
        {visibleRoutes.map((route) => {
          const rId = route.route_name || route.route_id || "Rota";
          const color = routeColorMap[rId] || "#3B82F6";
          const telem = lastTelemetry && rId ? lastTelemetry[rId] : null;

          const vLat = telem?.lat ?? route.last_lat;
          const vLng = telem?.lng ?? route.last_lng;
          const driverName = route.driver_name || "Motorista";
          const vehicle = route.vehicle_id || route.vehicle || "Viatura";
          const nextStop = route.next_stop;
          const nextClientLabel = nextStop ? `#${nextStop.sequence} ${(nextStop.cliente || nextStop.client_name || "").substring(0, 14)}` : "";
          const statusOp = route.status_operacional || "Em Operação";
          const lastGpsTime = telem?.timestamp || route.last_gps_time || "Agora";
          const speed = telem?.speed ?? route.speed ?? 0;

          if (!vLat || !vLng || vLat === 0 || vLng === 0) return null;

          return (
            <Marker
              key={`vehicle-${rId}`}
              position={[vLat, vLng]}
              icon={createVehicleIcon(driverName, vehicle, color, nextClientLabel)}
              zIndexOffset={1000}
            >
              <Popup className="custom-leaflet-popup" minWidth={260} maxWidth={320}>
                <div className="p-2 space-y-2 text-xs">
                  <div className="flex items-center justify-between border-b pb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🚚</span>
                      <div>
                        <div className="font-bold text-zinc-900">{rId}</div>
                        <div className="text-zinc-500 text-[10px] font-mono">{vehicle}</div>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                      {route.entregues || 0}/{route.total_stops || 0} entregas
                    </span>
                  </div>

                  <div className="space-y-1.5 text-zinc-700">
                    <div>
                      <span className="font-semibold">👤 Motorista:</span>{" "}
                      <span className="font-bold text-zinc-900">{driverName}</span>
                    </div>

                    {/* Destaque do Próximo Cliente */}
                    {nextStop ? (
                      <div className="bg-sky-50 border border-sky-200 p-2 rounded-lg text-[11px] text-sky-900">
                        <div className="font-bold text-sky-700">🎯 Próxima Paragem a Entregar:</div>
                        <div className="font-semibold mt-0.5">
                          #{nextStop.sequence} - {nextStop.cliente || nextStop.client_name}
                        </div>
                        <div className="text-sky-800 text-[10px] mt-0.5">
                          📍 {nextStop.morada || nextStop.address}
                        </div>
                        <div className="text-sky-700 text-[10px] mt-0.5 font-medium">
                          🕒 Janela: {nextStop.janela_inicio || "08:00"} - {nextStop.janela_fim || "18:00"}
                        </div>
                      </div>
                    ) : (
                      <div className="bg-emerald-50 border border-emerald-200 p-2 rounded-lg text-[11px] text-emerald-800 font-semibold">
                        🏁 Todas as entregas concluídas!
                      </div>
                    )}

                    <div className="text-[11px] text-zinc-600">
                      <span className="font-semibold">📡 Estado:</span> {statusOp}
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono pt-1">
                      <span>Velocidade: {Math.round(speed)} km/h</span>
                      <span>GPS: {lastGpsTime}</span>
                    </div>
                  </div>

                  {/* Ação rápida se houver próximo cliente */}
                  {nextStop && (
                    <div className="pt-1 border-t flex items-center gap-1.5">
                      <button
                        onClick={() => handleStatusChange(rId, nextStop.sequence, "Entregue")}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-1.5 px-2 rounded text-[11px] transition-colors cursor-pointer"
                      >
                        ✓ Entregar #{nextStop.sequence}
                      </button>
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
