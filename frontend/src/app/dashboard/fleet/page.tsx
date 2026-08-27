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
  matricula?: string;
  motorista?: string;
  capacidade_kg: number;
  capacidade_vol: number;
  custo_km: number;
  velocidade_media: number;
  horario_inicio: string;
  horario_fim: string;
  is_active?: number;
}

interface Driver {
  name: string;
  pin: string;
  phone: string;
  vehicle: string;
  is_active?: number;
}

interface FailureReason {
  reason: string;
  category: string;
}

export default function TablesFleetPage() {
  const { t } = useI18n();
  const { selectedProject } = useProjects();
  const [activeTab, setActiveTab] = useState<"warehouses" | "fleet" | "drivers" | "reasons">("warehouses");
  const [loading, setLoading] = useState(false);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [fleet, setFleet] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [reasons, setReasons] = useState<FailureReason[]>([]);

  // Auto-save/Persist function
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const persistAllTables = async (
    nextFleet = fleet,
    nextWh = warehouses,
    nextDrivers = drivers,
    nextReasons = reasons,
    showAlert = false
  ) => {
    if (!selectedProject) return;
    setSaveStatus("saving");
    try {
      await apiRequest(`/api/fleet/${selectedProject.id}/save`, {
        method: "POST",
        body: JSON.stringify({
          fleet: nextFleet,
          warehouses: nextWh,
          drivers: nextDrivers,
          reasons: nextReasons
        }),
      });
      setSaveStatus("saved");
      if (showAlert) alert("Tabelas guardadas com sucesso!");
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch (err: any) {
      setSaveStatus("error");
      if (showAlert) alert("Erro ao guardar tabelas: " + (err.message || "Erro desconhecido"));
    }
  };

  const loadData = async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const data = await apiRequest(`/api/fleet/${selectedProject.id}`);
      if (data) {
        setWarehouses(data.warehouses || []);
        setFleet(data.fleet || []);
        setDrivers(data.drivers || []);
        setReasons(data.reasons || [
          { reason: "Cliente Ausente / Fechado", category: "Ausência" },
          { reason: "Cliente Recusou a Carga", category: "Recusa" },
          { reason: "Morada Não Encontrada / Errada", category: "Morada" },
          { reason: "Mercadoria Danificada", category: "Avaria" },
          { reason: "Falta de Tempo / Fora de Horas", category: "Operacional" }
        ]);
      }
    } catch (err) {
      console.error("Erro ao carregar tabelas:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedProject]);

  // WAREHOUSE OPERATIONS
  const [geoModalOpen, setGeoModalOpen] = useState(false);
  const [editingWhIndex, setEditingWhIndex] = useState<number | null>(null);

  const addWarehouse = () => {
    const newWh: Warehouse = {
      name: `Armazém ${warehouses.length + 1}`,
      address: "",
      cp: "",
      locality: "",
      lat: 38.7223,
      lon: -9.1393,
      quality: 1,
    };
    const next = [...warehouses, newWh];
    setWarehouses(next);
    persistAllTables(fleet, next, drivers, reasons);
  };

  const updateWarehouse = (index: number, field: keyof Warehouse, value: any) => {
    const next = [...warehouses];
    next[index] = { ...next[index], [field]: value };
    setWarehouses(next);
  };

  const deleteWarehouse = (index: number) => {
    const next = warehouses.filter((_, i) => i !== index);
    setWarehouses(next);
    persistAllTables(fleet, next, drivers, reasons);
  };

  // FLEET OPERATIONS
  const addVehicle = () => {
    const newV: Vehicle = {
      veiculo: `Carrinha ${fleet.length + 1}`,
      armazem: warehouses[0]?.name || "Armazém 1",
      matricula: "00-AA-00",
      motorista: "",
      capacidade_kg: 1000,
      capacidade_vol: 5.0,
      custo_km: 0.5,
      velocidade_media: 45,
      horario_inicio: "08:00",
      horario_fim: "18:00",
      is_active: 1,
    };
    const next = [...fleet, newV];
    setFleet(next);
    persistAllTables(next, warehouses, drivers, reasons);
  };

  const updateVehicle = (index: number, field: keyof Vehicle, value: any) => {
    const next = [...fleet];
    next[index] = { ...next[index], [field]: value };
    setFleet(next);
  };

  const deleteVehicle = (index: number) => {
    const next = fleet.filter((_, i) => i !== index);
    setFleet(next);
    persistAllTables(next, warehouses, drivers, reasons);
  };

  // DRIVERS OPERATIONS
  const addDriver = () => {
    const newD: Driver = {
      name: `Motorista ${drivers.length + 1}`,
      pin: `${1000 + drivers.length + 1}`,
      phone: "910000000",
      vehicle: fleet[0]?.veiculo || "",
      is_active: 1,
    };
    const next = [...drivers, newD];
    setDrivers(next);
    persistAllTables(fleet, warehouses, next, reasons);
  };

  const updateDriver = (index: number, field: keyof Driver, value: any) => {
    const next = [...drivers];
    next[index] = { ...next[index], [field]: value };
    setDrivers(next);
  };

  const deleteDriver = (index: number) => {
    const next = drivers.filter((_, i) => i !== index);
    setDrivers(next);
    persistAllTables(fleet, warehouses, next, reasons);
  };

  // REASONS OPERATIONS
  const addReason = () => {
    const newR: FailureReason = {
      reason: "Novo Motivo de Não Entrega",
      category: "Geral",
    };
    const next = [...reasons, newR];
    setReasons(next);
    persistAllTables(fleet, warehouses, drivers, next);
  };

  const updateReason = (index: number, field: keyof FailureReason, value: any) => {
    const next = [...reasons];
    next[index] = { ...next[index], [field]: value };
    setReasons(next);
  };

  const deleteReason = (index: number) => {
    const next = reasons.filter((_, i) => i !== index);
    setReasons(next);
    persistAllTables(fleet, warehouses, drivers, next);
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-900/60 p-6 rounded-2xl border border-zinc-800 backdrop-blur-xl">
          <div>
            <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
              <span>📋</span> 2. Tabelas de Suporte & Frota
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Configure armazéns de partida, viaturas, motoristas com PINs diários e motivos de não entrega.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <a
              href={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/fleet/template/unified`}
              download="GeoRoutePlan.xlsx"
              className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border border-zinc-700"
            >
              📄 Descarregar Modelo Excel
            </a>
            <button
              onClick={() => persistAllTables(fleet, warehouses, drivers, reasons, true)}
              disabled={saveStatus === "saving"}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              {saveStatus === "saving" ? "A guardar..." : "💾 Guardar Tabelas"}
            </button>
          </div>
        </div>

        {/* 4 Tabs Selector */}
        <div className="flex border-b border-zinc-800 space-x-2">
          <button
            onClick={() => setActiveTab("warehouses")}
            className={`px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all cursor-pointer border-b-2 flex items-center gap-2 ${
              activeTab === "warehouses"
                ? "bg-zinc-850 border-indigo-500 text-indigo-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            }`}
          >
            <span>🏠</span> 1. Armazéns ({warehouses.length})
          </button>

          <button
            onClick={() => setActiveTab("fleet")}
            className={`px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all cursor-pointer border-b-2 flex items-center gap-2 ${
              activeTab === "fleet"
                ? "bg-zinc-850 border-indigo-500 text-indigo-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            }`}
          >
            <span>🚚</span> 2. Frota & Viaturas ({fleet.length})
          </button>

          <button
            onClick={() => setActiveTab("drivers")}
            className={`px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all cursor-pointer border-b-2 flex items-center gap-2 ${
              activeTab === "drivers"
                ? "bg-zinc-850 border-indigo-500 text-indigo-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            }`}
          >
            <span>👤</span> 3. Motoristas & PINs ({drivers.length})
          </button>

          <button
            onClick={() => setActiveTab("reasons")}
            className={`px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all cursor-pointer border-b-2 flex items-center gap-2 ${
              activeTab === "reasons"
                ? "bg-zinc-850 border-indigo-500 text-indigo-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            }`}
          >
            <span>📋</span> 4. Justificação de Entregas ({reasons.length})
          </button>
        </div>

        {/* TAB 1: WAREHOUSES */}
        {activeTab === "warehouses" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl p-5 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-bold text-zinc-100">Armazéns / Pontos de Partida</h2>
              <button
                onClick={addWarehouse}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-indigo-600 text-zinc-200 hover:text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                + Adicionar Armazém
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-950/80 text-zinc-400 font-bold uppercase text-[10px]">
                    <th className="py-2.5 px-3">Nome Armazém</th>
                    <th className="py-2.5 px-3">Morada</th>
                    <th className="py-2.5 px-3">Código Postal</th>
                    <th className="py-2.5 px-3">Localidade</th>
                    <th className="py-2.5 px-3 text-center">Coordenadas</th>
                    <th className="py-2.5 px-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {warehouses.map((wh, idx) => (
                    <tr key={idx} className="hover:bg-zinc-850/30">
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={wh.name}
                          onChange={(e) => updateWarehouse(idx, "name", e.target.value)}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-36 font-bold"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={wh.address}
                          onChange={(e) => updateWarehouse(idx, "address", e.target.value)}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-56"
                          placeholder="Estrada 10..."
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={wh.cp}
                          onChange={(e) => updateWarehouse(idx, "cp", e.target.value)}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-24 font-mono"
                          placeholder="2695-719"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={wh.locality}
                          onChange={(e) => updateWarehouse(idx, "locality", e.target.value)}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-32"
                          placeholder="São João da Talha"
                        />
                      </td>
                      <td className="py-2 px-3 text-center">
                        <button
                          onClick={() => {
                            setEditingWhIndex(idx);
                            setGeoModalOpen(true);
                          }}
                          className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-indigo-300 rounded text-[11px] font-mono border border-zinc-700 cursor-pointer"
                        >
                          📍 {wh.lat.toFixed(4)}, {wh.lon.toFixed(4)}
                        </button>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          onClick={() => deleteWarehouse(idx)}
                          className="p-1.5 text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
                          title="Eliminar Armazém"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: FLEET */}
        {activeTab === "fleet" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl p-5 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-bold text-zinc-100">Frota de Viaturas (Tipos, Matrículas e Capacidades)</h2>
              <button
                onClick={addVehicle}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-indigo-600 text-zinc-200 hover:text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                + Adicionar Viatura
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-950/80 text-zinc-400 font-bold uppercase text-[10px]">
                    <th className="py-2.5 px-3">Veículo / Tipo</th>
                    <th className="py-2.5 px-3">Matrícula</th>
                    <th className="py-2.5 px-3">Motorista Padrão</th>
                    <th className="py-2.5 px-3">Armazém Origem</th>
                    <th className="py-2.5 px-3 text-center">Carga (kg)</th>
                    <th className="py-2.5 px-3 text-center">Volume (m³)</th>
                    <th className="py-2.5 px-3 text-center">Vel. (km/h)</th>
                    <th className="py-2.5 px-3 text-center">Horário Turno</th>
                    <th className="py-2.5 px-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {fleet.map((v, idx) => (
                    <tr key={idx} className="hover:bg-zinc-850/30">
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={v.veiculo}
                          onChange={(e) => updateVehicle(idx, "veiculo", e.target.value)}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-32 font-bold"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={v.matricula || ""}
                          onChange={(e) => updateVehicle(idx, "matricula", e.target.value)}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-emerald-400 w-28 font-mono font-bold"
                          placeholder="54-TG-22"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={v.motorista || ""}
                          onChange={(e) => updateVehicle(idx, "motorista", e.target.value)}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-200 w-36"
                          placeholder="António Ferreira"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <select
                          value={v.armazem}
                          onChange={(e) => updateVehicle(idx, "armazem", e.target.value)}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-300 w-32 text-xs"
                        >
                          {warehouses.map((wh) => (
                            <option key={wh.name} value={wh.name}>{wh.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <input
                          type="number"
                          value={v.capacidade_kg}
                          onChange={(e) => updateVehicle(idx, "capacidade_kg", parseFloat(e.target.value) || 0)}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-20 text-center font-mono"
                        />
                      </td>
                      <td className="py-2 px-3 text-center">
                        <input
                          type="number"
                          step="0.1"
                          value={v.capacidade_vol}
                          onChange={(e) => updateVehicle(idx, "capacidade_vol", parseFloat(e.target.value) || 0)}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-16 text-center font-mono"
                        />
                      </td>
                      <td className="py-2 px-3 text-center">
                        <input
                          type="number"
                          value={v.velocidade_media}
                          onChange={(e) => updateVehicle(idx, "velocidade_media", parseFloat(e.target.value) || 40)}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-16 text-center font-mono"
                        />
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center gap-1 font-mono text-[11px]">
                          <input
                            type="text"
                            value={v.horario_inicio}
                            onChange={(e) => updateVehicle(idx, "horario_inicio", e.target.value)}
                            className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-zinc-200 w-14 text-center"
                          />
                          <span>-</span>
                          <input
                            type="text"
                            value={v.horario_fim}
                            onChange={(e) => updateVehicle(idx, "horario_fim", e.target.value)}
                            className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-zinc-200 w-14 text-center"
                          />
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          onClick={() => deleteVehicle(idx)}
                          className="p-1.5 text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
                          title="Eliminar Viatura"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: DRIVERS & PINS */}
        {activeTab === "drivers" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl p-5 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-bold text-zinc-100">Motoristas & PINs de Acesso Móvel</h2>
              <button
                onClick={addDriver}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-indigo-600 text-zinc-200 hover:text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                + Adicionar Motorista
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-950/80 text-zinc-400 font-bold uppercase text-[10px]">
                    <th className="py-2.5 px-3">Nome Motorista</th>
                    <th className="py-2.5 px-3">PIN / Password (4 Dígitos)</th>
                    <th className="py-2.5 px-3">Telefone Contacto</th>
                    <th className="py-2.5 px-3">Viatura Habitual</th>
                    <th className="py-2.5 px-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {drivers.map((d, idx) => (
                    <tr key={idx} className="hover:bg-zinc-850/30">
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={d.name}
                          onChange={(e) => updateDriver(idx, "name", e.target.value)}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-48 font-bold"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={d.pin}
                          onChange={(e) => updateDriver(idx, "pin", e.target.value)}
                          className="bg-zinc-950 border border-emerald-500/40 rounded px-2 py-1 text-emerald-400 w-24 font-mono font-bold text-center"
                          placeholder="1111"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={d.phone}
                          onChange={(e) => updateDriver(idx, "phone", e.target.value)}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-200 w-32 font-mono"
                          placeholder="910000000"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <select
                          value={d.vehicle}
                          onChange={(e) => updateDriver(idx, "vehicle", e.target.value)}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-300 w-40 text-xs"
                        >
                          <option value="">Sem viatura fixa</option>
                          {fleet.map((v) => (
                            <option key={v.veiculo} value={v.veiculo}>{v.veiculo} ({v.matricula || "-"})</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          onClick={() => deleteDriver(idx)}
                          className="p-1.5 text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
                          title="Eliminar Motorista"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: FAILURE REASONS */}
        {activeTab === "reasons" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl p-5 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-bold text-zinc-100">Motivos de Não Entrega Predefinidos</h2>
              <button
                onClick={addReason}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-indigo-600 text-zinc-200 hover:text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                + Adicionar Motivo
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-950/80 text-zinc-400 font-bold uppercase text-[10px]">
                    <th className="py-2.5 px-3">Motivo de Não Entrega</th>
                    <th className="py-2.5 px-3">Categoria / Ação</th>
                    <th className="py-2.5 px-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {reasons.map((r, idx) => (
                    <tr key={idx} className="hover:bg-zinc-850/30">
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={r.reason}
                          onChange={(e) => updateReason(idx, "reason", e.target.value)}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-80 font-semibold"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={r.category}
                          onChange={(e) => updateReason(idx, "category", e.target.value)}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-indigo-300 w-36"
                          placeholder="Ausência / Recusa..."
                        />
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          onClick={() => deleteReason(idx)}
                          className="p-1.5 text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
                          title="Eliminar Motivo"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Modal de Geocodificação Manual do Armazém */}
        {geoModalOpen && editingWhIndex !== null && (
          <WarehouseGeoModal
            isOpen={geoModalOpen}
            warehouseName={warehouses[editingWhIndex].name}
            initialAddress={warehouses[editingWhIndex].address}
            initialCp={warehouses[editingWhIndex].cp}
            initialLocality={warehouses[editingWhIndex].locality}
            initialLat={warehouses[editingWhIndex].lat}
            initialLon={warehouses[editingWhIndex].lon}
            onConfirm={(address, cp, locality, lat, lon) => {
              updateWarehouse(editingWhIndex, "address", address);
              updateWarehouse(editingWhIndex, "cp", cp);
              updateWarehouse(editingWhIndex, "locality", locality);
              updateWarehouse(editingWhIndex, "lat", lat);
              updateWarehouse(editingWhIndex, "lon", lon);
              setGeoModalOpen(false);
              setEditingWhIndex(null);
              persistAllTables();
            }}
            onClose={() => {
              setGeoModalOpen(false);
              setEditingWhIndex(null);
            }}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
