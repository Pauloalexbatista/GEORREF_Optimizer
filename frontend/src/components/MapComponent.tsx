"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { useI18n } from "@/context/I18nContext";
import { MapContainer, TileLayer, Marker, Popup, Polyline, Rectangle, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface MapClient {
  id?: number;
  ID_Original?: number;
  Doc_ID?: string;
  doc_id?: string;
  numero_doc?: string;
  Codigo_Cliente?: string;
  codigo_cliente?: string;
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
  Chegada?: string;
  Saida?: string;
  Peso_KG?: number;
  KM_Anterior?: number;
  Dist_Acum?: number;
  Volume_m3?: number;
  Volume_M3?: number;
  Carga_Acum?: number;
  Carga_Vol_Acum?: number;
  Telefone?: string;
  Telefone_Cliente?: string;
  telefone?: string;
  Observacoes?: string;
  observacoes?: string;
  Notas_Motorista?: string;
  notas_motorista?: string;
  Notas?: string;
  notas?: string;
  Vendedor?: string;
  vendedor?: string;
  Regras?: string;
  Tipo_Operacao?: string;
  tipo_operacao?: string;
  Par_ID?: string;
  par_id?: string;
}

interface MapWarehouse {
  name: string;
  address: string;
  lat: number;
  lon: number;
}

export interface MapFilterState {
  searchQuery?: string;
  selectedWarehouse?: string;
  statusFilter?: "all" | "active" | "with_cargo" | "empty" | "pending" | "late";
  selectedRoutes?: string[];
}

export interface MapComponentProps {
  clients: MapClient[];
  warehouses: MapWarehouse[];
  vehicles: string[];
  fleet?: any[];
  onMoveClientRoute?: (clientName: string, newRoute: string, deliveryId?: number, address?: string, lat?: number, lon?: number) => void;
  onBulkReassign?: (items: { clientName: string; deliveryId?: number; address?: string; lat?: number; lon?: number }[], newRoute: string) => Promise<void>;
  onUpdateClientCoords?: (clientName: string, lat: number, lon: number) => void;
  onGeoreferenceClient?: (client: MapClient) => void;
  filterState?: MapFilterState;
  onFilterChange?: (filters: MapFilterState) => void;
  onReoptimizeSubset?: (selectedRoutes: string[]) => void;
  rulesMatrix?: any[];
  onOpenBigPicture?: (zoneId?: string) => void;
}

export {
  parseWindowStartEnd,
  parseTimeToMinutes,
  normalizeLocality,
  extractTags,
  formatTimeWindow,
  haversineDistance,
  addMinutesToTime,
} from "@/utils/geoNormalize";
import {
  parseWindowStartEnd,
  parseTimeToMinutes,
  normalizeLocality,
  extractTags,
  formatTimeWindow,
  haversineDistance,
  addMinutesToTime,
} from "@/utils/geoNormalize";


function normRouteName(name: string): string {
  if (!name) return "";
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/cuentas/g, "contas")
    .replace(/customer/g, "costumer")
    .replace(/[^a-z0-9]/g, "");
}

function isPendingRoute(routeName: string) {
  if (!routeName) return true;
  const n = normRouteName(routeName);
  return (
    n === "" ||
    n === "pordistribuir" ||
    n === "pendente" ||
    n === "none" ||
    n === "null" ||
    n === "semviatura" ||
    n.includes("distribuir") ||
    n.includes("pendente")
  );
}

function routesMatch(r1?: string, r2?: string): boolean {
  if (!r1 && !r2) return true;
  if (!r1 || !r2) return false;
  if (isPendingRoute(r1) && isPendingRoute(r2)) return true;
  if (isPendingRoute(r1) !== isPendingRoute(r2)) return false;
  const n1 = normRouteName(r1);
  const n2 = normRouteName(r2);
  return n1 === n2 || n1.includes(n2) || n2.includes(n1);
}

// Controller that centers or fits map bounds on initial mount to the active distribution region
function MapInitialController({
  coords,
  initialPoints,
}: {
  coords: [number, number];
  initialPoints?: [number, number][];
}) {
  const map = useMap();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    const valid = (initialPoints || []).filter(p => p[0] !== 0 && p[1] !== 0);
    if (valid.length > 0) {
      try {
        const bounds = L.latLngBounds(valid.map(p => L.latLng(p[0], p[1])));
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14, animate: false });
        initializedRef.current = true;
        return;
      } catch (e) {}
    }
    if (coords[0] !== 0 && coords[1] !== 0) {
      map.setView(coords, map.getZoom() || 11);
      initializedRef.current = true;
    }
  }, [coords, initialPoints, map]);

  return null;
}

// Auto Fit Bounds Controller (triggers ONLY when filter triggerKey explicitly changes, preserving user zoom/pan during reassignments)
function MapBoundsFitter({ triggerKey, points }: { triggerKey: string; points: [number, number][] }) {
  const map = useMap();
  const lastTriggerRef = useRef("");

  useEffect(() => {
    if (!triggerKey || triggerKey === lastTriggerRef.current || points.length === 0) return;
    lastTriggerRef.current = triggerKey;
    try {
      const validPoints = points.filter(p => p[0] !== 0 && p[1] !== 0);
      if (validPoints.length > 0) {
        const bounds = L.latLngBounds(validPoints.map(p => L.latLng(p[0], p[1])));
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15, animate: true });
      }
    } catch (e) {}
  }, [triggerKey, points, map]);

  return null;
}

// Track zoom level dynamically to scale markers and icons
function MapTracker({ setZoom }: { setZoom: (z: number) => void }) {
  const map = useMapEvents({
    zoomend: () => {
      setZoom(map.getZoom());
    },
  });
  return null;
}

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

export type TimeSlotShape = "circle" | "square" | "triangle" | "rect" | "diamond";

export interface TimeSlotInfo {
  type: string;
  label: string;
  windowStr: string;
  shape: TimeSlotShape;
  badge: string;
  count?: number;
}

export interface TerritorialZone {
  id: string;
  name: string;
  dominantLocality: string;
  vehicles: string[];
  stopsCount: number;
  totalKg: number;
  centerLat: number;
  centerLon: number;
  bounds: [[number, number], [number, number]];
}


