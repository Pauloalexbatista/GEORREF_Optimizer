"use client";

import React, { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useProjects } from "@/context/ProjectContext";
import { apiRequest } from "@/utils/api";

interface Delivery {
  id: number;
  codigo_cliente: string;
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
}

export default function GeoreferencingPage() {
  const { selectedProject } = useProjects();
  const [step, setStep] = useState<"upload" | "mapping" | "geocoding" | "results">("upload");
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
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await apiRequest("/api/geocoding/upload", {
        method: "POST",
        body: formData,
      });
      setFileId(res.file_id);
      setFilename(res.filename);
      setColumns(res.columns);
      
      // Auto-mapping defaults
      const cols = res.columns as string[];
      setColCode(cols.find(c => c.toLowerCase().includes("cod") || c.toLowerCase().includes("client")) || cols[0] || "");
      setColName(cols.find(c => c.toLowerCase().includes("nome") || c.toLowerCase().includes("design")) || cols[0] || "");
      setColAddr(cols.find(c => c.toLowerCase().includes("morada") || c.toLowerCase().includes("rua") || c.toLowerCase().includes("address")) || cols[0] || "");
      setColCp(cols.find(c => c.toLowerCase().includes("postal") || c.toLowerCase().includes("cp")) || cols[0] || "");
      setColCity(cols.find(c => c.toLowerCase().includes("concelho") || c.toLowerCase().includes("cidade") || c.toLowerCase().includes("local")) || cols[0] || "");
      setColWeight(cols.find(c => c.toLowerCase().includes("peso") || c.toLowerCase().includes("kg")) || cols[0] || "");
      setColVolume(cols.find(c => c.toLowerCase().includes("vol") || c.toLowerCase().includes("m3")) || cols[0] || "");
      setColPriority(cols.find(c => c.toLowerCase().includes("prior")) || "");
      setColStartWindow(cols.find(c => c.toLowerCase().includes("inicio") || c.toLowerCase().includes("start")) || "");
      setColEndWindow(cols.find(c => c.toLowerCase().includes("fim") || c.toLowerCase().includes("end")) || "");
      setColLat(cols.find(c => c.toLowerCase().includes("lat")) || "");
      setColLon(cols.find(c => c.toLowerCase().includes("lon")) || "");

      setStep("mapping");
    } catch (err: any) {
      alert(err.message || "Erro no upload.");
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
      alert(err.message || "Erro no processamento.");
      setStep("mapping");
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
  };

  const submitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
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
      setEditingDelivery(null);
    } catch (err: any) {
      alert(err.message || "Erro ao salvar correção.");
    } finally {
      setLoading(false);
    }
  };

  const totalClients = deliveries.length;
  const successClients = deliveries.filter(d => d.latitude !== 0.0 && d.longitude !== 0.0 && d.nivel_qualidade < 99).length;
  const failedClients = totalClients - successClients;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header and Step Indicators */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Clientes & Georreferenciação</h1>
            <p className="text-zinc-400 text-xs mt-1">Carregue, mapeie e valide as coordenadas de entrega dos seus clientes.</p>
          </div>
          {step === "results" && (
            <button
              onClick={() => setStep("upload")}
              className="bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 px-4 py-2 rounded-xl text-xs font-semibold text-zinc-300 cursor-pointer"
            >
              Novo Ficheiro
            </button>
          )}
        </div>

        {/* Step 1: Upload */}
        {step === "upload" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center max-w-2xl mx-auto space-y-6">
            <div className="mx-auto w-16 h-16 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-zinc-150">Carregar Ficheiro de Encomendas</h3>
              <p className="text-zinc-450 text-xs max-w-sm mx-auto">
                Arraste ou carregue um ficheiro Excel (.xlsx, .xls) ou CSV contendo os dados dos clientes e entregas.
              </p>
            </div>
            <div className="pt-4">
              <label className="cursor-pointer bg-gradient-to-r from-indigo-500 to-violet-500 text-white rounded-xl px-6 py-3 text-sm font-semibold shadow-lg shadow-indigo-500/25 hover:from-indigo-600 hover:to-violet-600 transition-all inline-flex items-center space-x-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>Selecionar Ficheiro</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={loading}
                />
              </label>
            </div>
          </div>
        )}

        {/* Step 2: Mapping */}
        {step === "mapping" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 max-w-3xl mx-auto">
            <h3 className="text-lg font-bold text-zinc-100 mb-2">Mapear Colunas do Ficheiro</h3>
            <p className="text-zinc-450 text-xs mb-6">Mapeie as colunas do ficheiro carregado ({filename}) para os campos correspondentes na base de dados.</p>
            
            <form onSubmit={handleStartGeocoding} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-2">Código do Cliente</label>
                  <select value={colCode} onChange={e => setColCode(e.target.value)} required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-300 outline-none">
                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-2">Nome do Cliente</label>
                  <select value={colName} onChange={e => setColName(e.target.value)} required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-300 outline-none">
                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-2">Morada</label>
                  <select value={colAddr} onChange={e => setColAddr(e.target.value)} required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-300 outline-none">
                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-2">Código Postal</label>
                  <select value={colCp} onChange={e => setColCp(e.target.value)} required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-300 outline-none">
                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-2">Concelho / Cidade</label>
                  <select value={colCity} onChange={e => setColCity(e.target.value)} required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-300 outline-none">
                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-2">Peso (kg)</label>
                  <select value={colWeight} onChange={e => setColWeight(e.target.value)} required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-300 outline-none">
                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-2">Volume (m³)</label>
                  <select value={colVolume} onChange={e => setColVolume(e.target.value)} required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-300 outline-none">
                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-2">Prioridade (Opcional)</label>
                  <select value={colPriority} onChange={e => setColPriority(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-300 outline-none">
                    <option value="">-- Não Mapear (Padrão 2) --</option>
                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-2">Slot Horário Início (Opcional)</label>
                  <select value={colStartWindow} onChange={e => setColStartWindow(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-300 outline-none">
                    <option value="">-- Não Mapear (Padrão 08:00) --</option>
                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-2">Slot Horário Fim (Opcional)</label>
                  <select value={colEndWindow} onChange={e => setColEndWindow(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-300 outline-none">
                    <option value="">-- Não Mapear (Padrão 18:00) --</option>
                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-2">Latitude Existente (Opcional)</label>
                  <select value={colLat} onChange={e => setColLat(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-300 outline-none">
                    <option value="">-- Ignorar (Usar motor Geocodificador) --</option>
                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-2">Longitude Existente (Opcional)</label>
                  <select value={colLon} onChange={e => setColLon(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-300 outline-none">
                    <option value="">-- Ignorar (Usar motor Geocodificador) --</option>
                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setStep("upload")}
                  className="bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  className="bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-md shadow-indigo-500/10 cursor-pointer"
                >
                  Iniciar Georreferenciação
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Step 3: Geocoding Loader */}
        {step === "geocoding" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center max-w-md mx-auto space-y-6">
            <div className="w-16 h-16 rounded-full border-4 border-indigo-500/20 border-t-indigo-500 animate-spin mx-auto" />
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-zinc-150">A Georreferenciar Encomendas...</h3>
              <p className="text-zinc-450 text-xs leading-relaxed max-w-xs mx-auto">
                O motor está a processar o ficheiro. As moradas estão a ser comparadas e validadas em cascata. Isto poderá demorar alguns segundos.
              </p>
            </div>
          </div>
        )}

        {/* Step 4: Results and Correction Table */}
        {step === "results" && (
          <div className="space-y-6">
            {/* Stats section */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-2xl">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Total Encomendas</p>
                <p className="text-2xl font-black text-zinc-250 mt-1">{totalClients}</p>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-2xl">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-550">Geocodificadas com Sucesso</p>
                <div className="flex items-baseline space-x-2 mt-1">
                  <p className="text-2xl font-black text-emerald-400">{successClients}</p>
                  <p className="text-xs text-zinc-500">({totalClients > 0 ? Math.round(successClients/totalClients*100) : 0}%)</p>
                </div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-2xl">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-550">Falhas / Corrigir</p>
                <div className="flex items-baseline space-x-2 mt-1">
                  <p className="text-2xl font-black text-red-400">{failedClients}</p>
                  <p className="text-xs text-zinc-500">({totalClients > 0 ? Math.round(failedClients/totalClients*100) : 0}%)</p>
                </div>
              </div>
            </div>

            {/* Deliveries Table */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
              <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                <h3 className="text-base font-bold text-zinc-150">Lista de Entregas</h3>
                <span className="text-xs text-zinc-500">{deliveries.length} clientes carregados</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-950/40 border-b border-zinc-800 text-[10px] font-bold uppercase tracking-wider text-zinc-450">
                      <th className="px-6 py-3.5">Código</th>
                      <th className="px-6 py-3.5">Morada</th>
                      <th className="px-6 py-3.5">C. Postal</th>
                      <th className="px-6 py-3.5">Concelho</th>
                      <th className="px-6 py-3.5 text-center">Peso / Vol</th>
                      <th className="px-6 py-3.5">Qualidade / Fonte</th>
                      <th className="px-6 py-3.5 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 text-xs">
                    {deliveries.map((del) => {
                      const isFailed = del.latitude === 0.0 || del.longitude === 0.0 || del.nivel_qualidade === 99;
                      return (
                        <tr key={del.id} className="hover:bg-zinc-850/20 transition-colors">
                          <td className="px-6 py-4 font-bold text-zinc-300">{del.codigo_cliente}</td>
                          <td className="px-6 py-4 text-zinc-400 max-w-xs truncate" title={del.morada}>{del.morada}</td>
                          <td className="px-6 py-4 text-zinc-400 font-mono">{del.codigo_postal}</td>
                          <td className="px-6 py-4 text-zinc-400">{del.concelho}</td>
                          <td className="px-6 py-4 text-zinc-400 text-center font-mono">{del.peso_kg}kg / {del.volume_m3}m³</td>
                          <td className="px-6 py-4">
                            {isFailed ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 border border-red-500/20 text-red-400">
                                Falha
                              </span>
                            ) : (
                              <div className="flex items-center space-x-2">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                  del.nivel_qualidade <= 1 
                                    ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                                    : "bg-amber-500/10 border border-amber-500/20 text-amber-400"
                                }`}>
                                  Nível {del.nivel_qualidade}
                                </span>
                                <span className="text-[10px] text-zinc-500 font-mono uppercase">{del.fonte_match}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => openCorrection(del)}
                              className="cursor-pointer bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-zinc-250 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-colors"
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
          </div>
        )}

        {/* Correction Modal */}
        {editingDelivery && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-zinc-900 border border-zinc-800 w-full max-w-lg rounded-2xl p-6 shadow-2xl space-y-4">
              <div>
                <h3 className="text-lg font-bold text-zinc-100">Corrigir Georreferenciação</h3>
                <p className="text-zinc-450 text-xs mt-0.5">Corrija a morada e defina as coordenadas geográficas para o cliente: <b>{editingDelivery.codigo_cliente}</b></p>
              </div>

              <form onSubmit={submitCorrection} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Morada Correta</label>
                  <input
                    type="text"
                    required
                    value={corrAddr}
                    onChange={e => setCorrAddr(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 rounded-xl px-4 py-2.5 text-sm text-zinc-100 outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Código Postal</label>
                    <input
                      type="text"
                      required
                      value={corrCp}
                      onChange={e => setCorrCp(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 rounded-xl px-4 py-2.5 text-sm text-zinc-100 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Concelho / Cidade</label>
                    <input
                      type="text"
                      required
                      value={corrCity}
                      onChange={e => setCorrCity(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 rounded-xl px-4 py-2.5 text-sm text-zinc-100 outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Latitude</label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={corrLat}
                      onChange={e => setCorrLat(parseFloat(e.target.value) || 0.0)}
                      className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 rounded-xl px-4 py-2.5 text-sm text-zinc-100 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Longitude</label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={corrLon}
                      onChange={e => setCorrLon(parseFloat(e.target.value) || 0.0)}
                      className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 rounded-xl px-4 py-2.5 text-sm text-zinc-100 outline-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setEditingDelivery(null)}
                    className="bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-md shadow-indigo-500/10 cursor-pointer"
                  >
                    Confirmar Correção
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
