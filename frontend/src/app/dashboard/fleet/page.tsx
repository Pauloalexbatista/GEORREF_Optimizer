"use client";

import React, { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useProjects } from "@/context/ProjectContext";
import { apiRequest } from "@/utils/api";

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

  // Vehicle form state
  const [vName, setVName] = useState("");
  const [vWarehouse, setVWarehouse] = useState("");
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
        const newWh = res[0];
        if (newWh.quality === 99) {
          alert("Aviso: Não foi possível obter as coordenadas exatas da morada do armazém. Verifique a morada e o código postal.");
        }
        setWarehouses(prev => [...prev, newWh]);
        if (!vWarehouse) {
          setVWarehouse(newWh.name);
        }
        // Reset form
        setWhName("");
        setWhAddr("");
        setWhCp("");
        setWhLocality("");
      }
    } catch (err: any) {
      alert(err.message || "Erro ao adicionar armazém.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteWarehouse = (idx: number) => {
    const name = warehouses[idx].name;
    setWarehouses(prev => prev.filter((_, i) => i !== idx));
    // Remove vehicles associated with this warehouse or update their warehouse link
    setFleet(prev => prev.filter(v => v.armazem !== name));
  };

  const handleAddVehicle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!vName.trim() || !vWarehouse) return;

    // Check if vehicle name already exists
    if (fleet.some(v => v.veiculo.toLowerCase() === vName.toLowerCase())) {
      alert("Já existe um veículo com este nome na frota.");
      return;
    }

    const newVeh: Vehicle = {
      veiculo: vName,
      armazem: vWarehouse,
      capacidade_kg: vCapKg,
      capacidade_vol: vCapVol,
      custo_km: vCostKm,
      velocidade_media: vSpeed,
      horario_inicio: vStart,
      horario_fim: vEnd
    };

    setFleet(prev => [...prev, newVeh]);
    setVName("");
  };

  const handleDeleteVehicle = (idx: number) => {
    setFleet(prev => prev.filter((_, i) => i !== idx));
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

    setLoading(true);
    try {
      await apiRequest(`/api/fleet/${selectedProject.id}`, {
        method: "POST",
        body: JSON.stringify({
          fleet,
          warehouses
        })
      });
      alert("Configuração da frota e armazéns guardada com sucesso!");
    } catch (err: any) {
      alert(err.message || "Erro ao guardar configurações.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl">
        {/* Header section */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-50 font-sans">Frota e Armazéns</h1>
            <p className="text-zinc-400 text-xs mt-1">Configure os seus armazéns logísticos e os veículos de distribuição da sua frota.</p>
          </div>
          <button
            onClick={handleSaveConfig}
            disabled={loading}
            className="cursor-pointer bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white rounded-xl px-5 py-2.5 text-xs font-semibold shadow-md shadow-indigo-500/10 transition-all flex items-center space-x-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            <span>{loading ? "A Guardar..." : "Guardar Configurações"}</span>
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
              <h3 className="text-sm font-bold text-zinc-100 mb-4">Adicionar Armazém</h3>
              <form onSubmit={handleAddWarehouse} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1.5">Nome do Armazém</label>
                  <input
                    type="text"
                    required
                    value={whName}
                    onChange={e => setWhName(e.target.value)}
                    placeholder="Ex: Armazém Central Porto"
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1.5">Morada Completa</label>
                  <input
                    type="text"
                    required
                    value={whAddr}
                    onChange={e => setWhAddr(e.target.value)}
                    placeholder="Ex: Rua Direita, nº 123"
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1.5">C. Postal</label>
                    <input
                      type="text"
                      required
                      value={whCp}
                      onChange={e => setWhCp(e.target.value)}
                      placeholder="Ex: 4000-001"
                      className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1.5">Localidade</label>
                    <input
                      type="text"
                      required
                      value={whLocality}
                      onChange={e => setWhLocality(e.target.value)}
                      placeholder="Ex: Porto"
                      className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-200 hover:text-white rounded-lg py-2.5 text-xs font-semibold transition-colors cursor-pointer"
                >
                  {loading ? "A Obter Coordenadas..." : "+ Adicionar Armazém"}
                </button>
              </form>
            </div>

            {/* Warehouses List */}
            <div className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
              <h3 className="text-sm font-bold text-zinc-100 mb-4">Armazéns Configurados</h3>
              {warehouses.length === 0 ? (
                <div className="text-center py-12 text-zinc-500 text-xs">
                  Nenhum armazém adicionado. Utilize o formulário para registar os pontos de partida.
                </div>
              ) : (
                <div className="space-y-3">
                  {warehouses.map((wh, idx) => (
                    <div key={wh.name} className="flex items-center justify-between p-4 bg-zinc-950/40 border border-zinc-800/80 rounded-xl">
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-zinc-250">{wh.name}</p>
                        <p className="text-[10px] text-zinc-450">{wh.address}, {wh.cp} {wh.locality}</p>
                        <p className="text-[9px] font-mono text-zinc-500">Coordenadas: {wh.lat.toFixed(5)}, {wh.lon.toFixed(5)}</p>
                      </div>
                      <button
                        onClick={() => handleDeleteWarehouse(idx)}
                        className="p-2 bg-zinc-900 hover:bg-red-950/30 border border-zinc-800 hover:border-red-800 text-zinc-450 hover:text-red-400 rounded-lg transition-colors cursor-pointer"
                        title="Eliminar armazém"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
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
              <h3 className="text-sm font-bold text-zinc-100 mb-4">Registar Veículo</h3>
              {warehouses.length === 0 ? (
                <div className="text-center py-6 text-amber-400 text-xs">
                  Adicione primeiro um armazém de origem na aba "Armazéns" para poder criar veículos.
                </div>
              ) : (
                <form onSubmit={handleAddVehicle} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1.5">Identificador do Veículo</label>
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
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1.5">Armazém de Origem</label>
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
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1.5">Capacidade (kg)</label>
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
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1.5">Cap. Volume (m³)</label>
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
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1.5">Custo / KM (€)</label>
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
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1.5">Velocidade Média</label>
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
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1.5">Horário Início</label>
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
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1.5">Horário Fim</label>
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
                  <button
                    type="submit"
                    className="w-full bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-200 hover:text-white rounded-lg py-2.5 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    + Registar Veículo
                  </button>
                </form>
              )}
            </div>

            {/* Fleet List */}
            <div className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
              <h3 className="text-sm font-bold text-zinc-100 mb-4">Lista de Veículos</h3>
              {fleet.length === 0 ? (
                <div className="text-center py-12 text-zinc-500 text-xs">
                  Nenhum veículo registado. Adicione veículos de distribuição para calcular as rotas.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-zinc-950/40 border-b border-zinc-800 text-[9px] font-bold uppercase tracking-wider text-zinc-450">
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
                            <button
                              onClick={() => handleDeleteVehicle(idx)}
                              className="p-1.5 bg-zinc-900 hover:bg-red-950/30 border border-zinc-800 hover:border-red-800 text-zinc-450 hover:text-red-400 rounded-lg transition-colors cursor-pointer"
                              title="Eliminar veículo"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
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
    </DashboardLayout>
  );
}
