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
  filterState?: MapFilterState;
  onFilterChange?: (filters: MapFilterState) => void;
}

function formatTimeWindow(winStr?: string): string {
  if (!winStr || winStr === "Qualquer" || winStr === "--" || winStr === "None") return "Qualquer";
  const cleaned = String(winStr)
    .replace(/\d{4}-\d{2}-\d{2}\s*/g, "")
    .replace(/T/g, " ")
    .replace(/:00(?=\s|$|-)/g, "")
    .trim();
  if (cleaned.includes("-")) {
    const parts = cleaned.split("-").map(p => p.trim().slice(0, 5));
    if (parts[0] && parts[1]) return `${parts[0]} - ${parts[1]}`;
    if (parts[0]) return `${parts[0]} - 23:59`;
  }
  return cleaned.slice(0, 13) || "Qualquer";
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

  useEffect(() => {
    if (!initializedRef.current && coords[0] !== 0 && coords[1] !== 0) {
      map.setView(coords, map.getZoom() || 11);
      initializedRef.current = true;
    }
  }, [coords, map]);

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

function getRouteColor(routeName: string, vehicleList: string[]) {
  if (isPendingRoute(routeName)) return "#f59e0b"; // Amber for pending
  const idx = vehicleList.indexOf(routeName);
  if (idx === -1) return routeColors[0];
  return routeColors[idx % routeColors.length];
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

// Marker Icon for Clients
function createNumberedCircleIcon(
  order: number,
  color: string,
  isPending: boolean,
  zoom: number,
  isSelected: boolean = false
) {
  const size = isPending
    ? Math.max(18, Math.min(26, 16 + (zoom - 10) * 2))
    : Math.max(22, Math.min(32, 20 + (zoom - 10) * 2));

  const displayText = isPending ? "⚠️" : String(order || 1);
  const fontSize = isPending ? Math.round(size * 0.55) : Math.round(size * 0.45);

  const shadow = isSelected
    ? "0 0 0 4px #4f46e5, 0 0 16px rgba(99, 102, 241, 0.9)"
    : "0 2px 8px rgba(0,0,0,0.4)";
  const border = isSelected ? "3px solid #ffffff" : "2px solid #ffffff";
  const transform = isSelected ? "transform: scale(1.2); z-index: 100;" : "";

  return L.divIcon({
    className: "custom-client-marker" + (isSelected ? " selected-marker" : ""),
    html: `
      <div style="
        width: ${size}px;
        height: ${size}px;
        background-color: ${color};
        border: ${border};
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: ${shadow};
        color: #ffffff;
        font-weight: 900;
        font-family: monospace;
        font-size: ${fontSize}px;
        cursor: grab;
        ${transform}
      ">
        ${displayText}
      </div>
    `,
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
  filterState,
  onFilterChange,
}: MapComponentProps) {
  const { t } = useI18n();

  const [isMounted, setIsMounted] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(11);
  const [roadGeometries, setRoadGeometries] = useState<Record<string, [number, number][]>>({});
  
  // Interactive Filters
  const [searchQuery, setSearchQuery] = useState(filterState?.searchQuery || "");
  const [selectedWarehouse, setSelectedWarehouse] = useState(filterState?.selectedWarehouse || "all");
  const [statusFilter, setStatusFilter] = useState<"all" | "with_cargo" | "empty" | "pending" | "late">(() => {
    if (filterState?.statusFilter === "active") return "with_cargo";
    return (filterState?.statusFilter as any) || "all";
  });
  const [selectedRoutes, setSelectedRoutes] = useState<string[]>(filterState?.selectedRoutes || []);
  const [showRoads, setShowRoads] = useState(true);
  const [mapLayer, setMapLayer] = useState<"standard" | "google_sat" | "google_hybrid">("standard");
  const [fitTrigger, setFitTrigger] = useState("");

  // Area Selection & Bulk Transfer State
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [selectedClientKeys, setSelectedClientKeys] = useState<string[]>([]);
  const [bulkTargetRoute, setBulkTargetRoute] = useState<string>("Por Distribuir");
  const [isBulkLoading, setIsBulkLoading] = useState(false);

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

  const handleApplyBulkReassign = async () => {
    if (selectedClientKeys.length === 0) return;
    const selectedStops = visibleClients.filter((c) =>
      selectedClientKeys.includes(String(c.id || c.ID_Original || c.Cliente))
    );
    if (selectedStops.length === 0) return;

    setIsBulkLoading(true);
    try {
      if (onBulkReassign) {
        await onBulkReassign(
          selectedStops.map((c: any) => ({
            clientName: c.Cliente || c.Nome_Cliente || c.Doc_ID || "",
            deliveryId: c.id || c.ID_Original,
            address: c.Morada || "",
            lat: c.Latitude !== undefined ? Number(c.Latitude) : (c.lat !== undefined ? Number(c.lat) : undefined),
            lon: c.Longitude !== undefined ? Number(c.Longitude) : (c.lon !== undefined ? Number(c.lon) : (c.lng !== undefined ? Number(c.lng) : undefined)),
          })),
          bulkTargetRoute
        );
      } else if (onMoveClientRoute) {
        for (const s of selectedStops) {
          const sLat = (s as any).Latitude !== undefined ? Number((s as any).Latitude) : ((s as any).lat !== undefined ? Number((s as any).lat) : undefined);
          const sLon = (s as any).Longitude !== undefined ? Number((s as any).Longitude) : ((s as any).lon !== undefined ? Number((s as any).lon) : undefined);
          onMoveClientRoute(s.Cliente || (s as any).Nome_Cliente || "", bulkTargetRoute, s.id || s.ID_Original, s.Morada, sLat, sLon);
        }
      }
      setSelectedClientKeys([]);
    } catch (e: any) {
      alert("Erro ao transferir paragens em massa: " + (e.message || "Erro"));
    } finally {
      setIsBulkLoading(false);
    }
  };

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
    const routeClients = clients.filter(c => c.Rota === v);
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

  // Extract unique warehouses
  const warehouseOptions = useMemo(() => {
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
  }, [warehouses, clients, fleet]);

  // List of vehicles scoped to the currently selected warehouse
  const warehouseVehicles = useMemo(() => {
    return vehicles.filter(v => isVehicleInWarehouse(v, selectedWarehouse));
  }, [vehicles, selectedWarehouse, fleet, clients]);

  // Vehicle stats for badges (accurately scoped to selected warehouse!)
  const { totalVehiclesCount, activeVehiclesCount, emptyVehiclesCount, pendingStopsCount } = useMemo(() => {
    const vList = warehouseVehicles;
    const withCargo = vList.filter(v => clients.some(c => c.Rota === v)).length;
    const empty = Math.max(0, vList.length - withCargo);
    const pending = clients.filter(c => isPendingRoute(c.Rota) && isClientInWarehouse(c, selectedWarehouse)).length;
    return {
      totalVehiclesCount: vList.length,
      activeVehiclesCount: withCargo,
      emptyVehiclesCount: empty,
      pendingStopsCount: pending
    };
  }, [warehouseVehicles, clients, selectedWarehouse]);

  // Filtered vehicles list based on active warehouse & status filter
  const filteredVehiclesList = useMemo(() => {
    let list = warehouseVehicles;

    // Status Filter
    if (statusFilter === "with_cargo") {
      list = list.filter(v => clients.some(c => c.Rota === v));
    } else if (statusFilter === "empty") {
      list = list.filter(v => !clients.some(c => c.Rota === v));
    } else if (statusFilter === "pending") {
      list = []; // In pending status, only pending chip is shown
    }

    // Sort: Active with deliveries first -> vehicle name
    return list.sort((a, b) => {
      const countA = clients.filter(c => c.Rota === a).length;
      const countB = clients.filter(c => c.Rota === b).length;
      if ((countA > 0) !== (countB > 0)) {
        return countA > 0 ? -1 : 1;
      }
      if (countA !== countB) return countB - countA;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    });
  }, [warehouseVehicles, statusFilter, clients]);

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

      // 3. Status Filter
      const isPending = isPendingRoute(c.Rota);
      if (statusFilter === "pending" && !isPending) return false;
      if (statusFilter === "with_cargo" && isPending) return false;
      if (statusFilter === "empty" && isPending) return false;

      // 4. Route selection pills
      if (selectedRoutes.length === 0) return true;
      if (isPending) {
        return selectedRoutes.includes("Por Distribuir");
      }
      return selectedRoutes.includes(c.Rota);
    });
  }, [clients, searchQuery, selectedWarehouse, statusFilter, selectedRoutes, fleet]);

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
      <div className="w-full h-full rounded-2xl border border-zinc-800 bg-zinc-950 flex items-center justify-center text-zinc-300 text-xs font-mono">
        A carregar mapa interativo...
      </div>
    );
  }

  return (
    <div className="w-full h-full rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl relative z-10">
      
      {/* FLOATING FILTER BAR (IDENTICAL TO SYSTEM) */}
      <div className="absolute top-3 left-4 right-4 z-[1000] flex flex-col gap-1.5 pointer-events-none">
        
        {/* Main Filter Toolbar */}
        <div className="bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md p-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl pointer-events-auto flex flex-wrap items-center justify-between gap-2.5">
          
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

        {/* Filtered Vehicle Route Chips Strip */}
        <div className="flex items-center flex-wrap gap-1 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md p-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xl pointer-events-auto max-h-24 overflow-y-auto">
          {/* Todas button */}
          <button
            onClick={() => handleRoutesChange([])}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
              selectedRoutes.length === 0
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-zinc-100 dark:bg-zinc-850 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-750"
            }`}
          >
            ✨ Todas ({visibleClients.length}/{clients.length})
          </button>

          {/* "Por Distribuir" Pending Deliveries Chip */}
          {(() => {
            const pendingStops = clients.filter(c => isPendingRoute(c.Rota));
            const pendingCount = pendingStops.length;
            if (pendingCount === 0) return null;
            if (statusFilter === "with_cargo" || statusFilter === "empty") return null;
            
            const isSelected = selectedRoutes.length === 0 || selectedRoutes.includes("Por Distribuir");
            const isExclusive = selectedRoutes.length === 1 && selectedRoutes[0] === "Por Distribuir";

            return (
              <button
                key="Por Distribuir"
                onClick={(e) => toggleRouteFilter("Por Distribuir", e)}
                title="Clique para ver só encomendas Por Distribuir (Ctrl+Clique para seleção múltipla)"
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all flex items-center space-x-1.5 cursor-pointer border shadow-sm ${
                  isExclusive
                    ? "border-amber-500 bg-amber-600 text-white ring-2 ring-amber-400/80 shadow-md"
                    : isSelected
                    ? "border-amber-500/50 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-300 hover:border-amber-400"
                    : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 text-amber-600/60 opacity-60 hover:opacity-100"
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm bg-amber-500" />
                <span className="truncate max-w-[120px] font-bold">⚠️ Por Distribuir</span>
                <span
                  className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-black border ${
                    isExclusive
                      ? "bg-white text-amber-900 border-white/80"
                      : "bg-amber-500/20 text-amber-900 dark:text-amber-200 border-amber-500/40"
                  }`}
                >
                  {pendingCount}
                </span>
              </button>
            );
          })()}

          {/* Individual Filtered Vehicle Route Chips */}
          {filteredVehiclesList.map((v, i) => {
            const routeColor = getRouteColor(v, vehicles);
            const isSelected = selectedRoutes.length === 0 || selectedRoutes.includes(v);
            const isExclusive = selectedRoutes.length === 1 && selectedRoutes[0] === v;
            const count = clients.filter(c => c.Rota === v).length;

            return (
              <button
                key={v}
                onClick={(e) => toggleRouteFilter(v, e)}
                title={`Clique para ver só ${v} (Ctrl+Clique para seleção múltipla)`}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all flex items-center space-x-1.5 cursor-pointer border shadow-sm ${
                  isExclusive
                    ? "border-indigo-500 bg-indigo-600 text-white ring-2 ring-indigo-400/80 shadow-md"
                    : isSelected
                    ? "border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 hover:border-indigo-400 hover:shadow"
                    : "border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-400 opacity-60 hover:opacity-100"
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: routeColor }} />
                <span className="truncate max-w-[110px] font-bold">{v}</span>
                <span
                  className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-black border ${
                    count > 0
                      ? isExclusive
                        ? "bg-white text-indigo-900 border-white/80"
                        : "bg-indigo-50 text-indigo-950 border-indigo-200 dark:bg-zinc-800 dark:text-indigo-200 dark:border-zinc-700"
                      : "bg-zinc-100 text-zinc-600 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <MapContainer key={mapLayer} center={center} zoom={11} className="w-full h-full">
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
                <p className="text-[10px] text-zinc-600 mt-0.5 font-medium">Armazém / Centro de Distribuição</p>
                <p className="text-[9px] text-zinc-600 mt-1 font-mono">{wh.address}</p>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Visible Clients */}
        {visibleClients.map((c, idx) => {
          const isPending = isPendingRoute(c.Rota);
          const color = getRouteColor(c.Rota, vehicles);

          const clientName = c.Nome_Cliente || c.Cliente || "Cliente";
          const clientCode = c.Codigo_Cliente || (c.Cliente !== clientName ? c.Cliente : "") || "";
          const docNumber = c.Doc_ID || c.doc_id || c.numero_doc || "";
          const phone = c.Telefone || c.Telefone_Cliente || c.telefone || "";
          const driverNotes = c.Notas_Motorista || c.notas_motorista || c.Notas || c.notas || c.Observacoes || c.observacoes || "";
          const vendedor = c.Vendedor || c.vendedor || "";
          const stopWeight = c.Peso_KG !== undefined && c.Peso_KG !== null ? c.Peso_KG : (c.Carga_Acum || 0);
          const stopVolume = c.Volume_m3 !== undefined && c.Volume_m3 !== null ? c.Volume_m3 : (c.Volume_M3 || 0);
          const windowFormatted = formatTimeWindow(c.Janela_Horaria);
          const arrivalTime = c.Chegada && c.Chegada !== "00:00" ? c.Chegada : "";
          const departureTime = c.Saida && c.Saida !== "00:00" ? c.Saida : "";

          return (
            <Marker
              key={"marker-" + String(c.Cliente) + "-" + String(c.ID_Original || c.id || idx)}
              position={[c.Latitude, c.Longitude]}
              icon={createNumberedCircleIcon(
                c.Ordem,
                color,
                isPending,
                zoomLevel,
                selectedClientKeys.includes(String(c.id || c.ID_Original || c.Cliente))
              )}
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
                <div className="text-zinc-900 min-w-[280px] max-w-[340px] p-1 font-sans">
                  {/* 1. Header: Paragem # / Rota & Status */}
                  <div className="flex items-center justify-between border-b border-zinc-200 pb-2 mb-2">
                    <div className="flex items-center space-x-2">
                      <span className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: color }} />
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
                  </div>

                  {/* 3. Address */}
                  <div className="text-xs text-zinc-600 bg-zinc-50 rounded-lg p-2 border border-zinc-200 mb-2 space-y-0.5">
                    <p className="font-medium text-zinc-800 leading-tight">📍 {c.Morada || "Morada não especificada"}</p>
                    <p className="text-[10px] text-zinc-500 font-mono pl-4">{c.CP} {c.Localidade}</p>
                  </div>

                  {/* 4. Operational Metrics Grid */}
                  <div className="grid grid-cols-2 gap-1.5 text-[11px] mb-2">
                    <div className="bg-zinc-50 border border-zinc-200 rounded-md p-1.5">
                      <span className="text-[9px] text-zinc-400 uppercase font-semibold block">Janela Horária</span>
                      <span className="font-bold text-zinc-800 text-[11px]">{windowFormatted}</span>
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

                  {/* 6. Route Reassignment Selector inside Popup */}
                  {onMoveClientRoute && (
                    <div className="pt-2 border-t border-zinc-200 flex items-center justify-between gap-2">
                      <label className="text-[10px] font-bold text-zinc-600 shrink-0">Mover para:</label>
                      <select
                        value={isPending ? "Por Distribuir" : c.Rota}
                        onChange={(e) => onMoveClientRoute(c.Cliente || (c as any).Nome_Cliente || "", e.target.value, c.id || c.ID_Original, c.Morada, (c as any).Latitude || (c as any).lat, (c as any).Longitude || (c as any).lon)}
                        className="w-full text-[11px] bg-white border border-zinc-300 rounded-lg px-2 py-1 font-semibold text-zinc-800 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 cursor-pointer shadow-sm"
                      >
                        <option value="Por Distribuir">🟡 Por Distribuir</option>
                        {vehicles.map((v) => (
                          <option key={v} value={v}>
                            🚚 {v}
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

        {/* Area Selection Box Overlay */}
        <MapAreaSelector
          isSelecting={isBoxSelecting}
          onSelectionComplete={handleAreaSelectionComplete}
        />

        {/* Real OSRM Road Geometry Polylines (Strictly filtered to visible routes only) */}
        {showRoads && Object.entries(roadGeometries).map(([rName, coords]) => {
          if (!visibleRouteNames.has(rName)) return null;
          if (selectedRoutes.length > 0 && !selectedRoutes.includes(rName)) return null;
          const color = getRouteColor(rName, vehicles);

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
              <option value="Por Distribuir">🟡 Por Distribuir</option>
              {vehicles.map((v) => (
                <option key={v} value={v}>
                  🚚 {v}
                </option>
              ))}
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
    </div>
  );
}