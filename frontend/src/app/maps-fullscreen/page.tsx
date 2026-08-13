"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const CustomMap = dynamic(() => import("../dashboard/maps/CustomMap"), { ssr: false });

type Mapeamento = { id: string; cp: string; zona: string; cor: string; concelho?: string; distrito?: string; freguesia?: string };

export default function MapsFullscreen() {
  const [nome, setNome] = useState("");
  const [mapeamentos, setMapeamentos] = useState<Mapeamento[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("fullscreen_map_data");
      if (stored) {
        const parsed = JSON.parse(stored);
        setNome(parsed.nome || "");
        setMapeamentos(parsed.mapeamentos || []);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  return (
    <div className="w-screen h-screen bg-zinc-950 relative overflow-hidden">
      {nome && (
        <div className="absolute top-4 left-4 z-[2000] bg-zinc-900/90 backdrop-blur border border-zinc-800 px-4 py-2 rounded-lg shadow-lg pointer-events-none font-sans">
          <h2 className="text-zinc-100 font-bold text-base">{nome}</h2>
          <p className="text-zinc-550 text-xs">{mapeamentos.length} zonas mapeadas</p>
        </div>
      )}
      
      <div className="w-full h-full">
        <CustomMap mapeamentos={mapeamentos} />
      </div>
    </div>
  );
}
