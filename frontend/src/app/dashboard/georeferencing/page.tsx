"use client";

import React, { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
const DeliveryMapPicker = dynamic(() => import("@/components/DeliveryMapPicker"), { ssr: false });
import DashboardLayout from "@/components/DashboardLayout";
import { useProjects } from "@/context/ProjectContext";
import { apiRequest } from "@/utils/api";

interface Delivery {
  id: number;
  codigo_cliente: string;
  nome_cliente?: string;
  morada: string;
  codigo_postal: string;
  concelho: string;
  peso_kg: number;
  volume_m3: number;
  prioridade: number;
  janela_inicio: string;
  janela_fim: string;
  latitude: number;
  longitude: number;
  nivel_qualidade: number;
  fonte_match: string;
  morada_encontrada: string;
  motivo_falha?: string;
}

export default function GeoreferencingPage() {
  const { selectedProject } = useProjects();
  const [step, setStep] = useState<"upload" | "geocoding" | "results">("upload");
  const [loading, setLoading] = useState(false);
  const [fileId, setFileId] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  
  // Mapping state
  const [colCode, setColCode] = useState("");
  const [colName, setColName] = useState("");
  const [colAddr, setColAddr] = useState("");
  const [colCp, setColCp] = useState("");
  const [colCity, setColCity] = useState("");
  const [colWeight, setColWeight] = useState("");
  const [colVolume, setColVolume] = useState("");
  const [colPriority, setColPriority] = useState("");
  const [colStartWindow, setColStartWindow] = useState("");
  const [colEndWindow, setColEndWindow] = useState("");
  const [colLat, setColLat] = useState("");
  const [colLon, setColLon] = useState("");

  // Correction state
  const [editingDelivery, setEditingDelivery] = useState<Delivery | null>(null);
  const [corrAddr, setCorrAddr] = useState("");
  const [corrCp, setCorrCp] = useState("");
  const [corrCity, setCorrCity] = useState("");
  const [corrLat, setCorrLat] = useState(0.0);
  const [corrLon, setCorrLon] = useState(0.0);
  const [googleCoordsInput, setGoogleCoordsInput] = useState("");

  // Suggestions state
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  // Filter and sort states
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "failed">("all");
  const [sortField, setSortField] = useState<string>("status");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleDownloadFile = async (endpoint: string, filename: string) => {
    try {
      const token = localStorage.getItem("georoute_token");
      const headers = new Headers();
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      const response = await fetch(`${endpoint}`, { headers });
      if (!response.ok) {
        throw new Error("Erro ao descarregar ficheiro.");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e.message || "Erro ao efetuar o download.");
    }
  };

  const filteredAndSortedDeliveries = useMemo(() => {
    let result = [...deliveries];
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(d => 
        (d.codigo_cliente || "").toLowerCase().includes(term) ||
        (d.morada || "").toLowerCase().includes(term) ||
        (d.concelho && d.concelho.toLowerCase().includes(term))
      );
    }
    if (statusFilter === "success") {
      result = result.filter(d => !(d.latitude === 0.0 || d.longitude === 0.0 || d.nivel_qualidade === 99));
    } else if (statusFilter === "failed") {
      result = result.filter(d => (d.latitude === 0.0 || d.longitude === 0.0 || d.nivel_qualidade === 99));
    }
    result.sort((a, b) => {
      const isFailedA = a.latitude === 0.0 || a.longitude === 0.0 || a.nivel_qualidade === 99;
      const isFailedB = b.latitude === 0.0 || b.longitude === 0.0 || b.nivel_qualidade === 99;
      if (sortField === "status") {
        if (isFailedA && !isFailedB) return sortDirection === "asc" ? -1 : 1;
        if (!isFailedA && isFailedB) return sortDirection === "asc" ? 1 : -1;
        return sortDirection === "asc" ? a.nivel_qualidade - b.nivel_qualidade : b.nivel_qualidade - a.nivel_qualidade;
      }
      let valA = a[sortField as keyof Delivery] || "";
      let valB = b[sortField as keyof Delivery] || "";
      if (typeof valA === "string") {
        valA = (valA as string).toLowerCase();
        valB = (valB as string).toLowerCase();
      }
      if (valA < valB) return sortDirection === "asc" ? -1 : 1;
      if (valA > valB) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
    return result;
  }, [deliveries, searchTerm, statusFilter, sortField, sortDirection]);

  // Load suggestions on change of address fields
  useEffect(() => {
    if (!editingDelivery) return;
    if (!corrAddr && !corrCp) {
      setSuggestions([]);
      return;
    }

    const delayDebounceFn = setTimeout(async () => {
      setSuggestionsLoading(true);
      try {
        const queryParams = new URLSearchParams();
        if (corrAddr) queryParams.append("morada", corrAddr);
        if (corrCp) queryParams.append("cp", corrCp);
        if (corrCity) queryParams.append("concelho", corrCity);

        const data = await apiRequest(`/api/geocoding/suggestions?${queryParams.toString()}`);
        setSuggestions(data);
      } catch (err) {
        console.error("Failed to fetch suggestions:", err);
      } finally {
        setSuggestionsLoading(false);
      }
    }, 450);

    return () => clearTimeout(delayDebounceFn);
  }, [corrAddr, corrCp, corrCity, editingDelivery]);

  // Load existing deliveries on mount/project change
  useEffect(() => {
    if (!selectedProject) return;
    
    async function loadDeliveries() {
      setLoading(true);
      try {
        const data = await apiRequest(`/api/geocoding/${selectedProject?.id}`);
        if (data.length > 0) {
          setDeliveries(data);
          setStep("results");
        } else {
          setDeliveries([]);
          setStep("upload");
        }
      } catch (e) {
        console.error("Failed to load deliveries:", e);
      } finally {
        setLoading(false);
      }
    }
    loadDeliveries();
  }, [selectedProject]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedProject) return;

    setLoading(true);
    setStep("geocoding");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const importRes = await apiRequest(`/api/fleet/import/${selectedProject.id}`, {
        method: "POST",
        body: formData,
      });
      const data = await apiRequest(`/api/geocoding/${selectedProject.id}`);
      setDeliveries(data);
      setStep("results");
    } catch (err: any) {
      alert(err.message || "Erro ao importar GeoRoutePlan.xlsx. Certifique-se de que utiliza o modelo oficial.");
      setStep("upload");
    } finally {
      setLoading(false);
    }
  };

  const handleStartGeocoding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileId || !selectedProject) return;

    setStep("geocoding");
    setLoading(true);

    try {
      await apiRequest("/api/geocoding/start", {
        method: "POST",
        body: JSON.stringify({
          file_id: fileId,
          project_id: selectedProject.id,
          col_code: colCode,
          col_name: colName,
          col_addr: colAddr,
          col_cp: colCp,
          col_city: colCity,
          col_weight: colWeight,
          col_volume: colVolume,
          col_priority: colPriority || null,
          col_start_window: colStartWindow || null,
          col_end_window: colEndWindow || null,
          col_lat: colLat || null,
          col_lon: colLon || null,
        }),
      });

      // Load results
      const data = await apiRequest(`/api/geocoding/${selectedProject.id}`);
      setDeliveries(data);
      setStep("results");
    } catch (err: any) {
      alert(err.message || "Erro no processamento da georreferenciação.");
      setStep("upload");
    } finally {
      setLoading(false);
    }
  };

  const openCorrection = (del: Delivery) => {
    setEditingDelivery(del);
    setCorrAddr(del.morada);
    setCorrCp(del.codigo_postal);
    setCorrCity(del.concelho);
    setCorrLat(del.latitude);
    setCorrLon(del.longitude);
    setGoogleCoordsInput("");
  };

  const submitCorrection = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!editingDelivery || !selectedProject) return;

    setLoading(true);
    try {
      await apiRequest(`/api/geocoding/delivery/${editingDelivery.id}`, {
        method: "PUT",
        body: JSON.stringify({
          morada: corrAddr,
          codigo_postal: corrCp,
          concelho: corrCity,
          latitude: corrLat,
          longitude: corrLon,
        }),
      });

      // Refresh list
      const data = await apiRequest(`/api/geocoding/${selectedProject.id}`);
      setDeliveries(data);

      const currentIndex = filteredAndSortedDeliveries.findIndex(d => d.id === editingDelivery.id);
      const remainingFailed = filteredAndSortedDeliveries.filter(
        (d, idx) => idx > currentIndex && (d.latitude === 0.0 || d.longitude === 0.0 || d.nivel_qualidade === 99)
      );

      if (remainingFailed.length > 0) {
        openCorrection(remainingFailed[0]);
      } else {
        setEditingDelivery(null);
      }
    } catch (err: any) {
      alert(err.message || "Erro ao guardar correção.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Georreferenciação</h1>
            <p className="text-zinc-400 text-xs mt-1">Valide e atribua coordenadas precisas às encomendas dos seus clientes.</p>
          </div>
          {step === "results" && (
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setStep("upload")}
                className="cursor-pointer bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-xl px-4 py-2 text-xs font-semibold transition-colors"
              >
                Carregar Novo Ficheiro
              </button>
              <button
                onClick={() => handleDownloadFile(`/api/geocoding/export/${selectedProject?.id}`, `Clientes_Georreferenciados_${selectedProject?.id}.xlsx`)}
                className="cursor-pointer bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl px-4 py-2 text-xs font-semibold shadow-md shadow-indigo-500/10 transition-colors flex items-center space-x-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Exportar Excel</span>
              </button>
            </div>
          )}
        </div>

        {step === "upload" && (
          <div className="border border-dashed border-zinc-800 rounded-2xl p-12 text-center bg-zinc-900/30 flex flex-col items-center justify-center space-y-4 max-w-xl mx-auto mt-8">
            <div className="w-12 h-12 rounded-xl bg-zinc-800/80 flex items-center justify-center text-zinc-400">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-200">Carregar Ficheiro de Encomendas</h3>
              <p className="text-xs text-zinc-500 mt-1 max-w-sm">
                Arraste ou carregue um ficheiro Excel (.xlsx, .xls) ou CSV contendo os dados dos clientes e entregas.
              </p>
            </div>
            <div>
              <label className="cursor-pointer bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white rounded-xl px-5 py-2.5 text-xs font-semibold shadow-md shadow-indigo-500/10 transition-all inline-block">
                <span>{loading ? "A carregar..." : "+ Selecionar Ficheiro"}</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  disabled={loading}
                  className="hidden"
                />
              </label>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => handleDownloadFile("/api/fleet/template/unified", "GeoRoutePlan.xlsx")}
                className="text-[11px] text-zinc-400 hover:text-indigo-400 transition-colors flex items-center space-x-1.5 cursor-pointer"
              >
                <span>📥</span>
                <span className="underline">Descarregar Modelo Excel</span>
              </button>
            </div>
          </div>
        )}

        {step === "geocoding" && (
          <div className="border border-zinc-800 rounded-2xl p-12 text-center bg-zinc-900/30 flex flex-col items-center justify-center space-y-4 max-w-md mx-auto mt-8">
            <div className="w-10 h-10 rounded-full border-2 border-indigo-500/20 border-t-indigo-500 animate-spin" />
            <div>
              <h3 className="text-sm font-semibold text-zinc-200">A Georreferenciar Encomendas...</h3>
              <p className="text-xs text-zinc-500 mt-1">A cruzar moradas com a base de dados de códigos postais e coordenadas GPS.</p>
            </div>
          </div>
        )}

        {step === "results" && (
          <div className="space-y-4">
            {/* Filters Bar */}
            <div className="flex items-center justify-between bg-zinc-900/40 p-4 border border-zinc-800 rounded-2xl gap-4">
              <div className="flex items-center space-x-2 flex-1 max-w-md">
                <input
                  type="text"
                  placeholder="Pesquisar por cliente, morada ou concelho..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setStatusFilter("all")}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    statusFilter === "all" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Todos ({deliveries.length})
                </button>
                <button
                  onClick={() => setStatusFilter("success")}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    statusFilter === "success" ? "bg-emerald-950 text-emerald-300 border border-emerald-800/60" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Válidos ({deliveries.filter(d => d.latitude !== 0.0 && d.longitude !== 0.0 && d.nivel_qualidade !== 99).length})
                </button>
                <button
                  onClick={() => setStatusFilter("failed")}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    statusFilter === "failed" ? "bg-amber-950 text-amber-300 border border-amber-800/60" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Pendentes de Ajuste ({deliveries.filter(d => d.latitude === 0.0 || d.longitude === 0.0 || d.nivel_qualidade === 99).length})
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="border border-zinc-800 rounded-2xl bg-zinc-900/40 overflow-hidden shadow-xl">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-zinc-950 border-b border-zinc-800 text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                    <th onClick={() => handleSort("status")} className="py-3 px-4 cursor-pointer">Estado</th>
                    <th onClick={() => handleSort("codigo_cliente")} className="py-3 px-4 cursor-pointer">Código</th>
                    <th onClick={() => handleSort("morada")} className="py-3 px-4 cursor-pointer">Morada Original</th>
                    <th className="py-3 px-4">CP</th>
                    <th className="py-3 px-4">Concelho</th>
                    <th className="py-3 px-4">Coordenadas</th>
                    <th className="py-3 px-4 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedDeliveries.map((del) => {
                    const isValid = del.latitude !== 0.0 && del.longitude !== 0.0 && del.nivel_qualidade !== 99;
                    return (
                      <tr key={del.id} className="border-b border-zinc-800/40 hover:bg-zinc-800/30 transition-colors">
                        <td className="py-2.5 px-4">
                          {isValid ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-950 text-emerald-400 border border-emerald-800/60">
                              Nível {del.nivel_qualidade}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-950 text-amber-400 border border-amber-800/60">
                              Pendente
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-zinc-200">{del.nome_cliente || del.codigo_cliente}</div>
                          {del.nome_cliente && del.nome_cliente !== del.codigo_cliente && (
                            <div className="text-[10px] text-zinc-500 font-mono">{del.codigo_cliente}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-zinc-300 truncate max-w-xs">{del.morada}</td>
                        <td className="py-2.5 px-4 text-zinc-400 font-mono">{del.codigo_postal || "N/A"}</td>
                        <td className="py-2.5 px-4 text-zinc-400">{del.concelho || "N/A"}</td>
                        <td className="py-2.5 px-4 font-mono text-zinc-300">
                          {isValid ? `${del.latitude.toFixed(5)}, ${del.longitude.toFixed(5)}` : "--, --"}
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          <button
                            onClick={() => openCorrection(del)}
                            className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors"
                          >
                            Corrigir
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Correction Modal */}
        {editingDelivery && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-5xl p-6 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                <div>
                  <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                    <span>Ajustar Coordenadas do Cliente:</span>
                    <span className="text-indigo-400 font-mono">{editingDelivery.codigo_cliente}</span>
                    {editingDelivery.nome_cliente && (
                      <span className="text-zinc-400 font-normal text-sm">({editingDelivery.nome_cliente})</span>
                    )}
                  </h3>
                  <p className="text-zinc-400 text-xs mt-0.5">
                    Selecione uma sugestão, pesquise online ou clique diretamente no mapa para posicionar a entrega.
                  </p>
                </div>
                <button
                  onClick={() => setEditingDelivery(null)}
                  className="text-zinc-400 hover:text-zinc-200 text-sm p-1.5 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={submitCorrection} className="space-y-4 text-xs">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Left Column: Form & Suggestions (5 cols) */}
                  <div className="lg:col-span-5 space-y-3">
                    <div>
                      <label className="block text-zinc-400 font-semibold mb-1 text-[11px]">Morada</label>
                      <input
                        type="text"
                        value={corrAddr}
                        onChange={(e) => setCorrAddr(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500 text-xs"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-zinc-400 font-semibold mb-1 text-[11px]">Código Postal</label>
                        <input
                          type="text"
                          value={corrCp}
                          onChange={(e) => setCorrCp(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500 font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-zinc-400 font-semibold mb-1 text-[11px]">Concelho</label>
                        <input
                          type="text"
                          value={corrCity}
                          onChange={(e) => setCorrCity(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500 text-xs"
                        />
                      </div>
                    </div>

                    {/* Google Maps Smart Paste */}
                    <div className="bg-indigo-950/30 border border-indigo-500/30 rounded-xl p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="block text-[11px] font-bold text-indigo-300">
                          📋 Colar Coordenadas (Google Maps)
                        </label>
                        <span className="text-[9px] text-zinc-400 font-mono">Ex: 38.600914, -7.888504</span>
                      </div>
                      <input
                        type="text"
                        value={googleCoordsInput}
                        placeholder="Cole aqui (ex: 38.600914, -7.888504)..."
                        onChange={(e) => {
                          const val = e.target.value;
                          setGoogleCoordsInput(val);
                          const clean = val.trim();
                          if (!clean) return;
                          const parts = clean.split(/[,;\s\t]+/).filter(Boolean);
                          if (parts.length >= 2) {
                            const pLat = parseFloat(parts[0].replace(",", "."));
                            const pLon = parseFloat(parts[1].replace(",", "."));
                            if (!isNaN(pLat) && !isNaN(pLon) && pLat >= -90 && pLat <= 90 && pLon >= -180 && pLon <= 180) {
                              setCorrLat(pLat);
                              setCorrLon(pLon);
                            }
                          }
                        }}
                        className="w-full bg-zinc-950 border border-indigo-500/40 rounded-lg px-3 py-1.5 text-xs text-emerald-400 font-mono outline-none focus:border-indigo-400 placeholder-zinc-600"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-zinc-400 font-semibold mb-1 text-[11px]">Latitude</label>
                        <input
                          type="number"
                          step="any"
                          value={corrLat}
                          onChange={(e) => setCorrLat(Number(e.target.value))}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500 font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-zinc-400 font-semibold mb-1 text-[11px]">Longitude</label>
                        <input
                          type="number"
                          step="any"
                          value={corrLon}
                          onChange={(e) => setCorrLon(Number(e.target.value))}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500 font-mono text-xs"
                        />
                      </div>
                    </div>

                    {/* Suggestions Section */}
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                          Sugestões da Base de Dados CTT:
                        </span>
                        {suggestionsLoading && (
                          <span className="text-[10px] text-indigo-400 animate-pulse">A pesquisar...</span>
                        )}
                      </div>
                      {suggestions.length > 0 ? (
                        <div className="max-h-44 overflow-y-auto space-y-1.5 bg-zinc-950 p-2 border border-zinc-800 rounded-xl">
                          {suggestions.map((s, idx) => (
                            <div
                              key={idx}
                              onClick={() => {
                                setCorrAddr(s.morada || corrAddr);
                                setCorrCp(s.cp || corrCp);
                                setCorrCity(s.concelho || corrCity);
                                setCorrLat(s.lat || corrLat);
                                setCorrLon(s.lon || corrLon);
                              }}
                              className="p-2 hover:bg-zinc-850 bg-zinc-900/60 border border-zinc-800/80 rounded-lg cursor-pointer text-xs text-zinc-300 transition-colors flex items-center justify-between gap-2"
                            >
                              <div className="truncate">
                                <div className="font-semibold text-zinc-200 truncate">{s.morada || s.address}</div>
                                <div className="text-[10px] text-zinc-400">{s.concelho || s.localidade}</div>
                              </div>
                              <div className="text-right shrink-0">
                                <span className="font-mono text-xs text-indigo-400 block">{s.cp}</span>
                                {s.score !== undefined && (
                                  <span className="text-[9px] text-emerald-400 font-bold">{Math.round(s.score)}% match</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-3 text-[11px] text-zinc-500 bg-zinc-950/50 border border-zinc-800/50 rounded-xl italic text-center">
                          {suggestionsLoading ? "A procurar sugestões..." : "Sem sugestões exatas na BD. Use o mapa ao lado para pesquisar ou clicar."}
                        </div>
                      )}
                  </div>
                </div>

                {/* Right Column: Interactive Leaflet Map (7 cols) */}
                <div className="lg:col-span-7 flex flex-col min-h-[380px]">
                  <DeliveryMapPicker
                    lat={corrLat}
                    lon={corrLon}
                    onCoordsChange={(newLat, newLon) => {
                      setCorrLat(newLat);
                      setCorrLon(newLon);
                    }}
                    searchAddress={`${corrAddr} ${corrCp} ${corrCity}`}
                  />
                </div>
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setEditingDelivery(null)}
                  className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-300 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold cursor-pointer transition-all flex items-center space-x-2 shadow-lg shadow-indigo-600/20"
                >
                  {loading && (
                    <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  )}
                  <span>{loading ? "A gravar..." : "Gravar & Próximo"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
  </DashboardLayout>
  );
}
