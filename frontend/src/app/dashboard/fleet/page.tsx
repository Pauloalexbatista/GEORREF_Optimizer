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
          fleet: nextFleet.map(v => ({
            ...v,
            is_active: v.is_active !== undefined ? v.is_active : 1
          })),
          warehouses: whToSend,
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
      alert(`Aviso ao guardar frota: ${err.message || "Verifique a ligação"}`);
    }
  };

  // Load configuration on project change
  useEffect(() => {
    if (!selectedProject) return;

    async function loadConfig() {
      setLoading(true);
      try {
        const data = await apiRequest(`/api/fleet/${selectedProject?.id}`);
        setWarehouses(data.warehouses || []);
        setFleet(data.fleet || []);
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
      alert("Por favor introduza o nome e morada do armazém.");
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
            alert("Aviso: Não foi possível obter as coordenadas exatas da morada do armazém. Introduza as coordenadas manualmente se desejar.");
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
      alert(err.message || "Erro ao criar armazém.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEditWarehouse = async (idx: number) => {
    if (!editWhData || !editWhData.name.trim() || !editWhData.address.trim()) {
      alert("Nome e morada são obrigatórios.");
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
      alert(err.message || "Erro ao editar armazém.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteWarehouse = (idx: number) => {
    if (!confirm("Tem a certeza que deseja eliminar este armazém? Os veículos associados serão desassociados.")) return;
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

  const handleCreateVehicle = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newVName.trim();
    if (!cleanName) {
      alert("Insira a matrícula/nome do veículo.");
      return;
    }
    const targetWh = newVWarehouse.trim() || (warehouses.length > 0 ? warehouses[0].name : "Armazém Principal");

    if (fleet.some(v => v.veiculo.toLowerCase() === cleanName.toLowerCase())) {
      alert("Já existe um veículo com este nome na frota.");
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
      alert("Nome do veículo é obrigatório.");
      return;
    }

    const nextFleet = fleet.map((v, i) => i === idx ? editVehData : v);
    setFleet(nextFleet);
    persistFleetAndWarehouses(nextFleet, warehouses);
    setEditingVehIdx(null);
    setEditVehData(null);
  };

  const handleDeleteVehicle = (idx: number) => {
    if (!confirm("Deseja eliminar este veículo?")) return;
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
        throw new Error(errorData.detail || "Erro ao importar frota e armazéns.");
      }

      const resJson = await response.json();
      alert(resJson.message || "Ficheiro importado com sucesso!");

      setLoading(true);
      const res = await apiRequest(`/api/fleet/${selectedProject.id}`);
      setWarehouses(res.warehouses || []);
      setFleet(res.fleet || []);
    } catch (err: any) {
      alert(err.message || "Erro ao efetuar a importação.");
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
      <div className="space-y-4 max-w-full">
        {/* COMPACT TOP HEADER AND TOOLBAR */}
        <div className="flex flex-col md:flex-row md:items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl p-3 gap-3">
          <div className="flex items-center space-x-4">
            <div>
              <h1 className="text-sm font-bold text-zinc-50 font-sans leading-tight">Frota e Armazéns</h1>
              <p className="text-[10px] text-zinc-400">Configure as origens e veículos ativos</p>
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
                🏬 Armazéns ({warehouses.length})
              </button>
              <button
                onClick={() => setActiveTab("fleet")}
                className={`px-3 py-1 rounded-md font-bold transition-all cursor-pointer ${
                  activeTab === "fleet"
                    ? "bg-indigo-600 dark:bg-indigo-650 text-white shadow-sm"
                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 border border-transparent"
                }`}
              >
                🚚 Frota ({fleet.length})
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

            <button
              onClick={handleSaveConfig}
              disabled={loading}
              className="cursor-pointer bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white rounded-lg px-3.5 py-1.5 text-[11px] font-semibold shadow-md shadow-indigo-500/10 transition-all flex items-center space-x-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              <span>{loading ? "A Guardar..." : "Guardar Configurações"}</span>
            </button>
          </div>
        </div>

        {/* TAB 1: WAREHOUSES TABLE */}
        {activeTab === "warehouses" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-xl p-3">
            <div className="overflow-auto max-h-[calc(100vh-220px)] relative">
              <table className="w-full text-left border-collapse text-[11px] font-sans">
                <thead>
                  <tr className="bg-zinc-950 border-b border-zinc-800 text-[9px] font-bold uppercase tracking-wider text-zinc-300">
                    <th className="px-3 py-2.5 w-[80px] text-center">Ações</th>
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
                          📍
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* DATA ROWS */}
                  {warehouses.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-zinc-500">
                        Nenhum armazém configurado. Importe um ficheiro Excel ou crie uma linha acima.
                      </td>
                    </tr>
                  ) : (
                    warehouses.map((wh, idx) => {
                      const isEditing = editingWhIdx === idx;
                      return (
                        <tr key={wh.name + idx} className="hover:bg-zinc-850/20 transition-colors">
                          <td className="px-3 py-1.5 text-center">
                            <div className="flex items-center justify-center space-x-1.5">
                              {isEditing ? (
                                <>
                                  <button
                                    onClick={() => handleSaveEditWarehouse(idx)}
                                    title="Guardar Linha"
                                    className="p-1 bg-indigo-950 hover:bg-indigo-900 border border-indigo-800 text-indigo-400 hover:text-indigo-300 rounded cursor-pointer"
                                  >
                                    💾
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingWhIdx(null);
                                      setEditWhData(null);
                                    }}
                                    title="Cancelar"
                                    className="p-1 bg-zinc-950 hover:bg-zinc-850 border border-zinc-800 text-zinc-400 hover:text-zinc-300 rounded cursor-pointer"
                                  >
                                    ❌
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={() => {
                                      setEditingWhIdx(idx);
                                      setEditWhData({ ...wh });
                                    }}
                                    title="Editar Linha"
                                    className="p-1 bg-zinc-950 hover:bg-indigo-950 border border-zinc-850 hover:border-indigo-850 text-zinc-400 hover:text-indigo-400 rounded cursor-pointer transition-colors"
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    onClick={() => handleDeleteWarehouse(idx)}
                                    title="Eliminar Linha"
                                    className="p-1 bg-zinc-950 hover:bg-red-950 border border-zinc-855 hover:border-red-850 text-zinc-400 hover:text-red-400 rounded cursor-pointer transition-colors"
                                  >
                                    🗑️
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-1.5 font-bold text-zinc-200">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editWhData?.name || ""}
                                onChange={e => setEditWhData(prev => prev ? ({ ...prev, name: e.target.value }) : null)}
                                className="w-full bg-zinc-950 border border-zinc-850 rounded px-1.5 py-0.5 text-xs text-zinc-200 outline-none"
                              />
                            ) : (
                              wh.name
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-zinc-350">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editWhData?.address || ""}
                                onChange={e => setEditWhData(prev => prev ? ({ ...prev, address: e.target.value }) : null)}
                                className="w-full bg-zinc-950 border border-zinc-850 rounded px-1.5 py-0.5 text-xs text-zinc-250 outline-none"
                              />
                            ) : (
                              wh.address
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-zinc-400 font-mono">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editWhData?.cp || ""}
                                onChange={e => setEditWhData(prev => prev ? ({ ...prev, cp: e.target.value }) : null)}
                                className="w-full bg-zinc-950 border border-zinc-850 rounded px-1.5 py-0.5 text-xs text-zinc-300 outline-none font-mono"
                              />
                            ) : (
                              wh.cp
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-zinc-450">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editWhData?.locality || ""}
                                onChange={e => setEditWhData(prev => prev ? ({ ...prev, locality: e.target.value }) : null)}
                                className="w-full bg-zinc-950 border border-zinc-850 rounded px-1.5 py-0.5 text-xs text-zinc-300 outline-none"
                              />
                            ) : (
                              wh.locality
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-center text-zinc-400 font-mono">
                            {isEditing ? (
                              <input
                                type="number"
                                step="0.000001"
                                value={editWhData?.lat || 0.0}
                                onChange={e => setEditWhData(prev => prev ? ({ ...prev, lat: parseFloat(e.target.value) || 0.0 }) : null)}
                                className="w-full bg-zinc-950 border border-zinc-850 rounded px-1.5 py-0.5 text-xs text-zinc-300 outline-none font-mono text-center"
                              />
                            ) : (
                              wh.lat.toFixed(6)
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-center text-zinc-400 font-mono">
                            {isEditing ? (
                              <div className="flex items-center space-x-1">
                                <input
                                  type="number"
                                  step="0.000001"
                                  value={editWhData?.lon || 0.0}
                                  onChange={e => setEditWhData(prev => prev ? ({ ...prev, lon: parseFloat(e.target.value) || 0.0 }) : null)}
                                  className="w-full bg-zinc-950 border border-zinc-850 rounded px-1.5 py-0.5 text-xs text-zinc-350 outline-none font-mono text-center"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setGeoTarget("edit");
                                    setIsMapModalOpen(true);
                                  }}
                                  title="Georreferenciar no Mapa"
                                  className="p-1 bg-zinc-900 border border-zinc-850 hover:bg-zinc-800 hover:border-zinc-700 rounded text-zinc-450 hover:text-zinc-200 transition-all cursor-pointer"
                                >
                                  📍
                                </button>
                              </div>
                            ) : (
                              wh.lon.toFixed(6)
                            )}
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
                    <th className="px-3 py-2.5 w-[110px] text-center sticky top-0 bg-zinc-100 dark:bg-zinc-950 z-10">Ações</th>
                    <th className="px-3 py-2.5 min-w-[150px] sticky top-0 bg-zinc-100 dark:bg-zinc-950 z-10">Identificação / Matrícula</th>
                    <th className="px-3 py-2.5 min-w-[130px] sticky top-0 bg-zinc-100 dark:bg-zinc-950 z-10">Armazém de Origem</th>
                    <th className="px-3 py-2.5 w-[90px] text-center sticky top-0 bg-zinc-100 dark:bg-zinc-950 z-10">Capacidade (KG)</th>
                    <th className="px-3 py-2.5 w-[90px] text-center sticky top-0 bg-zinc-100 dark:bg-zinc-950 z-10">Volume (M³)</th>
                    <th className="px-3 py-2.5 w-[80px] text-center sticky top-0 bg-zinc-100 dark:bg-zinc-950 z-10">V. Média (km/h)</th>
                    <th className="px-3 py-2.5 w-[80px] text-center sticky top-0 bg-zinc-100 dark:bg-zinc-950 z-10">Início Turno</th>
                    <th className="px-3 py-2.5 w-[80px] text-center sticky top-0 bg-zinc-100 dark:bg-zinc-950 z-10">Fim Turno</th>
                    <th className="px-3 py-2.5 w-[80px] text-center sticky top-0 bg-zinc-100 dark:bg-zinc-950 z-10">Custo/KM (€)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-850">
                  {/* QUICK CREATION ROW */}
                  <tr className="bg-zinc-950/40 hover:bg-zinc-950/70 border-b border-zinc-800">
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={handleCreateVehicle}
                        disabled={warehouses.length === 0}
                        title="Adicionar Veículo"
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
                        placeholder="Matrícula / Identificador"
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
                        Nenhum veículo registado. Importe um ficheiro Excel ou crie uma linha acima.
                      </td>
                    </tr>
                  ) : (
                    fleet.map((veh, idx) => {
                      const isEditing = editingVehIdx === idx;
                      const isActive = veh.is_active !== 0;
                      return (
                        <tr key={veh.veiculo + idx} className={`hover:bg-zinc-850/20 transition-colors ${!isActive ? 'opacity-40 bg-zinc-950/20' : ''}`}>
                          <td className="px-3 py-1.5 text-center">
                            <div className="flex items-center justify-center space-x-1.5">
                              {isEditing ? (
                                <>
                                  <button
                                    onClick={() => handleSaveEditVehicle(idx)}
                                    title="Guardar Linha"
                                    className="p-1 bg-indigo-950 hover:bg-indigo-900 border border-indigo-800 text-indigo-400 hover:text-indigo-300 rounded cursor-pointer"
                                  >
                                    💾
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingVehIdx(null);
                                      setEditVehData(null);
                                    }}
                                    title="Cancelar"
                                    className="p-1 bg-zinc-950 hover:bg-zinc-850 border border-zinc-800 text-zinc-400 hover:text-zinc-300 rounded cursor-pointer"
                                  >
                                    ❌
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={() => handleToggleVehicleActive(idx)}
                                    title={isActive ? "Desativar Veículo" : "Ativar Veículo"}
                                    className={`p-1 border rounded cursor-pointer transition-all ${
                                      isActive 
                                        ? 'bg-emerald-950/60 border-emerald-700 text-emerald-400 hover:bg-emerald-900/60' 
                                        : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:bg-zinc-800'
                                    }`}
                                  >
                                    ●
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingVehIdx(idx);
                                      setEditVehData({ ...veh });
                                    }}
                                    title="Editar Linha"
                                    className="p-1 bg-zinc-950 hover:bg-indigo-950 border border-zinc-850 hover:border-indigo-850 text-zinc-400 hover:text-indigo-400 rounded cursor-pointer transition-colors"
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    onClick={() => handleDeleteVehicle(idx)}
                                    title="Eliminar Linha"
                                    className="p-1 bg-zinc-950 hover:bg-red-950 border border-zinc-855 hover:border-red-850 text-zinc-400 hover:text-red-400 rounded cursor-pointer transition-colors"
                                  >
                                    🗑️
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-1.5 font-bold text-zinc-200">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editVehData?.veiculo || ""}
                                onChange={e => setEditVehData(prev => prev ? ({ ...prev, veiculo: e.target.value }) : null)}
                                className="w-full bg-zinc-950 border border-zinc-850 rounded px-1.5 py-0.5 text-xs text-zinc-200 outline-none"
                              />
                            ) : (
                              veh.veiculo
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-zinc-350">
                            {isEditing ? (
                              <select
                                value={editVehData?.armazem || ""}
                                onChange={e => setEditVehData(prev => prev ? ({ ...prev, armazem: e.target.value }) : null)}
                                className="w-full bg-zinc-950 border border-zinc-850 rounded px-1.5 py-0.5 text-xs text-zinc-250 outline-none"
                              >
                                {warehouses.map(w => (
                                  <option key={w.name} value={w.name}>{w.name}</option>
                                ))}
                              </select>
                            ) : (
                              veh.armazem
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-center text-zinc-300 font-mono">
                            {isEditing ? (
                              <input
                                type="number"
                                min="0"
                                value={editVehData?.capacidade_kg || 0}
                                onChange={e => setEditVehData(prev => prev ? ({ ...prev, capacidade_kg: parseInt(e.target.value) || 0 }) : null)}
                                className="w-full bg-zinc-950 border border-zinc-850 rounded px-1.5 py-0.5 text-xs text-zinc-300 outline-none font-mono text-center"
                              />
                            ) : (
                              `${veh.capacidade_kg} kg`
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-center text-zinc-300 font-mono">
                            {isEditing ? (
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                value={editVehData?.capacidade_vol || 0.0}
                                onChange={e => setEditVehData(prev => prev ? ({ ...prev, capacidade_vol: parseFloat(e.target.value) || 0.0 }) : null)}
                                className="w-full bg-zinc-950 border border-zinc-850 rounded px-1.5 py-0.5 text-xs text-zinc-300 outline-none font-mono text-center"
                              />
                            ) : (
                              `${veh.capacidade_vol} m³`
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-center text-zinc-400 font-mono">
                            {isEditing ? (
                              <input
                                type="number"
                                min="0"
                                value={editVehData?.velocidade_media || 0}
                                onChange={e => setEditVehData(prev => prev ? ({ ...prev, velocidade_media: parseInt(e.target.value) || 0 }) : null)}
                                className="w-full bg-zinc-950 border border-zinc-850 rounded px-1.5 py-0.5 text-xs text-zinc-300 outline-none font-mono text-center"
                              />
                            ) : (
                              `${veh.velocidade_media} km/h`
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-center text-zinc-400 font-mono">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editVehData?.horario_inicio || ""}
                                onChange={e => setEditVehData(prev => prev ? ({ ...prev, horario_inicio: e.target.value }) : null)}
                                className="w-full bg-zinc-950 border border-zinc-850 rounded px-1.5 py-0.5 text-xs text-zinc-300 outline-none font-mono text-center"
                              />
                            ) : (
                              veh.horario_inicio
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-center text-zinc-400 font-mono">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editVehData?.horario_fim || ""}
                                onChange={e => setEditVehData(prev => prev ? ({ ...prev, horario_fim: e.target.value }) : null)}
                                className="w-full bg-zinc-950 border border-zinc-850 rounded px-1.5 py-0.5 text-xs text-zinc-300 outline-none font-mono text-center"
                              />
                            ) : (
                              veh.horario_fim
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-center text-zinc-400 font-mono">
                            {isEditing ? (
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={editVehData?.custo_km || 0.0}
                                onChange={e => setEditVehData(prev => prev ? ({ ...prev, custo_km: parseFloat(e.target.value) || 0.0 }) : null)}
                                className="w-full bg-zinc-950 border border-zinc-850 rounded px-1.5 py-0.5 text-xs text-zinc-300 outline-none font-mono text-center"
                              />
                            ) : (
                              `${veh.custo_km.toFixed(2)} €`
                            )}
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
