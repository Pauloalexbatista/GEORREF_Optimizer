"use client";

import React, { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
const UnifiedGeocodingModal = dynamic(() => import("@/components/UnifiedGeocodingModal"), { ssr: false });
import DashboardLayout from "@/components/DashboardLayout";
import { useProjects } from "@/context/ProjectContext";
import { apiRequest } from "@/utils/api";
import { useI18n } from "@/context/I18nContext";

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
  armazem?: string;
  vendedor?: string;
  telefone?: string;
  tempo_descarga_min?: number;
  regras?: string;
  valor_cobrar?: number;
  observacoes?: string;
  rota?: string;
  ordem?: number;
}

export default function GeoreferencingPage() {
  const { t } = useI18n();
  const { selectedProject } = useProjects();
  const [step, setStep] = useState<"upload" | "geocoding" | "results">("upload");
  const [loading, setLoading] = useState(false);
  const [fileId, setFileId] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newDelivForm, setNewDelivForm] = useState({
    codigo_cliente: "",
    nome_cliente: "",
    morada: "",
    codigo_postal: "",
    concelho: "",
    armazem: "Armazém Principal",
    peso_kg: 0,
    volume_m3: 0,
    janela_inicio: "08:00",
    janela_fim: "19:00",
    tempo_descarga_min: 10,
    telefone: "",
    vendedor: "",
    valor_cobrar: 0,
    regras: "",
    observacoes: "",
    latitude: 0,
    longitude: 0,
  });

  const handleCreateNewDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    if (!newDelivForm.morada || !newDelivForm.codigo_postal) {
      alert("A morada e o código postal são obrigatórios.");
      return;
    }
    setLoading(true);
    try {
      await apiRequest(`/api/geocoding/delivery/${selectedProject.id}`, {
        method: "POST",
        body: JSON.stringify(newDelivForm),
      });
      const data = await apiRequest(`/api/geocoding/${selectedProject.id}`);
      setDeliveries(data);
      setNewModalOpen(false);
      setNewDelivForm({
        codigo_cliente: "",
        nome_cliente: "",
        morada: "",
        codigo_postal: "",
        concelho: "",
        armazem: "Armazém Principal",
        peso_kg: 0,
        volume_m3: 0,
        janela_inicio: "08:00",
        janela_fim: "19:00",
        tempo_descarga_min: 10,
        telefone: "",
        vendedor: "",
        valor_cobrar: 0,
        regras: "",
        observacoes: "",
        latitude: 0,
        longitude: 0,
      });
      alert("Nova encomenda criada e geocodificada com sucesso!");
    } catch (err: any) {
      alert(err.message || "Erro ao criar encomenda.");
    } finally {
      setLoading(false);
    }
  };
  
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
  const [colVendedor, setColVendedor] = useState("");

  // Inline editing state
  const [editingInlineId, setEditingInlineId] = useState<number | null>(null);
  const [editInlineData, setEditInlineData] = useState<Delivery | null>(null);

  const startEditingInline = (del: Delivery) => {
    setEditingInlineId(del.id);
    setEditInlineData({ ...del });
  };

  const handleEditInlineChange = (field: keyof Delivery, value: any) => {
    setEditInlineData(prev => prev ? { ...prev, [field]: value } : null);
  };

  const handleSaveInline = async (id: number) => {
    if (!editInlineData || !selectedProject) return;
    setLoading(true);
    try {
      await apiRequest(`/api/geocoding/delivery/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          morada: editInlineData.morada,
          codigo_postal: editInlineData.codigo_postal,
          concelho: editInlineData.concelho,
          latitude: editInlineData.latitude,
          longitude: editInlineData.longitude,
        }),
      });
      const data = await apiRequest(`/api/geocoding/${selectedProject.id}`);
      setDeliveries(data);
      setEditingInlineId(null);
      setEditInlineData(null);
    } catch (err: any) {
      alert(err.message || "Erro ao guardar alterações.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteInline = async (id: number) => {
    if (!confirm("Tem a certeza que deseja eliminar esta encomenda permanente da base de dados? Esta ação não pode ser desfeita.")) return;
    setLoading(true);
    try {
      await apiRequest(`/api/geocoding/delivery/${id}`, {
        method: "DELETE",
      });
      if (selectedProject) {
        const data = await apiRequest(`/api/geocoding/${selectedProject.id}`);
        setDeliveries(data);
      }
      if (editingInlineId === id) {
        setEditingInlineId(null);
        setEditInlineData(null);
      }
    } catch (err: any) {
      alert(err.message || "Erro ao eliminar encomenda.");
    } finally {
      setLoading(false);
    }
  };

  const handleCellSave = async (del: Delivery, field: keyof Delivery, value: any) => {
    let isChanged = false;
    if (field === 'latitude' || field === 'longitude') {
      const numVal = parseFloat(value) || 0.0;
      isChanged = numVal !== del[field];
    } else {
      isChanged = String(value).trim() !== String(del[field] || "").trim();
    }
    if (!isChanged) return;

    // Reactively update local state first
    const updatedDeliveries = deliveries.map(d => 
      d.id === del.id ? { 
        ...d, 
        [field]: (field === 'latitude' || field === 'longitude') ? (parseFloat(value) || 0.0) : value 
      } : d
    );
    setDeliveries(updatedDeliveries);

    try {
      const payload = {
        morada: field === 'morada' ? value : del.morada,
        codigo_postal: field === 'codigo_postal' ? value : del.codigo_postal,
        concelho: field === 'concelho' ? value : del.concelho,
        latitude: field === 'latitude' ? (parseFloat(value) || 0.0) : del.latitude,
        longitude: field === 'longitude' ? (parseFloat(value) || 0.0) : del.longitude,
      };

      await apiRequest(`/api/geocoding/delivery/${del.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      if (selectedProject) {
        const data = await apiRequest(`/api/geocoding/${selectedProject.id}`);
        setDeliveries(data);
      }
    } catch (err: any) {
      alert(err.message || "Erro ao guardar alterações.");
      // Rollback on error
      if (selectedProject) {
        const data = await apiRequest(`/api/geocoding/${selectedProject.id}`);
        setDeliveries(data);
      }
    }
  };

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
      const term = searchTerm.toLowerCase().trim();
      result = result.filter(d => 
        (d.nome_cliente || "").toLowerCase().includes(term) ||
        (d.codigo_cliente || "").toLowerCase().includes(term) ||
        (d.morada || "").toLowerCase().includes(term) ||
        (d.codigo_postal || "").toLowerCase().includes(term) ||
        (d.concelho && d.concelho.toLowerCase().includes(term)) ||
        (d.armazem && d.armazem.toLowerCase().includes(term))
      );
    }
    if (statusFilter === "success") {
      result = result.filter(d => !(d.latitude === 0.0 || d.longitude === 0.0 || d.nivel_qualidade === 99));
    } else if (statusFilter === "failed") {
      result = result.filter(d => (d.latitude === 0.0 || d.longitude === 0.0 || d.nivel_qualidade === 99));
    }
    result.sort((a, b) => {
      // Prioritize exact or prefix matches on client name and code
      if (searchTerm) {
        const term = searchTerm.toLowerCase().trim();
        const nameA = (a.nome_cliente || a.codigo_cliente || "").toLowerCase();
        const nameB = (b.nome_cliente || b.codigo_cliente || "").toLowerCase();
        const aStarts = nameA.startsWith(term);
        const bStarts = nameB.startsWith(term);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        const aHas = nameA.includes(term);
        const bHas = nameB.includes(term);
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;
      }
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

  const loadDeliveries = async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const data = await apiRequest(`/api/geocoding/${selectedProject.id}`);
      if (data && data.length > 0) {
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
  };

  // Load existing deliveries on mount/project change
  useEffect(() => {
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
          col_vendedor: colVendedor || null,
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

  const saveCurrentDelivery = async () => {
    if (!editingDelivery || !selectedProject) return;
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
    const data = await apiRequest(`/api/geocoding/${selectedProject.id}`);
    setDeliveries(data);
  };

  const handleGoToPrevious = async () => {
    if (!editingDelivery) return;
    const currentIndex = filteredAndSortedDeliveries.findIndex(d => d.id === editingDelivery.id);
    if (currentIndex > 0) {
      // Save current if has changes
      try {
        if (corrLat !== editingDelivery.latitude || corrLon !== editingDelivery.longitude || corrAddr !== editingDelivery.morada) {
          await saveCurrentDelivery();
        }
      } catch (e) {
        console.error("Auto-save on previous error:", e);
      }
      openCorrection(filteredAndSortedDeliveries[currentIndex - 1]);
    }
  };

  const submitCorrection = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!editingDelivery || !selectedProject) return;

    setLoading(true);
    try {
      await saveCurrentDelivery();

      const currentIndex = filteredAndSortedDeliveries.findIndex(d => d.id === editingDelivery.id);
      
      // If there is a next delivery in current filter, go to it
      if (currentIndex >= 0 && currentIndex < filteredAndSortedDeliveries.length - 1) {
        openCorrection(filteredAndSortedDeliveries[currentIndex + 1]);
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
                        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 font-sans">Georreferenciação</h1>
            <p className="text-zinc-500 dark:text-zinc-400 text-xs mt-1">{t.geocoding.subtitle}</p>
          </div>
          {step === "results" && (
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setStep("upload")}
                className="cursor-pointer bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-xl px-4 py-2 text-xs font-semibold transition-colors"
              >
                {t.geocoding.importDeliveriesBtn}
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
              <p className="text-xs text-zinc-300 mt-1 max-w-sm">
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
              <p className="text-xs text-zinc-300 mt-1">A cruzar moradas com a base de dados de códigos postais e coordenadas GPS.</p>
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
                  placeholder={t.geocoding.searchPlaceholder}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setNewModalOpen(true)}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/20 flex items-center space-x-1.5 transition-all cursor-pointer mr-2"
                >
                  <span>➕ Nova Entrega Manual</span>
                </button>
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

            {/* Table Container with vertical scroll and sticky headers */}
            <div className="border border-zinc-800 rounded-2xl bg-zinc-900/40 overflow-hidden shadow-xl max-h-[600px] overflow-y-auto relative">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-zinc-950 border-b border-zinc-800 text-[11px] font-bold text-zinc-400 uppercase tracking-wider sticky top-0 z-10">
                    <th className="py-3 px-3 w-16 text-center">Ações</th>
                    <th onClick={() => handleSort("status")} className="py-3 px-3 cursor-pointer">Estado</th>
                    <th onClick={() => handleSort("codigo_cliente")} className="py-3 px-3 cursor-pointer hover:text-zinc-200">Código / Cliente</th>
                    <th onClick={() => handleSort("armazem")} className="py-3 px-3 w-40 cursor-pointer hover:text-zinc-200">Armazém</th>
                    <th onClick={() => handleSort("morada")} className="py-3 px-3 cursor-pointer">Morada</th>
                    <th onClick={() => handleSort("codigo_postal")} className="py-3 px-3 w-28 cursor-pointer hover:text-zinc-200">Cód. Postal</th>
                    <th onClick={() => handleSort("concelho")} className="py-3 px-3 w-36 cursor-pointer hover:text-zinc-200">Concelho</th>
                    <th onClick={() => handleSort("latitude")} className="py-3 px-3 w-48 cursor-pointer hover:text-zinc-200">Latitude / Longitude</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedDeliveries.map((del) => {
                    const isValid = del.latitude !== 0.0 && del.longitude !== 0.0 && del.nivel_qualidade !== 99;
                    return (
                      <tr key={`${del.id}-${del.morada}-${del.codigo_postal}-${del.concelho}-${del.latitude}-${del.longitude}-${del.nivel_qualidade}`} className="border-b border-zinc-800/40 hover:bg-zinc-800/20 hover:text-zinc-100 transition-colors">
                        {/* Actions Col Left */}
                        <td className="py-1 px-2 text-center whitespace-nowrap">
                          <button
                            onClick={() => openCorrection(del)}
                            title="Ajustar no Mapa"
                            className="p-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-indigo-400 rounded transition-colors cursor-pointer"
                          >
                            📍
                          </button>
                          <button
                            onClick={() => handleDeleteInline(del.id)}
                            title="Eliminar Encomenda"
                            className="p-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-red-400 rounded transition-colors cursor-pointer ml-1"
                          >
                            🗑️
                          </button>
                        </td>

                        {/* Status Badge */}
                        <td className="py-1 px-2 whitespace-nowrap">
                          {isValid ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-emerald-950/80 text-emerald-400 border border-emerald-800/40">
                              Nível {del.nivel_qualidade}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-amber-950/80 text-amber-400 border border-amber-800/40">
                              Pendente
                            </span>
                          )}
                        </td>

                        {/* Codigo / Nome */}
                        <td className="py-1 px-2">
                          <div className="font-semibold text-zinc-200 truncate max-w-[120px]" title={del.nome_cliente || del.codigo_cliente}>
                            {del.nome_cliente || del.codigo_cliente}
                          </div>
                          {del.nome_cliente && del.nome_cliente !== del.codigo_cliente && (
                            <div className="text-[9px] text-zinc-400 font-mono truncate max-w-[120px]">{del.codigo_cliente}</div>
                          )}
                        </td>

                        {/* Armazém */}
                        <td className="py-1 px-2">
                          <div className="text-xs text-zinc-400 truncate max-w-[140px]" title={del.armazem || ""}>
                            {del.armazem || <span className="text-zinc-600 italic">—</span>}
                          </div>
                        </td>

                        {/* Morada Input (Click-to-edit) */}
                        <td className="py-1 px-2">
                          <input
                            type="text"
                            defaultValue={del.morada}
                            onBlur={(e) => handleCellSave(del, 'morada', e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                            className="w-full bg-transparent border border-transparent hover:border-zinc-800 focus:border-indigo-500 focus:bg-zinc-950/80 rounded px-2 py-1 text-xs text-zinc-300 focus:text-zinc-100 outline-none transition-all"
                          />
                        </td>

                        {/* Codigo Postal Input (Click-to-edit) */}
                        <td className="py-1 px-2">
                          <input
                            type="text"
                            defaultValue={del.codigo_postal || ""}
                            placeholder="CP7"
                            onBlur={(e) => handleCellSave(del, 'codigo_postal', e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                            className="w-full bg-transparent border border-transparent hover:border-zinc-800 focus:border-indigo-500 focus:bg-zinc-950/80 rounded px-2 py-1 text-xs text-zinc-300 focus:text-zinc-100 font-mono outline-none transition-all"
                          />
                        </td>

                        {/* Concelho Input (Click-to-edit) */}
                        <td className="py-1 px-2">
                          <input
                            type="text"
                            defaultValue={del.concelho || ""}
                            placeholder="Concelho"
                            onBlur={(e) => handleCellSave(del, 'concelho', e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                            className="w-full bg-transparent border border-transparent hover:border-zinc-800 focus:border-indigo-500 focus:bg-zinc-950/80 rounded px-2 py-1 text-xs text-zinc-300 focus:text-zinc-100 outline-none transition-all"
                          />
                        </td>

                        {/* Coordinates Inputs (Click-to-edit) */}
                        <td className="py-1 px-2">
                          <div className="flex items-center space-x-1.5">
                            <input
                              type="text"
                              placeholder="Lat"
                              defaultValue={del.latitude !== 0.0 ? del.latitude.toFixed(5) : ""}
                              onBlur={(e) => handleCellSave(del, 'latitude', e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                              }}
                              className="w-20 bg-transparent border border-transparent hover:border-zinc-800 focus:border-indigo-500 focus:bg-zinc-950/80 rounded px-1.5 py-1 text-xs text-zinc-300 focus:text-zinc-100 font-mono outline-none transition-all text-right"
                            />
                            <span className="text-zinc-600">,</span>
                            <input
                              type="text"
                              placeholder="Lon"
                              defaultValue={del.longitude !== 0.0 ? del.longitude.toFixed(5) : ""}
                              onBlur={(e) => handleCellSave(del, 'longitude', e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                              }}
                              className="w-20 bg-transparent border border-transparent hover:border-zinc-800 focus:border-indigo-500 focus:bg-zinc-950/80 rounded px-1.5 py-1 text-xs text-zinc-300 focus:text-zinc-100 font-mono outline-none transition-all text-right"
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}


        {/* MODAL CRIAR NOVA ENTREGA MANUAL */}
      {newModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950">
              <div className="flex items-center space-x-2.5">
                <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 font-bold">📦</span>
                <div>
                  <h3 className="text-base font-bold text-zinc-100">Criar Nova Entrega Manual</h3>
                  <p className="text-xs text-zinc-400">Insira todos os dados da encomenda. O sistema geocodifica automaticamente.</p>
                </div>
              </div>
              <button
                onClick={() => setNewModalOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateNewDelivery} className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Doc ID / Código *</label>
                  <input
                    type="text"
                    required
                    placeholder="ex: FT-2026/099"
                    value={newDelivForm.codigo_cliente}
                    onChange={(e) => setNewDelivForm({ ...newDelivForm, codigo_cliente: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Nome do Cliente *</label>
                  <input
                    type="text"
                    required
                    placeholder="ex: Restaurante Central"
                    value={newDelivForm.nome_cliente}
                    onChange={(e) => setNewDelivForm({ ...newDelivForm, nome_cliente: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-zinc-400 font-semibold mb-1">Morada Completa *</label>
                  <input
                    type="text"
                    required
                    placeholder="ex: Rua Garrett, 24"
                    value={newDelivForm.morada}
                    onChange={(e) => setNewDelivForm({ ...newDelivForm, morada: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Código Postal (CP4 ou CP7) *</label>
                  <input
                    type="text"
                    required
                    placeholder="ex: 1200-204"
                    value={newDelivForm.codigo_postal}
                    onChange={(e) => setNewDelivForm({ ...newDelivForm, codigo_postal: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Localidade / Concelho</label>
                  <input
                    type="text"
                    placeholder="ex: Lisboa"
                    value={newDelivForm.concelho}
                    onChange={(e) => setNewDelivForm({ ...newDelivForm, concelho: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Armazém Base</label>
                  <input
                    type="text"
                    value={newDelivForm.armazem}
                    onChange={(e) => setNewDelivForm({ ...newDelivForm, armazem: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Telefone de Contacto</label>
                  <input
                    type="text"
                    placeholder="ex: 912345678"
                    value={newDelivForm.telefone}
                    onChange={(e) => setNewDelivForm({ ...newDelivForm, telefone: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Peso (KG)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={newDelivForm.peso_kg}
                    onChange={(e) => setNewDelivForm({ ...newDelivForm, peso_kg: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Volume (m³)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newDelivForm.volume_m3}
                    onChange={(e) => setNewDelivForm({ ...newDelivForm, volume_m3: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Janela Início (HH:MM)</label>
                  <input
                    type="text"
                    value={newDelivForm.janela_inicio}
                    onChange={(e) => setNewDelivForm({ ...newDelivForm, janela_inicio: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Janela Fim (HH:MM)</label>
                  <input
                    type="text"
                    value={newDelivForm.janela_fim}
                    onChange={(e) => setNewDelivForm({ ...newDelivForm, janela_fim: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Tempo Descarga (min)</label>
                  <input
                    type="number"
                    value={newDelivForm.tempo_descarga_min}
                    onChange={(e) => setNewDelivForm({ ...newDelivForm, tempo_descarga_min: parseInt(e.target.value) || 10 })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Valor a Cobrar (€ COD)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newDelivForm.valor_cobrar}
                    onChange={(e) => setNewDelivForm({ ...newDelivForm, valor_cobrar: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Vendedor</label>
                  <input
                    type="text"
                    placeholder="ex: João Silva"
                    value={newDelivForm.vendedor}
                    onChange={(e) => setNewDelivForm({ ...newDelivForm, vendedor: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Tags / Regras (ex: [FRIO], [PESADOS])</label>
                  <input
                    type="text"
                    placeholder="ex: [FRIO]"
                    value={newDelivForm.regras}
                    onChange={(e) => setNewDelivForm({ ...newDelivForm, regras: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-zinc-400 font-semibold mb-1">Observações / Notas de Entrega</label>
                  <input
                    type="text"
                    placeholder="ex: Tocar à campainha das traseiras"
                    value={newDelivForm.observacoes}
                    onChange={(e) => setNewDelivForm({ ...newDelivForm, observacoes: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setNewModalOpen(false)}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/20 cursor-pointer"
                >
                  {loading ? "A criar e geocodificar..." : "💾 Gravar e Geocodificar Entrega"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unified Correction Modal */}
      {editingDelivery && (
        <UnifiedGeocodingModal
          isOpen={!!editingDelivery}
          title={`Georreferenciação Manual do Cliente: ${editingDelivery.codigo_cliente || ""} ${editingDelivery.nome_cliente ? `(${editingDelivery.nome_cliente})` : ""}`}
          entityType="delivery"
          initialData={{
            name: editingDelivery.nome_cliente || editingDelivery.codigo_cliente || "",
            address: editingDelivery.morada || "",
            cp: editingDelivery.codigo_postal || "",
            locality: editingDelivery.concelho || "",
            lat: editingDelivery.latitude || 0,
            lon: editingDelivery.longitude || 0,
          }}
          onSave={async (data) => {
            if (!editingDelivery || !selectedProject) return;
            try {
              await apiRequest(`/api/geocoding/delivery/${editingDelivery.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  morada: data.address,
                  codigo_postal: data.cp,
                  concelho: data.locality,
                  latitude: data.lat,
                  longitude: data.lon,
                }),
              });
              const res = await apiRequest(`/api/geocoding/${selectedProject.id}`);
              setDeliveries(res);
              setEditingDelivery(null);
            } catch (err: any) {
              alert("Erro ao guardar georreferenciação: " + (err.message || "Erro desconhecido"));
            }
          }}
          onClose={() => setEditingDelivery(null)}
        />
      )}
    </div>
  </DashboardLayout>
  );
}
