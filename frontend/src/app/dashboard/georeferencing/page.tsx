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
  motivo_falha?: string;
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
      const response = await fetch(`http://localhost:8000${endpoint}`, {
        headers
      });
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

  const filteredAndSortedDeliveries = React.useMemo(() => {
    let result = [...deliveries];
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(d => 
        d.codigo_cliente.toLowerCase().includes(term) ||
        d.morada.toLowerCase().includes(term) ||
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
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      // 1. Tentar importação unificada se for ficheiro Excel
      const isExcel = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");
      if (isExcel && selectedProject) {
        try {
          const token = localStorage.getItem("georoute_token");
          const headers = new Headers();
          if (token) {
            headers.set("Authorization", `Bearer ${token}`);
          }
          const response = await fetch(`http://localhost:8000/api/fleet/import/${selectedProject.id}`, {
            method: "POST",
            headers,
            body: formData
          });
          
          if (response.ok) {
            alert("Importação unificada realizada com sucesso! Armazéns, viaturas e entregas foram atualizados e georreferenciados.");
            // Recarregar entregas e mostrar resultados diretamente
            const data = await apiRequest(`/api/geocoding/${selectedProject.id}`);
            setDeliveries(data);
            setStep("results");
            setLoading(false);
            return;
          }
          
          const errorData = await response.json();
          // Se o erro for devido a falta de folhas, fazemos fallback. Caso contrário, reportamos.
          if (errorData.detail && (
            errorData.detail.includes("Deve conter a folha") ||
            errorData.detail.includes("folha") ||
            errorData.detail.includes("sheet") ||
            errorData.detail.includes("Sheet")
          )) {
            console.log("Ficheiro não contém folhas de importação unificada. Fazendo fallback para entregas simples...");
          } else {
            throw new Error(errorData.detail || "Erro ao processar importação unificada.");
          }
        } catch (unifiedErr: any) {
          console.warn("Importação unificada falhou, tentando upload simples...", unifiedErr);
          if (unifiedErr.message && !unifiedErr.message.includes("folha") && !unifiedErr.message.includes("sheet")) {
            alert(unifiedErr.message);
            setLoading(false);
            return;
          }
        }
      }

      // 2. Fallback para upload padrão de georreferenciação simples
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

      // Find index of corrected delivery in currently visible list
      const currentIndex = filteredAndSortedDeliveries.findIndex(d => d.id === editingDelivery.id);
      
      // Find the next failed delivery in sequence
      let nextFailed = filteredAndSortedDeliveries.slice(currentIndex + 1).find(d => 
        d.latitude === 0.0 || d.longitude === 0.0 || d.nivel_qualidade === 99
      );
      
      // Wrap around to start if not found in remainder of list
      if (!nextFailed) {
        nextFailed = filteredAndSortedDeliveries.slice(0, currentIndex).find(d => 
          d.latitude === 0.0 || d.longitude === 0.0 || d.nivel_qualidade === 99
        );
      }

      if (nextFailed) {
        // Automatically load next failed client
        setEditingDelivery(nextFailed);
        setCorrAddr(nextFailed.morada);
        setCorrCp(nextFailed.codigo_postal);
        setCorrCity(nextFailed.concelho);
        setCorrLat(nextFailed.latitude);
        setCorrLon(nextFailed.longitude);
        setSuggestions([]);
      } else {
        // No more failed clients remaining
        setEditingDelivery(null);
        alert("Todos os clientes em falha foram corrigidos com sucesso!");
      }
    } catch (err: any) {
      alert(err.message || "Erro ao salvar correcao.");
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
            <div className="pt-4 space-y-4">
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
              <div className="pt-4 border-t border-zinc-800/60 max-w-xs mx-auto">
                <button
                  type="button"
                  onClick={() => handleDownloadFile('/api/fleet/template/unified', 'Template_Importacao_Completa.xlsx')}
                  className="text-indigo-400 hover:text-indigo-300 text-xs font-semibold underline transition-colors cursor-pointer"
                >
                  📥 Descarregar Modelo Excel Geral (3 Folhas)
                </button>
              </div>
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
              <div className="p-6 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold text-zinc-150">Lista de Entregas</h3>
                  <span className="text-xs text-zinc-500">{deliveries.length} clientes carregados</span>
                </div>
                
                {deliveries.length > 0 && (
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={async () => {
                        if (!selectedProject) return;
                        try {
                          await apiRequest(`/api/geocoding/save/${selectedProject.id}`, { method: "POST" });
                          alert("Georreferenciação guardada com sucesso!");
                        } catch {
                          alert("Erro ao guardar georreferenciação.");
                        }
                      }}
                      className="cursor-pointer bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white rounded-xl px-4 py-2 text-xs font-semibold shadow-md shadow-indigo-500/10 transition-all flex items-center space-x-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                      </svg>
                      <span>Guardar Georreferenciação</span>
                    </button>
                    <button
                      onClick={() => handleDownloadFile(`/api/geocoding/export/${selectedProject?.id}?type=success`, `clientes_georreferenciados_${selectedProject?.id}.xlsx`)}
                      className="cursor-pointer bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-emerald-400 hover:text-emerald-300 rounded-xl px-4 py-2 text-xs font-semibold transition-colors flex items-center space-x-2"
                    >
                      <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      <span>Exportar Sucessos</span>
                    </button>
                    
                    {deliveries.some(d => d.latitude === 0.0 || d.longitude === 0.0 || d.nivel_qualidade === 99) && (
                      <button
                        onClick={() => handleDownloadFile(`/api/geocoding/export/${selectedProject?.id}?type=failed`, `falhas_georreferenciacao_${selectedProject?.id}.xlsx`)}
                        className="cursor-pointer bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-red-400 hover:text-red-300 rounded-xl px-4 py-2 text-xs font-semibold transition-colors flex items-center space-x-2"
                      >
                        <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span>Exportar Falhas</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Filter and Search controls */}
              {deliveries.length > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 bg-zinc-950/20 border-b border-zinc-800">
                  {/* Search */}
                  <div className="relative flex-1 max-w-xs">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-zinc-550">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </span>
                    <input
                      type="text"
                      placeholder="Pesquisar cliente ou morada..."
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl pl-9 pr-4 py-2 text-xs text-zinc-200 outline-none transition-all"
                    />
                  </div>

                  {/* Status Filters */}
                  <div className="flex items-center space-x-2 shrink-0">
                    <button
                      onClick={() => setStatusFilter("all")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                        statusFilter === "all"
                          ? "bg-zinc-800 border-zinc-700 text-zinc-150"
                          : "bg-zinc-900/40 border-zinc-850 text-zinc-450 hover:text-zinc-300"
                      }`}
                    >
                      Todos
                    </button>
                    <button
                      onClick={() => setStatusFilter("success")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                        statusFilter === "success"
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                          : "bg-zinc-900/40 border-zinc-850 text-zinc-450 hover:text-zinc-300"
                      }`}
                    >
                      Sucessos
                    </button>
                    <button
                      onClick={() => setStatusFilter("failed")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                        statusFilter === "failed"
                          ? "bg-red-500/10 border-red-500/20 text-red-400"
                          : "bg-zinc-900/40 border-zinc-850 text-zinc-450 hover:text-zinc-300"
                      }`}
                    >
                      Falhas
                    </button>
                  </div>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-950/40 border-b border-zinc-800 text-[10px] font-bold uppercase tracking-wider text-zinc-450">
                      <th className="px-6 py-3.5 cursor-pointer hover:text-zinc-300 transition-colors" onClick={() => handleSort("codigo_cliente")}>
                        Codigo {sortField === "codigo_cliente" && (sortDirection === "asc" ? "▲" : "▼")}
                      </th>
                      <th className="px-6 py-3.5 cursor-pointer hover:text-zinc-300 transition-colors" onClick={() => handleSort("morada")}>
                        Morada {sortField === "morada" && (sortDirection === "asc" ? "▲" : "▼")}
                      </th>
                      <th className="px-6 py-3.5 cursor-pointer hover:text-zinc-300 transition-colors" onClick={() => handleSort("codigo_postal")}>
                        C. Postal {sortField === "codigo_postal" && (sortDirection === "asc" ? "▲" : "▼")}
                      </th>
                      <th className="px-6 py-3.5 cursor-pointer hover:text-zinc-300 transition-colors" onClick={() => handleSort("concelho")}>
                        Concelho {sortField === "concelho" && (sortDirection === "asc" ? "▲" : "▼")}
                      </th>
                      <th className="px-6 py-3.5 text-center">Peso / Vol</th>
                      <th className="px-6 py-3.5 cursor-pointer hover:text-zinc-300 transition-colors" onClick={() => handleSort("status")}>
                        Qualidade / Fonte {sortField === "status" && (sortDirection === "asc" ? "▲" : "▼")}
                      </th>
                      <th className="px-6 py-3.5 text-right">Acao</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 text-xs">
                    {filteredAndSortedDeliveries.map((del) => {
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
                              <div className="flex flex-col space-y-1">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 border border-red-500/20 text-red-400 w-fit">
                                  Falha
                                </span>
                                {del.motivo_falha && (
                                  <span className="text-[10px] text-red-400/80 italic font-medium max-w-[150px] truncate" title={del.motivo_falha}>
                                    {del.motivo_falha}
                                  </span>
                                )}
                              </div>
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
          <div className="bg-zinc-900 border border-zinc-800 w-full max-w-5xl rounded-2xl p-6 shadow-2xl space-y-4">
            <div>
              <h3 className="text-lg font-bold text-zinc-150">Corrigir Georreferenciacao</h3>
              <p className="text-zinc-450 text-xs mt-0.5">Corrija a morada e defina as coordenadas geograficas para o cliente: <b>{editingDelivery.codigo_cliente}</b></p>
            </div>

            {/* Failure Reason Alert */}
            {(editingDelivery.latitude === 0.0 || editingDelivery.longitude === 0.0 || editingDelivery.nivel_qualidade === 99) && editingDelivery.motivo_falha && (
              <div className="bg-red-950/20 border border-red-900/30 text-red-300 text-xs rounded-xl p-3 flex items-start space-x-2">
                <svg className="w-4.5 h-4.5 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <span className="font-semibold block text-red-400">Motivo da Falha:</span>
                  <span>{editingDelivery.motivo_falha}</span>
                </div>
              </div>
            )}

            {/* Two-column layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Column: Input fields (7 cols) */}
              <div className="lg:col-span-7 space-y-4">
                {/* Morada Correta */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Morada Correta</label>
                  <input
                    type="text"
                    required
                    autoComplete="chrome-off-addr"
                    value={corrAddr}
                    onChange={e => setCorrAddr(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 rounded-xl px-4 py-2.5 text-xs text-zinc-100 outline-none"
                  />
                </div>

                {/* CP & Concelho Grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Codigo Postal</label>
                    <input
                      type="text"
                      required
                      autoComplete="chrome-off-cp"
                      value={corrCp}
                      onChange={e => setCorrCp(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 rounded-xl px-4 py-2.5 text-xs text-zinc-100 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Concelho / Cidade</label>
                    <input
                      type="text"
                      required
                      autoComplete="chrome-off-city"
                      value={corrCity}
                      onChange={e => setCorrCity(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 rounded-xl px-4 py-2.5 text-xs text-zinc-100 outline-none"
                    />
                  </div>
                </div>

                {/* Lat & Lon Grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Latitude</label>
                    <input
                      type="number"
                      step="any"
                      required
                      autoComplete="chrome-off-lat"
                      value={corrLat || ""}
                      onChange={e => setCorrLat(parseFloat(e.target.value) || 0.0)}
                      className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 rounded-xl px-4 py-2.5 text-xs text-zinc-100 outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Longitude</label>
                    <input
                      type="number"
                      step="any"
                      required
                      autoComplete="chrome-off-lon"
                      value={corrLon || ""}
                      onChange={e => setCorrLon(parseFloat(e.target.value) || 0.0)}
                      className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 rounded-xl px-4 py-2.5 text-xs text-zinc-100 outline-none font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Right Column: Database Suggestions (5 cols) */}
              <div className="lg:col-span-5 flex flex-col h-full min-h-[220px]">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-455 mb-1.5 flex items-center justify-between">
                  <span>📌 Sugestoes (Fuzzy Match)</span>
                  {suggestionsLoading && <span className="text-indigo-400 animate-pulse text-[9px] lowercase">a pesquisar...</span>}
                </label>
                
                <div className="flex-1 bg-zinc-950/60 border border-zinc-800 rounded-xl p-3.5 flex flex-col justify-between">
                  <div className="space-y-1.5 overflow-y-auto max-h-[190px] pr-1 flex-1">
                    {suggestions.length > 0 ? (
                      suggestions.map((s, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setCorrAddr(s.morada);
                            setCorrCp(s.cp);
                            setCorrCity(s.concelho.trim());
                            setCorrLat(s.lat);
                            setCorrLon(s.lon);
                          }}
                          className="w-full text-left bg-zinc-900 hover:bg-zinc-850 border border-zinc-800/80 hover:border-zinc-700/80 rounded-lg p-2 text-[10px] text-zinc-350 transition-all flex items-center justify-between cursor-pointer"
                        >
                          <span className="truncate pr-2">{s.display}</span>
                          <span className="text-[9px] text-indigo-400 font-semibold shrink-0">{s.score}% Match</span>
                        </button>
                      ))
                    ) : (
                      <div className="h-full flex items-center justify-center text-center p-4">
                        <p className="text-[10px] text-zinc-550 italic">
                          Escreva na morada ou codigo postal para pesquisar na base de dados de Portugal.
                        </p>
                      </div>
                    )}
                  </div>
                  {suggestions.length > 0 && (
                    <p className="text-[9px] text-zinc-500 italic mt-2 border-t border-zinc-800/60 pt-2 shrink-0">
                      Clique numa sugestao para preencher automaticamente os campos e coordenadas.
                    </p>
                  )}
                </div>
              </div>

            </div>

            {/* Modal Actions */}
            <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-800/80">
              <button
                type="button"
                onClick={() => setEditingDelivery(null)}
                className="bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => submitCorrection()}
                disabled={loading}
                className="bg-indigo-500 hover:bg-indigo-650 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer"
              >
                {loading && (
                  <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
                <span>{loading ? "A gravar..." : "Gravar & Proximo"}</span>
              </button>
            </div>

          </div>
        </div>
      )}
      </div>
    </DashboardLayout>
  );
}