export function checkVehicleClientCompatibility(
  vRulesStr: string,
  cRulesStr: string,
  rulesMatrix?: any[]
): { isCompatible: boolean; reason?: string } {
  const cTags = extractTags(cRulesStr);
  if (cTags.length === 0) return { isCompatible: true };
  const vTags = extractTags(vRulesStr);

  if (rulesMatrix && rulesMatrix.length > 0) {
    const prohibitions = new Set<string>();
    const permissions = new Set<string>();
    const configuredDeliveryTags = new Set<string>();

    rulesMatrix.forEach((r) => {
      const tv = String(r.Tag_Veiculo || r.tag_veiculo || "").trim().toUpperCase();
      const perm = String(r.Permissao || r.permissao || "SIM").trim().toUpperCase();
      const td = String(r.Tag_Entrega || r.tag_entrega || "").trim().toUpperCase();
      if (!tv || !td) return;

      configuredDeliveryTags.add(td);
      if (["NAO", "NÃO", "NO", "PROIBIR", "FALSE", "0"].includes(perm)) {
        prohibitions.add(`${tv}|${td}`);
      } else {
        permissions.add(`${tv}|${td}`);
      }
    });

    // 1. Proibições Rígidas (NAO)
    for (const vt of vTags) {
      for (const dt of cTags) {
        if (prohibitions.has(`${vt}|${dt}`)) {
          return {
            isCompatible: false,
            reason: `A viatura [${vt}] tem proibição na matriz de regras para entregas com [${dt}].`
          };
        }
      }
    }

    // 2. Obrigatoriedades para tags configuradas na matriz de regras
    for (const dt of cTags) {
      if (!configuredDeliveryTags.has(dt)) continue;
      let matched = vTags.includes(dt);
      if (!matched) {
        for (const vt of vTags) {
          if (permissions.has(`${vt}|${dt}`)) {
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        return {
          isCompatible: false,
          reason: `A entrega exige a característica [${dt}], não permitida para esta viatura.`
        };
      }
    }
  } else {
    // Validação direta por tags informativas
    for (const dt of cTags) {
      if (dt.includes("FRIO") && !vTags.some(vt => vt.includes("FRIO"))) {
        return { isCompatible: false, reason: `A entrega exige refrigeração [${dt}], mas a viatura não possui frio.` };
      }
      if (dt.includes("ONEMAN") && !vTags.some(vt => vt.includes("ONEMAN"))) {
        return { isCompatible: false, reason: `A entrega exige tripulação [${dt}], não configurada nesta viatura.` };
      }
    }
  }

  return { isCompatible: true };
}

export interface GuardianViolation {
  type: "rule_incompatibility" | "capacity_kg" | "capacity_vol" | "max_stops";
  severity: "error" | "warning";
  title: string;
  message: string;
  clientName?: string;
}

export function checkGuardianViolations(
  items: { clientName: string; weight?: number; vol?: number; rules?: string }[],
  targetRoute: string,
  fleet: any[],
  rulesMatrix?: any[],
  vehicleMetricsMap?: Record<string, any>
): GuardianViolation[] {
  if (!targetRoute || isPendingRoute(targetRoute)) return [];

  const violations: GuardianViolation[] = [];
  const vConfig = fleet.find(f => routesMatch(f.veiculo, targetRoute));
  const vRulesStr = vConfig?.regras || "";
  const capKg = Number(vConfig?.capacidade_kg) || 0;
  const capVol = Number(vConfig?.capacidade_vol) || 0;
  const maxStops = Number(vConfig?.max_entregas) || 0;

  const currentMetrics = vehicleMetricsMap?.[targetRoute] || {
    count: 0,
    totalKg: 0,
    totalVol: 0,
  };

  let additionalKg = 0;
  let additionalVol = 0;
  const additionalStops = items.length;

  items.forEach(it => {
    additionalKg += Number(it.weight) || 0;
    additionalVol += Number(it.vol) || 0;

    const comp = checkVehicleClientCompatibility(vRulesStr, it.rules || "", rulesMatrix);
    if (!comp.isCompatible) {
      violations.push({
        type: "rule_incompatibility",
        severity: "error",
        title: "Incompatibilidade de Regra / Equipamento",
        message: `${it.clientName}: ${comp.reason}`,
        clientName: it.clientName,
      });
    }
  });

  if (capKg > 0 && (currentMetrics.totalKg + additionalKg) > capKg) {
    const excess = Math.round((currentMetrics.totalKg + additionalKg) - capKg);
    violations.push({
      type: "capacity_kg",
      severity: "warning",
      title: "Sobrecarga de Peso",
      message: `A viatura "${targetRoute}" vai exceder a capacidade máxima em +${excess.toLocaleString("pt-PT")} kg (Total: ${Math.round(currentMetrics.totalKg + additionalKg).toLocaleString("pt-PT")} kg / Máx: ${capKg.toLocaleString("pt-PT")} kg).`,
    });
  }

  if (capVol > 0 && (currentMetrics.totalVol + additionalVol) > capVol) {
    const excessVol = Number(((currentMetrics.totalVol + additionalVol) - capVol).toFixed(1));
    violations.push({
      type: "capacity_vol",
      severity: "warning",
      title: "Sobrecarga de Volume",
      message: `A viatura "${targetRoute}" vai exceder a capacidade de volume em +${excessVol} m³ (Total: ${Number((currentMetrics.totalVol + additionalVol).toFixed(1))} m³ / Máx: ${capVol} m³).`,
    });
  }

  if (maxStops > 0 && (currentMetrics.count + additionalStops) > maxStops) {
    violations.push({
      type: "max_stops",
      severity: "warning",
      title: "Limite de Paragens Excedido",
      message: `A viatura "${targetRoute}" vai ficar com ${currentMetrics.count + additionalStops} paragens (limite contratual: ${maxStops}).`,
    });
  }

  return violations;
}

function getRouteColor(routeName: string, vehicleList: string[], customColors?: Record<string, string>) {
  if (!routeName || isPendingRoute(routeName)) return "#f59e0b"; // Amber for pending
  if (customColors) {
    if (customColors[routeName]) return customColors[routeName];
    const match = vehicleList.find(v => routesMatch(v, routeName));
    if (match && customColors[match]) return customColors[match];
  }
  const idx = vehicleList.findIndex(v => routesMatch(v, routeName));
  if (idx !== -1) return routeColors[idx % routeColors.length];
  
  // Deterministic fallback color based on name hash so different route names have distinct colors
  let hash = 0;
  const norm = normRouteName(routeName);
  for (let i = 0; i < norm.length; i++) {
    hash = norm.charCodeAt(i) + ((hash << 5) - hash);
  }
  return routeColors[Math.abs(hash) % routeColors.length];
}

// Marker Icon for Warehouse
function getWarehouseIcon(zoom: number) {
  const size = Math.max(26, Math.min(38, 22 + (zoom - 10) * 2));
  return L.divIcon({
    className: "warehouse-marker",
    html: `
      <div style="
        width: ${size}px;
        height: ${size}px;
        background-color: #1e1b4b;
        border: 2px solid #818cf8;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        color: white;
        font-size: ${Math.round(size * 0.55)}px;
      ">
        🏠
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// Marker Icon for Clients with Geometric Shapes based on Time Slot & Operation Type (D, P, From, To)
function createGeometricMarkerIcon(
  order: number,
  color: string,
  isPending: boolean,
  zoom: number,
  isSelected: boolean = false,
  slot?: TimeSlotInfo,
  opType?: string
) {
  const effectiveSlot = isPending
    ? { type: "any" as const, shape: "circle" as const, label: "Pendente", badge: "⚠️" }
    : (slot || { type: "any" as const, shape: "circle" as const, label: "Qualquer", badge: "⚪" });

  const size = isPending
    ? Math.max(22, Math.min(30, 20 + (zoom - 10) * 2))
    : Math.max(26, Math.min(38, 24 + (zoom - 10) * 2));

  const displayText = isPending ? "⚠️" : String(order || 1);
  const strokeColor = isSelected ? "#ffffff" : "rgba(255,255,255,0.95)";
  const strokeWidth = isSelected ? 3 : 2;
  const filter = isSelected
    ? "drop-shadow(0 0 6px rgba(99,102,241,1)) drop-shadow(0 2px 6px rgba(0,0,0,0.6))"
    : "drop-shadow(0 2px 4px rgba(0,0,0,0.45))";

  let shapeSvg = "";
  let textY = size / 2;
  let fontSize = Math.round(size * 0.44);

  if (effectiveSlot.shape === "triangle") {
    const pad = 2;
    const topX = size / 2;
    const topY = pad;
    const leftX = pad;
    const leftY = size - pad;
    const rightX = size - pad;
    const rightY = size - pad;
    shapeSvg = `<polygon points="${topX},${topY} ${rightX},${rightY} ${leftX},${leftY}" fill="${color}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="round" />`;
    textY = size * 0.64;
    fontSize = Math.round(size * 0.38);
  } else if (effectiveSlot.shape === "square") {
    const pad = 2.5;
    const s = size - pad * 2;
    shapeSvg = `<rect x="${pad}" y="${pad}" width="${s}" height="${s}" rx="5" fill="${color}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />`;
    textY = size / 2;
  } else if (effectiveSlot.shape === "rect") {
    const padX = 2;
    const padY = Math.round(size * 0.16);
    const w = size - padX * 2;
    const h = size - padY * 2;
    shapeSvg = `<rect x="${padX}" y="${padY}" width="${w}" height="${h}" rx="5" fill="${color}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />`;
    textY = size / 2;
    fontSize = Math.round(size * 0.40);
  } else if (effectiveSlot.shape === "diamond") {
    const cx = size / 2;
    const cy = size / 2;
    const r = (size - 6) / 2;
    shapeSvg = `<polygon points="${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}" fill="${color}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="round" />`;
    textY = size / 2;
    fontSize = Math.round(size * 0.40);
  } else {
    // Circle
    const r = (size - 4) / 2;
    const dash = effectiveSlot.type === "any" && !isPending ? 'stroke-dasharray="3 2"' : "";
    shapeSvg = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="${color}" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${dash} />`;
    textY = size / 2;
  }

  // Mini-Badge para Operações Especiais (P = Sucata, From = Lev. Loja, To = Entrega Loja)
  let opBadgeSvg = "";
  if (opType && opType !== "D" && !isPending) {
    const badgeSize = Math.max(10, Math.round(size * 0.36));
    const bx = size - badgeSize;
    const by = 0;
    let bColor = "#f59e0b"; // P = Amber
    let bLetter = "P";
    if (opType === "From") {
      bColor = "#a855f7"; // From = Purple
      bLetter = "F";
    } else if (opType === "To") {
      bColor = "#06b6d4"; // To = Cyan
      bLetter = "T";
    }
    opBadgeSvg = `
      <g transform="translate(${bx}, ${by})">
        <circle cx="${badgeSize/2}" cy="${badgeSize/2}" r="${badgeSize/2}" fill="${bColor}" stroke="#ffffff" stroke-width="1.2" />
        <text x="${badgeSize/2}" y="${badgeSize/2}" text-anchor="middle" dominant-baseline="central" fill="#ffffff" font-family="sans-serif" font-weight="900" font-size="${badgeSize*0.65}px">${bLetter}</text>
      </g>
    `;
  }

  const svgHtml = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="filter: ${filter}; overflow: visible; cursor: grab;" xmlns="http://www.w3.org/2000/svg">
      ${shapeSvg}
      <text
        x="${size / 2}"
        y="${textY}"
        text-anchor="middle"
        dominant-baseline="central"
        fill="#ffffff"
        font-family="monospace, ui-monospace, sans-serif"
        font-weight="900"
        font-size="${fontSize}px"
        style="pointer-events: none; user-select: none;"
      >
        ${displayText}
      </text>
      ${opBadgeSvg}
    </svg>
  `;

  return L.divIcon({
    className: "custom-client-marker" + (isSelected ? " selected-marker" : ""),
    html: svgHtml,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// Interactive Area Selection Component (Box / Rectangle Selection with Mouse)
function MapAreaSelector({
  isSelecting,
  onSelectionComplete,
}: {
  isSelecting: boolean;
  onSelectionComplete: (bounds: L.LatLngBounds) => void;
}) {
  const map = useMap();
  const [dragStart, setDragStart] = useState<L.LatLng | null>(null);
  const [dragEnd, setDragEnd] = useState<L.LatLng | null>(null);

  useEffect(() => {
    if (isSelecting) {
      map.dragging.disable();
      const container = map.getContainer();
      if (container) container.style.cursor = "crosshair";
    } else {
      map.dragging.enable();
      const container = map.getContainer();
      if (container) container.style.cursor = "";
      setDragStart(null);
      setDragEnd(null);
    }
  }, [isSelecting, map]);

  useMapEvents({
    mousedown: (e) => {
      if (!isSelecting) return;
      setDragStart(e.latlng);
      setDragEnd(e.latlng);
    },
    mousemove: (e) => {
      if (!isSelecting || !dragStart) return;
      setDragEnd(e.latlng);
    },
    mouseup: (e) => {
      if (!isSelecting || !dragStart) return;
      const endLatLng = e.latlng;
      const bounds = L.latLngBounds(dragStart, endLatLng);
      setDragStart(null);
      setDragEnd(null);
      onSelectionComplete(bounds);
    },
  });

  if (!dragStart || !dragEnd) return null;

  const bounds = L.latLngBounds(dragStart, dragEnd);
  return (
    <Rectangle
      bounds={bounds}
      pathOptions={{
        color: "#4f46e5",
        fillColor: "#6366f1",
        fillOpacity: 0.25,
        weight: 2,
        dashArray: "4 4",
      }}
    />
  );
}

export default function MapComponent({
  clients,
  warehouses,
  vehicles,
  fleet = [],
  onMoveClientRoute,
  onBulkReassign,
  onUpdateClientCoords,
  onGeoreferenceClient,
  filterState,
  onFilterChange,
  onReoptimizeSubset,
  rulesMatrix = [],
  onOpenBigPicture,
}: MapComponentProps) {
  const { t } = useI18n();

  const [isMounted, setIsMounted] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(11);
  const [roadGeometries, setRoadGeometries] = useState<Record<string, [number, number][]>>({});
  
  // Interactive Filters
  const [searchQuery, setSearchQuery] = useState(filterState?.searchQuery || "");
  const [selectedWarehouse, setSelectedWarehouse] = useState(filterState?.selectedWarehouse || "all");
  const [statusFilter, setStatusFilter] = useState<"all" | "with_cargo" | "empty" | "pending" | "late">(() => {
    if (filterState?.statusFilter === "active" || filterState?.statusFilter === "with_cargo") return "with_cargo";
    return (filterState?.statusFilter as any) || "with_cargo";
  });
  const [selectedRoutes, setSelectedRoutes] = useState<string[]>(filterState?.selectedRoutes || []);
  const [isRoutesPanelOpen, setIsRoutesPanelOpen] = useState<boolean>(true);
  const [showRoads, setShowRoads] = useState(true);
  const [mapLayer, setMapLayer] = useState<"standard" | "google_sat" | "google_hybrid">("standard");
  const [fitTrigger, setFitTrigger] = useState("");

  // Guardião de Regras e Capacidades no Drag & Drop
  const [guardianPendingAction, setGuardianPendingAction] = useState<{
    items: {
      clientName: string;
      deliveryId?: number;
      address?: string;
      lat?: number;
      lon?: number;
      weight?: number;
      vol?: number;
      rules?: string;
    }[];
    targetRoute: string;
    violations: GuardianViolation[];
    sourceType: "marker_drag" | "popup_select" | "bulk_area";
  } | null>(null);

  // Territorial Focus Mode (Dividir para Conquistar)
  const [selectedZoneId, setSelectedZoneId] = useState<string>("all");
  const [validatedZones, setValidatedZones] = useState<Record<string, boolean>>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("georoute_validated_zones");
        if (stored) return JSON.parse(stored);
      } catch (e) {}
    }
    return {};
  });

  // Area Selection & Bulk Transfer State
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [selectedClientKeys, setSelectedClientKeys] = useState<string[]>([]);
  const [bulkTargetRoute, setBulkTargetRoute] = useState<string>("Por Distribuir");
  const [isBulkLoading, setIsBulkLoading] = useState(false);

  // Custom Vehicle Colors (persisted in localStorage)
  const [customVehicleColors, setCustomVehicleColors] = useState<Record<string, string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("georoute_custom_vehicle_colors");
        if (stored) return JSON.parse(stored);
      } catch (e) {}
    }
    return {};
  });

  const handleSetVehicleColor = (vehicleName: string, newColor: string) => {
    setCustomVehicleColors((prev) => {
      const updated = { ...prev, [vehicleName]: newColor };
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("georoute_custom_vehicle_colors", JSON.stringify(updated));
        } catch (e) {}
      }
      return updated;
    });
  };

  // Route Sorting State
  const [routeSortField, setRouteSortField] = useState<"name" | "stops" | "weight" | "vol" | "km">("name");
  const [routeSortAsc, setRouteSortAsc] = useState<boolean>(true);

  // Time Slot Legend Toggle
  const [isLegendOpen, setIsLegendOpen] = useState<boolean>(true);

  const handleSortRoutes = (field: "name" | "stops" | "weight" | "vol" | "km") => {
    if (routeSortField === field) {
      setRouteSortAsc(!routeSortAsc);
    } else {
      setRouteSortField(field);
      setRouteSortAsc(true);
    }
  };

  // Dynamically analyze only the time windows actually present in the distribution
  const availableShapes: TimeSlotShape[] = ["circle", "square", "triangle", "rect", "diamond"];
  const shapeBadges: Record<TimeSlotShape, string> = {
    circle: "⭕",
    square: "⬛",
    triangle: "🔺",
    rect: "🔷",
    diamond: "🔶",
  };

  const dynamicTimeSlots = useMemo(() => {
    const windowMap = new Map<string, { start: number; end: number; formatted: string; count: number }>();
    let hasAnyCount = 0;

    clients.forEach((c) => {
      const parsed = parseWindowStartEnd(c.Janela_Horaria);
      if (!parsed) {
        hasAnyCount++;
        return;
      }
      const existing = windowMap.get(parsed.formatted);
      if (existing) {
        existing.count++;
      } else {
        windowMap.set(parsed.formatted, { ...parsed, count: 1 });
      }
    });

    // Sort existing windows chronologically by start time, then end time
    const sortedWindows = Array.from(windowMap.values()).sort((a, b) => a.start - b.start || a.end - b.end);

    const slotsByWindow = new Map<string, TimeSlotInfo>();
    const legendSlots: TimeSlotInfo[] = [];

    sortedWindows.forEach((w, index) => {
      const shape = availableShapes[index % availableShapes.length];
      const slotNumber = index + 1;
      const badge = shapeBadges[shape] || "⭕";
      const slotInfo: TimeSlotInfo = {
        type: `slot${slotNumber}`,
        label: `${slotNumber}ª Slot (${w.formatted})`,
        windowStr: w.formatted,
        shape: shape,
        badge: badge,
        count: w.count,
      };
      slotsByWindow.set(w.formatted, slotInfo);
      legendSlots.push(slotInfo);
    });

    return {
      slotsByWindow,
      legendSlots,
      hasAnyWindow: hasAnyCount > 0,
      anyCount: hasAnyCount,
    };
  }, [clients]);

  const getClientSlotInfo = (janelaStr?: string): TimeSlotInfo => {
    const parsed = parseWindowStartEnd(janelaStr);
    if (!parsed) {
      return {
        type: "any",
        label: "Qualquer Horário",
        windowStr: "Qualquer",
        shape: "circle",
        badge: "⚪",
        count: 0,
      };
    }
    const found = dynamicTimeSlots.slotsByWindow.get(parsed.formatted);
    if (found) return found;

    return {
      type: "custom",
      label: parsed.formatted,
      windowStr: parsed.formatted,
      shape: "circle",
      badge: "⭕",
      count: 1,
    };
  };

  // Sync when external controlled filterState changes
  useEffect(() => {
    if (filterState) {
      if (filterState.searchQuery !== undefined && filterState.searchQuery !== searchQuery) {
        setSearchQuery(filterState.searchQuery);
      }
      if (filterState.selectedWarehouse !== undefined && filterState.selectedWarehouse !== selectedWarehouse) {
        setSelectedWarehouse(filterState.selectedWarehouse);
      }
      if (filterState.statusFilter !== undefined) {
        const mapped = filterState.statusFilter === "active" ? "with_cargo" : (filterState.statusFilter as any);
        if (mapped !== statusFilter) {
          setStatusFilter(mapped);
        }
      }
      if (filterState.selectedRoutes !== undefined && JSON.stringify(filterState.selectedRoutes) !== JSON.stringify(selectedRoutes)) {
        setSelectedRoutes(filterState.selectedRoutes);
      }
    }
  }, [filterState]);

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setFitTrigger(`search_${val}_${Date.now()}`);
    onFilterChange?.({
      searchQuery: val,
      selectedWarehouse,
      statusFilter: statusFilter === "with_cargo" ? "active" : statusFilter,
      selectedRoutes,
    });
  };

  const handleWarehouseChange = (val: string) => {
    setSelectedWarehouse(val);
    setFitTrigger(`wh_${val}_${Date.now()}`);
    onFilterChange?.({
      searchQuery,
      selectedWarehouse: val,
      statusFilter: statusFilter === "with_cargo" ? "active" : statusFilter,
      selectedRoutes,
    });
  };

  const handleStatusChange = (val: "all" | "with_cargo" | "empty" | "pending" | "late") => {
    setStatusFilter(val);
    setFitTrigger(`status_${val}_${Date.now()}`);
    onFilterChange?.({
      searchQuery,
      selectedWarehouse,
      statusFilter: val === "with_cargo" ? "active" : val,
      selectedRoutes,
    });
  };

  const handleRoutesChange = (newRoutes: string[]) => {
    setSelectedRoutes(newRoutes);
    setFitTrigger(`routes_${newRoutes.join(",")}_${Date.now()}`);
    onFilterChange?.({
      searchQuery,
      selectedWarehouse,
      statusFilter: statusFilter === "with_cargo" ? "active" : statusFilter,
      selectedRoutes: newRoutes,
    });
  };

  const handleAreaSelectionComplete = (bounds: L.LatLngBounds) => {
    setIsBoxSelecting(false);
    const inside = visibleClients.filter((c) => {
      if (!c.Latitude || !c.Longitude) return false;
      return bounds.contains(L.latLng(c.Latitude, c.Longitude));
    });
    const keys = inside.map((c) => String(c.id || c.ID_Original || c.Cliente));
    setSelectedClientKeys(keys);
  };

  const executeBulkReassignAction = async (items: any[], targetRoute: string) => {
    setIsBulkLoading(true);
    try {
      if (onBulkReassign) {
        await onBulkReassign(
          items.map((c: any) => ({
            clientName: String(c.clientName || c.Cliente || c.Nome_Cliente || c.Doc_ID || ""),
            deliveryId: c.deliveryId !== undefined ? c.deliveryId : (c.id || c.ID_Original),
            address: String(c.address || c.Morada || ""),
            lat: c.lat !== undefined ? Number(c.lat) : (c.Latitude !== undefined ? Number(c.Latitude) : undefined),
            lon: c.lon !== undefined ? Number(c.lon) : (c.Longitude !== undefined ? Number(c.Longitude) : (c.lon !== undefined ? Number(c.lon) : (c.lng !== undefined ? Number(c.lng) : undefined))),
          })),
          targetRoute
        );
      } else if (onMoveClientRoute) {
        for (const s of items) {
          const sLat = s.lat !== undefined ? Number(s.lat) : (s.Latitude !== undefined ? Number(s.Latitude) : undefined);
          const sLon = s.lon !== undefined ? Number(s.lon) : (s.Longitude !== undefined ? Number(s.Longitude) : undefined);
          onMoveClientRoute(s.clientName || s.Cliente || "", targetRoute, s.deliveryId || s.id || s.ID_Original, s.address || s.Morada, sLat, sLon);
        }
      }
      setSelectedClientKeys([]);
    } catch (e: any) {
      alert("Erro ao transferir paragens em massa: " + (e.message || "Erro"));
    } finally {
      setIsBulkLoading(false);
    }
  };

  const requestMoveClientRoute = (
    client: MapClient,
    targetRoute: string,
    dropLat?: number,
    dropLng?: number,
    sourceType: "marker_drag" | "popup_select" = "popup_select"
  ) => {
    const clientName = client.Nome_Cliente || client.Cliente || "Cliente";
    const stopWeight = client.Peso_KG !== undefined && client.Peso_KG !== null ? client.Peso_KG : (client.Carga_Acum || 0);
    const stopVol = client.Volume_m3 !== undefined && client.Volume_m3 !== null ? client.Volume_m3 : (client.Volume_M3 || 0);
    const clientRules = client.Regras || (client as any).regras || (client as any).Restricoes || (client as any).restricoes || "";

    const items = [{
      clientName: client.Cliente || client.Nome_Cliente || "",
      deliveryId: client.id || client.ID_Original,
      address: client.Morada,
      lat: dropLat !== undefined ? dropLat : client.Latitude,
      lon: dropLng !== undefined ? dropLng : client.Longitude,
      weight: stopWeight,
      vol: stopVol,
      rules: clientRules,
    }];

    const violations = checkGuardianViolations(items, targetRoute, fleet, rulesMatrix, vehicleMetricsMap);

    if (violations.length > 0) {
      setGuardianPendingAction({
        items,
        targetRoute,
        violations,
        sourceType,
      });
      return;
    }

    if (onMoveClientRoute) {
      onMoveClientRoute(
        items[0].clientName,
        targetRoute,
        items[0].deliveryId,
        items[0].address,
        items[0].lat,
        items[0].lon
      );
    }
  };

  const handleApplyBulkReassign = async () => {
    if (selectedClientKeys.length === 0) return;
    const selectedStops = visibleClients.filter((c) =>
      selectedClientKeys.includes(String(c.id || c.ID_Original || c.Cliente))
    );
    if (selectedStops.length === 0) return;

    const items = selectedStops.map((c) => ({
      clientName: String(c.Cliente || c.Nome_Cliente || c.Doc_ID || ""),
      deliveryId: c.id || c.ID_Original,
      address: String(c.Morada || ""),
      lat: c.Latitude !== undefined ? Number(c.Latitude) : undefined,
      lon: c.Longitude !== undefined ? Number(c.Longitude) : undefined,
      weight: c.Peso_KG !== undefined ? c.Peso_KG : (c.Carga_Acum || 0),
      vol: c.Volume_m3 !== undefined ? c.Volume_m3 : (c.Volume_M3 || 0),
      rules: c.Regras || (c as any).regras || "",
    }));

    const violations = checkGuardianViolations(items, bulkTargetRoute, fleet, rulesMatrix, vehicleMetricsMap);

    if (violations.length > 0) {
      setGuardianPendingAction({
        items,
        targetRoute: bulkTargetRoute,
        violations,
        sourceType: "bulk_area",
      });
      return;
    }

    await executeBulkReassignAction(items, bulkTargetRoute);
  };

  const handleConfirmGuardianAction = async () => {
    if (!guardianPendingAction) return;
    const { items, targetRoute, sourceType } = guardianPendingAction;
    setGuardianPendingAction(null);

    if (sourceType === "bulk_area") {
      await executeBulkReassignAction(items, targetRoute);
    } else {
      if (onMoveClientRoute && items.length > 0) {
        onMoveClientRoute(
          items[0].clientName,
          targetRoute,
          items[0].deliveryId,
          items[0].address,
          items[0].lat,
          items[0].lon
        );
      }
    }
  };

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Set of warehouses that currently have cargo / assigned routes or deliveries
  const warehousesWithCargo = useMemo(() => {
    const set = new Set<string>();
    clients.forEach(c => {
      const arm = (c.Armazem || (c as any).armazem || "").trim();
      if (arm && arm !== "N/A" && arm !== "None") {
        set.add(arm);
      }
    });
    fleet.forEach(f => {
      const fArm = (f.armazem || (f as any).Armazem || "").trim();
      if (fArm && fArm !== "N/A" && clients.some(c => routesMatch(c.Rota, f.veiculo))) {
        set.add(fArm);
      }
    });
    return set;
  }, [clients, fleet]);

  // Identify the active warehouse that actually has cargo in this distribution
  const activeWarehouse = useMemo(() => {
    if (!warehouses || warehouses.length === 0) return null;

    // 1. Match by warehouse name with cargo
    for (const wh of warehouses) {
      if (!wh.lat || !wh.lon) continue;
      const whNameNorm = (wh.name || "").trim().toLowerCase();
      for (const wCargo of warehousesWithCargo) {
        const cNorm = wCargo.trim().toLowerCase();
        if (cNorm === whNameNorm || whNameNorm.includes(cNorm) || cNorm.includes(whNameNorm)) {
          return wh;
        }
      }
    }

    // 2. Proximity to clients with coordinates (never pick an island if deliveries are on mainland or vice-versa!)
    const validClients = clients.filter(c => Number(c.Latitude) !== 0 && Number(c.Longitude) !== 0);
    if (validClients.length > 0) {
      const avgLat = validClients.reduce((acc, c) => acc + Number(c.Latitude), 0) / validClients.length;
      const avgLon = validClients.reduce((acc, c) => acc + Number(c.Longitude), 0) / validClients.length;
      let closest = warehouses[0];
      let minDist = Infinity;
      warehouses.forEach(w => {
        if (w.lat && w.lon) {
          const dist = Math.hypot(w.lat - avgLat, w.lon - avgLon);
          if (dist < minDist) {
            minDist = dist;
            closest = w;
          }
        }
      });
      if (closest && closest.lat && closest.lon) return closest;
    }

    return warehouses.find(w => w.lat && w.lon) || null;
  }, [warehouses, warehousesWithCargo, clients]);

  const center: [number, number] = useMemo(() => {
    if (activeWarehouse && activeWarehouse.lat && activeWarehouse.lon) {
      return [activeWarehouse.lat, activeWarehouse.lon];
    }
    const validClient = clients.find(c => Number(c.Latitude) !== 0 && Number(c.Longitude) !== 0);
    if (validClient) {
      return [Number(validClient.Latitude), Number(validClient.Longitude)];
    }
    return [38.841, -9.193]; // Default Loures / Grande Lisboa
  }, [activeWarehouse, clients]);

  const initialPoints = useMemo(() => {
    const pts: [number, number][] = [];
    if (activeWarehouse && activeWarehouse.lat && activeWarehouse.lon) {
      pts.push([activeWarehouse.lat, activeWarehouse.lon]);
    }
    clients.forEach(c => {
      const lat = Number(c.Latitude);
      const lon = Number(c.Longitude);
      if (lat !== 0 && lon !== 0 && !isNaN(lat) && !isNaN(lon)) {
        pts.push([lat, lon]);
      }
    });
    return pts;
  }, [activeWarehouse, clients]);

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
          .filter(c => routesMatch(c.Rota, rName) && Number(c.Latitude) !== 0 && Number(c.Longitude) !== 0)
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

        const vCfg = fleet.find((f: any) => routesMatch(f.veiculo, rName));
        const regVal = vCfg?.regresso_armazem ?? (stops[0] as any)?.Regresso_Armazem ?? "Sim";
        const returnsToDepot = !["não", "nao", "false", "0", "no"].includes(String(regVal).trim().toLowerCase());

        if (originWh && returnsToDepot) {
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
  }, [clients, warehouses, isMounted, fleet]);

  // Helper: check if a vehicle belongs to target warehouse
  const isVehicleInWarehouse = (v: string, targetWh: string): boolean => {
    if (!targetWh || targetWh === "all") return true;
    const selWh = targetWh.toLowerCase().trim();

    // A. Check from fleet configuration
    const vData = fleet.find((f: any) => (f.veiculo || "").trim().toLowerCase() === v.trim().toLowerCase());
    if (vData && vData.armazem) {
      const vWh = vData.armazem.trim().toLowerCase();
      return vWh === selWh || selWh.includes(vWh) || vWh.includes(selWh);
    }

    // B. Check if vehicle name or prefix matches (e.g. "Portimão_3" vs "Auchan Portimão")
    const vClean = v.toLowerCase().trim();
    const vPrefix = (v.includes("_") ? v.split("_")[0] : v).trim().toLowerCase();
    if (selWh.includes(vClean) || vClean.includes(selWh)) return true;
    if (vPrefix.length >= 3 && (selWh.includes(vPrefix) || vPrefix.includes(selWh))) return true;

    // C. Check if clients on this route have this warehouse
    const routeClients = clients.filter(c => routesMatch(c.Rota, v));
    if (routeClients.length > 0) {
      return routeClients.some(c => {
        const cWh = (c.Armazem || "").trim().toLowerCase();
        return cWh === selWh || (cWh.length >= 3 && selWh.includes(cWh));
      });
    }

    return false;
  };

  // Helper: check if a client belongs to target warehouse
  const isClientInWarehouse = (c: MapClient, targetWh: string): boolean => {
    if (!targetWh || targetWh === "all") return true;
    const selWh = targetWh.toLowerCase().trim();
    const cWh = (c.Armazem || "").trim().toLowerCase();

    // If client has explicit warehouse
    if (cWh && cWh !== "n/a" && cWh !== "armazém principal" && cWh !== "base central") {
      if (cWh === selWh || selWh.includes(cWh) || cWh.includes(selWh)) return true;
      return false;
    }

    // If assigned to a vehicle, check vehicle's warehouse
    if (!isPendingRoute(c.Rota)) {
      return isVehicleInWarehouse(c.Rota, targetWh);
    }

    return true;
  };


  // Extract unique warehouses (Apenas os armazéns que têm carga por defeito)
  const warehouseOptions = useMemo(() => {
    if (statusFilter === "with_cargo" && warehousesWithCargo.size > 0) {
      return Array.from(warehousesWithCargo);
    }
    const set = new Set<string>();
    warehouses.forEach(w => {
      if (w.name) set.add(w.name);
    });
    clients.forEach(c => {
      if (c.Armazem && c.Armazem !== "N/A") set.add(c.Armazem);
    });
    fleet.forEach(f => {
      if (f.armazem && f.armazem !== "N/A") set.add(f.armazem);
    });
    return Array.from(set);
  }, [warehouses, clients, fleet, statusFilter, warehousesWithCargo]);

  // List of vehicles scoped to the currently selected warehouse, dynamically including all routes present in clients
  const warehouseVehicles = useMemo(() => {
    const list: string[] = [...vehicles.filter(v => !isPendingRoute(v))];
    clients.forEach(c => {
      if (c.Rota && !isPendingRoute(c.Rota)) {
        const found = list.some(v => routesMatch(v, c.Rota));
        if (!found) {
          list.push(c.Rota);
        }
      }
    });
    return list.filter(v => isVehicleInWarehouse(v, selectedWarehouse));
  }, [vehicles, selectedWarehouse, fleet, clients]);

  // Vehicle stats for badges (accurately scoped to selected warehouse with normalized matching!)
  const { totalVehiclesCount, activeVehiclesCount, emptyVehiclesCount, pendingStopsCount } = useMemo(() => {
    const vList = warehouseVehicles;
    const withCargo = vList.filter(v => clients.some(c => routesMatch(c.Rota, v))).length;
    const empty = Math.max(0, vList.length - withCargo);
    const pending = clients.filter(c => isPendingRoute(c.Rota) && isClientInWarehouse(c, selectedWarehouse)).length;
    return {
      totalVehiclesCount: vList.length,
      activeVehiclesCount: withCargo,
      emptyVehiclesCount: empty,
      pendingStopsCount: pending
    };
  }, [warehouseVehicles, clients, selectedWarehouse]);

  // Deteção Automática e Clustering de Zonas Territoriais ("Dividir para Conquistar")
  const territorialZones = useMemo<TerritorialZone[]>(() => {
    const vehicleDataMap = new Map<string, {
      dominantLocality: string;
      stopsCount: number;
      totalKg: number;
      latSum: number;
      lonSum: number;
      coordsCount: number;
      minLat: number;
      maxLat: number;
      minLon: number;
      maxLon: number;
    }>();

    warehouseVehicles.forEach((v) => {
      const vClients = clients.filter(c => routesMatch(c.Rota, v));
      if (vClients.length === 0) return;

      const locCounts: Record<string, number> = {};
      let latSum = 0;
      let lonSum = 0;
      let coordsCount = 0;
      let totalKg = 0;
      let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;

      vClients.forEach(c => {
        totalKg += Number(c.Peso_KG) || 0;
        const norm = normalizeLocality(c.Localidade, c.CP);
        locCounts[norm] = (locCounts[norm] || 0) + 1;

        if (c.Latitude && c.Longitude && c.Latitude !== 0 && c.Longitude !== 0) {
          latSum += c.Latitude;
          lonSum += c.Longitude;
          coordsCount++;
          if (c.Latitude < minLat) minLat = c.Latitude;
          if (c.Latitude > maxLat) maxLat = c.Latitude;
          if (c.Longitude < minLon) minLon = c.Longitude;
          if (c.Longitude > maxLon) maxLon = c.Longitude;
        }
      });

      let dominant = "GERAL";
      let maxCount = -1;
      Object.entries(locCounts).forEach(([loc, cnt]) => {
        if (cnt > maxCount) {
          maxCount = cnt;
          dominant = loc;
        }
      });

      vehicleDataMap.set(v, {
        dominantLocality: dominant,
        stopsCount: vClients.length,
        totalKg: Math.round(totalKg),
        latSum,
        lonSum,
        coordsCount,
        minLat: coordsCount > 0 ? minLat : 38.7,
        maxLat: coordsCount > 0 ? maxLat : 38.8,
        minLon: coordsCount > 0 ? minLon : -9.2,
        maxLon: coordsCount > 0 ? maxLon : -9.1,
      });
    });

    if (vehicleDataMap.size === 0) return [];

    const groups = new Map<string, {
      name: string;
      vehicles: string[];
      stopsCount: number;
      totalKg: number;
      latSum: number;
      lonSum: number;
      coordsCount: number;
      minLat: number;
      maxLat: number;
      minLon: number;
      maxLon: number;
    }>();

    vehicleDataMap.forEach((vData, vName) => {
      const locKey = vData.dominantLocality;
      const existing = groups.get(locKey);
      if (existing) {
        existing.vehicles.push(vName);
        existing.stopsCount += vData.stopsCount;
        existing.totalKg += vData.totalKg;
        existing.latSum += vData.latSum;
        existing.lonSum += vData.lonSum;
        existing.coordsCount += vData.coordsCount;
        existing.minLat = Math.min(existing.minLat, vData.minLat);
        existing.maxLat = Math.max(existing.maxLat, vData.maxLat);
        existing.minLon = Math.min(existing.minLon, vData.minLon);
        existing.maxLon = Math.max(existing.maxLon, vData.maxLon);
      } else {
        const displayName = locKey === "GERAL" 
          ? "Geral / Mista" 
          : `Zona ${locKey.charAt(0) + locKey.slice(1).toLowerCase()}`;
        groups.set(locKey, {
          name: displayName,
          vehicles: [vName],
          stopsCount: vData.stopsCount,
          totalKg: vData.totalKg,
          latSum: vData.latSum,
          lonSum: vData.lonSum,
          coordsCount: vData.coordsCount,
          minLat: vData.minLat,
          maxLat: vData.maxLat,
          minLon: vData.minLon,
          maxLon: vData.maxLon,
        });
      }
    });

    const zones: TerritorialZone[] = [];
    groups.forEach((grp, key) => {
      const cLat = grp.coordsCount > 0 ? grp.latSum / grp.coordsCount : 38.74;
      const cLon = grp.coordsCount > 0 ? grp.lonSum / grp.coordsCount : -9.16;
      const padLat = Math.max(0.015, (grp.maxLat - grp.minLat) * 0.1);
      const padLon = Math.max(0.015, (grp.maxLon - grp.minLon) * 0.1);

      zones.push({
        id: `zone_${key.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
        name: grp.name,
        dominantLocality: key,
        vehicles: grp.vehicles,
        stopsCount: grp.stopsCount,
        totalKg: grp.totalKg,
        centerLat: cLat,
        centerLon: cLon,
        bounds: [
          [grp.minLat - padLat, grp.minLon - padLon],
          [grp.maxLat + padLat, grp.maxLon + padLon]
        ],
      });
    });

    return zones.sort((a, b) => b.stopsCount - a.stopsCount);
  }, [warehouseVehicles, clients]);

  const handleSelectZone = (zoneId: string) => {
    setSelectedZoneId(zoneId);
    if (zoneId === "all") {
      setFitTrigger(`zone_all_${Date.now()}`);
    } else {
      setFitTrigger(`zone_${zoneId}_${Date.now()}`);
    }
  };

  const toggleValidateZone = (zoneId: string) => {
    setValidatedZones(prev => {
      const updated = { ...prev, [zoneId]: !prev[zoneId] };
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("georoute_validated_zones", JSON.stringify(updated));
        } catch (e) {}
      }
      return updated;
    });
  };

  // Comprehensive Vehicle Metrics Map (paragens, peso, volume, km, horários e alertas de excesso)
  const vehicleMetricsMap = useMemo<Record<string, {
    vehicle: string;
    count: number;
    maxStops: number;
    totalKg: number;
    capKg: number;
    totalVol: number;
    capVol: number;
    totalRouteKm: number;
    startTime: string;
    returnArrivalTime: string;
    shiftEndTime: string;
    isOverStops: boolean;
    isOverWeight: boolean;
    isOverVol: boolean;
    isOverTime: boolean;
    hasErrors: boolean;
  }>>(() => {
    const result: Record<string, any> = {};

    warehouseVehicles.forEach((v) => {
      const vClients = clients.filter((c) => routesMatch(c.Rota, v));
      const count = vClients.length;
      const totalKg = Math.round(vClients.reduce((sum, c) => sum + (Number(c.Peso_KG) || 0), 0));
      const totalVol = Number(
        vClients.reduce((sum, c) => sum + (Number(c.Volume_m3 !== undefined ? c.Volume_m3 : c.Volume_M3) || 0), 0).toFixed(2)
      );

      const vConfig = fleet.find((f: any) => routesMatch(f.veiculo, v));
      const maxStops = Number(vConfig?.max_entregas) || 0;
      const capKg = Number(vConfig?.capacidade_kg) || 0;
      const capVol = Number(vConfig?.capacidade_vol) || 0;
      const startTimeStr = (vConfig?.horario_inicio || "08:00").slice(0, 5);
      const shiftEndStr = (vConfig?.horario_fim || "18:00").slice(0, 5);
      const speed = Number(vConfig?.velocidade_media) || 50.0;

      const sortedStops = [...vClients].sort((a, b) => (Number(a.Ordem) || 0) - (Number(b.Ordem) || 0));
      let totalRouteKm = 0.0;
      let returnArrivalTimeStr = startTimeStr;

      const regressoVal = vConfig?.regresso_armazem ?? (vClients[0] as any)?.Regresso_Armazem ?? "Sim";
      const returnsToDepot = !["não", "nao", "false", "0", "no"].includes(String(regressoVal).trim().toLowerCase());

      if (sortedStops.length > 0) {
        const lastStop = sortedStops[sortedStops.length - 1];
        if (returnsToDepot) {
          const whName = lastStop.Armazem || vConfig?.armazem;
          const whObj = warehouses.find((w) => w.name === whName) || warehouses[0];
          let returnDist = 0.0;
          if (whObj && lastStop.Latitude && lastStop.Longitude && whObj.lat && whObj.lon) {
            returnDist = haversineDistance(lastStop.Latitude, lastStop.Longitude, whObj.lat, whObj.lon);
          }
          totalRouteKm = (Number(lastStop.Dist_Acum) || 0) + returnDist;
          const returnTravelMin = (returnDist / speed) * 60.0;
          returnArrivalTimeStr = addMinutesToTime(lastStop.Saida || lastStop.Chegada || "12:00", returnTravelMin);
        } else {
          totalRouteKm = Number(lastStop.Dist_Acum) || 0;
          returnArrivalTimeStr = lastStop.Saida || lastStop.Chegada || startTimeStr;
        }
      }

      const isOverStops = count > 0 && maxStops > 0 && count > maxStops;
      const isOverWeight = count > 0 && capKg > 0 && totalKg > capKg;
      const isOverVol = count > 0 && capVol > 0 && totalVol > capVol;
      const isOverTime = count > 0 && shiftEndStr !== "" && parseTimeToMinutes(returnArrivalTimeStr) > parseTimeToMinutes(shiftEndStr);

      result[v] = {
        vehicle: v,
        count,
        maxStops,
        totalKg,
        capKg,
        totalVol,
        capVol,
        totalRouteKm: Number(totalRouteKm.toFixed(1)),
        startTime: startTimeStr,
        returnArrivalTime: returnArrivalTimeStr,
        shiftEndTime: shiftEndStr,
        isOverStops,
        isOverWeight,
        isOverVol,
        isOverTime,
        hasErrors: isOverStops || isOverWeight || isOverVol || isOverTime,
      };
    });

    return result;
  }, [warehouseVehicles, clients, fleet, warehouses]);

  // Filtered and Sorted vehicles list based on active warehouse, status filter & selected sort column
  const filteredVehiclesList = useMemo(() => {
    let list = [...warehouseVehicles];

    // Status Filter
    if (statusFilter === "with_cargo") {
      list = list.filter((v) => (vehicleMetricsMap[v]?.count || 0) > 0);
    } else if (statusFilter === "empty") {
      list = list.filter((v) => (vehicleMetricsMap[v]?.count || 0) === 0);
    } else if (statusFilter === "pending") {
      list = []; // In pending status, only pending chip is shown
    }

    // Territorial Zone Focus Filter
    if (selectedZoneId !== "all") {
      const activeZone = territorialZones.find(z => z.id === selectedZoneId);
      if (activeZone) {
        list = list.filter((v) => activeZone.vehicles.some(zv => routesMatch(zv, v)));
      }
    }

    // Dynamic Column Sorting
    return list.sort((a, b) => {
      const mA = vehicleMetricsMap[a];
      const mB = vehicleMetricsMap[b];

      let comp = 0;
      if (routeSortField === "stops") {
        comp = (mA?.count || 0) - (mB?.count || 0);
      } else if (routeSortField === "weight") {
        comp = (mA?.totalKg || 0) - (mB?.totalKg || 0);
      } else if (routeSortField === "vol") {
        comp = (mA?.totalVol || 0) - (mB?.totalVol || 0);
      } else if (routeSortField === "km") {
        comp = (mA?.totalRouteKm || 0) - (mB?.totalRouteKm || 0);
      } else {
        // "name" default: vehicles with cargo first, then alphabetical
        const countA = mA?.count || 0;
        const countB = mB?.count || 0;
        const hasA = countA > 0;
        const hasB = countB > 0;
        if (hasA && !hasB) return -1;
        if (!hasA && hasB) return 1;
        comp = a.localeCompare(b, "pt", { numeric: true, sensitivity: "base" });
      }

      return routeSortAsc ? comp : -comp;
    });
  }, [warehouseVehicles, statusFilter, selectedZoneId, territorialZones, vehicleMetricsMap, routeSortField, routeSortAsc]);

  // Table Totals Summary
  const tableTotals = useMemo(() => {
    let stops = 0;
    let kg = 0;
    let vol = 0;
    let km = 0;
    let vehiclesWithCargo = 0;
    let vehiclesWithErrors = 0;

    filteredVehiclesList.forEach((v) => {
      const m = vehicleMetricsMap[v];
      if (m) {
        if (m.count > 0) vehiclesWithCargo++;
        if (m.hasErrors) vehiclesWithErrors++;
        stops += m.count;
        kg += m.totalKg;
        vol += m.totalVol;
        km += m.totalRouteKm;
      }
    });

    return {
      stops,
      kg,
      vol: Number(vol.toFixed(2)),
      km: Number(km.toFixed(1)),
      vehiclesWithCargo,
      vehiclesWithErrors,
    };
  }, [filteredVehiclesList, vehicleMetricsMap]);

  // Filter visible clients
  const visibleClients = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return clients.filter(c => {
      if (c.Latitude === 0 || c.Longitude === 0) return false;

      // 1. Text Search
      if (q) {
        const matchCode = String(c.Cliente || "").toLowerCase().includes(q);
        const matchName = String(c.Nome_Cliente || "").toLowerCase().includes(q);
        const matchAddr = String(c.Morada || "").toLowerCase().includes(q);
        const matchCP = String(c.CP || "").toLowerCase().includes(q);
        const matchLoc = String(c.Localidade || "").toLowerCase().includes(q);
        const matchRoute = String(c.Rota || "").toLowerCase().includes(q);
        const matchVendedor = String(c.Vendedor || c.vendedor || "").toLowerCase().includes(q);
        if (!matchCode && !matchName && !matchAddr && !matchCP && !matchLoc && !matchRoute && !matchVendedor) {
          return false;
        }
      }

      // 2. Warehouse Filter (Strict & Synchronized)
      if (!isClientInWarehouse(c, selectedWarehouse)) {
        return false;
      }

      // 2.5 Territorial Zone Focus Filter
      if (selectedZoneId !== "all") {
        const activeZone = territorialZones.find(z => z.id === selectedZoneId);
        if (activeZone) {
          const isPending = isPendingRoute(c.Rota);
          if (isPending) {
            const cNorm = normalizeLocality(c.Localidade, c.CP);
            if (cNorm !== activeZone.dominantLocality && activeZone.dominantLocality !== "GERAL") {
              return false;
            }
          } else {
            const inZone = activeZone.vehicles.some(zv => routesMatch(zv, c.Rota));
            if (!inZone) return false;
          }
        }
      }

      // 3 & 4. Status Filter & Route Selection (Explicit selection takes absolute priority)
      const isPending = isPendingRoute(c.Rota);
      if (selectedRoutes.length > 0) {
        if (isPending) {
          return selectedRoutes.some(sel => routesMatch(sel, "Por Distribuir"));
        }
        return selectedRoutes.some(sel => routesMatch(sel, c.Rota));
      }

      // If no explicit route is selected, apply general statusFilter
      if (statusFilter === "pending" && !isPending) return false;
      if (statusFilter === "with_cargo" && isPending) return false;
      if (statusFilter === "empty" && isPending) return false;
      return true;
    });
  }, [clients, searchQuery, selectedWarehouse, statusFilter, selectedZoneId, territorialZones, selectedRoutes, fleet]);

  // Scoped routes set for strictly cleaning road geometry polylines
  const visibleRouteNames = useMemo(() => {
    return new Set(visibleClients.map(c => c.Rota));
  }, [visibleClients]);

  // Bulk Selected Stops Metrics
  const { selectedStopsTotalKg, selectedStopsTotalVol } = useMemo(() => {
    const selectedStops = visibleClients.filter(c =>
      selectedClientKeys.includes(String(c.id || c.ID_Original || c.Cliente))
    );
    let kg = 0;
    let vol = 0;
    selectedStops.forEach(s => {
      kg += s.Peso_KG || s.Carga_Acum || 0;
      vol += s.Volume_m3 || s.Volume_M3 || 0.1;
    });
    return { selectedStopsTotalKg: Math.round(kg), selectedStopsTotalVol: vol };
  }, [visibleClients, selectedClientKeys]);

  // Map of client count and kg per vehicle for selects and labels
  const vehicleStatsMap = useMemo(() => {
    const map: Record<string, { count: number; kg: number }> = {};
    vehicles.forEach((v) => {
      map[v] = { count: 0, kg: 0 };
    });
    let pendingCount = 0;
    let pendingKg = 0;

    clients.forEach((c) => {
      if (isPendingRoute(c.Rota)) {
        pendingCount++;
        pendingKg += Number(c.Peso_KG || 0);
      } else {
        const matched = vehicles.find((v) => routesMatch(v, c.Rota));
        if (matched) {
          if (!map[matched]) map[matched] = { count: 0, kg: 0 };
          map[matched].count++;
          map[matched].kg += Number(c.Peso_KG || 0);
        }
      }
    });

    return { map, pendingCount, pendingKg: Math.round(pendingKg) };
  }, [clients, vehicles]);

  // Points for auto fit bounds (focuses directly on active route stops when single route selected)
  const visiblePoints: [number, number][] = useMemo(() => {
    const pts: [number, number][] = [];
    if (selectedRoutes.length === 0) {
      warehouses.forEach(w => {
        if (w.lat && w.lon) pts.push([w.lat, w.lon]);
      });
    }
    visibleClients.forEach(c => {
      pts.push([c.Latitude, c.Longitude]);
    });
    if (pts.length === 0) {
      warehouses.forEach(w => {
        if (w.lat && w.lon) pts.push([w.lat, w.lon]);
      });
    }
    return pts;
  }, [warehouses, visibleClients, selectedRoutes]);

  const handleFitAll = () => {
    setFitTrigger(Date.now().toString());
  };

  const toggleRouteFilter = (v: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (routesMatch(v, "Por Distribuir")) {
      if (statusFilter === "with_cargo" || statusFilter === "empty") {
        handleStatusChange("all");
      }
    }
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (selectedRoutes.some(r => routesMatch(r, v))) {
        const next = selectedRoutes.filter(r => !routesMatch(r, v));
        handleRoutesChange(next);
      } else {
        handleRoutesChange([...selectedRoutes, v]);
      }
    } else {
      if (selectedRoutes.length === 1 && routesMatch(selectedRoutes[0], v)) {
        handleRoutesChange([]); // Reset to all
      } else {
        handleRoutesChange([v]); // Select only this one
      }
    }
  };

  if (!isMounted) {
    return (
      <div className="w-full h-full rounded-2xl border border-zinc-800 bg-zinc-950 flex items-center justify-center text-zinc-300 text-xs font-mono">
        A carregar mapa interativo...
      </div>
    );
  }

  return (
    <div className="w-full h-full rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl relative z-10">
      
      {/* TOP ATTACHED CONTROL BAR (GLUED TO TOP EDGE) */}
      <div className="absolute top-0 left-0 right-0 z-[1001] w-full bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 shadow-md pointer-events-auto flex flex-wrap items-center justify-between gap-2">
          
          {/* Left: Search input, Warehouse dropdown & Status pills */}
          <div className="flex items-center flex-wrap gap-2">
            {/* Search Input */}
            <div className="relative min-w-[220px] max-w-xs">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-xs">🔍</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Pesquisar cliente, código, morada, CP..."
                className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-600 focus:border-indigo-500 rounded-xl pl-8 pr-7 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => handleSearchChange("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xs font-bold"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Warehouse Filter */}
            {warehouseOptions.length > 0 && (
              <select
                value={selectedWarehouse}
                onChange={(e) => handleWarehouseChange(e.target.value)}
                className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-600 focus:border-indigo-500 rounded-xl px-3 py-1.5 text-xs text-zinc-800 dark:text-zinc-200 outline-none cursor-pointer font-medium shadow-sm"
              >
                <option value="all">🏠 Todos os Armazéns ({warehouseOptions.length})</option>
                {warehouseOptions.map((wh) => (
                  <option key={wh} value={wh}>
                    🏠 {wh}
                  </option>
                ))}
              </select>
            )}

            {/* Status Segmented Pills Filter */}
            <div className="flex items-center bg-zinc-100 dark:bg-zinc-900 p-0.5 rounded-xl border border-zinc-300 dark:border-zinc-800 text-[11px] font-semibold">
              <button
                onClick={() => handleStatusChange("all")}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  statusFilter === "all"
                    ? "bg-indigo-600 text-white shadow-sm font-bold"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                }`}
              >
                Todos ({totalVehiclesCount})
              </button>
              <button
                onClick={() => handleStatusChange("with_cargo")}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer flex items-center space-x-1 ${
                  statusFilter === "with_cargo"
                    ? "bg-emerald-600 text-white shadow-sm font-bold"
                    : "text-emerald-700 dark:text-emerald-400 hover:text-emerald-800"
                }`}
              >
                <span>🚚 Com Carga ({activeVehiclesCount})</span>
              </button>
              <button
                onClick={() => handleStatusChange("empty")}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer flex items-center space-x-1 ${
                  statusFilter === "empty"
                    ? "bg-zinc-700 text-white shadow-sm font-bold"
                    : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700"
                }`}
              >
                <span>🌙 Vazias ({emptyVehiclesCount})</span>
              </button>
              {pendingStopsCount > 0 && (
                <button
                  onClick={() => handleStatusChange("pending")}
                  className={`px-3 py-1 rounded-lg transition-all cursor-pointer flex items-center space-x-1 ${
                    statusFilter === "pending"
                      ? "bg-amber-600 text-white shadow-sm font-bold"
                      : "text-amber-600 dark:text-amber-400 hover:text-amber-700"
                  }`}
                >
                  <span>⚠️ Por Distribuir ({pendingStopsCount})</span>
                </button>
              )}
            </div>
          </div>

          {/* Right: Actions (Area Selection, Layer Switcher, Fit Bounds & Toggle Roads) */}
          <div className="flex items-center space-x-2">
            {/* Box / Area Selection Button */}
            <button
              onClick={() => {
                setIsBoxSelecting(!isBoxSelecting);
                if (!isBoxSelecting) setSelectedClientKeys([]);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer shadow-sm ${
                isBoxSelecting
                  ? "bg-amber-600 text-white ring-2 ring-amber-400 animate-pulse"
                  : selectedClientKeys.length > 0
                  ? "bg-indigo-600 text-white"
                  : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700"
              }`}
              title={isBoxSelecting ? "Modo de seleção ativo: clique e arraste no mapa para desenhar um retângulo" : "Desenhar área com o rato para selecionar e transferir paragens"}
            >
              <span>{isBoxSelecting ? "✏️ A Desenhar..." : "🔲 Selecionar Área"}</span>
            </button>
            {/* Google Layer Switcher */}
            <div className="flex items-center space-x-1 bg-zinc-100 dark:bg-zinc-900 p-0.5 rounded-xl border border-zinc-300 dark:border-zinc-800 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setMapLayer("standard")}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  mapLayer === "standard"
                    ? "bg-indigo-600 text-white shadow-sm font-bold"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                }`}
                title="Mapa Padrão Vetor"
              >
                🗺️ Mapa
              </button>
              <button
                type="button"
                onClick={() => setMapLayer("google_sat")}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  mapLayer === "google_sat"
                    ? "bg-indigo-600 text-white shadow-sm font-bold"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                }`}
                title="Google Satélite de alta resolução (Custo Zero)"
              >
                🛰️ Satélite
              </button>
              <button
                type="button"
                onClick={() => setMapLayer("google_hybrid")}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  mapLayer === "google_hybrid"
                    ? "bg-indigo-600 text-white shadow-sm font-bold"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                }`}
                title="Google Híbrido com nomes de ruas e estradas (Custo Zero)"
              >
                🏙️ Híbrido
              </button>
            </div>
            <button
              onClick={() => setShowRoads(!showRoads)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer flex items-center space-x-1.5 shadow-sm ${
                showRoads
                  ? "bg-indigo-50 dark:bg-indigo-950/80 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 font-bold"
                  : "bg-zinc-100 dark:bg-zinc-900 border-zinc-300 dark:border-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
              }`}
              title="Ligar/Desligar traçados de estrada reais"
            >
              <span>🛣️ Traçados</span>
            </button>

            <button
              onClick={handleFitAll}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-md cursor-pointer transition-all flex items-center space-x-1"
              title="Enquadrar todas as paragens visíveis no ecrã"
            >
              <span>🎯 Enquadrar</span>
            </button>
          </div>
        </div>

      {/* LEFT-SIDE VERTICAL VEHICLE ROUTES PANEL / TABLE */}
      <div className="absolute left-3 top-14 bottom-4 z-[1000] pointer-events-none flex flex-col justify-start">
        {isRoutesPanelOpen ? (
          <div className="pointer-events-auto w-84 sm:w-96 md:w-[410px] max-h-[calc(100vh-130px)] flex flex-col bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden transition-all duration-200">
            {/* Panel Header */}
            <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-900/90 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-sm">🚚</span>
                <div>
                  <div className="flex items-center space-x-1.5">
                    <h3 className="text-xs font-black text-zinc-800 dark:text-zinc-100 tracking-tight">Tabela de Viaturas</h3>
                    {tableTotals.vehiclesWithErrors > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/50 animate-pulse" title="Viaturas com limites de capacidade, entregas ou horário ultrapassados">
                        ⚠️ {tableTotals.vehiclesWithErrors} alerta(s)
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">
                    {activeVehiclesCount} ativas · {emptyVehiclesCount} vazias
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsRoutesPanelOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-all cursor-pointer font-bold text-xs"
                title="Colapsar tabela"
              >
                ◀
              </button>
            </div>

            {/* Quick Actions & Special Filters */}
            <div className="p-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100/50 dark:bg-zinc-900/50 space-y-1.5">
              {/* Seletor de Foco por Zona Territorial (Dividir para Conquistar) */}
              {territorialZones.length > 0 && (
                <div className="bg-white dark:bg-zinc-900 p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs space-y-1">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center space-x-1">
                      <span>🗺️</span>
                      <span>Foco por Território / Zona</span>
                    </span>
                    {selectedZoneId !== "all" && (
                      <button
                        onClick={() => handleSelectZone("all")}
                        className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer"
                        title="Ver todas as zonas"
                      >
                        ✕ Limpar Foco
                      </button>
                    )}
                  </div>

                  <div className="flex items-center space-x-1.5">
                    <select
                      value={selectedZoneId}
                      onChange={(e) => handleSelectZone(e.target.value)}
                      className="flex-1 bg-zinc-50 dark:bg-zinc-850 border border-zinc-300 dark:border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-800 dark:text-zinc-100 font-bold outline-none cursor-pointer"
                    >
                      <option value="all">🌐 Todas as Zonas ({activeVehiclesCount} viaturas)</option>
                      {territorialZones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {validatedZones[z.id] ? "✅ " : "📍 "}
                          {z.name} ({z.vehicles.length} vts · {z.stopsCount}p · {z.totalKg.toLocaleString()}kg)
                        </option>
                      ))}
                    </select>

                    {selectedZoneId !== "all" && (
                      <button
                        type="button"
                        onClick={() => toggleValidateZone(selectedZoneId)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer shrink-0 ${
                          validatedZones[selectedZoneId]
                            ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/50"
                            : "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700"
                        }`}
                        title={validatedZones[selectedZoneId] ? "Zona Fechada e Validada" : "Marcar zona como afinada e validada"}
                      >
                        {validatedZones[selectedZoneId] ? "Validada ✅" : "Validar ✅"}
                      </button>
                    )}

                    {onOpenBigPicture && (
                      <button
                        type="button"
                        onClick={() => onOpenBigPicture(selectedZoneId !== "all" ? selectedZoneId : undefined)}
                        className="px-2 py-1 rounded-lg text-[10px] font-bold border border-indigo-500/40 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors cursor-pointer flex items-center space-x-1 shrink-0"
                        title="Ver diagnóstico executivo Big Picture para esta zona ou geral"
                      >
                        <span>📊</span>
                        <span>Big Picture {selectedZoneId !== "all" ? "da Zona" : "Geral"}</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
              {(() => {
                const totalGeocoded = clients.filter(c => Number(c.Latitude) !== 0 && Number(c.Longitude) !== 0).length;
                const isAllSelected = selectedRoutes.length === 0;
                return (
                  <button
                    onClick={() => handleRoutesChange([])}
                    className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-between cursor-pointer border ${
                      isAllSelected
                        ? "bg-indigo-600 text-white border-indigo-500 shadow-sm ring-1 ring-indigo-400"
                        : "bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-850"
                    }`}
                  >
                    <span className="flex items-center space-x-1.5">
                      <span>✨</span>
                      <span>Todas as Rotas</span>
                    </span>
                    <span className={`text-[10px] font-mono font-black px-1.5 py-0.5 rounded ${
                      isAllSelected ? "bg-white/20 text-white" : "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                    }`}>
                      {totalGeocoded} / {clients.length}
                    </span>
                  </button>
                );
              })()}

              {/* Re-optimize Selected Subset Button in Sidebar */}
              {selectedRoutes.length >= 2 && onReoptimizeSubset && (
                <button
                  onClick={() => onReoptimizeSubset(selectedRoutes)}
                  className="w-full px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-md shadow-indigo-500/20 flex items-center justify-center space-x-2 cursor-pointer transition-all animate-in fade-in"
                  title="Re-planear e otimizar conjuntamente as rotas selecionadas"
                >
                  <svg className="w-3.5 h-3.5 text-amber-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                  <span>✨ Re-otimizar Seleção ({selectedRoutes.length})</span>
                </button>
              )}

              {/* Por Distribuir Option */}
              {(() => {
                const pendingStops = clients.filter(c => isPendingRoute(c.Rota));
                const pendingCount = pendingStops.length;
                if (pendingCount === 0) return null;
                const isSelected = selectedRoutes.length === 0 || selectedRoutes.some(r => routesMatch(r, "Por Distribuir"));
                const isExclusive = selectedRoutes.length === 1 && routesMatch(selectedRoutes[0], "Por Distribuir");
                const isMultiSelected = selectedRoutes.length > 1 && selectedRoutes.some(r => routesMatch(r, "Por Distribuir"));
                const isPendingActive = isExclusive || isMultiSelected;

                return (
                  <button
                    onClick={(e) => toggleRouteFilter("Por Distribuir", e)}
                    className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-between cursor-pointer border ${
                      isPendingActive
                        ? "bg-amber-600 text-white border-amber-500 shadow-sm ring-1 ring-amber-400"
                        : isSelected
                        ? "bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-300 border-amber-500/40"
                        : "bg-white dark:bg-zinc-900 text-zinc-400 border-zinc-200 dark:border-zinc-800 opacity-60 hover:opacity-100"
                    }`}
                  >
                    <span className="flex items-center space-x-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                      <span>⚠️ Por Distribuir</span>
                    </span>
                    <span
                      style={isPendingActive ? { backgroundColor: "#ffffff", color: "#78350f", borderColor: "#ffffff" } : undefined}
                      className={`text-[10px] font-mono font-black px-1.5 py-0.5 rounded border ${
                        isPendingActive
                          ? "badge-pill-contrast bg-white text-amber-950 border-white shadow-xs"
                          : "bg-amber-500/20 text-amber-800 dark:text-amber-200 border-amber-500/30"
                      }`}
                    >
                      {pendingCount}
                    </span>
                  </button>
                );
              })()}
            </div>

            {/* Compact Table Header (Clickable for Sorting) */}
            <div className="px-2 py-1.5 bg-zinc-100/90 dark:bg-zinc-900/90 border-b border-zinc-200 dark:border-zinc-800 grid grid-cols-12 gap-1 items-center text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider select-none">
              <div
                onClick={() => handleSortRoutes("name")}
                className="col-span-4 flex items-center space-x-1 cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                title="Ordenar por nome da viatura"
              >
                <span>Viatura</span>
                {routeSortField === "name" && <span className="text-indigo-600 dark:text-indigo-400">{routeSortAsc ? "▲" : "▼"}</span>}
              </div>
              <div
                onClick={() => handleSortRoutes("stops")}
                className="col-span-2 text-center cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                title="Ordenar por número de paragens"
              >
                <span>Par.</span>
                {routeSortField === "stops" && <span className="text-indigo-600 dark:text-indigo-400">{routeSortAsc ? "▲" : "▼"}</span>}
              </div>
              <div
                onClick={() => handleSortRoutes("weight")}
                className="col-span-2 text-right cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                title="Ordenar por peso em kg"
              >
                <span>Kg</span>
                {routeSortField === "weight" && <span className="text-indigo-600 dark:text-indigo-400">{routeSortAsc ? "▲" : "▼"}</span>}
              </div>
              <div
                onClick={() => handleSortRoutes("vol")}
                className="col-span-2 text-right cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                title="Ordenar por volume em m³"
              >
                <span>M³</span>
                {routeSortField === "vol" && <span className="text-indigo-600 dark:text-indigo-400">{routeSortAsc ? "▲" : "▼"}</span>}
              </div>
              <div
                onClick={() => handleSortRoutes("km")}
                className="col-span-2 text-right cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                title="Ordenar por km estimados / horário de fim"
              >
                <span>KM/Fim</span>
                {routeSortField === "km" && <span className="text-indigo-600 dark:text-indigo-400">{routeSortAsc ? "▲" : "▼"}</span>}
              </div>
            </div>

            {/* Compact Table Body - Scrollable */}
            <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-900/60 p-1 space-y-0.5">
              {filteredVehiclesList.map((v) => {
                const routeColor = getRouteColor(v, vehicles, customVehicleColors);
                const isSelected = selectedRoutes.length === 0 || selectedRoutes.some(r => routesMatch(r, v));
                const isExclusive = selectedRoutes.length === 1 && routesMatch(selectedRoutes[0], v);
                const isMultiSelected = selectedRoutes.length > 1 && selectedRoutes.some(r => routesMatch(r, v));
                const isRouteActive = isExclusive || isMultiSelected;
                
                const m = vehicleMetricsMap[v] || {
                  count: 0,
                  maxStops: 0,
                  totalKg: 0,
                  capKg: 0,
                  totalVol: 0,
                  capVol: 0,
                  totalRouteKm: 0,
                  startTime: "08:00",
                  returnArrivalTime: "08:00",
                  shiftEndTime: "18:00",
                  isOverStops: false,
                  isOverWeight: false,
                  isOverVol: false,
                  isOverTime: false,
                  hasErrors: false,
                };

                return (
                  <div
                    key={v}
                    onClick={(e) => toggleRouteFilter(v, e)}
                    title={`Clique para filtrar ${v} (Ctrl+Clique para multi-seleção)`}
                    className={`w-full px-2 py-1.5 rounded-xl text-xs transition-all grid grid-cols-12 gap-1 items-center cursor-pointer border ${
                      isRouteActive
                        ? "bg-indigo-600 text-white border-indigo-500 shadow-md ring-1 ring-indigo-400/80"
                        : isSelected
                        ? "bg-white dark:bg-zinc-900/90 text-zinc-900 dark:text-zinc-100 border-zinc-200 dark:border-zinc-800 hover:border-indigo-400/60 shadow-xs"
                        : "bg-transparent text-zinc-400 dark:text-zinc-500 border-transparent opacity-40 hover:opacity-100 hover:bg-zinc-100 dark:hover:bg-zinc-900/50"
                    }`}
                  >
                    {/* Col 1-4: Color dot with native color picker overlay + Vehicle Name */}
                    <div className="col-span-4 flex items-center space-x-1.5 min-w-0 pr-1">
                      <label
                        className="relative inline-flex items-center justify-center w-3 h-3 rounded-full cursor-pointer shrink-0 shadow-xs ring-1 ring-black/20 hover:scale-125 transition-transform"
                        style={{ backgroundColor: routeColor }}
                        title="Clique na bola para mudar a cor desta viatura"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="color"
                          value={routeColor}
                          onChange={(e) => handleSetVehicleColor(v, e.target.value)}
                          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                        />
                      </label>
                      <span className={`truncate font-bold text-[11px] ${isRouteActive ? "text-white" : ""}`}>
                        {v}
                      </span>
                      {m.hasErrors && (
                        <span className="text-[10px] shrink-0" title="Viatura com limites ultrapassados!">⚠️</span>
                      )}
                    </div>

                    {/* Col 5-6: Paragens (com alerta vermelho se exceder e contraste garantido) */}
                    <div className="col-span-2 text-center">
                      {m.isOverStops ? (
                        <span
                          style={isRouteActive ? { backgroundColor: "#ffe4e6", color: "#be123c", borderColor: "#f43f5e" } : undefined}
                          className="badge-pill-contrast inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-black bg-rose-500/25 text-rose-600 dark:text-rose-400 border border-rose-500/60 animate-pulse"
                          title={`⚠️ Limite de entregas ultrapassado: ${m.count} / máx ${m.maxStops} (+${m.count - m.maxStops})`}
                        >
                          {m.count}/{m.maxStops}
                        </span>
                      ) : (
                        <span
                          style={
                            isRouteActive && m.count > 0
                              ? { backgroundColor: "#ffffff", color: "#0f172a", borderColor: "#ffffff" }
                              : undefined
                          }
                          className={`badge-pill-contrast inline-block px-1.5 py-0.5 rounded font-mono text-[10px] font-black border ${
                            m.count > 0
                              ? isRouteActive
                                ? "bg-white text-slate-950 border-white shadow-xs"
                                : "bg-indigo-50 text-indigo-950 border-indigo-200 dark:bg-zinc-800 dark:text-indigo-200 dark:border-zinc-700"
                              : isRouteActive
                              ? "bg-indigo-700/60 text-indigo-200 border-indigo-500/40"
                              : "bg-zinc-100 text-zinc-400 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-600 dark:border-zinc-800"
                          }`}
                        >
                          {m.count > 0 ? (m.maxStops > 0 ? `${m.count}/${m.maxStops}` : m.count) : "—"}
                        </span>
                      )}
                    </div>

                    {/* Col 7-8: Peso kg (com alerta vermelho se exceder) */}
                    <div className="col-span-2 text-right">
                      {m.isOverWeight ? (
                        <span
                          className="px-1 py-0.5 rounded text-[10px] font-mono font-black bg-rose-500/25 text-rose-600 dark:text-rose-400 border border-rose-500/60 animate-pulse"
                          title={`⚠️ Limite de peso ultrapassado: ${m.totalKg} kg / cap ${m.capKg} kg (+${m.totalKg - m.capKg} kg)`}
                        >
                          {m.totalKg.toLocaleString()}k
                        </span>
                      ) : (
                        <span className={`font-mono text-[10px] ${
                          isRouteActive ? "text-indigo-100 font-bold" : "text-zinc-600 dark:text-zinc-300"
                        }`}>
                          {m.count > 0 ? `${m.totalKg.toLocaleString()}k` : "—"}
                        </span>
                      )}
                    </div>

                    {/* Col 9-10: Volume m3 (com alerta vermelho se exceder) */}
                    <div className="col-span-2 text-right">
                      {m.isOverVol ? (
                        <span
                          className="px-1 py-0.5 rounded text-[10px] font-mono font-black bg-rose-500/25 text-rose-600 dark:text-rose-400 border border-rose-500/60 animate-pulse"
                          title={`⚠️ Limite de volume ultrapassado: ${m.totalVol} m³ / cap ${m.capVol} m³ (+${(m.totalVol - m.capVol).toFixed(1)} m³)`}
                        >
                          {m.totalVol.toFixed(1)}
                        </span>
                      ) : (
                        <span className={`font-mono text-[10px] ${
                          isRouteActive ? "text-indigo-100 font-semibold" : "text-zinc-500 dark:text-zinc-400"
                        }`}>
                          {m.count > 0 ? (m.totalVol > 0 ? m.totalVol.toFixed(1) : "0") : "—"}
                        </span>
                      )}
                    </div>

                    {/* Col 11-12: KM estimados e Horário (com alerta vermelho se regresso > horario_fim) */}
                    <div className="col-span-2 text-right">
                      {m.isOverTime ? (
                        <span
                          className="px-1 py-0.5 rounded text-[9.5px] font-mono font-black bg-rose-500/25 text-rose-600 dark:text-rose-400 border border-rose-500/60 animate-pulse block truncate"
                          title={`⚠️ Horário de fim ultrapassado: regresso previsto às ${m.returnArrivalTime} > fim às ${m.shiftEndTime}`}
                        >
                          {m.returnArrivalTime}
                        </span>
                      ) : (
                        <span className={`font-mono text-[9.5px] block truncate ${
                          isRouteActive ? "text-indigo-100 font-semibold" : "text-zinc-500 dark:text-zinc-400"
                        }`} title={m.count > 0 ? `${m.totalRouteKm} km · ${m.startTime} → ${m.returnArrivalTime}` : "Sem entregas"}>
                          {m.count > 0 ? (m.totalRouteKm > 0 ? `${Math.round(m.totalRouteKm)}k` : m.returnArrivalTime) : "—"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Summary Row */}
            <div className="px-2.5 py-1.5 bg-zinc-100/90 dark:bg-zinc-900/90 border-t border-zinc-200 dark:border-zinc-800 grid grid-cols-12 gap-1 items-center text-[9.5px] font-mono font-black text-zinc-700 dark:text-zinc-300">
              <div className="col-span-4 truncate uppercase tracking-wider text-[9px] text-zinc-500 dark:text-zinc-400">
                Totais ({tableTotals.vehiclesWithCargo})
              </div>
              <div className="col-span-2 text-center text-indigo-600 dark:text-indigo-400 font-black">
                {tableTotals.stops}
              </div>
              <div className="col-span-2 text-right">
                {tableTotals.kg.toLocaleString()}k
              </div>
              <div className="col-span-2 text-right">
                {tableTotals.vol}m³
              </div>
              <div className="col-span-2 text-right text-indigo-600 dark:text-indigo-400">
                {tableTotals.km}km
              </div>
            </div>

            {/* Panel Footer Navigation */}
            <div className="px-3 py-1.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-900/90 flex items-center justify-between text-[10px]">
              <span className="text-zinc-500 dark:text-zinc-400 font-medium">
                {selectedRoutes.length === 0 ? "Todas selecionadas" : `${selectedRoutes.length} selecionada(s)`}
              </span>
              <button
                onClick={handleFitAll}
                className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer"
              >
                🎯 Enquadrar
              </button>
            </div>
          </div>
        ) : (
          /* Minimized Panel Strip */
          <div className="pointer-events-auto bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl p-1 flex flex-col items-center">
            <button
              onClick={() => setIsRoutesPanelOpen(true)}
              className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center space-x-1.5 shadow-md cursor-pointer transition-all"
              title="Abrir tabela de viaturas"
            >
              <span>🚚</span>
              <span>Viaturas ({activeVehiclesCount})</span>
              <span>▶</span>
            </button>
          </div>
        )}
      </div>

      <style jsx global>{`
        .pale-map-tile {
          filter: saturate(30%) brightness(105%) contrast(92%) !important;
        }
      `}</style>

      <MapContainer key={mapLayer} center={center} zoom={11} className="w-full h-full">
        <TileLayer
          className={mapLayer === "standard" || !mapLayer ? "pale-map-tile" : ""}
          attribution={
            mapLayer === "google_sat"
              ? '&copy; Google Satellite'
              : mapLayer === "google_hybrid"
              ? '&copy; Google Hybrid'
              : '&copy; Google Maps'
          }
          url={
            mapLayer === "google_sat"
              ? "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
              : mapLayer === "google_hybrid"
              ? "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
              : "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
          }
        />
        <MapInitialController coords={center} initialPoints={initialPoints} />
        <MapBoundsFitter triggerKey={fitTrigger} points={visiblePoints} />
        <MapTracker setZoom={setZoomLevel} />

        {/* Warehouses (Apenas armazéns com carga ativa nesta distribuição) */}
        {warehouses
          .filter(wh => {
            if (!wh.lat || !wh.lon) return false;
            // Se o utilizador filtrou um armazém específico no dropdown
            if (selectedWarehouse && selectedWarehouse !== "all") {
              const selNorm = selectedWarehouse.trim().toLowerCase();
              const whNorm = (wh.name || "").trim().toLowerCase();
              return whNorm === selNorm || whNorm.includes(selNorm) || selNorm.includes(whNorm);
            }
            // Se há armazéns identificados com carga nesta distribuição, ignorar armazéns sem carga
            if (warehousesWithCargo.size > 0) {
              const whNameNorm = (wh.name || "").trim().toLowerCase();
              return Array.from(warehousesWithCargo).some(wCargo => {
                const cNorm = wCargo.trim().toLowerCase();
                return cNorm === whNameNorm || whNameNorm.includes(cNorm) || cNorm.includes(whNameNorm);
              });
            }
            // Se nenhum armazém tiver carga explícita, mostrar apenas o armazém ativo mais próximo dos clientes
            if (activeWarehouse) {
              return wh.name === activeWarehouse.name;
            }
            return true;
          })
          .map(wh => (
            <Marker key={wh.name} position={[wh.lat, wh.lon]} icon={getWarehouseIcon(zoomLevel)}>
              <Popup>
                <div className="text-zinc-900 p-1 font-sans">
                  <p className="font-bold text-xs flex items-center space-x-1">
                    <span>🏠</span> <span>{wh.name}</span>
                  </p>
                  <p className="text-[10px] text-zinc-600 mt-0.5 font-medium">Armazém / Centro de Distribuição</p>
                  <p className="text-[9px] text-zinc-600 mt-1 font-mono">{wh.address}</p>
                </div>
              </Popup>
            </Marker>
          ))}

        {/* Visible Clients */}
        {visibleClients.map((c, idx) => {
          const isPending = isPendingRoute(c.Rota);
          const color = getRouteColor(c.Rota, vehicles, customVehicleColors);
          const slotInfo = getClientSlotInfo(c.Janela_Horaria);

          const clientName = c.Nome_Cliente || c.Cliente || "Cliente";
          const clientCode = c.Codigo_Cliente || (c.Cliente !== clientName ? c.Cliente : "") || "";
          const docNumber = c.Doc_ID || c.doc_id || c.numero_doc || "";
          const phone = c.Telefone || c.Telefone_Cliente || c.telefone || "";
          const driverNotes = c.Notas_Motorista || c.notas_motorista || c.Notas || c.notas || c.Observacoes || c.observacoes || "";
          const vendedor = c.Vendedor || c.vendedor || "";
          const clientRules = c.Regras || (c as any).regras || (c as any).Restricoes || (c as any).restricoes || "";
          const armazemOrigem = c.Armazem || (c as any).armazem || "";
          const unloadTime = Number((c as any).tempo_descarga_min || (c as any).Tempo_Descarga_Min || 0);
          const codAmount = Number((c as any).valor_cobrar || (c as any).Valor_Cobrar || 0);
          const stopWeight = c.Peso_KG !== undefined && c.Peso_KG !== null ? c.Peso_KG : (c.Carga_Acum || 0);
          const stopVolume = c.Volume_m3 !== undefined && c.Volume_m3 !== null ? c.Volume_m3 : (c.Volume_M3 || 0);
          const windowFormatted = formatTimeWindow(c.Janela_Horaria);
          const arrivalTime = c.Chegada && c.Chegada !== "00:00" ? c.Chegada : "";
          const departureTime = c.Saida && c.Saida !== "00:00" ? c.Saida : "";

          return (
            <Marker
              key={"marker-" + String(c.Cliente) + "-" + String(c.ID_Original || c.id || idx)}
              position={[c.Latitude, c.Longitude]}
              icon={createGeometricMarkerIcon(
                c.Ordem,
                color,
                isPending,
                zoomLevel,
                selectedClientKeys.includes(String(c.id || c.ID_Original || c.Cliente)),
                slotInfo,
                c.Tipo_Operacao || c.tipo_operacao
              )}
              draggable={true}
              eventHandlers={{
                dragend: (e) => {
                  const marker = e.target;
                  const position = marker.getLatLng();

                  // Check if dropped near another client of a different route (< 400m)
                  let nearestOther: MapClient | null = null;
                  let minOtherDist = Infinity;

                  visibleClients.forEach((other) => {
                    const isSelf = (other.id && c.id && other.id === c.id) ||
                                   (other.ID_Original && c.ID_Original && other.ID_Original === c.ID_Original) ||
                                   (other.Cliente === c.Cliente && other.Morada === c.Morada);
                    if (isSelf) return;

                    if (other.Latitude && other.Longitude) {
                      const dist = haversineDistance(position.lat, position.lng, other.Latitude, other.Longitude);
                      if (dist < minOtherDist) {
                        minOtherDist = dist;
                        nearestOther = other;
                      }
                    }
                  });

                  if (nearestOther && minOtherDist <= 0.40 && !routesMatch((nearestOther as MapClient).Rota, c.Rota)) {
                    const targetRoute = isPendingRoute((nearestOther as MapClient).Rota) ? "Por Distribuir" : (nearestOther as MapClient).Rota;
                    const targetName = (nearestOther as MapClient).Nome_Cliente || (nearestOther as MapClient).Cliente;
                    const clientLabel = clientName || c.Cliente;
                    const willTransfer = window.confirm(
                      `🎯 Transferência de Rota:\n\nLargou o cliente "${clientLabel}" a ${Math.round(minOtherDist * 1000)}m de "${targetName}".\n\nPretende transferir esta entrega para a rota "${targetRoute}"?`
                    );

                    if (willTransfer) {
                      requestMoveClientRoute(c, targetRoute, position.lat, position.lng, "marker_drag");
                      return;
                    }
                  }

                  if (onUpdateClientCoords) {
                    onUpdateClientCoords(c.Cliente, position.lat, position.lng);
                  }
                }
              }}
            >
              <Popup>
                <div className="text-zinc-900 min-w-[280px] max-w-[340px] p-1 font-sans">
                  {/* 1. Header: Paragem # / Rota & Status + Color Changer */}
                  <div className="flex items-center justify-between border-b border-zinc-200 pb-2 mb-2">
                    <div className="flex items-center space-x-2">
                      <label
                        className="relative inline-flex items-center justify-center w-3.5 h-3.5 rounded-full cursor-pointer shrink-0 shadow-sm ring-1 ring-black/20 hover:scale-125 transition-transform"
                        style={{ backgroundColor: color }}
                        title="Clique na bola para mudar a cor desta viatura"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="color"
                          value={color}
                          onChange={(e) => handleSetVehicleColor(isPending ? "Por Distribuir" : c.Rota, e.target.value)}
                          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                        />
                      </label>
                      <span className="font-extrabold text-sm text-zinc-900">
                        {isPending ? "Pendente" : `Paragem #${c.Ordem}`}
                      </span>
                    </div>
                    <span
                      className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
                      style={{
                        backgroundColor: isPending ? "#fef3c7" : `${color}20`,
                        color: isPending ? "#b45309" : color,
                        border: `1px solid ${isPending ? "#fde68a" : `${color}40`}`,
                      }}
                    >
                      {isPending ? "Por Distribuir" : c.Rota}
                    </span>
                  </div>

                  {/* 2. Client Name Header & Identification Chips */}
                  <div className="mb-2">
                    <p className="font-bold text-zinc-900 text-xs leading-snug">
                      {clientName}
                    </p>
                    
                    {/* Identification Chips: Código Cliente, Nº Doc, Telefone */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      {clientCode && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-300 text-[10px] font-mono text-zinc-700 font-semibold" title="Código do Cliente">
                          <span className="text-zinc-400 mr-1 font-sans">Cód:</span> {clientCode}
                        </span>
                      )}
                      {docNumber && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-[10px] font-mono text-indigo-700 font-bold" title="Número do Documento / Encomenda">
                          <span className="text-indigo-400 mr-1 font-sans">Doc:</span> {docNumber}
                        </span>
                      )}
                      {phone && (
                        <a
                          href={`tel:${phone}`}
                          className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-[10px] font-mono text-emerald-700 font-bold hover:underline"
                          title="Ligar para cliente"
                        >
                          <span className="mr-1">📞</span> {phone}
                        </a>
                      )}
                    </div>

                    {/* Badge do Tipo de Operação */}
                    <div className="mt-2">
                      {((c.Tipo_Operacao || c.tipo_operacao) === "P") && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 shadow-xs">
                          ♻️ <span className="font-mono">P</span> — Recolha Sucata / Retoma (para armazém)
                        </span>
                      )}
                      {((c.Tipo_Operacao || c.tipo_operacao) === "From") && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-900 border border-purple-300 shadow-xs">
                          🏪⤴️ <span className="font-mono">From</span> — Levantamento em Loja {(c.Par_ID || c.par_id) ? `(Par #${String(c.Par_ID || c.par_id).slice(-4)})` : ""}
                        </span>
                      )}
                      {((c.Tipo_Operacao || c.tipo_operacao) === "To") && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-100 text-cyan-900 border border-cyan-300 shadow-xs">
                          🏠⤵️ <span className="font-mono">To</span> — Entrega de Loja ao Cliente {(c.Par_ID || c.par_id) ? `(Par #${String(c.Par_ID || c.par_id).slice(-4)})` : ""}
                        </span>
                      )}
                      {(!(c.Tipo_Operacao || c.tipo_operacao) || (c.Tipo_Operacao || c.tipo_operacao) === "D") && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-900 border border-blue-300 shadow-xs">
                          📦 <span className="font-mono">D</span> — Entrega de Armazém
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 3. Address */}
                  <div className="text-xs text-zinc-600 bg-zinc-50 rounded-lg p-2 border border-zinc-200 mb-2 space-y-0.5">
                    <p className="font-medium text-zinc-800 leading-tight">📍 {c.Morada || "Morada não especificada"}</p>
                    <p className="text-[10px] text-zinc-500 font-mono pl-4">{c.CP} {c.Localidade}</p>
                  </div>

                  {/* 4. Operational Metrics Grid */}
                  <div className="grid grid-cols-2 gap-1.5 text-[11px] mb-2">
                    <div className="bg-zinc-50 border border-zinc-200 rounded-md p-1.5">
                      <span className="text-[9px] text-zinc-400 uppercase font-semibold flex items-center justify-between">
                        <span>Janela Horária</span>
                        <span className="text-[10px]" title={slotInfo.label}>{slotInfo.badge}</span>
                      </span>
                      <span className="font-bold text-zinc-800 text-[11px] block">{windowFormatted}</span>
                      {slotInfo.type !== "any" && (
                        <span className="text-[9px] text-indigo-600 font-semibold block">{slotInfo.label}</span>
                      )}
                    </div>

                    <div className="bg-zinc-50 border border-zinc-200 rounded-md p-1.5">
                      <span className="text-[9px] text-zinc-400 uppercase font-semibold block">
                        {arrivalTime ? "Chegada Prevista" : "Carga / Peso"}
                      </span>
                      {arrivalTime ? (
                        <span className="font-bold text-indigo-600 text-[11px]">
                          {arrivalTime} {departureTime ? `→ ${departureTime}` : ""}
                        </span>
                      ) : (
                        <span className="font-bold text-zinc-800 text-[11px]">{stopWeight} kg</span>
                      )}
                    </div>

                    <div className="bg-zinc-50 border border-zinc-200 rounded-md p-1.5">
                      <span className="text-[9px] text-zinc-400 uppercase font-semibold block">Peso da Paragem</span>
                      <span className="font-bold text-zinc-800 text-[11px]">{stopWeight} kg</span>
                    </div>

                    <div className="bg-zinc-50 border border-zinc-200 rounded-md p-1.5">
                      <span className="text-[9px] text-zinc-400 uppercase font-semibold block">Volume</span>
                      <span className="font-bold text-zinc-800 text-[11px]">{Number(stopVolume).toFixed(2)} m³</span>
                    </div>

                    {c.Carga_Acum !== undefined && (
                      <div className="bg-indigo-50/60 border border-indigo-200 rounded-md p-1.5 col-span-2">
                        <span className="text-[9px] text-indigo-600 uppercase font-bold block">Carga a Bordo na Viatura</span>
                        <span className="font-extrabold text-indigo-900 text-xs">
                          {Math.round(c.Carga_Acum)} kg <span className="font-normal text-indigo-700">/ {Number(c.Carga_Vol_Acum || 0).toFixed(2)} m³</span>
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 5. Vendedor & Notas Motorista (Sempre visíveis no cartão) */}
                  <div className="space-y-1.5 mb-2">
                    {/* Vendedor */}
                    <div className="p-1.5 bg-blue-50/90 border border-blue-200/80 rounded-md text-[10px] text-blue-950 flex items-center justify-between">
                      <span className="font-bold uppercase tracking-wider text-[9px] text-blue-700 flex items-center space-x-1 shrink-0">
                        <span>👤</span>
                        <span>Vendedor:</span>
                      </span>
                      <span className={`font-semibold truncate pl-1 ${vendedor ? "text-blue-900 font-bold" : "text-zinc-400 italic"}`}>
                        {vendedor || "Não atribuído"}
                      </span>
                    </div>

                    {/* Notas Motorista */}
                    <div className="p-1.5 bg-amber-50/90 border border-amber-200/90 rounded-md text-[10px] text-amber-950">
                      <span className="font-bold uppercase tracking-wider block text-[9px] text-amber-700 flex items-center space-x-1 mb-0.5">
                        <span>📝</span>
                        <span>Notas Motorista:</span>
                      </span>
                      <p className={`leading-tight ${driverNotes ? "text-amber-950 font-medium whitespace-pre-wrap" : "text-zinc-400 italic text-[9.5px]"}`}>
                        {driverNotes || "Sem notas registadas para esta paragem"}
                      </p>
                    </div>
                  </div>

                  {/* 6. Regras & Características da Entrega */}
                  <div className="p-1.5 bg-purple-50/90 border border-purple-200/90 rounded-md text-[10px] text-purple-950 mb-2">
                    <span className="font-bold uppercase tracking-wider block text-[9px] text-purple-700 flex items-center justify-between mb-0.5">
                      <span className="flex items-center space-x-1">
                        <span>🏷️</span>
                        <span>Regras & Características da Entrega:</span>
                      </span>
                      {unloadTime > 0 && (
                        <span className="text-[9px] text-purple-800 font-semibold lowercase">
                          ⏱️ {unloadTime} min
                        </span>
                      )}
                    </span>
                    {clientRules ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {clientRules.split(/[,;\s]+/).filter(Boolean).map((rg: string, i: number) => (
                          <span key={i} className="px-1.5 py-0.5 rounded bg-purple-200/80 border border-purple-300 text-purple-950 font-bold font-mono text-[9.5px]">
                            {rg}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-zinc-400 italic text-[9.5px]">Sem regras ou restrições especiais</span>
                    )}

                    {(codAmount > 0 || armazemOrigem) && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5 pt-1 border-t border-purple-200/60 text-[9px]">
                        {armazemOrigem && (
                          <span className="text-purple-900 font-medium truncate" title="Armazém de Abastecimento">
                            🏢 {armazemOrigem}
                          </span>
                        )}
                        {codAmount > 0 && (
                          <span className="px-1 py-0.2 rounded bg-amber-100 text-amber-900 font-bold border border-amber-300">
                            💰 Cobrar: {Number(codAmount).toFixed(2)} €
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 7. Route Reassignment Selector inside Popup */}
                  {onMoveClientRoute && (
                    <div className="pt-2 border-t border-zinc-200 flex items-center justify-between gap-2">
                      <label className="text-[10px] font-bold text-zinc-600 shrink-0">Mover para:</label>
                      <select
                        value={isPending ? "Por Distribuir" : c.Rota}
                        onChange={(e) => {
                          const target = e.target.value;
                          const cLat = (c as any).Latitude !== undefined ? Number((c as any).Latitude) : ((c as any).lat !== undefined ? Number((c as any).lat) : undefined);
                          const cLon = (c as any).Longitude !== undefined ? Number((c as any).Longitude) : ((c as any).lon !== undefined ? Number((c as any).lon) : undefined);
                          requestMoveClientRoute(c, target, cLat, cLon, "popup_select");
                        }}
                        className="w-full text-[11px] bg-white border border-zinc-300 rounded-lg px-2 py-1 font-semibold text-zinc-800 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 cursor-pointer shadow-sm"
                      >
                        <option value="Por Distribuir">
                          🟡 Por Distribuir ({vehicleStatsMap.pendingCount} {vehicleStatsMap.pendingCount === 1 ? "cliente" : "clientes"})
                        </option>
                        {vehicles.map((v) => {
                          const stats = vehicleStatsMap.map[v] || { count: 0, kg: 0 };
                          return (
                            <option key={v} value={v}>
                              🚚 {v} ({stats.count} {stats.count === 1 ? "cliente" : "clientes"}{stats.count === 0 ? " · Vazio" : ` · ${stats.kg} kg`})
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}

                  {/* 7. Quick Georeferencing / Coordinate Correction Modal Trigger */}
                  {onGeoreferenceClient && (
                    <div className="pt-2 border-t border-zinc-200">
                      <button
                        type="button"
                        onClick={() => onGeoreferenceClient(c)}
                        className="w-full py-1.5 px-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white rounded-lg text-[11px] font-bold flex items-center justify-center space-x-1.5 shadow-sm transition-all cursor-pointer"
                        title="Abrir ecrã de georreferenciação para corrigir morada ou coordenadas"
                      >
                        <span className="text-xs">📍</span>
                        <span>Corrigir Georreferenciação</span>
                      </button>
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Area Selection Box Overlay */}
        <MapAreaSelector
          isSelecting={isBoxSelecting}
          onSelectionComplete={handleAreaSelectionComplete}
        />

        {/* Real OSRM Road Geometry Polylines (Strictly filtered to visible routes only) */}
        {showRoads && Object.entries(roadGeometries).map(([rName, coords]) => {
          if (!visibleRouteNames.has(rName)) return null;
          if (selectedRoutes.length > 0 && !selectedRoutes.some(sel => routesMatch(sel, rName))) return null;
          const color = getRouteColor(rName, vehicles, customVehicleColors);

          return (
            <Polyline
              key={"road-" + rName}
              positions={coords}
              pathOptions={{
                color: color,
                weight: 4,
                opacity: 0.85,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
          );
        })}
      </MapContainer>

      {/* FLOATING BOTTOM-RIGHT TIME SLOT GEOMETRIC LEGEND (Apenas slots reais da distribuição) */}
      {(dynamicTimeSlots.legendSlots.length > 0 || dynamicTimeSlots.hasAnyWindow) && (
        <div className="absolute bottom-6 right-3 z-[1000] pointer-events-auto">
          <div className="bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden transition-all duration-200 min-w-[210px] max-w-[280px]">
            <button
              type="button"
              onClick={() => setIsLegendOpen(!isLegendOpen)}
              className="w-full px-3 py-1.5 bg-zinc-100/90 dark:bg-zinc-900/90 flex items-center justify-between gap-2 cursor-pointer border-b border-zinc-200/80 dark:border-zinc-800/80 text-left hover:bg-zinc-200/70 dark:hover:bg-zinc-850 transition-colors"
              title="Clique para recolher/expandir a legenda das figuras geométricas das slots horárias"
            >
              <span className="font-bold text-[11px] text-zinc-800 dark:text-zinc-200 flex items-center space-x-1.5">
                <span>⏱️</span>
                <span>Slots Horárias ({dynamicTimeSlots.legendSlots.length})</span>
              </span>
              <span className="text-zinc-400 text-[10px] font-mono">{isLegendOpen ? "▼" : "▲"}</span>
            </button>

            {isLegendOpen && (
              <div className="p-2 space-y-1.5 font-sans">
                {dynamicTimeSlots.legendSlots.map((slot) => (
                  <div key={slot.type} className="flex items-center justify-between space-x-2 text-[10.5px] text-zinc-700 dark:text-zinc-300">
                    <div className="flex items-center space-x-2 min-w-0 truncate">
                      {slot.shape === "circle" && (
                        <span className="w-4 h-4 rounded-full border-2 border-indigo-500 bg-indigo-500/20 flex items-center justify-center shrink-0" />
                      )}
                      {slot.shape === "square" && (
                        <span className="w-4 h-4 rounded border-2 border-indigo-500 bg-indigo-500/20 flex items-center justify-center shrink-0" />
                      )}
                      {slot.shape === "triangle" && (
                        <span
                          className="w-4 h-4 border-2 border-indigo-500 bg-indigo-500/20 flex items-center justify-center shrink-0"
                          style={{ clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)" }}
                        />
                      )}
                      {slot.shape === "rect" && (
                        <span className="w-4 h-2.5 rounded-xs border-2 border-indigo-500 bg-indigo-500/20 flex items-center justify-center shrink-0" />
                      )}
                      {slot.shape === "diamond" && (
                        <span
                          className="w-3.5 h-3.5 border-2 border-indigo-500 bg-indigo-500/20 flex items-center justify-center shrink-0 transform rotate-45"
                        />
                      )}
                      <span className="font-medium truncate">{slot.label}</span>
                    </div>
                    {slot.count !== undefined && (
                      <span className="text-[9.5px] font-mono text-zinc-400 shrink-0 font-bold">
                        {slot.count}
                      </span>
                    )}
                  </div>
                ))}

                {dynamicTimeSlots.hasAnyWindow && (
                  <div className="flex items-center justify-between space-x-2 text-[10px] text-zinc-500 dark:text-zinc-400 pt-1 border-t border-zinc-100 dark:border-zinc-800">
                    <div className="flex items-center space-x-2">
                      <span className="w-4 h-4 rounded-full border-2 border-dashed border-zinc-400 shrink-0" />
                      <span>Sem Janela / Qualquer</span>
                    </div>
                    <span className="text-[9.5px] font-mono text-zinc-400 font-bold">
                      {dynamicTimeSlots.anyCount}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {/* FLOATING BOTTOM BULK REASSIGN ACTION BAR */}
      {selectedClientKeys.length > 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] bg-zinc-950/95 dark:bg-zinc-900/95 backdrop-blur-md border border-indigo-500/60 shadow-2xl rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3 min-w-[320px] max-w-[95%] animate-in fade-in slide-in-from-bottom-4 pointer-events-auto">
          <div className="flex items-center space-x-2 text-white">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-ping shrink-0" />
            <div>
              <span className="text-xs font-black tracking-wide text-zinc-100 block">
                🔲 {selectedClientKeys.length} paragens selecionadas
              </span>
              <span className="text-[10px] text-zinc-400 font-medium font-mono">
                Total: {selectedStopsTotalKg} kg | {selectedStopsTotalVol.toFixed(2)} m³
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <label className="text-[10px] uppercase font-bold text-zinc-400 shrink-0">Mover para:</label>
            <select
              value={bulkTargetRoute}
              onChange={(e) => setBulkTargetRoute(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-1 text-xs text-zinc-200 font-semibold outline-none focus:border-indigo-500 cursor-pointer shadow-sm"
            >
              <option value="Por Distribuir">
                🟡 Por Distribuir ({vehicleStatsMap.pendingCount} {vehicleStatsMap.pendingCount === 1 ? "cliente" : "clientes"})
              </option>
              {vehicles.map((v) => {
                const stats = vehicleStatsMap.map[v] || { count: 0, kg: 0 };
                return (
                  <option key={v} value={v}>
                    🚚 {v} ({stats.count} {stats.count === 1 ? "cliente" : "clientes"}{stats.count === 0 ? " · Vazio" : ` · ${stats.kg} kg`})
                  </option>
                );
              })}
            </select>
          </div>

          <div className="flex items-center space-x-1.5">
            <button
              onClick={handleApplyBulkReassign}
              disabled={isBulkLoading}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-md shadow-indigo-500/20 cursor-pointer transition-all flex items-center space-x-1.5 disabled:opacity-50"
            >
              <span>{isBulkLoading ? "A Transferir..." : "⚡ Transferir em Massa"}</span>
            </button>
            <button
              onClick={() => setSelectedClientKeys([])}
              className="text-zinc-400 hover:text-zinc-200 px-2 py-1 text-xs font-bold cursor-pointer rounded-lg hover:bg-zinc-800"
              title="Cancelar Seleção"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* 8. Modal Guardião de Regras e Capacidades */}
      {guardianPendingAction && (
        <div className="fixed inset-0 z-[3000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl max-w-lg w-full shadow-2xl p-6 text-zinc-100 flex flex-col space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center space-x-3">
                <span className="text-2xl p-2 bg-amber-500/10 border border-amber-500/20 rounded-xl">🛡️</span>
                <div>
                  <h3 className="text-base font-bold text-white tracking-tight">
                    Guardião Operacional de Rotas
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Aviso ao transferir para <span className="font-semibold text-amber-400">{guardianPendingAction.targetRoute}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setGuardianPendingAction(null)}
                className="text-zinc-500 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition"
              >
                ✕
              </button>
            </div>

            {/* Violations List */}
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {guardianPendingAction.violations.map((violation, idx) => {
                const isError = violation.severity === "error";
                return (
                  <div
                    key={idx}
                    className={`p-3 rounded-xl border text-xs flex items-start space-x-2.5 ${
                      isError
                        ? "bg-rose-950/40 border-rose-800/60 text-rose-200"
                        : "bg-amber-950/40 border-amber-800/60 text-amber-200"
                    }`}
                  >
                    <span className="text-sm shrink-0 mt-0.5">
                      {isError ? "⛔" : "⚠️"}
                    </span>
                    <div className="space-y-0.5">
                      <div className="font-bold">{violation.title}</div>
                      <div className="text-[11px] opacity-90 leading-relaxed">{violation.message}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Impact Details */}
            <div className="bg-zinc-950/60 rounded-xl p-3 border border-zinc-800/80 text-xs space-y-1.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Resumo do Impacto ({guardianPendingAction.items.length} {guardianPendingAction.items.length === 1 ? "entrega" : "entregas"})
              </div>
              <div className="flex items-center justify-between text-zinc-300">
                <span>Carga a Adicionar:</span>
                <span className="font-semibold text-white">
                  {guardianPendingAction.items.reduce((acc, it) => acc + (it.weight || 0), 0).toFixed(1)} kg · {guardianPendingAction.items.reduce((acc, it) => acc + (it.vol || 0), 0).toFixed(2)} m³
                </span>
              </div>
              <div className="text-[11px] text-zinc-400 truncate">
                Clientes: {guardianPendingAction.items.map(it => it.clientName).join(", ")}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setGuardianPendingAction(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition cursor-pointer"
              >
                Cancelar Transferência
              </button>
              <button
                type="button"
                onClick={handleConfirmGuardianAction}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/30 transition cursor-pointer flex items-center space-x-1.5"
              >
                <span>Forçar Transferência Excecional ⚠️</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}