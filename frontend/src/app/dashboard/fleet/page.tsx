"use client";



import React, { useState, useEffect } from "react";

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

}



export default function FleetPage() {
  const { t } = useI18n();

  const { selectedProject } = useProjects();

  const [activeTab, setActiveTab] = useState<"warehouses" | "fleet">("warehouses");

  const [loading, setLoading] = useState(false);



  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [fleet, setFleet] = useState<Vehicle[]>([]);



  // Warehouse form state

  const [whName, setWhName] = useState("");

  const [whAddr, setWhAddr] = useState("");

  const [whCp, setWhCp] = useState("");

  const [whLocality, setWhLocality] = useState("");
  const [whLat, setWhLat] = useState("");
  const [whLon, setWhLon] = useState("");
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);
  
  // Edit states
  const [editingWhIdx, setEditingWhIdx] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const persistFleetAndWarehouses = async (nextFleet: Vehicle[], nextWh: Warehouse[], showAlert = false) => {
    if (!selectedProject) return;
    setSaveStatus("saving");
    try {
      await apiRequest(`/api/fleet/${selectedProject.id}`, {
        method: "POST",
        body: JSON.stringify({
          fleet: nextFleet,
          warehouses: nextWh,
        }),
      });
      setSaveStatus("saved");
      if (showAlert) {
        alert("Configuração da frota e armazéns guardada com sucesso!");
      }
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err: any) {
      setSaveStatus("error");
      console.error("Auto-save fleet error:", err);
      if (showAlert) {
        alert(err.message || "Erro ao guardar configurações.");
      }
    }
  };
  const [editingVehIdx, setEditingVehIdx] = useState<number | null>(null);



  // Vehicle form state

  const [vName, setVName] = useState("");

  const [vWarehouse, setVWarehouse] = useState("");

  const [importing, setImporting] = useState(false);

  const [vCapKg, setVCapKg] = useState(1000);

  const [vCapVol, setVCapVol] = useState(5.0);

  const [vCostKm, setVCostKm] = useState(0.5);

  const [vSpeed, setVSpeed] = useState(40);

  const [vStart, setVStart] = useState("08:00");

  const [vEnd, setVEnd] = useState("18:00");



  // Load existing configuration on mount/project change

  useEffect(() => {

    if (!selectedProject) return;



    async function loadConfig() {

      setLoading(true);

      try {

        const data = await apiRequest(`/api/fleet/${selectedProject?.id}`);

        setWarehouses(data.warehouses || []);

        setFleet(data.fleet || []);

        if (data.warehouses && data.warehouses.length > 0) {

          setVWarehouse(data.warehouses[0].name);

        }

      } catch (e) {

        console.error("Failed to load fleet configuration:", e);

      } finally {

        setLoading(false);

      }

    }

    loadConfig();

  }, [selectedProject]);



  const handleAddWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!whName.trim() || !whAddr.trim()) return;

    setLoading(true);
    try {
      let lat = parseFloat(whLat) || 0.0;
      let lon = parseFloat(whLon) || 0.0;
      let quality = (lat !== 0 && lon !== 0) ? 0 : 99;

      const isEditing = editingWhIdx !== null;
      const addressChanged = !isEditing || 
        whAddr !== warehouses[editingWhIdx!].address || 
        whCp !== warehouses[editingWhIdx!].cp || 
        whLocality !== warehouses[editingWhIdx!].locality;

      // Geocode only if coordinates are NOT manually entered AND address changed
      if (addressChanged && (lat === 0.0 || lon === 0.0)) {
        const res = await apiRequest("/api/fleet/geocode-warehouses", {
          method: "POST",
          body: JSON.stringify([{
            name: whName,
            address: whAddr,
            cp: whCp,
            locality: whLocality
          }]),
        });

        if (res && res.length > 0) {
          const geocoded = res[0];
          lat = geocoded.lat;
          lon = geocoded.lon;
          quality = geocoded.quality;
          if (geocoded.quality === 99) {
            alert("Aviso: Não foi possível obter as coordenadas exatas da morada do armazém. Introduza as coordenadas manualmente se desejar.");
          }
        }
      } else if (isEditing && lat === 0.0 && lon === 0.0) {
        lat = warehouses[editingWhIdx!].lat;
        lon = warehouses[editingWhIdx!].lon;
        quality = warehouses[editingWhIdx!].quality;
      }

      const updatedWh = {
        name: whName,
        address: whAddr,
        cp: whCp,
        locality: whLocality,
        lat,
        lon,
        quality
      };

      let nextWh: Warehouse[] = [];
      let nextFleet = fleet;

      if (isEditing) {
        const oldName = warehouses[editingWhIdx!].name;
        nextWh = warehouses.map((w, idx) => idx === editingWhIdx ? updatedWh : w);
        setWarehouses(nextWh);
        
        // Propagate name change to fleet
        if (oldName !== whName) {
          nextFleet = fleet.map(v => v.armazem === oldName ? { ...v, armazem: whName } : v);
          setFleet(nextFleet);
          if (vWarehouse === oldName) {
            setVWarehouse(whName);
          }
        }
        setEditingWhIdx(null);
      } else {
        nextWh = [...warehouses, updatedWh];
        setWarehouses(nextWh);
        if (!vWarehouse) {
          setVWarehouse(whName);
        }
      }

      // Auto-save warehouse changes
      persistFleetAndWarehouses(nextFleet, nextWh);

      setWhName("");
      setWhAddr("");
      setWhCp("");
      setWhLocality("");
      setWhLat("");
      setWhLon("");
    } catch (err: any) {
      alert(err.message || "Erro ao guardar armazém.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteWarehouse = (idx: number) => {
    const name = warehouses[idx].name;
    const nextWh = warehouses.filter((_, i) => i !== idx);
    const nextFleet = fleet.filter(v => v.armazem !== name);

    setWarehouses(nextWh);
    setFleet(nextFleet);
    persistFleetAndWarehouses(nextFleet, nextWh);
  };



  const handleAddVehicle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!vName.trim() || !vWarehouse) return;

    const isEditing = editingVehIdx !== null;

    if (fleet.some((v, idx) => (!isEditing || idx !== editingVehIdx) && v.veiculo.toLowerCase() === vName.toLowerCase())) {
      alert("Já existe um veículo com este nome na frota.");
      return;
    }

    const updatedVeh: Vehicle = {
      veiculo: vName,
      armazem: vWarehouse,
      capacidade_kg: vCapKg,
      capacidade_vol: vCapVol,
      custo_km: vCostKm,
      velocidade_media: vSpeed,
      horario_inicio: vStart,
      horario_fim: vEnd
    };

    const nextFleet = isEditing
      ? fleet.map((v, idx) => idx === editingVehIdx ? updatedVeh : v)
      : [...fleet, updatedVeh];

    setFleet(nextFleet);
    if (isEditing) {
      setEditingVehIdx(null);
    }
    // Auto-save vehicle changes immediately
    persistFleetAndWarehouses(nextFleet, warehouses);

    setVName("");
    setVCapKg(1000);
    setVCapVol(5.0);
    setVCostKm(0.5);
    setVSpeed(40);
    setVStart("08:00");
    setVEnd("18:00");
  };

  const handleDeleteVehicle = (idx: number) => {
    const nextFleet = fleet.filter((_, i) => i !== idx);
    setFleet(nextFleet);
    persistFleetAndWarehouses(nextFleet, warehouses);
  };



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

        throw new Error(errorData.detail || "Erro ao importar frota e armazens.");

      }

      

      const resJson = await response.json();
      alert(resJson.message || "Ficheiro importado com sucesso!");

      

      setLoading(true);

      const res = await apiRequest(`/api/fleet/${selectedProject.id}`);

      setWarehouses(res.warehouses || []);

      setFleet(res.fleet || []);

    } catch (err: any) {

      alert(err.message || "Erro ao efetuar a importacao.");

    } finally {

      setImporting(false);

      setLoading(false);

      e.target.value = "";

    }

  };



  const handleSaveConfig = async () => {
    if (!selectedProject) return;
    if (warehouses.length === 0) {
      alert("Adicione pelo menos um armazém de origem antes de salvar.");
      return;
    }
    if (fleet.length === 0) {
      alert("Adicione pelo menos um veículo à frota antes de salvar.");
      return;
    }

    await persistFleetAndWarehouses(fleet, warehouses, true);
  };



  return (

    <DashboardLayout>

      <div className="space-y-6 max-w-5xl">

        {/* Header section */}

        <div className="flex items-center justify-between">

          <div>

            <h1 className="text-2xl font-bold tracking-tight text-zinc-50 font-sans">Frota e Armazéns</h1>

            <p className="text-zinc-400 text-xs mt-1">{t.fleet.subtitle}</p>

          </div>

          <label className="cursor-pointer bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 hover:border-zinc-700 text-zinc-300 rounded-xl px-4 py-2 text-xs font-semibold transition-colors flex items-center space-x-2 mr-3">

            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">

              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />

            </svg>

            <span>{importing ? "A importar..." : t.common.importExcel}</span>

            <input

              type="file"

              accept=".xlsx,.xls"

              onChange={handleImportExcel}

              className="hidden"

              disabled={importing || loading}

            />

          </label>



          <button

            onClick={handleSaveConfig}

            disabled={loading}

            className="cursor-pointer bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white rounded-xl px-5 py-2.5 text-xs font-semibold shadow-md shadow-indigo-500/10 transition-all flex items-center space-x-2"

          >

            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">

              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />

            </svg>

            <span>{loading ? "A Guardar..." : t.fleet.saveConfigBtn}</span>

          </button>

        </div>



        {/* Tabs navigation */}

        <div className="flex space-x-1 border-b border-zinc-800">

          <button

            onClick={() => setActiveTab("warehouses")}

            className={`px-5 py-2.5 text-sm font-semibold border-b-2 transition-all ${

              activeTab === "warehouses"

                ? "border-indigo-500 text-indigo-400"

                : "border-transparent text-zinc-400 hover:text-zinc-200"

            }`}

          >

            📍 Armazéns ({warehouses.length})

          </button>

          <button

            onClick={() => setActiveTab("fleet")}

            className={`px-5 py-2.5 text-sm font-semibold border-b-2 transition-all ${

              activeTab === "fleet"

                ? "border-indigo-500 text-indigo-400"

                : "border-transparent text-zinc-400 hover:text-zinc-200"

            }`}

          >

            🚛 Frota Automóvel ({fleet.length})

          </button>

        </div>



        {/* Tab 1: Warehouses */}

        {activeTab === "warehouses" && (

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* Add Warehouse Form */}

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 h-fit">

              <h3 className="text-sm font-bold text-zinc-100 mb-4">{editingWhIdx !== null ? "Editar Armazém" : "Adicionar Armazém"}</h3>

              <form onSubmit={handleAddWarehouse} className="space-y-4">

                <div>

                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-300 mb-1.5">Nome do Armazém</label>

                  <input

                    type="text"

                    required

                    value={whName}

                    onChange={e => setWhName(e.target.value)}

                    placeholder={t.fleet.whNamePlaceholder}

                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none"

                  />

                </div>

                <div>

                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-300 mb-1.5">Morada Completa</label>

                  <input

                    type="text"

                    required

                    value={whAddr}

                    onChange={e => setWhAddr(e.target.value)}

                    placeholder={t.fleet.whAddressPlaceholder}

                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none"

                  />

                </div>

                <div className="grid grid-cols-2 gap-3">

                  <div>

                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-300 mb-1.5">C. Postal</label>

                    <input

                      type="text"

                      required

                      value={whCp}

                      onChange={e => setWhCp(e.target.value)}

                      placeholder={t.fleet.whCpPlaceholder}

                      className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none"

                    />

                  </div>

                  <div>

                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-300 mb-1.5">Localidade</label>

                    <input

                      type="text"

                      required

                      value={whLocality}

                      onChange={e => setWhLocality(e.target.value)}

                      placeholder={t.fleet.whLocalityPlaceholder}

                      className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none"

                    />

                  </div>

                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-300 mb-1.5">Latitude (Opcional)</label>
                    <input
                      type="number"
                      step="0.000001"
                      placeholder="Ex: 38.7842"
                      value={whLat}
                      onChange={e => setWhLat(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-300 mb-1.5">Longitude (Opcional)</label>
                    <input
                      type="number"
                      step="0.000001"
                      placeholder="Ex: -9.1238"
                      value={whLon}
                      onChange={e => setWhLon(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none"
                    />
                  </div>
                </div>
                
                <button
                  type="button"
                  onClick={() => setIsMapModalOpen(true)}
                  className="w-full bg-zinc-950 border border-zinc-800 hover:bg-zinc-850 hover:border-zinc-700 text-zinc-200 hover:text-zinc-200 rounded-lg py-2 text-xs font-semibold transition-all cursor-pointer flex items-center justify-center space-x-1.5 mt-1"
                >
                  <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>{t.fleet.whGeoBtn}</span>
                </button>

                <div className="flex space-x-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-200 hover:text-white rounded-lg py-2.5 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    {loading ? "A Obter Coordenadas..." : (editingWhIdx !== null ? "Guardar Alterações" : "+ Adicionar Armazém")}
                  </button>
                  {editingWhIdx !== null && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingWhIdx(null);
                        setWhName("");
                        setWhAddr("");
                        setWhCp("");
                        setWhLocality("");
                        setWhLat("");
                        setWhLon("");
                      }}
                      className="bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-300 rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Cancelar
                    </button>
                  )}
                </div>

              </form>

            </div>



            {/* Warehouses List */}

            <div className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded-2xl p-6">

              <h3 className="text-sm font-bold text-zinc-100 mb-4">{t.fleet.configuredWarehouses}</h3>

              {warehouses.length === 0 ? (

                <div className="text-center py-12 text-zinc-300 text-xs">

                  Nenhum armazém adicionado. Utilize o formulário para registar os pontos de partida.

                </div>

              ) : (

                <div className="space-y-3">

                  {warehouses.map((wh, idx) => (

                    <div key={wh.name} className="flex items-center justify-between p-4 bg-zinc-950/40 border border-zinc-800/80 rounded-xl">

                      <div className="space-y-1">

                        <p className="text-xs font-bold text-zinc-250">{wh.name}</p>

                        <p className="text-[10px] text-zinc-300">{wh.address}, {wh.cp} {wh.locality}</p>

                        <p className="text-[9px] font-mono text-zinc-300">Coordenadas: {wh.lat.toFixed(5)}, {wh.lon.toFixed(5)}</p>

                      </div>

                      <div className="flex space-x-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingWhIdx(idx);
                            setWhName(wh.name);
                            setWhAddr(wh.address);
                            setWhCp(wh.cp);
                            setWhLocality(wh.locality);
                            setWhLat(wh.lat ? wh.lat.toString() : "");
                            setWhLon(wh.lon ? wh.lon.toString() : "");
                          }}
                          className="p-2 bg-zinc-900 hover:bg-indigo-950/30 border border-zinc-800 hover:border-indigo-800 text-zinc-300 hover:text-indigo-400 rounded-lg transition-colors cursor-pointer"
                          title="Editar Armazém"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeleteWarehouse(idx)}
                          className="p-2 bg-zinc-900 hover:bg-red-950/30 border border-zinc-800 hover:border-red-800 text-zinc-300 hover:text-red-400 rounded-lg transition-colors cursor-pointer"
                          title="Eliminar Armazém"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>

                    </div>

                  ))}

                </div>

              )}

            </div>

          </div>

        )}



        {/* Tab 2: Fleet */}

        {activeTab === "fleet" && (

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* Add Vehicle Form */}

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 h-fit">

              <h3 className="text-sm font-bold text-zinc-100 mb-4">{editingVehIdx !== null ? "Editar Veículo" : "Registar Veículo"}</h3>

              {warehouses.length === 0 ? (

                <div className="text-center py-6 text-amber-400 text-xs">

                  Adicione primeiro um armazém de origem na aba "Armazéns" para poder criar veículos.

                </div>

              ) : (

                <form onSubmit={handleAddVehicle} className="space-y-4">

                  <div>

                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-300 mb-1.5">Identificador do Veículo</label>

                    <input

                      type="text"

                      required

                      value={vName}

                      onChange={e => setVName(e.target.value)}

                      placeholder="Ex: Camião Volvo 12T"

                      className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none"

                    />

                  </div>

                  <div>

                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-300 mb-1.5">Armazém de Origem</label>

                    <select

                      value={vWarehouse}

                      onChange={e => setVWarehouse(e.target.value)}

                      required

                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300 outline-none focus:border-indigo-500"

                    >

                      {warehouses.map(w => (

                        <option key={w.name} value={w.name}>

                          {w.name}

                        </option>

                      ))}

                    </select>

                  </div>

                  <div className="grid grid-cols-2 gap-3">

                    <div>

                      <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-300 mb-1.5">Capacidade (kg)</label>

                      <input

                        type="number"

                        min="0"

                        required

                        value={vCapKg}

                        onChange={e => setVCapKg(parseInt(e.target.value) || 0)}

                        className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none"

                      />

                    </div>

                    <div>

                      <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-300 mb-1.5">Cap. Volume (m³)</label>

                      <input

                        type="number"

                        step="0.1"

                        min="0"

                        required

                        value={vCapVol}

                        onChange={e => setVCapVol(parseFloat(e.target.value) || 0.0)}

                        className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none"

                      />

                    </div>

                  </div>

                  <div className="grid grid-cols-2 gap-3">

                    <div>

                      <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-300 mb-1.5">Custo / KM (€)</label>

                      <input

                        type="number"

                        step="0.01"

                        min="0"

                        required

                        value={vCostKm}

                        onChange={e => setVCostKm(parseFloat(e.target.value) || 0.0)}

                        className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none"

                      />

                    </div>

                    <div>

                      <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-300 mb-1.5">Velocidade Média</label>

                      <input

                        type="number"

                        min="0"

                        required

                        value={vSpeed}

                        onChange={e => setVSpeed(parseInt(e.target.value) || 0)}

                        className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none"

                      />

                    </div>

                  </div>

                  <div className="grid grid-cols-2 gap-3">

                    <div>

                      <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-300 mb-1.5">Horário Início</label>

                      <input

                        type="text"

                        required

                        value={vStart}

                        onChange={e => setVStart(e.target.value)}

                        placeholder="08:00"

                        className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none font-mono"

                      />

                    </div>

                    <div>

                      <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-300 mb-1.5">Horário Fim</label>

                      <input

                        type="text"

                        required

                        value={vEnd}

                        onChange={e => setVEnd(e.target.value)}

                        placeholder="18:00"

                        className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none font-mono"

                      />

                    </div>

                  </div>

                  <div className="flex space-x-2">
                    <button
                      type="submit"
                      className="flex-1 bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-200 hover:text-white rounded-lg py-2.5 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      {editingVehIdx !== null ? "Guardar Alterações" : "+ Registar Veículo"}
                    </button>
                    {editingVehIdx !== null && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingVehIdx(null);
                          setVName("");
                          setVCapKg(1000);
                          setVCapVol(5.0);
                          setVCostKm(0.5);
                          setVSpeed(40);
                          setVStart("08:00");
                          setVEnd("18:00");
                        }}
                        className="bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-300 rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>

                </form>

              )}

            </div>



            {/* Fleet List */}

            <div className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded-2xl p-6">

              <h3 className="text-sm font-bold text-zinc-100 mb-4">Lista de Veículos</h3>

              {fleet.length === 0 ? (

                <div className="text-center py-12 text-zinc-300 text-xs">

                  Nenhum veículo registado. Adicione veículos de distribuição para calcular as rotas.

                </div>

              ) : (

                <div className="overflow-x-auto">

                  <table className="w-full text-left border-collapse text-xs">

                    <thead>

                      <tr className="bg-zinc-950/40 border-b border-zinc-800 text-[9px] font-bold uppercase tracking-wider text-zinc-300">

                        <th className="px-4 py-3">Veículo</th>

                        <th className="px-4 py-3">Armazém</th>

                        <th className="px-4 py-3 text-center">Capacidades</th>

                        <th className="px-4 py-3 text-center">Custo/KM</th>

                        <th className="px-4 py-3 text-center">V. Média</th>

                        <th className="px-4 py-3 text-center">Horário</th>

                        <th className="px-4 py-3 text-right">Ação</th>

                      </tr>

                    </thead>

                    <tbody className="divide-y divide-zinc-800/60">

                      {fleet.map((v, idx) => (

                        <tr key={v.veiculo} className="hover:bg-zinc-850/20 transition-colors">

                          <td className="px-4 py-3.5 font-bold text-zinc-300">{v.veiculo}</td>

                          <td className="px-4 py-3.5 text-zinc-400">{v.armazem}</td>

                          <td className="px-4 py-3.5 text-zinc-400 text-center font-mono">{v.capacidade_kg}kg / {v.capacidade_vol}m³</td>

                          <td className="px-4 py-3.5 text-zinc-400 text-center font-mono">{v.custo_km.toFixed(2)}€</td>

                          <td className="px-4 py-3.5 text-zinc-400 text-center font-mono">{v.velocidade_media} km/h</td>

                          <td className="px-4 py-3.5 text-zinc-400 text-center font-mono">{v.horario_inicio} - {v.horario_fim}</td>

                          <td className="px-4 py-3.5 text-right">

                            <div className="flex space-x-1.5 justify-end">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingVehIdx(idx);
                                  setVName(v.veiculo);
                                  setVWarehouse(v.armazem);
                                  setVCapKg(v.capacidade_kg);
                                  setVCapVol(v.capacidade_vol);
                                  setVCostKm(v.custo_km);
                                  setVSpeed(v.velocidade_media);
                                  setVStart(v.horario_inicio);
                                  setVEnd(v.horario_fim);
                                }}
                                className="p-1.5 bg-zinc-900 hover:bg-indigo-950/30 border border-zinc-800 hover:border-indigo-800 text-zinc-300 hover:text-indigo-400 rounded-lg transition-colors cursor-pointer"
                                title="Editar Veículo"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => handleDeleteVehicle(idx)}
                                className="p-1.5 bg-zinc-900 hover:bg-red-950/30 border border-zinc-800 hover:border-red-800 text-zinc-300 hover:text-red-400 rounded-lg transition-colors cursor-pointer"
                                title="Eliminar Veículo"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>

                          </td>

                        </tr>

                      ))}

                    </tbody>

                  </table>

                </div>

              )}

            </div>

          </div>

        )}

      </div>

      <WarehouseGeoModal
        isOpen={isMapModalOpen}
        warehouseName={whName || "Novo Armazém"}
        initialAddress={whAddr || ""}
        initialCp={whCp || ""}
        initialLocality={whLocality || ""}
        initialLat={whLat ? parseFloat(whLat) : 0}
        initialLon={whLon ? parseFloat(whLon) : 0}
        onConfirm={(addr, cp, loc, lat, lon) => {
          setWhAddr(addr);
          setWhCp(cp);
          setWhLocality(loc);
          setWhLat(lat.toFixed(6));
          setWhLon(lon.toFixed(6));
          setIsMapModalOpen(false);
        }}
        onClose={() => setIsMapModalOpen(false)}
      />
    </DashboardLayout>

  );

}
