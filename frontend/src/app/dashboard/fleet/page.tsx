"use client";



import React, { useState, useEffect, useRef } from "react";

import DashboardLayout from "@/components/DashboardLayout";

import { useProjects } from "@/context/ProjectContext";

import { apiRequest } from "@/utils/api";

import { useI18n } from "@/context/I18nContext";

import dynamic from "next/dynamic";



const WarehouseGeoModal = dynamic(() => import("@/components/WarehouseGeoModal"), { ssr: false });



interface Warehouse {

  name: string;

  address: string;

  cp: string;

  locality: string;

  lat: number;

  lon: number;

  quality: number;

}



interface Vehicle {

  veiculo: string;

  armazem: string;

  capacidade_kg: number;

  capacidade_vol: number;

  custo_km: number;

  velocidade_media: number;

  horario_inicio: string;

  horario_fim: string;

  is_active?: number;

}



export default function FleetPage() {

  const { t } = useI18n();

  const { selectedProject } = useProjects();

  const [activeTab, setActiveTab] = useState<"warehouses" | "fleet">("warehouses");

  const [loading, setLoading] = useState(false);

  const [importing, setImporting] = useState(false);



  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [fleet, setFleet] = useState<Vehicle[]>([]);



  // Auto-save/Persist function

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");



  const persistFleetAndWarehouses = async (nextFleet: Vehicle[], nextWh: Warehouse[], showAlert = false) => {

    if (!selectedProject) return;

    setSaveStatus("saving");

    try {

      let whToSend = nextWh;

      if (whToSend.length === 0 && nextFleet.length > 0) {

        whToSend = [{

          name: "Armazém Principal",

          address: "Base Central",

          cp: "1000-001",

          locality: "Lisboa",

          lat: 38.7223,

          lon: -9.1393,

          quality: 1

        }];

        setWarehouses(whToSend);

      }



      await apiRequest(`/api/fleet/${selectedProject.id}`, {

        method: "POST",

        body: JSON.stringify({

          fleet: nextFleet.map((v, i) => ({

            ...v,

            veiculo: v.veiculo?.trim() ? v.veiculo : `VeÃculo ${i + 1}`,

            armazem: v.armazem?.trim() ? v.armazem : (whToSend.length > 0 ? whToSend[0].name : "Armazém Principal"),

            capacidade_kg: v.capacidade_kg || 1000,

            capacidade_vol: v.capacidade_vol || 5,

            is_active: v.is_active !== undefined ? v.is_active : 1

          })),

          warehouses: whToSend,

        }),

      });

      setSaveStatus("saved");

      // Notificar outras paginas (ex: Planeamento) que a frota foi guardada

      try { localStorage.setItem("georoute_fleet_saved", Date.now().toString()); } catch(_) {}

      if (showAlert) {

        alert("ConfiguraÃ§Ã£o da frota e armazÃ©ns guardada com sucesso!");

      }

      setTimeout(() => setSaveStatus("idle"), 3000);

    } catch (err: any) {

      setSaveStatus("error");

      console.error("Auto-save fleet error:", err);

      alert(`Aviso ao guardar frota: ${err.message || "Verifique a ligaÃ§Ã£o"}`);

    }

  };



  // Load configuration on project change

  useEffect(() => {

    if (!selectedProject) return;



    async function loadConfig() {

      setLoading(true);

      try {

        const data = await apiRequest(`/api/fleet/${selectedProject?.id}`);

                  const whs = data.warehouses || [];

          setWarehouses(whs);

          

          const defaultWh = whs.length > 0 ? whs[0].name : "Armazém Principal";

          const rawFleet: Vehicle[] = data.fleet || [];

          

          const safeFleet = rawFleet.map((v, i) => ({

            ...v,

            veiculo: v.veiculo?.trim() ? v.veiculo : `VeÃculo ${i + 1}`,

            armazem: v.armazem?.trim() ? v.armazem : defaultWh,

            capacidade_kg: v.capacidade_kg || 1000,

            capacidade_vol: v.capacidade_vol || 5,

            custo_km: v.custo_km || 0.5,

            velocidade_media: v.velocidade_media || 40,

            horario_inicio: v.horario_inicio || "08:00",

            horario_fim: v.horario_fim || "18:00",

            is_active: v.is_active !== undefined ? v.is_active : 1

          }));

          

          setFleet(safeFleet);

        if (data.warehouses && data.warehouses.length > 0 && !newVWarehouse) {

          setNewVWarehouse(data.warehouses[0].name);

        }

      } catch (e) {

        console.error("Failed to load fleet configuration:", e);

      } finally {

        setLoading(false);

      }

    }

    loadConfig();

  }, [selectedProject]);



  // --- WAREHOUSE STATE & ACTIONS ---

  // Create state

  const [newWhName, setNewWhName] = useState("");

  const [newWhAddr, setNewWhAddr] = useState("");

  const [newWhCp, setNewWhCp] = useState("");

  const [newWhLocality, setNewWhLocality] = useState("");

  const [newWhLat, setNewWhLat] = useState("");

  const [newWhLon, setNewWhLon] = useState("");

  

  // Edit state

  const [editingWhIdx, setEditingWhIdx] = useState<number | null>(null);

  const [editWhData, setEditWhData] = useState<Warehouse | null>(null);



  const [isMapModalOpen, setIsMapModalOpen] = useState(false);

  const [geoTarget, setGeoTarget] = useState<"new" | "edit">("new");



  const handleCreateWarehouse = async (e: React.FormEvent) => {

    e.preventDefault();

    if (!newWhName.trim() || !newWhAddr.trim()) {

      alert("Por favor introduza o nome e morada do armazÃ©m.");

      return;

    }



    setLoading(true);

    try {

      let lat = parseFloat(newWhLat) || 0.0;

      let lon = parseFloat(newWhLon) || 0.0;

      let quality = (lat !== 0 && lon !== 0) ? 0 : 99;



      if (lat === 0.0 || lon === 0.0) {

        const res = await apiRequest("/api/fleet/geocode-warehouses", {

          method: "POST",

          body: JSON.stringify([{

            name: newWhName,

            address: newWhAddr,

            cp: newWhCp,

            locality: newWhLocality

          }]),

        });



        if (res && res.length > 0) {

          const geocoded = res[0];

          lat = geocoded.lat;

          lon = geocoded.lon;

          quality = geocoded.quality;

          if (geocoded.quality === 99) {

            alert("Aviso: NÃ£o foi possÃvel obter as coordenadas exatas da morada do armazÃ©m. Introduza as coordenadas manualmente se desejar.");

          }

        }

      }



      const updatedWh: Warehouse = {

        name: newWhName,

        address: newWhAddr,

        cp: newWhCp,

        locality: newWhLocality,

        lat,

        lon,

        quality

      };



      const nextWh = [...warehouses, updatedWh];

      setWarehouses(nextWh);

      if (!newVWarehouse) {

        setNewVWarehouse(newWhName);

      }



      persistFleetAndWarehouses(fleet, nextWh);



      // Reset

      setNewWhName("");

      setNewWhAddr("");

      setNewWhCp("");

      setNewWhLocality("");

      setNewWhLat("");

      setNewWhLon("");

    } catch (err: any) {

      alert(err.message || "Erro ao criar armazÃ©m.");

    } finally {

      setLoading(false);

    }

  };



  const handleSaveEditWarehouse = async (idx: number) => {

    if (!editWhData || !editWhData.name.trim() || !editWhData.address.trim()) {

      alert("Nome e morada sÃ£o obrigatÃ³rios.");

      return;

    }



    setLoading(true);

    try {

      let lat = editWhData.lat;

      let lon = editWhData.lon;

      let quality = editWhData.quality;



      const originalWh = warehouses[idx];

      const addressChanged = editWhData.address !== originalWh.address || 

                             editWhData.cp !== originalWh.cp || 

                             editWhData.locality !== originalWh.locality;



      if (addressChanged && (lat === 0.0 || lon === 0.0)) {

        const res = await apiRequest("/api/fleet/geocode-warehouses", {

          method: "POST",

          body: JSON.stringify([{

            name: editWhData.name,

            address: editWhData.address,

            cp: editWhData.cp,

            locality: editWhData.locality

          }]),

        });



        if (res && res.length > 0) {

          const geocoded = res[0];

          lat = geocoded.lat;

          lon = geocoded.lon;

          quality = geocoded.quality;

        }

      }



      const finalWh: Warehouse = {

        ...editWhData,

        lat,

        lon,

        quality

      };



      const nextWh = warehouses.map((w, i) => i === idx ? finalWh : w);

      setWarehouses(nextWh);



      // Propagate name change to fleet

      let nextFleet = fleet;

      if (originalWh.name !== editWhData.name) {

        nextFleet = fleet.map(v => v.armazem === originalWh.name ? { ...v, armazem: editWhData.name } : v);

        setFleet(nextFleet);

        if (newVWarehouse === originalWh.name) {

          setNewVWarehouse(editWhData.name);

        }

      }



      persistFleetAndWarehouses(nextFleet, nextWh);

      setEditingWhIdx(null);

      setEditWhData(null);

    } catch (err: any) {

      alert(err.message || "Erro ao editar armazÃ©m.");

    } finally {

      setLoading(false);

    }

  };



  const handleDeleteWarehouse = (idx: number) => {

    if (!confirm("Tem a certeza que deseja eliminar este armazÃ©m? Os veÃculos associados serÃ£o desassociados.")) return;

    const name = warehouses[idx].name;

    const nextWh = warehouses.filter((_, i) => i !== idx);

    const nextFleet = fleet.filter(v => v.armazem !== name);



    setWarehouses(nextWh);

    setFleet(nextFleet);

    persistFleetAndWarehouses(nextFleet, nextWh);

  };



  // --- VEHICLE STATE & ACTIONS ---

  // Create state

  const [newVName, setNewVName] = useState("");

  const [newVWarehouse, setNewVWarehouse] = useState("");

  const [newVCapKg, setNewVCapKg] = useState(1000);

  const [newVCapVol, setNewVCapVol] = useState(5.0);

  const [newVCostKm, setNewVCostKm] = useState(0.5);

  const [newVSpeed, setNewVSpeed] = useState(40);

  const [newVStart, setNewVStart] = useState("08:00");

  const [newVEnd, setNewVEnd] = useState("18:00");



  // Edit state

  const [editingVehIdx, setEditingVehIdx] = useState<number | null>(null);

  const [editVehData, setEditVehData] = useState<Vehicle | null>(null);



  // --- SORT & INLINE CHANGE HANDLERS ---

  const [sortField, setSortField] = useState<string | null>(null);

  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");



  const handleSort = (field: string) => {

    if (sortField === field) {

      setSortDirection(prev => prev === "asc" ? "desc" : "asc");

    } else {

      setSortField(field);

      setSortDirection("asc");

    }

  };

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);





  const handleWhChange = (idx: number, field: keyof Warehouse, value: any) => {

    const nextWh = [...warehouses];

    nextWh[idx] = { ...nextWh[idx], [field]: value };

    setWarehouses(nextWh);

    // Gravar imediatamente (sem debounce) - evita perda de dados ao navegar

    persistFleetAndWarehouses(fleet, nextWh);

  };



  const handleFleetChange = (idx: number, field: keyof Vehicle, value: any, immediate = false) => {

    const nextFleet = [...fleet];

    nextFleet[idx] = { ...nextFleet[idx], [field]: value };

    setFleet(nextFleet);

    // Para campos de texto: guardar no onBlur (immediate=false so atualiza estado local)

    // Para selects, checkboxes e time: guardar imediatamente (immediate=true)

    if (immediate) {

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

      persistFleetAndWarehouses(nextFleet, warehouses);

    }

  };



  // Gravar a frota completa no onBlur de campos de texto

  const handleFleetBlur = (nextFleet: typeof fleet) => {

    persistFleetAndWarehouses(nextFleet, warehouses);

  };



  const sortedWarehouses = [...warehouses].sort((a, b) => {

    if (!sortField) return 0;

    const va = (a as any)[sortField] ?? "";

    const vb = (b as any)[sortField] ?? "";

    return sortDirection === "asc" ? (va < vb ? -1 : va > vb ? 1 : 0) : (va > vb ? -1 : va < vb ? 1 : 0);

  });



  const sortedFleet = [...fleet].sort((a, b) => {

    if (!sortField) return 0;

    const va = (a as any)[sortField] ?? "";

    const vb = (b as any)[sortField] ?? "";

    return sortDirection === "asc" ? (va < vb ? -1 : va > vb ? 1 : 0) : (va > vb ? -1 : va < vb ? 1 : 0);

  });







  const handleCreateVehicle = (e: React.FormEvent) => {

    e.preventDefault();

    let cleanName = newVName.trim();

      if (!cleanName) {

        let num = fleet.length + 1;

        cleanName = `Viatura ${num}`;

        while (fleet.some(v => v.veiculo.toLowerCase() === cleanName.toLowerCase())) {

          num++;

          cleanName = `Viatura ${num}`;

        }

      }

    const targetWh = newVWarehouse.trim() || (warehouses.length > 0 ? warehouses[0].name : "Armazém Principal");



    if (fleet.some(v => v.veiculo.toLowerCase() === cleanName.toLowerCase())) {

      alert("JÃ¡ existe um veÃculo com este nome na frota.");

      return;

    }



    const updatedVeh: Vehicle = {

      veiculo: cleanName,

      armazem: targetWh,

      capacidade_kg: Number(newVCapKg) || 1000,

      capacidade_vol: Number(newVCapVol) || 5.0,

      custo_km: Number(newVCostKm) || 0.5,

      velocidade_media: Number(newVSpeed) || 40,

      horario_inicio: newVStart || "08:00",

      horario_fim: newVEnd || "18:00",

      is_active: 1

    };



    const nextFleet = [...fleet, updatedVeh];

    setFleet(nextFleet);

    persistFleetAndWarehouses(nextFleet, warehouses);



    // Reset

    setNewVName("");

    setNewVCapKg(1000);

    setNewVCapVol(5.0);

    setNewVCostKm(0.5);

    setNewVSpeed(40);

    setNewVStart("08:00");

    setNewVEnd("18:00");

  };



  const handleSaveEditVehicle = (idx: number) => {

    if (!editVehData || !editVehData.veiculo.trim()) {

      alert("Nome do veÃculo Ã© obrigatÃ³rio.");

      return;

    }



    const nextFleet = fleet.map((v, i) => i === idx ? editVehData : v);

    setFleet(nextFleet);

    persistFleetAndWarehouses(nextFleet, warehouses);

    setEditingVehIdx(null);

    setEditVehData(null);

  };



  const handleDeleteVehicle = (idx: number) => {

    if (!confirm("Deseja eliminar este veÃculo?")) return;

    const nextFleet = fleet.filter((_, i) => i !== idx);

    setFleet(nextFleet);

    persistFleetAndWarehouses(nextFleet, warehouses);

  };



  const handleToggleVehicleActive = (idx: number) => {

    const nextFleet = fleet.map((v, i) => i === idx ? { ...v, is_active: v.is_active === 0 ? 1 : 0 } : v);

    setFleet(nextFleet);

    persistFleetAndWarehouses(nextFleet, warehouses);

  };



  // --- IMPORT / EXPORT EXCEL ---

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {

    if (!selectedProject || !e.target.files || e.target.files.length === 0) return;

    const file = e.target.files[0];

    setImporting(true);



    const formData = new FormData();

    formData.append("file", file);



    try {

      const token = localStorage.getItem("georoute_token");

      const headers = new Headers();

      if (token) {

        headers.set("Authorization", `Bearer ${token}`);

      }



      const response = await fetch(`/api/fleet/import/${selectedProject.id}`, {

        method: "POST",

        headers,

        body: formData

      });



      if (!response.ok) {

        const errorData = await response.json();

        throw new Error(errorData.detail || "Erro ao importar frota e armazÃ©ns.");

      }



      const resJson = await response.json();

      alert(resJson.message || "Ficheiro importado com sucesso!");



      setLoading(true);

      const res = await apiRequest(`/api/fleet/${selectedProject.id}`);

      setWarehouses(res.warehouses || []);

      setFleet(res.fleet || []);

    } catch (err: any) {

      alert(err.message || "Erro ao efetuar a importaÃ§Ã£o.");

    } finally {

      setImporting(false);

      setLoading(false);

      e.target.value = "";

    }

  };



  const handleSaveConfig = async () => {

    if (!selectedProject) return;

    if (warehouses.length === 0) {

      alert("Adicione pelo menos um armazÃ©m de origem antes de salvar.");

      return;

    }

    if (fleet.length === 0) {

      alert("Adicione pelo menos um veÃculo Ã  frota antes de salvar.");

      return;

    }



    await persistFleetAndWarehouses(fleet, warehouses, true);

  };



  return (

    <DashboardLayout>

      <div className="space-y-4 max-w-full">

        {/* COMPACT TOP HEADER AND TOOLBAR */}

        <div className="flex flex-col md:flex-row md:items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl p-3 gap-3">

          <div className="flex items-center space-x-4">

            <div>

              <h1 className="text-sm font-bold text-zinc-50 font-sans leading-tight">Frota e Armazéns</h1>

              <p className="text-[10px] text-zinc-400">Configure as origens e veÃculos ativos</p>

            </div>

            {/* Nav tabs compact selection */}

            <div className="flex border border-zinc-850 bg-zinc-950 rounded-lg p-0.5 text-[11px] font-sans">

              <button

                onClick={() => setActiveTab("warehouses")}

                className={`px-3 py-1 rounded-md font-bold transition-all cursor-pointer ${

                  activeTab === "warehouses"

                    ? "bg-indigo-600 dark:bg-indigo-650 text-white shadow-sm"

                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 border border-transparent"

                }`}

              >

                Armazéns ({warehouses.length})

              </button>

              <button

                onClick={() => setActiveTab("fleet")}

                className={`px-3 py-1 rounded-md font-bold transition-all cursor-pointer ${

                  activeTab === "fleet"

                    ? "bg-indigo-600 dark:bg-indigo-650 text-white shadow-sm"

                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 border border-transparent"

                }`}

              >

                Frota ({fleet.length})

              </button>

            </div>

          </div>



          <div className="flex items-center space-x-2 justify-end">

            {saveStatus === "saving" && <span className="text-[10px] text-zinc-500 animate-pulse">A gravar...</span>}

            {saveStatus === "saved" && <span className="text-[10px] text-emerald-500 font-bold">Gravado!</span>}

            

            <label className="cursor-pointer bg-zinc-950 hover:bg-zinc-850 border border-zinc-800 text-zinc-300 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors flex items-center space-x-1.5">

              <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">

                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />

              </svg>

              <span>{importing ? "A importar..." : "Importar Excel"}</span>

              <input

                type="file"

                accept=".xlsx,.xls"

                onChange={handleImportExcel}

                className="hidden"

                disabled={importing || loading}

              />

            </label>

          </div>

        </div>



        {/* TAB 1: WAREHOUSES TABLE */}

        {activeTab === "warehouses" && (

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-xl p-3">

            <div className="overflow-auto max-h-[calc(100vh-220px)] relative">

              <table className="w-full text-left border-collapse text-[11px] font-sans">

                <thead>

                  <tr className="bg-zinc-950 border-b border-zinc-800 text-[9px] font-bold uppercase tracking-wider text-zinc-300">

                    <th className="px-3 py-2.5 w-[80px] text-center">AÃ§Ãµes</th>

                    <th className="px-3 py-2.5 min-w-[150px]">Nome do Armazém</th>

                    <th className="px-3 py-2.5 min-w-[200px]">Morada Completa</th>

                    <th className="px-3 py-2.5 w-[90px]">C. Postal</th>

                    <th className="px-3 py-2.5 min-w-[100px]">Localidade</th>

                    <th className="px-3 py-2.5 w-[90px] text-center">Latitude</th>

                    <th className="px-3 py-2.5 w-[90px] text-center">Longitude</th>

                  </tr>

                </thead>

                <tbody className="divide-y divide-zinc-850">

                  {/* QUICK CREATION ROW */}

                  <tr className="bg-zinc-950/40 hover:bg-zinc-950/70 border-b border-zinc-800">

                    <td className="px-3 py-2 text-center">

                      <button

                        onClick={handleCreateWarehouse}

                        title="Adicionar Armazém"

                        className="p-1 bg-emerald-950 hover:bg-emerald-900 border border-emerald-800 text-emerald-400 hover:text-emerald-300 rounded cursor-pointer transition-colors"

                      >

                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">

                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />

                        </svg>

                      </button>

                    </td>

                    <td className="px-2 py-1">

                      <input

                        type="text"

                        placeholder="Novo Armazém"

                        value={newWhName}

                        onChange={e => setNewWhName(e.target.value)}

                        className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 rounded px-2 py-1 text-xs text-zinc-200 outline-none"

                      />

                    </td>

                    <td className="px-2 py-1">

                      <input

                        type="text"

                        placeholder="Morada completa da base"

                        value={newWhAddr}

                        onChange={e => setNewWhAddr(e.target.value)}

                        className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 rounded px-2 py-1 text-xs text-zinc-200 outline-none"

                      />

                    </td>

                    <td className="px-2 py-1">

                      <input

                        type="text"

                        placeholder="1000-001"

                        value={newWhCp}

                        onChange={e => setNewWhCp(e.target.value)}

                        className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 rounded px-2 py-1 text-xs text-zinc-200 outline-none font-mono"

                      />

                    </td>

                    <td className="px-2 py-1">

                      <input

                        type="text"

                        placeholder="Cidade"

                        value={newWhLocality}

                        onChange={e => setNewWhLocality(e.target.value)}

                        className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 rounded px-2 py-1 text-xs text-zinc-200 outline-none"

                      />

                    </td>

                    <td className="px-2 py-1">

                      <input

                        type="text"

                        placeholder="Ex: 38.7"

                        value={newWhLat}

                        onChange={e => setNewWhLat(e.target.value)}

                        className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 rounded px-2 py-1 text-xs text-zinc-200 outline-none font-mono text-center"

                      />

                    </td>

                    <td className="px-2 py-1">

                      <div className="flex items-center space-x-1">

                        <input

                          type="text"

                          placeholder="Ex: -9.1"

                          value={newWhLon}

                          onChange={e => setNewWhLon(e.target.value)}

                          className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 rounded px-2 py-1 text-xs text-zinc-200 outline-none font-mono text-center"

                        />

                        <button

                          type="button"

                          onClick={() => {

                            setGeoTarget("new");

                            setIsMapModalOpen(true);

                          }}

                          title="Georreferenciar no Mapa"

                          className="p-1 bg-zinc-900 border border-zinc-850 hover:bg-zinc-800 hover:border-zinc-700 rounded text-zinc-400 hover:text-zinc-200 transition-all cursor-pointer"

                        >

                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>

                        </button>

                      </div>

                    </td>

                  </tr>



                  {/* DATA ROWS */}

                  {warehouses.length === 0 ? (

                    <tr>

                      <td colSpan={7} className="text-center py-8 text-zinc-500">

                        Nenhum armazÃ©m configurado. Importe um ficheiro Excel ou crie uma linha acima.

                      </td>

                    </tr>

                  ) : (

                    sortedWarehouses.map((wh, _loopIdx) => {

                      const idx = warehouses.findIndex(w => w.name === wh.name);

                      return (

                        <tr key={wh.name + idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">

                          {/* ACTIONS */}

                          <td className="px-3 py-1.5 text-center">

                            <div className="flex items-center justify-center space-x-1.5">

                              <button

                                onClick={() => { setGeoTarget("edit"); setEditWhData(wh); setEditingWhIdx(idx); setIsMapModalOpen(true); }}

                                title="Georreferenciar no Mapa"

                                className="p-1 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded cursor-pointer transition-colors text-sm"

                              ><svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg></button>

                              <button

                                onClick={() => handleDeleteWarehouse(idx)}

                                title="Eliminar Armazém"

                                className="p-1 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded cursor-pointer transition-colors text-sm"

                              ><svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>

                            </div>

                          </td>

                          {/* NOME */}

                          <td className="px-3 py-1.5">

                            <input type="text" value={wh.name}

                              onChange={e => handleWhChange(idx, "name", e.target.value)}

                              className="w-full bg-transparent border border-transparent hover:border-zinc-600 focus:border-indigo-500 rounded px-1.5 py-0.5 text-xs text-zinc-800 dark:text-zinc-200 outline-none transition-all" />

                          </td>

                          {/* MORADA */}

                          <td className="px-3 py-1.5">

                            <input type="text" value={wh.address}

                              onChange={e => handleWhChange(idx, "address", e.target.value)}

                              className="w-full bg-transparent border border-transparent hover:border-zinc-600 focus:border-indigo-500 rounded px-1.5 py-0.5 text-xs text-zinc-800 dark:text-zinc-200 outline-none transition-all" />

                          </td>

                          {/* CP */}

                          <td className="px-3 py-1.5">

                            <input type="text" value={wh.cp}

                              onChange={e => handleWhChange(idx, "cp", e.target.value)}

                              className="w-full bg-transparent border border-transparent hover:border-zinc-600 focus:border-indigo-500 rounded px-1.5 py-0.5 text-xs text-zinc-800 dark:text-zinc-200 font-mono outline-none transition-all" />

                          </td>

                          {/* LOCALIDADE */}

                          <td className="px-3 py-1.5">

                            <input type="text" value={wh.locality}

                              onChange={e => handleWhChange(idx, "locality", e.target.value)}

                              className="w-full bg-transparent border border-transparent hover:border-zinc-600 focus:border-indigo-500 rounded px-1.5 py-0.5 text-xs text-zinc-800 dark:text-zinc-200 outline-none transition-all" />

                          </td>

                          {/* COORDS */}

                          <td className="px-3 py-1.5 text-zinc-400 font-mono text-[10px]">

                            {wh.lat !== 0 && wh.lon !== 0 ? `${wh.lat.toFixed(5)}, ${wh.lon.toFixed(5)}`  : "â€”"}

                          </td>

                        </tr>

                      );

                    })

                  )}

                </tbody>

              </table>

            </div>

          </div>

        )}



        {/* TAB 2: VEHICLES TABLE */}

        {activeTab === "fleet" && (

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-xl p-3">

            <div className="overflow-auto max-h-[calc(100vh-220px)] relative">

              <table className="w-full text-left border-collapse text-[11px] font-sans">

                <thead>

                  <tr className="bg-zinc-100 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-850 text-[9px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">

                    <th className="px-3 py-2.5 w-[110px] text-center sticky top-0 bg-zinc-100 dark:bg-zinc-950 z-10">AÃ§Ãµes</th>

                    <th onClick={() => handleSort("veiculo")} className="px-3 py-2.5 min-w-[150px] sticky top-0 bg-zinc-100 dark:bg-zinc-950 z-10 cursor-pointer select-none">IdentificaÃ§Ã£o / MatrÃcula {sortField==="veiculo"?(sortDirection==="asc"?"â–²":"â–¼"):""}</th>

                    <th onClick={() => handleSort("armazem")} className="px-3 py-2.5 min-w-[130px] sticky top-0 bg-zinc-100 dark:bg-zinc-950 z-10 cursor-pointer select-none">Armazém de Origem {sortField==="armazem"?(sortDirection==="asc"?"â–²":"â–¼"):""}</th>

                    <th onClick={() => handleSort("capacidade_kg")} className="px-3 py-2.5 w-[90px] text-center sticky top-0 bg-zinc-100 dark:bg-zinc-950 z-10 cursor-pointer select-none">Cap. KG {sortField==="capacidade_kg"?(sortDirection==="asc"?"â–²":"â–¼"):""}</th>

                    <th onClick={() => handleSort("capacidade_vol")} className="px-3 py-2.5 w-[90px] text-center sticky top-0 bg-zinc-100 dark:bg-zinc-950 z-10 cursor-pointer select-none">Vol. MÂ³ {sortField==="capacidade_vol"?(sortDirection==="asc"?"â–²":"â–¼"):""}</th>

                    <th onClick={() => handleSort("velocidade_media")} className="px-3 py-2.5 w-[80px] text-center sticky top-0 bg-zinc-100 dark:bg-zinc-950 z-10 cursor-pointer select-none">V.MÃ©dia {sortField==="velocidade_media"?(sortDirection==="asc"?"â–²":"â–¼"):""}</th>

                    <th onClick={() => handleSort("horario_inicio")} className="px-3 py-2.5 w-[80px] text-center sticky top-0 bg-zinc-100 dark:bg-zinc-950 z-10 cursor-pointer select-none">InÃcio {sortField==="horario_inicio"?(sortDirection==="asc"?"â–²":"â–¼"):""}</th>

                    <th onClick={() => handleSort("horario_fim")} className="px-3 py-2.5 w-[80px] text-center sticky top-0 bg-zinc-100 dark:bg-zinc-950 z-10 cursor-pointer select-none">Fim {sortField==="horario_fim"?(sortDirection==="asc"?"â–²":"â–¼"):""}</th>

                    <th onClick={() => handleSort("custo_km")} className="px-3 py-2.5 w-[80px] text-center sticky top-0 bg-zinc-100 dark:bg-zinc-950 z-10 cursor-pointer select-none">â‚¬/km {sortField==="custo_km"?(sortDirection==="asc"?"â–²":"â–¼"):""}</th>

                  </tr>

                </thead>

                <tbody className="divide-y divide-zinc-850">

                  {/* QUICK CREATION ROW */}

                  <tr className="bg-zinc-950/40 hover:bg-zinc-950/70 border-b border-zinc-800">

                    <td className="px-3 py-2 text-center">

                      <button

                        onClick={handleCreateVehicle}

                        disabled={warehouses.length === 0}

                        title="Adicionar VeÃculo"

                        className="p-1 bg-emerald-950 hover:bg-emerald-900 border border-emerald-800 text-emerald-400 hover:text-emerald-300 rounded cursor-pointer transition-colors disabled:opacity-50"

                      >

                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">

                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />

                        </svg>

                      </button>

                    </td>

                    <td className="px-2 py-1">

                      <input

                        type="text"

                        placeholder="MatrÃcula / Identificador"

                        value={newVName}

                        onChange={e => setNewVName(e.target.value)}

                        className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 rounded px-2 py-1 text-xs text-zinc-200 outline-none"

                      />

                    </td>

                    <td className="px-2 py-1">

                      <select

                        value={newVWarehouse}

                        onChange={e => setNewVWarehouse(e.target.value)}

                        className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 rounded px-2 py-1 text-xs text-zinc-250 outline-none"

                      >

                        {warehouses.length === 0 ? (

                          <option>Sem Armazéns</option>

                        ) : (

                          warehouses.map(w => (

                            <option key={w.name} value={w.name}>{w.name}</option>

                          ))

                        )}

                      </select>

                    </td>

                    <td className="px-2 py-1">

                      <input

                        type="number"

                        min="0"

                        placeholder="1000"

                        value={newVCapKg}

                        onChange={e => setNewVCapKg(parseInt(e.target.value) || 0)}

                        className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 rounded px-2 py-1 text-xs text-zinc-200 outline-none text-center font-mono"

                      />

                    </td>

                    <td className="px-2 py-1">

                      <input

                        type="number"

                        step="0.1"

                        min="0"

                        placeholder="5.0"

                        value={newVCapVol}

                        onChange={e => setNewVCapVol(parseFloat(e.target.value) || 0.0)}

                        className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 rounded px-2 py-1 text-xs text-zinc-200 outline-none text-center font-mono"

                      />

                    </td>

                    <td className="px-2 py-1">

                      <input

                        type="number"

                        min="0"

                        placeholder="40"

                        value={newVSpeed}

                        onChange={e => setNewVSpeed(parseInt(e.target.value) || 0)}

                        className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 rounded px-2 py-1 text-xs text-zinc-200 outline-none text-center font-mono"

                      />

                    </td>

                    <td className="px-2 py-1">

                      <input

                        type="text"

                        placeholder="08:00"

                        value={newVStart}

                        onChange={e => setNewVStart(e.target.value)}

                        className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 rounded px-2 py-1 text-xs text-zinc-200 outline-none text-center font-mono"

                      />

                    </td>

                    <td className="px-2 py-1">

                      <input

                        type="text"

                        placeholder="18:00"

                        value={newVEnd}

                        onChange={e => setNewVEnd(e.target.value)}

                        className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 rounded px-2 py-1 text-xs text-zinc-200 outline-none text-center font-mono"

                      />

                    </td>

                    <td className="px-2 py-1">

                      <input

                        type="number"

                        step="0.01"

                        min="0"

                        placeholder="0.50"

                        value={newVCostKm}

                        onChange={e => setNewVCostKm(parseFloat(e.target.value) || 0.0)}

                        className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 rounded px-2 py-1 text-xs text-zinc-200 outline-none text-center font-mono"

                      />

                    </td>

                  </tr>



                  {/* DATA ROWS */}

                  {fleet.length === 0 ? (

                    <tr>

                      <td colSpan={9} className="text-center py-8 text-zinc-500">

                        Nenhum veÃculo registado. Importe um ficheiro Excel ou crie uma linha acima.

                      </td>

                    </tr>

                  ) : (

                    sortedFleet.map((veh, _loopIdx) => {

                      const idx = fleet.findIndex(v => v.veiculo === veh.veiculo);

                      return (

                        <tr key={veh.veiculo + idx} className={`hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors${veh.is_active === 0 ? " opacity-50 grayscale" : ""}`}>

                          {/* ACTIONS */}

                          <td className="px-3 py-1.5 text-center">

                            <div className="flex items-center justify-center space-x-1.5">

                              <button

                                onClick={() => handleToggleVehicleActive(idx)}

                                title={veh.is_active !== 0 ? "Desativar" : "Ativar"}

                                className={`p-1 rounded cursor-pointer transition-colors text-sm ${veh.is_active !== 0 ? "bg-emerald-950 hover:bg-emerald-900 text-emerald-400" : "bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 text-zinc-500"}`}

                              >{veh.is_active !== 0 ? "ON" : "OFF"}</button>

                              <button

                                onClick={() => handleDeleteVehicle(idx)}

                                title="Eliminar"

                                className="p-1 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded cursor-pointer transition-colors text-sm"

                              ><svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>

                            </div>

                          </td>

                          {/* VEICULO */}

                          <td className="px-3 py-1.5">

                            <input type="text" value={veh.veiculo}

                                onChange={e => handleFleetChange(idx, "veiculo", e.target.value)}

                                onBlur={(e) => {

                                  const finalFleet = [...fleet];

                                  if (!e.target.value.trim()) {

                                    finalFleet[idx] = { ...finalFleet[idx], veiculo: `Viatura ` };

                                    setFleet(finalFleet);

                                  }

                                  // Gravar na BD ao sair do campo de texto

                                  handleFleetBlur(finalFleet);

                                }}

                              className="w-full bg-transparent border border-transparent hover:border-zinc-600 focus:border-indigo-500 rounded px-1.5 py-0.5 text-xs text-zinc-800 dark:text-zinc-200 outline-none transition-all" />

                          </td>

                          {/* ARMAZEM */}

                          <td className="px-3 py-1.5">

                            <select value={veh.armazem || (warehouses.length > 0 ? warehouses[0].name : "")}

                              onChange={e => handleFleetChange(idx, "armazem", e.target.value, true)}

                              className="w-full bg-transparent border border-transparent hover:border-zinc-600 focus:border-indigo-500 rounded px-1.5 py-0.5 text-xs text-zinc-800 dark:text-zinc-200 outline-none transition-all">

                              {warehouses.map(w => <option key={w.name} value={w.name}>{w.name}</option>)}

                            </select>

                          </td>

                          {/* CAP KG */}

                          <td className="px-3 py-1.5">

                            <input type="number" min="0" value={veh.capacidade_kg}

                              onChange={e => handleFleetChange(idx, "capacidade_kg", parseInt(e.target.value) || 0)}

              onBlur={e => handleFleetBlur(fleet.map((v,i) => i === idx ? {...v, capacidade_kg: parseInt(e.target.value) || 0} : v))}

                              className="w-full bg-transparent border border-transparent hover:border-zinc-600 focus:border-indigo-500 rounded px-1.5 py-0.5 text-xs text-zinc-800 dark:text-zinc-200 text-center font-mono outline-none transition-all" />

                          </td>

                          {/* CAP VOL */}

                          <td className="px-3 py-1.5">

                            <input type="number" step="0.1" min="0" value={veh.capacidade_vol}

                              onChange={e => handleFleetChange(idx, "capacidade_vol", parseFloat(e.target.value) || 0)}

              onBlur={e => handleFleetBlur(fleet.map((v,i) => i === idx ? {...v, capacidade_vol: parseFloat(e.target.value) || 0} : v))}

                              className="w-full bg-transparent border border-transparent hover:border-zinc-600 focus:border-indigo-500 rounded px-1.5 py-0.5 text-xs text-zinc-800 dark:text-zinc-200 text-center font-mono outline-none transition-all" />

                          </td>

                          {/* VELOCIDADE */}

                          <td className="px-3 py-1.5">

                            <input type="number" min="0" value={veh.velocidade_media}

                              onChange={e => handleFleetChange(idx, "velocidade_media", parseInt(e.target.value) || 0)}

              onBlur={e => handleFleetBlur(fleet.map((v,i) => i === idx ? {...v, velocidade_media: parseInt(e.target.value) || 0} : v))}

                              className="w-full bg-transparent border border-transparent hover:border-zinc-600 focus:border-indigo-500 rounded px-1.5 py-0.5 text-xs text-zinc-800 dark:text-zinc-200 text-center font-mono outline-none transition-all" />

                          </td>

                          {/* INICIO */}

                          <td className="px-3 py-1.5">

                            <input type="time" value={veh.horario_inicio}

                              onChange={e => handleFleetChange(idx, "horario_inicio", e.target.value, true)}

                              className="w-full bg-transparent border border-transparent hover:border-zinc-600 focus:border-indigo-500 rounded px-1.5 py-0.5 text-xs text-zinc-800 dark:text-zinc-200 text-center font-mono outline-none transition-all" />

                          </td>

                          {/* FIM */}

                          <td className="px-3 py-1.5">

                            <input type="time" value={veh.horario_fim}

                              onChange={e => handleFleetChange(idx, "horario_fim", e.target.value, true)}

                              className="w-full bg-transparent border border-transparent hover:border-zinc-600 focus:border-indigo-500 rounded px-1.5 py-0.5 text-xs text-zinc-800 dark:text-zinc-200 text-center font-mono outline-none transition-all" />

                          </td>

                          {/* CUSTO */}

                          <td className="px-3 py-1.5">

                            <input type="number" step="0.01" min="0" value={veh.custo_km}

                              onChange={e => handleFleetChange(idx, "custo_km", parseFloat(e.target.value) || 0)}

              onBlur={e => handleFleetBlur(fleet.map((v,i) => i === idx ? {...v, custo_km: parseFloat(e.target.value) || 0} : v))}

                              className="w-full bg-transparent border border-transparent hover:border-zinc-600 focus:border-indigo-500 rounded px-1.5 py-0.5 text-xs text-zinc-800 dark:text-zinc-200 text-center font-mono outline-none transition-all" />

                          </td>

                        </tr>

                      );

                    })

                  )}

                </tbody>

              </table>

            </div>

          </div>

        )}

      </div>



      <WarehouseGeoModal

        isOpen={isMapModalOpen}

        warehouseName={geoTarget === "new" ? (newWhName || "Novo Armazém") : (editWhData?.name || "Editar Armazém")}

        initialAddress={geoTarget === "new" ? (newWhAddr || "") : (editWhData?.address || "")}

        initialCp={geoTarget === "new" ? (newWhCp || "") : (editWhData?.cp || "")}

        initialLocality={geoTarget === "new" ? (newWhLocality || "") : (editWhData?.locality || "")}

        initialLat={geoTarget === "new" ? (newWhLat ? parseFloat(newWhLat) : 0) : (editWhData?.lat || 0)}

        initialLon={geoTarget === "new" ? (newWhLon ? parseFloat(newWhLon) : 0) : (editWhData?.lon || 0)}

        onConfirm={(addr, cp, loc, lat, lon) => {

          if (geoTarget === "new") {

            setNewWhAddr(addr);

            setNewWhCp(cp);

            setNewWhLocality(loc);

            setNewWhLat(lat.toFixed(6));

            setNewWhLon(lon.toFixed(6));

          } else {

            setEditWhData(prev => prev ? {

              ...prev,

              address: addr,

              cp: cp,

              locality: loc,

              lat: parseFloat(lat.toFixed(6)),

              lon: parseFloat(lon.toFixed(6))

            } : null);

          }

          setIsMapModalOpen(false);

        }}

        onClose={() => setIsMapModalOpen(false)}

      />

    </DashboardLayout>

  );

}



