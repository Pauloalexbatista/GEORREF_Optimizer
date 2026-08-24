"use client";

import React, { useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { useTheme } from "@/context/ThemeContext";
import "leaflet/dist/leaflet.css";

type Mapeamento = { cp: string; zona: string; cor: string; concelho?: string; distrito?: string; freguesia?: string };

function MapResizer() {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

function CP4Layer({ mapeamentos }: { mapeamentos: Mapeamento[] }) {
  const map = useMap();
  const layersRef = useRef<any[]>([]);

  useEffect(() => {
    // Remove old layers
    layersRef.current.forEach(l => {
      try { l.remove(); } catch {}
    });
    layersRef.current = [];

    if (mapeamentos.length === 0) return;

    let firstFit = true;

    mapeamentos.forEach(async (item) => {
      const cp = typeof item.cp === 'string' ? item.cp.trim() : String(item.cp || '').trim();
      if (!cp || cp.length < 4) return;

      try {
        const res = await fetch(`/api/maps/cp4-polygon/${cp}`);
        if (!res.ok) return;
        const geojson = await res.json();

        const L = (await import("leaflet")).default;
        
        // Build descriptive tooltip text
        let tooltipText = `<b>Zona:</b> ${item.zona || "Sem Nome"}<br/><b>CP:</b> ${cp}`;
        if (item.concelho) {
          tooltipText += `<br/><b>Município:</b> ${item.concelho} (${item.distrito})`;
        }
        if (item.freguesia) {
          tooltipText += `<br/><b>Freguesia:</b> ${item.freguesia}`;
        }

        const layer = L.geoJSON(geojson, {
          style: {
            fillColor: item.cor,
            weight: 2.5,
            opacity: 0.95,
            color: item.cor,
            fillOpacity: 0.6,
          }
        }).bindTooltip(tooltipText, { sticky: true, className: "custom-map-tooltip" });

        layer.addTo(map);
        layersRef.current.push(layer);

        if (firstFit) {
          map.fitBounds(layer.getBounds(), { padding: [50, 50] });
          firstFit = false;
        }
      } catch (e) {
        console.warn(`Error fetching polygon for CP4 ${cp}:`, e);
      }
    });
  }, [mapeamentos, map]);

  return null;
}

export default function CustomMap({ mapeamentos }: { mapeamentos: Mapeamento[] }) {
  const { theme } = useTheme();

  // Clean white/light tiles for light mode, dark tiles for dark mode
  const tileUrl = theme === "light"
    ? "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

  return (
    <MapContainer
      key={theme}
      center={[39.3999, -8.2245]}
      zoom={6}
      style={{ height: "100%", width: "100%", borderRadius: "0.75rem" }}
      zoomControl={true}
    >
      <TileLayer
        url={tileUrl}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
      />
      <MapResizer />
      <CP4Layer mapeamentos={mapeamentos} />
    </MapContainer>
  );
}
