"use client";

import React, { useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const API_BASE = "";

type Mapeamento = { cp: string; zona: string; cor: string; concelho?: string; distrito?: string; freguesia?: string };

function MapResizer() {
  const map = useMap();
  useEffect(() => {
    setTimeout(() => {
      map.invalidateSize();
    }, 150);
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
  return (
    <MapContainer
      center={[39.3999, -8.2245]}
      zoom={6}
      style={{ height: "100%", width: "100%", borderRadius: "0.5rem" }}
      zoomControl={true}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; OSM &copy; CARTO'
      />
      <MapResizer />
      <CP4Layer mapeamentos={mapeamentos} />
    </MapContainer>
  );
}


