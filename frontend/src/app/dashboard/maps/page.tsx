"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { apiRequest } from "@/utils/api";
import dynamic from "next/dynamic";

const CustomMap = dynamic(() => import("./CustomMap"), { ssr: false });

type Mapeamento = { id: string; cp: string; zona: string; cor: string; concelho?: string; distrito?: string; freguesia?: string };
type MapaGuardado = { id: string; nome: string; created_at: string };
type SortField = "zona" | "cp" | null;
type SortDir = "asc" | "desc";

const PRESET_COLORS = [
  "#ef4444","#f97316","#eab308","#22c55e","#14b8a6",
  "#3b82f6","#8b5cf6","#ec4899","#f43f5e","#06b6d4",
  "#84cc16","#a855f7","#f59e0b","#10b981","#6366f1",
  "#e11d48","#0ea5e9","#d946ef","#64748b","#ffffff",
];

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 220) });
    }
    setOpen(!open);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) {
        const panel = document.getElementById('color-picker-panel');
        if (panel && !panel.contains(e.target as Node)) setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div>
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        className="w-7 h-7 rounded-md border-2 border-zinc-700 hover:border-zinc-500 transition-colors cursor-pointer shadow-inner"
        style={{ backgroundColor: value }}
        title="Escolher cor"
      />
      {open && typeof window !== 'undefined' && (
        <div
          id="color-picker-panel"
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 shadow-2xl w-52"
        >
          <div className="grid grid-cols-5 gap-1.5 mb-3">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => { onChange(c); setOpen(false); }}
                className={`w-7 h-7 rounded-md border-2 transition-all hover:scale-110 ${value === c ? "border-white scale-110" : "border-transparent"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="border-t border-zinc-700 pt-2.5">
            <label className="block text-xs text-zinc-500 mb-1">Cor personalizada</label>
            <input
              type="color"
              value={value}
              onChange={e => onChange(e.target.value)}
              className="w-full h-8 rounded-lg cursor-pointer border-0 bg-zinc-800 p-0.5"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function MapsPage() {
  const [nomeMapa, setNomeMapa] = useState("");
  const [mapeamentos, setMapeamentos] = useState<Mapeamento[]>([]);
  const [mapasGuardados, setMapasGuardados] = useState<MapaGuardado[]>([]);
  const [selectedMapaId, setSelectedMapaId] = useState<string>("");
  const [filterText, setFilterText] = useState("");
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [isUploading, setIsUploading] = useState(false);
  const [mapFullscreen, setMapFullscreen] = useState(false);

  const handleOpenFullscreen = () => {
    localStorage.setItem(
      "fullscreen_map_data",
      JSON.stringify({ nome: nomeMapa || "Mapa Sem Nome", mapeamentos })
    );
    window.open("/maps-fullscreen", "_blank");
  };
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadMapsList = async () => {
    try {
      const data = await apiRequest("/api/maps/list");
      setMapasGuardados(data);
    } catch (e) {
      console.error("Failed to load maps list", e);
    }
  };

  useEffect(() => {
    loadMapsList();
  }, []);

  const handleExportExcel = async () => {
    try {
      const response = await fetch(`/api/maps/export-excel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("georoute_token")}`
        },
        body: JSON.stringify({ mapeamentos: mapeamentos })
      });
      if (!response.ok) throw new Error("Erro a exportar Excel");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${nomeMapa || "mapa_export"}_zonas.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      alert("Erro ao exportar Excel");
    }
  };

    const handleClearMapa = () => {
    setSelectedMapaId("");
    setNomeMapa("");
    setMapeamentos([]);
  };

  const handleSaveMapa = async () => {
    if (!nomeMapa.trim()) return alert("Dê um nome ao mapa!");
    try {
      const res = await apiRequest("/api/maps/save", {
        method: "POST",
        body: JSON.stringify({
          id: selectedMapaId || null,
          nome: nomeMapa,
          mapeamentos: mapeamentos,
        })
      });
      alert("Mapa guardado com sucesso!");
      await loadMapsList();
      if (!selectedMapaId) {
        setSelectedMapaId(res.id);
      }
    } catch (e) {
      alert("Erro ao guardar mapa");
    }
  };

  const handleSelectMapa = async (id: string) => {
    setSelectedMapaId(id);
    if (!id) {
      setNomeMapa("");
      setMapeamentos([]);
      return;
    }
    try {
      const data = await apiRequest(`/api/maps/${id}`);
      setNomeMapa(data.nome);
      const mapped = data.mapeamentos.map((m: any, idx: number) => ({
        id: `xls_${idx}_${Date.now()}`,
        ...m
      }));
      setMapeamentos(mapped);
    } catch (e) {
      console.error("Failed to load map details", e);
    }
  };

  const handleDeleteMapa = async () => {
    if (!selectedMapaId) return;
    if (!confirm("Tem a certeza que deseja apagar este mapa permanentemente?")) return;
    try {
      await apiRequest(`/api/maps/${selectedMapaId}`, { method: "DELETE" });
      setSelectedMapaId("");
      setNomeMapa("");
      setMapeamentos([]);
      await loadMapsList();
    } catch (e) {
      alert("Erro ao apagar mapa");
    }
  };

  const handleImportExcelClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    setIsUploading(true);
    try {
      const data = await apiRequest("/api/maps/upload-excel", {
        method: "POST",
        body: formData,
      });
      const mapped = data.mapeamentos.map((m: any, idx: number) => ({
        id: `xls_${idx}_${Date.now()}`,
        ...m
      }));
      setMapeamentos(mapped);
    } catch (err: any) {
      alert("Erro a ler o Excel: " + err.message);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const updateRow = (index: number, field: keyof Mapeamento, val: string) => {
    const up = [...mapeamentos];
    up[index] = { ...up[index], [field]: val };
    setMapeamentos(up);
  };

  const handleCPBlur = async (index: number, cpVal: string) => {
    const cp = cpVal.trim();
    if (cp.length < 4) return;
    try {
      const info = await apiRequest(`/api/maps/cp4-info/${cp}`);
      const up = [...mapeamentos];
      up[index] = { ...up[index], concelho: info.concelho, distrito: info.distrito, freguesia: info.freguesia };
      setMapeamentos(up);
    } catch (e) {
      // Ignora erro se CP não existir na base de dados
    }
  };

  const handleDeleteRow = (index: number) => {
    setMapeamentos(mapeamentos.filter((_, i) => i !== index));
  };

  const handleAddRow = () => {
    const defaultColor = mapeamentos.length > 0 ? mapeamentos[0].cor : PRESET_COLORS[0];
    setMapeamentos([{ id: \ow_\_\\, zona: "", cp: "", cor: defaultColor }, ...mapeamentos]);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="text-zinc-600 ml-1">⇅</span>;
    return <span className="text-indigo-400 ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  const filteredSorted = useMemo(() => {
    let result = [...mapeamentos];
    if (filterText.trim()) {
      const f = filterText.toLowerCase();
      result = result.filter(m => 
        m.zona.toLowerCase().includes(f) || 
        m.cp.includes(f) ||
        (m.concelho && m.concelho.toLowerCase().includes(f)) ||
        (m.distrito && m.distrito.toLowerCase().includes(f))
      );
    }
    if (sortField) {
      result.sort((a, b) => {
        const va = String(a[sortField]).toLowerCase();
        const vb = String(b[sortField]).toLowerCase();
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    }
    return result;
  }, [mapeamentos, filterText, sortField, sortDir]);

  const mapData = useMemo(() => mapeamentos.filter(m => m.cp.trim().length >= 4), [mapeamentos]);

  return (
    <DashboardLayout>
      <div className="space-y-5 max-w-7xl mx-auto">
        <input 
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".xlsx,.xls"
          className="hidden"
        />

        {/* Header */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex flex-col md:flex-row md:items-end gap-4 no-print">
          <div className="flex-1 max-w-sm">
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">Selecionar Mapa</label>
            <select
              value={selectedMapaId}
              onChange={e => handleSelectMapa(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-zinc-100 outline-none"
            >
              <option value="">-- Criar Novo Mapa --</option>
              {mapasGuardados.map(m => (
                <option key={m.id} value={m.id}>{m.nome}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 max-w-sm">
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">Nome do Mapa</label>
            <input
              type="text"
              value={nomeMapa}
              onChange={e => setNomeMapa(e.target.value)}
              placeholder="Ex: Zonas Comerciais Norte"
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-650 outline-none"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSaveMapa} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors cursor-pointer">
              Guardar
            </button>
              <button 
                onClick={handleClearMapa} 
                className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors cursor-pointer"
              >
                Limpar
              </button>
            {selectedMapaId && (
              <button onClick={handleDeleteMapa} className="bg-zinc-800 hover:bg-red-950/60 border border-zinc-700 text-zinc-400 hover:text-red-400 text-sm px-3.5 py-2.5 rounded-xl transition-colors cursor-pointer">
                🗑
              </button>
            )}
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Table Panel */}
          <div className="flex flex-col gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col h-[600px] print-table-card">

              {/* Table Header */}
              <div className="p-3 border-b border-zinc-800 space-y-2 bg-zinc-900/80 no-print">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-zinc-200">Zonas e Códigos Postais</span>
                  <div className="flex gap-2">
                    <button 
                      onClick={handleImportExcelClick} 
                      disabled={isUploading}
                      className="text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 px-3 py-1.5 rounded-lg border border-zinc-700 transition-colors cursor-pointer"
                    >
                      {isUploading ? "A carregar..." : "↑ Importar Excel"}
                    </button>
                    <button onClick={handleAddRow} className="text-xs bg-indigo-500 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-lg transition-colors cursor-pointer">
                      + Linha
                    </button>
                  </div>
                </div>
                <p className="text-[10px] text-zinc-550 leading-relaxed">
                  💡 <b>Colunas necessárias:</b> Código Postal (ex: <i>CP</i>, <i>CP4</i>) e Nome da Zona (ex: <i>Zone</i>, <i>Zona</i>).
                </p>
                <input
                  type="text"
                  value={filterText}
                  onChange={e => setFilterText(e.target.value)}
                  placeholder="🔍 Filtrar por zona, CP ou concelho..."
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-lg px-3 py-1.5 text-xs text-zinc-300 placeholder-zinc-650 outline-none"
                />
              </div>

              {/* Table Body */}
              <div className="flex-1 overflow-auto">
                {filteredSorted.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-zinc-600 text-sm">
                    {mapeamentos.length === 0
                      ? "Lista vazia. Clique em + Linha ou Importar Excel."
                      : "Nenhum resultado para o filtro aplicado."}
                  </div>
                ) : (
                  <table className="w-full text-left text-sm text-zinc-300 border-collapse">
                    <thead className="text-[11px] uppercase text-zinc-500">
                      <tr>
                        <th
                          className="px-3 py-2.5 font-semibold cursor-pointer hover:text-zinc-300 select-none sticky top-0 bg-zinc-950 z-10 border-b border-zinc-800"
                          onClick={() => handleSort("zona")}
                        >
                          Zona <SortIcon field="zona" />
                        </th>
                        <th
                          className="px-3 py-2.5 font-semibold cursor-pointer hover:text-zinc-300 select-none sticky top-0 bg-zinc-950 z-10 border-b border-zinc-800"
                          onClick={() => handleSort("cp")}
                        >
                          CP4 <SortIcon field="cp" />
                        </th>
                        <th className="px-3 py-2.5 font-semibold w-16 text-center sticky top-0 bg-zinc-950 z-10 border-b border-zinc-800">Cor</th>
                        <th className="px-3 py-2.5 w-8 sticky top-0 bg-zinc-950 z-10 border-b border-zinc-800 no-print"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/40">
                      {filteredSorted.map((item, displayIdx) => {
                        const realIdx = mapeamentos.findIndex(m => m.id === item.id);
                        return (
                          <tr key={item.id} className="hover:bg-zinc-800/20 transition-colors group">
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={item.zona}
                                onChange={e => updateRow(realIdx, "zona", e.target.value)}
                                placeholder="Nome da zona"
                                className="w-full bg-transparent text-sm outline-none text-zinc-200 placeholder-zinc-700 font-semibold"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={item.cp}
                                onChange={e => updateRow(realIdx, "cp", e.target.value)}
                                onBlur={e => handleCPBlur(realIdx, e.target.value)}
                                placeholder="Ex: 7000"
                                maxLength={8}
                                className="w-full bg-transparent text-xs font-mono outline-none text-zinc-400 placeholder-zinc-700"
                              />
                              {item.concelho && (
                                <div className="text-[10px] text-zinc-500 font-sans mt-0.5 leading-snug">
                                  {item.distrito} · {item.concelho}
                                  {item.freguesia && <span className="block text-[9px] text-zinc-600 italic">{item.freguesia}</span>}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <div className="flex justify-center">
                                <ColorPicker
                                  value={item.cor}
                                  onChange={cor => updateRow(realIdx, "cor", cor)}
                                />
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right no-print">
                              <button
                                onClick={() => handleDeleteRow(realIdx)}
                                className="text-zinc-750 hover:text-red-450 transition-colors opacity-0 group-hover:opacity-100 text-xs font-bold cursor-pointer"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Stats footer */}
              <div className="px-3 py-2 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-600 bg-zinc-950/40">
                <span>{mapeamentos.length} linhas · {[...new Set(mapeamentos.map(m => m.zona))].filter(Boolean).length} zonas</span>
                {filterText && <span className="text-indigo-400">{filteredSorted.length} resultados</span>}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 no-print">
              <button onClick={() => window.print()} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-sm py-2.5 rounded-xl border border-zinc-700 transition-colors cursor-pointer">
                Exportar PDF
              </button>
              <button onClick={handleExportExcel} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-sm py-2.5 rounded-xl border border-zinc-700 transition-colors cursor-pointer">
                Exportar Excel
              </button>
            </div>
          </div>

          {/* Map Container */}
          <div className={`${mapFullscreen ? 'fixed inset-0 z-[5000] w-screen h-screen p-4 bg-zinc-950/90 backdrop-blur-md' : ''}`}>
            <div 
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-1.5 relative z-0 print-map-card" 
              style={{ height: mapFullscreen ? "100%" : "600px" }}
            >
              {/* Map Title overlay */}
              {nomeMapa && (
                <div className="absolute top-4 left-4 z-[2000] bg-zinc-900/90 backdrop-blur border border-zinc-750 px-4 py-2 rounded-lg shadow-lg pointer-events-none">
                  <h2 className="text-zinc-100 font-bold text-base">{nomeMapa}</h2>
                  <p className="text-zinc-550 text-xs">{mapData.length} zonas mapeadas</p>
                </div>
              )}
              
              {/* Map Action Toggle Buttons */}
              <div className="absolute top-4 right-4 z-[2000] flex space-x-2">
                <button
                  onClick={handleOpenFullscreen}
                  className="bg-zinc-900/95 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-lg transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                  </svg>
                  Novo Separador
                </button>
              </div>

              <CustomMap mapeamentos={mapData} />
            </div>
          </div>

        </div>
      </div>
    </DashboardLayout>
  );
}


