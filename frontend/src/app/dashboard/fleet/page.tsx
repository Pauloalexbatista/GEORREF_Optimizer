"use client";

import React, { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import DashboardLayout from "@/components/DashboardLayout";
import { useProjects } from "@/context/ProjectContext";
import { apiRequest } from "@/utils/api";
import { useI18n } from "@/context/I18nContext";

const UnifiedGeocodingModal = dynamic(() => import("@/components/UnifiedGeocodingModal"), { ssr: false });

interface Warehouse {
  name: string;
  address: string;
  cp: string;
  locality: string;
  lat: number;
  lon: number;
  quality: number;
  open_time?: string;
  close_time?: string;
  load_time?: number;
  contact?: string;
}

interface Vehicle {
  armazem: string;
  veiculo: string;
  capacidade_kg: number;
  capacidade_vol: number;
  velocidade_media: number;
  horario_inicio: string;
  horario_fim: string;
  custo_km: number;
  custo_hora: number;
  max_entregas: number;
  regras: string;
  motorista_nome: string;
  motorista_telemovel: string;
  is_active: number;
}

interface RuleItem {
  tag_veiculo: string;
  tag_entrega: string;
  permissao: string;
  descricao: string;
}

interface Driver {
  name: string;
  pin: string;
  vehicle?: string;
  matricula?: string;
  phone: string;
  shift_start: string;
  shift_end: string;
  is_active: number;
}

interface NonDeliveryReason {
  id?: number;
  code: string;
  reason: string;
  category: string;
  action_required: string;
  is_active: number;
}

type TabType = "warehouses" | "fleet" | "rules" | "drivers" | "reasons";

export default function FleetPage() {
  const { selectedProject } = useProjects();
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TabType>("warehouses");

  // State for all 5 tables
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [fleet, setFleet] = useState<Vehicle[]>([]);
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [reasons, setReasons] = useState<NonDeliveryReason[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [geocodingWh, setGeocodingWh] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // Search/Filters per tab
  const [searchFleet, setSearchFleet] = useState("");
  const [searchRules, setSearchRules] = useState("");
  const [searchDrivers, setSearchDrivers] = useState("");
  const [searchReasons, setSearchReasons] = useState("");

  // Geocoding Modal State
  const [geoModalOpen, setGeoModalOpen] = useState(false);
  const [editingWhIndex, setEditingWhIndex] = useState<number | null>(null);

  // Load all tables on project change
  useEffect(() => {
    if (!selectedProject) return;

    const loadAllTables = async () => {
      setLoading(true);
      setFeedback(null);
      try {
        const data = await apiRequest(`/api/fleet/${selectedProject.id}`);
        if (data) {
          if (data.warehouses) setWarehouses(data.warehouses);
          if (data.fleet) setFleet(data.fleet);
          if (data.rules_matrix) setRules(data.rules_matrix);
          if (data.drivers) setDrivers(data.drivers);
          if (data.reasons) setReasons(data.reasons);
        }
      } catch (err: any) {
        console.error("Erro ao carregar tabelas de frota:", err);
      } finally {
        setLoading(false);
      }
    };

    loadAllTables();
  }, [selectedProject]);

  // Persist all tables back to backend
  const persistAllTables = async () => {
    if (!selectedProject) return;
    setSaving(true);
    setFeedback(null);
    try {
      const payload = {
        warehouses,
        fleet,
        rules_matrix: rules,
        drivers,
        reasons,
      };

      await apiRequest(`/api/fleet/${selectedProject.id}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setFeedback({ type: "success", msg: "Todas as tabelas de suporte e regras foram guardadas com sucesso!" });
      setTimeout(() => setFeedback(null), 4000);
    } catch (err: any) {
      console.error("Erro ao guardar tabelas:", err);
      setFeedback({ type: "error", msg: err.message || "Erro ao guardar alterações nas tabelas." });
    } finally {
      setSaving(false);
    }
  };

  // --- WAREHOUSE HANDLERS ---
  const updateWarehouse = (index: number, field: keyof Warehouse, value: any) => {
    setWarehouses((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const addWarehouse = () => {
    const newWh: Warehouse = {
      name: `Armazém ${warehouses.length + 1}`,
      address: "",
      cp: "",
      locality: "",
      lat: 0,
      lon: 0,
      quality: 1,
      open_time: "06:00:00",
      close_time: "22:00:00",
      load_time: 30,
      contact: "",
    };
    setWarehouses((prev) => [...prev, newWh]);
  };

  const deleteWarehouse = (index: number) => {
    setWarehouses((prev) => prev.filter((_, i) => i !== index));
  };

  const geocodeAllWarehouses = async () => {
    if (!selectedProject || warehouses.length === 0) return;
    setGeocodingWh(true);
    setFeedback(null);
    try {
      const updated = [...warehouses];
      let geocodedCount = 0;
      for (let i = 0; i < updated.length; i++) {
        const wh = updated[i];
        if (wh.address.trim()) {
          try {
            const res = await apiRequest(`/api/geocoding/resolve`, {
              method: "POST",
              body: JSON.stringify({
                morada: wh.address,
                cp: wh.cp,
                concelho: wh.locality,
              }),
            });
            if (res && res.lat && res.lon && res.lat !== 0 && res.lon !== 0) {
              updated[i] = {
                ...wh,
                lat: Number(res.lat),
                lon: Number(res.lon),
                quality: 1,
              };
              geocodedCount++;
            }
          } catch (e) {
            console.error("Geocoding failed for warehouse:", wh.name, e);
          }
        }
      }
      setWarehouses(updated);
      setFeedback({
        type: "success",
        msg: `${geocodedCount} armazém(ns) georreferenciado(s) com sucesso.`,
      });
    } catch (err: any) {
      setFeedback({ type: "error", msg: "Erro ao georreferenciar armazéns." });
    } finally {
      setGeocodingWh(false);
    }
  };

  // --- VEHICLE HANDLERS ---
  const updateVehicle = (index: number, field: keyof Vehicle, value: any) => {
    setFleet((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const addVehicle = () => {
    const newVeh: Vehicle = {
      veiculo: `Viatura ${fleet.length + 1}`,
      armazem: warehouses.length > 0 ? warehouses[0].name : "",
      capacidade_kg: 1000,
      capacidade_vol: 10,
      velocidade_media: 50,
      horario_inicio: "08:00:00",
      horario_fim: "18:00:00",
      custo_km: 0.65,
      custo_hora: 12.5,
      max_entregas: 30,
      regras: "",
      motorista_nome: "",
      motorista_telemovel: "",
      is_active: 1,
    };
    setFleet((prev) => [...prev, newVeh]);
  };

  const deleteVehicle = (index: number) => {
    setFleet((prev) => prev.filter((_, i) => i !== index));
  };

  // --- RULES HANDLERS ---
  const updateRule = (index: number, field: keyof RuleItem, value: any) => {
    setRules((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const addRule = () => {
    const newRule: RuleItem = {
      tag_veiculo: "",
      tag_entrega: "",
      permissao: "SIM",
      descricao: "",
    };
    setRules((prev) => [...prev, newRule]);
  };

  const deleteRule = (index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index));
  };

  // --- DRIVER HANDLERS ---
  const updateDriver = (index: number, field: keyof Driver, value: any) => {
    setDrivers((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const addDriver = () => {
    const newDr: Driver = {
      name: `Motorista ${drivers.length + 1}`,
      pin: `${1000 + drivers.length + 1}`,
      vehicle: "",
      matricula: "",
      phone: "910000000",
      shift_start: "08:00",
      shift_end: "18:00",
      is_active: 1,
    };
    setDrivers((prev) => [...prev, newDr]);
  };

  const deleteDriver = (index: number) => {
    setDrivers((prev) => prev.filter((_, i) => i !== index));
  };

  // --- REASON HANDLERS ---
  const updateReason = (index: number, field: keyof NonDeliveryReason, value: any) => {
    setReasons((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const addReason = () => {
    const newR: NonDeliveryReason = {
      code: `FALHA_${reasons.length + 1}`,
      reason: "Novo Motivo de Não Entrega",
      category: "Cliente",
      action_required: "Reagendar",
      is_active: 1,
    };
    setReasons((prev) => [...prev, newR]);
  };

  const deleteReason = (index: number) => {
    setReasons((prev) => prev.filter((_, i) => i !== index));
  };

  // Filtered lists
  const filteredFleet = useMemo(() => {
    if (!searchFleet.trim()) return fleet;
    const q = searchFleet.toLowerCase();
    return fleet.filter(
      (v) =>
        v.veiculo.toLowerCase().includes(q) ||
        v.armazem.toLowerCase().includes(q) ||
        v.regras.toLowerCase().includes(q)
    );
  }, [fleet, searchFleet]);

  const filteredRules = useMemo(() => {
    if (!searchRules.trim()) return rules;
    const q = searchRules.toLowerCase();
    return rules.filter(
      (r) =>
        r.tag_veiculo.toLowerCase().includes(q) ||
        r.tag_entrega.toLowerCase().includes(q) ||
        r.permissao.toLowerCase().includes(q) ||
        r.descricao.toLowerCase().includes(q)
    );
  }, [rules, searchRules]);

  const filteredDrivers = useMemo(() => {
    if (!searchDrivers.trim()) return drivers;
    const q = searchDrivers.toLowerCase();
    return drivers.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.pin.includes(q) ||
        (d.matricula && d.matricula.toLowerCase().includes(q)) ||
        d.phone.includes(q)
    );
  }, [drivers, searchDrivers]);

  const filteredReasons = useMemo(() => {
    if (!searchReasons.trim()) return reasons;
    const q = searchReasons.toLowerCase();
    return reasons.filter(
      (r) =>
        r.reason.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q)
    );
  }, [reasons, searchReasons]);

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header with Save Button */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-900/60 p-6 rounded-2xl border border-zinc-800 backdrop-blur-xl">
          <div>
            <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
              <span>📋</span> 2. Tabelas de Suporte, Frota & Regras
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Configure armazéns de partida, viaturas da frota, matriz de regras de compatibilidade, credenciais de motoristas e motivos de não entrega.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={persistAllTables}
              disabled={saving}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/20 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              {saving ? "💾 A Gravar..." : "💾 Gravar Alterações"}
            </button>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`p-3 rounded-xl text-xs font-semibold flex items-center justify-between animate-in fade-in duration-200 border ${
              feedback.type === "success"
                ? "bg-emerald-950/60 border-emerald-800 text-emerald-300"
                : "bg-rose-950/60 border-rose-800 text-rose-300"
            }`}
          >
            <div className="flex items-center space-x-2">
              <span>{feedback.type === "success" ? "✅" : "⚠️"}</span>
              <span>{feedback.msg}</span>
            </div>
            <button
              onClick={() => setFeedback(null)}
              className="text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Tabs Navigation */}
        <div className="flex items-center space-x-1.5 border-b border-zinc-800 pb-1 overflow-x-auto">
          <button
            onClick={() => setActiveTab("warehouses")}
            className={`px-3.5 py-2 text-xs font-bold rounded-t-xl transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
              activeTab === "warehouses"
                ? "bg-zinc-850 border-indigo-500 text-indigo-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            }`}
          >
            <span>🏠</span> 1. Armazéns ({warehouses.length})
          </button>

          <button
            onClick={() => setActiveTab("fleet")}
            className={`px-3.5 py-2 text-xs font-bold rounded-t-xl transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
              activeTab === "fleet"
                ? "bg-zinc-850 border-indigo-500 text-indigo-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            }`}
          >
            <span>🚚</span> 2. Frota & Viaturas ({fleet.length})
          </button>

          <button
            onClick={() => setActiveTab("rules")}
            className={`px-3.5 py-2 text-xs font-bold rounded-t-xl transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
              activeTab === "rules"
                ? "bg-zinc-850 border-indigo-500 text-indigo-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            }`}
          >
            <span>⚖️</span> 3. Regras ({rules.length})
          </button>

          <button
            onClick={() => setActiveTab("drivers")}
            className={`px-3.5 py-2 text-xs font-bold rounded-t-xl transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
              activeTab === "drivers"
                ? "bg-zinc-850 border-indigo-500 text-indigo-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            }`}
          >
            <span>👤</span> 4. Motoristas & PINs ({drivers.length})
          </button>

          <button
            onClick={() => setActiveTab("reasons")}
            className={`px-3.5 py-2 text-xs font-bold rounded-t-xl transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
              activeTab === "reasons"
                ? "bg-zinc-850 border-indigo-500 text-indigo-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            }`}
          >
            <span>⚠️</span> 5. Justificação de Entregas ({reasons.length})
          </button>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* TAB 1: WAREHOUSES (Aba Armazéns)                              */}
        {/* ------------------------------------------------------------- */}
        {activeTab === "warehouses" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                  <span>🏠</span> Armazéns / Pontos de Partida
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Defina a localização exata de partida e chegada para o cálculo otimizado de rotas.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={geocodeAllWarehouses}
                  disabled={geocodingWh || warehouses.length === 0}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
                  title="Georreferenciar automaticamente todos os armazéns"
                >
                  {geocodingWh ? "📍 A georreferenciar..." : "📍 Georreferenciar Armazéns"}
                </button>
                <button
                  onClick={addWarehouse}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-indigo-600 text-zinc-200 hover:text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  + Adicionar Armazém
                </button>
              </div>
            </div>

            {/* Grelha Excel para Armazéns */}
            <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950">
              <table className="w-full text-left text-xs border-collapse border border-zinc-800">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/90 text-zinc-300 font-bold uppercase text-[10.5px]">
                    <th className="py-2 px-1 text-center w-12 border-r border-zinc-800">Ações</th>
                    <th className="py-2 px-2 w-36 border-r border-zinc-800">Nome Armazém</th>
                    <th className="py-2 px-2 border-r border-zinc-800">Morada</th>
                    <th className="py-2 px-1.5 w-24 text-center border-r border-zinc-800">Cód. Postal</th>
                    <th className="py-2 px-2 w-32 border-r border-zinc-800">Localidade</th>
                    <th className="py-2 px-1.5 w-28 text-center border-r border-zinc-800">Latitude</th>
                    <th className="py-2 px-1.5 w-28 text-center border-r border-zinc-800">Longitude</th>
                    <th className="py-2 px-1 w-20 text-center border-r border-zinc-800">Abertura</th>
                    <th className="py-2 px-1 w-20 text-center border-r border-zinc-800">Fecho</th>
                    <th className="py-2 px-1 w-16 text-center border-r border-zinc-800">Carga(m)</th>
                    <th className="py-2 px-2 w-28">Contacto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 font-sans">
                  {warehouses.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-zinc-500">
                        Nenhum armazém configurado. Clique em "+ Adicionar Armazém".
                      </td>
                    </tr>
                  ) : (
                    warehouses.map((wh, idx) => (
                      <tr key={idx} className="hover:bg-zinc-850/50 transition-colors">
                        <td className="py-1 px-1 text-center border-r border-zinc-800 bg-zinc-900/40">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => {
                                setEditingWhIndex(idx);
                                setGeoModalOpen(true);
                              }}
                              className="p-1 text-zinc-400 hover:text-indigo-300 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
                              title="Editar Georreferenciação no Mapa"
                            >
                              📍
                            </button>
                            <button
                              onClick={() => deleteWarehouse(idx)}
                              className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors cursor-pointer"
                              title="Eliminar Armazém"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                        <td className="py-1 px-2 border-r border-zinc-800">
                          <input
                            type="text"
                            value={wh.name}
                            onChange={(e) => updateWarehouse(idx, "name", e.target.value)}
                            className="bg-transparent border-none outline-none text-zinc-100 font-bold text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                          />
                        </td>
                        <td className="py-1 px-2 border-r border-zinc-800">
                          <input
                            type="text"
                            value={wh.address}
                            onChange={(e) => updateWarehouse(idx, "address", e.target.value)}
                            className="bg-transparent border-none outline-none text-zinc-200 text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                          />
                        </td>
                        <td className="py-1 px-1 text-center border-r border-zinc-800">
                          <input
                            type="text"
                            value={wh.cp}
                            onChange={(e) => updateWarehouse(idx, "cp", e.target.value)}
                            className="bg-transparent border-none outline-none text-zinc-300 font-mono text-center text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                          />
                        </td>
                        <td className="py-1 px-2 border-r border-zinc-800">
                          <input
                            type="text"
                            value={wh.locality}
                            onChange={(e) => updateWarehouse(idx, "locality", e.target.value)}
                            className="bg-transparent border-none outline-none text-zinc-300 text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                          />
                        </td>
                        <td className="py-1 px-1 text-center border-r border-zinc-800">
                          <input
                            type="number"
                            step="any"
                            value={wh.lat || ""}
                            onChange={(e) => updateWarehouse(idx, "lat", parseFloat(e.target.value) || 0)}
                            className="bg-transparent border-none outline-none text-zinc-300 font-mono text-center text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                          />
                        </td>
                        <td className="py-1 px-1 text-center border-r border-zinc-800">
                          <input
                            type="number"
                            step="any"
                            value={wh.lon || ""}
                            onChange={(e) => updateWarehouse(idx, "lon", parseFloat(e.target.value) || 0)}
                            className="bg-transparent border-none outline-none text-zinc-300 font-mono text-center text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                          />
                        </td>
                        <td className="py-1 px-1 text-center border-r border-zinc-800">
                          <input
                            type="text"
                            value={wh.open_time || "06:00:00"}
                            onChange={(e) => updateWarehouse(idx, "open_time", e.target.value)}
                            className="bg-transparent border-none outline-none text-zinc-300 font-mono text-center text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                          />
                        </td>
                        <td className="py-1 px-1 text-center border-r border-zinc-800">
                          <input
                            type="text"
                            value={wh.close_time || "22:00:00"}
                            onChange={(e) => updateWarehouse(idx, "close_time", e.target.value)}
                            className="bg-transparent border-none outline-none text-zinc-300 font-mono text-center text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                          />
                        </td>
                        <td className="py-1 px-1 text-center border-r border-zinc-800">
                          <input
                            type="number"
                            value={wh.load_time || 30}
                            onChange={(e) => updateWarehouse(idx, "load_time", parseInt(e.target.value, 10) || 0)}
                            className="bg-transparent border-none outline-none text-zinc-300 font-mono text-center text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                          />
                        </td>
                        <td className="py-1 px-2">
                          <input
                            type="text"
                            value={wh.contact || ""}
                            onChange={(e) => updateWarehouse(idx, "contact", e.target.value)}
                            className="bg-transparent border-none outline-none text-zinc-300 font-mono text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            placeholder="Contacto / Tel"
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* TAB 2: FLEET (Aba Frota)                                      */}
        {/* ------------------------------------------------------------- */}
        {activeTab === "fleet" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                  <span>🚚</span> Frota & Viaturas de Distribuição ({fleet.length})
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Configure viaturas, capacidades de carga, turnos, custos, regras e etiquetas atribuídas.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Filtrar viaturas..."
                  value={searchFleet}
                  onChange={(e) => setSearchFleet(e.target.value)}
                  className="px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 w-44"
                />
                <button
                  onClick={addVehicle}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-indigo-600 text-zinc-200 hover:text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  + Adicionar Viatura
                </button>
              </div>
            </div>

            {/* Grelha Excel para Frota */}
            <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950">
              <table className="w-full text-left text-xs border-collapse border border-zinc-800">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/90 text-zinc-300 font-bold uppercase text-[10px]">
                    <th className="py-2 px-1 text-center w-12 border-r border-zinc-800">Ações</th>
                    <th className="py-2 px-2 border-r border-zinc-800 w-32">Viatura</th>
                    <th className="py-2 px-2 border-r border-zinc-800 w-36">Armazém</th>
                    <th className="py-2 px-1 text-center border-r border-zinc-800 w-20">Cap. KG</th>
                    <th className="py-2 px-1 text-center border-r border-zinc-800 w-16">Vol. m³</th>
                    <th className="py-2 px-1 text-center border-r border-zinc-800 w-16">Vel. km/h</th>
                    <th className="py-2 px-1 text-center border-r border-zinc-800 w-20">Início</th>
                    <th className="py-2 px-1 text-center border-r border-zinc-800 w-20">Fim</th>
                    <th className="py-2 px-1 text-center border-r border-zinc-800 w-16">€/km</th>
                    <th className="py-2 px-1 text-center border-r border-zinc-800 w-16">€/hora</th>
                    <th className="py-2 px-1 text-center border-r border-zinc-800 w-16">Máx. Ent.</th>
                    <th className="py-2 px-2 border-r border-zinc-800">Regras</th>
                    <th className="py-2 px-2 text-center w-16">Ativo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 font-sans">
                  {filteredFleet.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="py-8 text-center text-zinc-500">
                        Nenhuma viatura encontrada. Clique em "+ Adicionar Viatura".
                      </td>
                    </tr>
                  ) : (
                    filteredFleet.map((v) => {
                      const idx = fleet.indexOf(v);
                      return (
                        <tr key={idx} className="hover:bg-zinc-850/50 transition-colors">
                          <td className="py-1 px-1 text-center border-r border-zinc-800 bg-zinc-900/40">
                            <button
                              onClick={() => deleteVehicle(idx)}
                              className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors cursor-pointer"
                              title="Eliminar Viatura"
                            >
                              🗑️
                            </button>
                          </td>
                          <td className="py-1 px-2 border-r border-zinc-800">
                            <input
                              type="text"
                              value={v.veiculo}
                              onChange={(e) => updateVehicle(idx, "veiculo", e.target.value)}
                              className="bg-transparent border-none outline-none text-zinc-100 font-bold text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            />
                          </td>
                          <td className="py-1 px-2 border-r border-zinc-800">
                            <select
                              value={v.armazem}
                              onChange={(e) => updateVehicle(idx, "armazem", e.target.value)}
                              className="bg-transparent border-none outline-none text-zinc-300 w-full text-xs focus:bg-zinc-900 px-1 py-0.5 rounded cursor-pointer"
                            >
                              <option value="">Sem Armazém</option>
                              {warehouses.map((wh) => (
                                <option key={wh.name} value={wh.name}>
                                  {wh.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1 px-1 text-center border-r border-zinc-800">
                            <input
                              type="number"
                              value={v.capacidade_kg}
                              onChange={(e) => updateVehicle(idx, "capacidade_kg", parseFloat(e.target.value) || 0)}
                              className="bg-transparent border-none outline-none text-zinc-200 font-mono text-center text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            />
                          </td>
                          <td className="py-1 px-1 text-center border-r border-zinc-800">
                            <input
                              type="number"
                              step="0.1"
                              value={v.capacidade_vol}
                              onChange={(e) => updateVehicle(idx, "capacidade_vol", parseFloat(e.target.value) || 0)}
                              className="bg-transparent border-none outline-none text-zinc-200 font-mono text-center text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            />
                          </td>
                          <td className="py-1 px-1 text-center border-r border-zinc-800">
                            <input
                              type="number"
                              value={v.velocidade_media}
                              onChange={(e) => updateVehicle(idx, "velocidade_media", parseFloat(e.target.value) || 0)}
                              className="bg-transparent border-none outline-none text-zinc-200 font-mono text-center text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            />
                          </td>
                          <td className="py-1 px-1 text-center border-r border-zinc-800">
                            <input
                              type="text"
                              value={v.horario_inicio}
                              onChange={(e) => updateVehicle(idx, "horario_inicio", e.target.value)}
                              className="bg-transparent border-none outline-none text-zinc-200 font-mono text-center text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            />
                          </td>
                          <td className="py-1 px-1 text-center border-r border-zinc-800">
                            <input
                              type="text"
                              value={v.horario_fim}
                              onChange={(e) => updateVehicle(idx, "horario_fim", e.target.value)}
                              className="bg-transparent border-none outline-none text-zinc-200 font-mono text-center text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            />
                          </td>
                          <td className="py-1 px-1 text-center border-r border-zinc-800">
                            <input
                              type="number"
                              step="0.01"
                              value={v.custo_km}
                              onChange={(e) => updateVehicle(idx, "custo_km", parseFloat(e.target.value) || 0)}
                              className="bg-transparent border-none outline-none text-zinc-200 font-mono text-center text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            />
                          </td>
                          <td className="py-1 px-1 text-center border-r border-zinc-800">
                            <input
                              type="number"
                              step="0.01"
                              value={v.custo_hora}
                              onChange={(e) => updateVehicle(idx, "custo_hora", parseFloat(e.target.value) || 0)}
                              className="bg-transparent border-none outline-none text-zinc-200 font-mono text-center text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            />
                          </td>
                          <td className="py-1 px-1 text-center border-r border-zinc-800">
                            <input
                              type="number"
                              value={v.max_entregas}
                              onChange={(e) => updateVehicle(idx, "max_entregas", parseInt(e.target.value, 10) || 0)}
                              className="bg-transparent border-none outline-none text-zinc-200 font-mono text-center text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            />
                          </td>
                          <td className="py-1 px-2 border-r border-zinc-800">
                            <input
                              type="text"
                              value={v.regras}
                              onChange={(e) => updateVehicle(idx, "regras", e.target.value)}
                              className="bg-transparent border-none outline-none text-zinc-300 text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                              placeholder="Regras / Tags..."
                            />
                          </td>
                          <td className="py-1 px-2 text-center">
                            <input
                              type="checkbox"
                              checked={v.is_active === 1}
                              onChange={(e) => updateVehicle(idx, "is_active", e.target.checked ? 1 : 0)}
                              className="w-4 h-4 text-indigo-600 bg-zinc-950 border-zinc-800 rounded focus:ring-indigo-500 cursor-pointer"
                            />
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

        {/* ------------------------------------------------------------- */}
        {/* TAB 3: RULES (Aba Regras / Matriz de Compatibilidade)         */}
        {/* ------------------------------------------------------------- */}
        {activeTab === "rules" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                  <span>⚖️</span> Matriz de Regras & Compatibilidade de Acesso ({rules.length})
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Configure a compatibilidade entre as etiquetas da frota e as restrições das encomendas (ex: Lisboa, Pequeno, Frigorífico).
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Filtrar regras..."
                  value={searchRules}
                  onChange={(e) => setSearchRules(e.target.value)}
                  className="px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 w-44"
                />
                <button
                  onClick={addRule}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-indigo-600 text-zinc-200 hover:text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  + Adicionar Regra
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950">
              <table className="w-full text-left text-xs border-collapse border border-zinc-800">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/90 text-zinc-300 font-bold uppercase text-[10px]">
                    <th className="py-2 px-1 text-center w-12 border-r border-zinc-800">Ações</th>
                    <th className="py-2 px-3 border-r border-zinc-800 w-48">Tag Veículo / Frota</th>
                    <th className="py-2 px-3 border-r border-zinc-800 w-48">Tag Entrega / Cliente</th>
                    <th className="py-2 px-3 border-r border-zinc-800 w-36 text-center">Permissão</th>
                    <th className="py-2 px-3">Descrição / Restrição</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 font-sans">
                  {filteredRules.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-zinc-500">
                        Nenhuma regra registada. Clique em "+ Adicionar Regra".
                      </td>
                    </tr>
                  ) : (
                    filteredRules.map((r) => {
                      const idx = rules.indexOf(r);
                      return (
                        <tr key={idx} className="hover:bg-zinc-850/50 transition-colors">
                          <td className="py-1 px-1 text-center border-r border-zinc-800 bg-zinc-900/40">
                            <button
                              onClick={() => deleteRule(idx)}
                              className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors cursor-pointer"
                              title="Eliminar Regra"
                            >
                              🗑️
                            </button>
                          </td>
                          <td className="py-1 px-2 border-r border-zinc-800">
                            <input
                              type="text"
                              value={r.tag_veiculo}
                              onChange={(e) => updateRule(idx, "tag_veiculo", e.target.value)}
                              placeholder="Ex: Lisboa, Pequeno..."
                              className="bg-transparent border-none outline-none text-zinc-100 font-bold text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            />
                          </td>
                          <td className="py-1 px-2 border-r border-zinc-800">
                            <input
                              type="text"
                              value={r.tag_entrega}
                              onChange={(e) => updateRule(idx, "tag_entrega", e.target.value)}
                              placeholder="Ex: Lisboa, Centro..."
                              className="bg-transparent border-none outline-none text-zinc-200 text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            />
                          </td>
                          <td className="py-1 px-2 text-center border-r border-zinc-800">
                            <select
                              value={r.permissao ? r.permissao.toUpperCase() : "SIM"}
                              onChange={(e) => updateRule(idx, "permissao", e.target.value)}
                              className={`bg-zinc-900 border border-zinc-700 outline-none text-xs font-bold px-2 py-0.5 rounded cursor-pointer ${
                                r.permissao && r.permissao.toUpperCase() === "SIM" ? "text-emerald-400" : "text-rose-400"
                              }`}
                            >
                              <option value="SIM" className="text-emerald-400">SIM (Permitido)</option>
                              <option value="NAO" className="text-rose-400">NÃO (Proibido)</option>
                            </select>
                          </td>
                          <td className="py-1 px-2">
                            <input
                              type="text"
                              value={r.descricao}
                              onChange={(e) => updateRule(idx, "descricao", e.target.value)}
                              placeholder="Ex: Restrições de acesso ou circulação."
                              className="bg-transparent border-none outline-none text-zinc-400 text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            />
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

        {/* ------------------------------------------------------------- */}
        {/* TAB 4: DRIVERS (Aba Motoristas & Carros)                      */}
        {/* ------------------------------------------------------------- */}
        {activeTab === "drivers" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                  <span>👤</span> Motoristas & Credenciais App ({drivers.length})
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Gira os acessos móveis dos motoristas com PIN individual de 4 dígitos, telemóvel e matrícula do veículo.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Filtrar motoristas, telemóvel, matrícula..."
                  value={searchDrivers}
                  onChange={(e) => setSearchDrivers(e.target.value)}
                  className="px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 w-52"
                />
                <button
                  onClick={addDriver}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-indigo-600 text-zinc-200 hover:text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  + Adicionar Motorista
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950">
              <table className="w-full text-left text-xs border-collapse border border-zinc-800">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/90 text-zinc-300 font-bold uppercase text-[10px]">
                    <th className="py-2 px-1 text-center w-12 border-r border-zinc-800">Ações</th>
                    <th className="py-2 px-3 border-r border-zinc-800">Nome do Motorista</th>
                    <th className="py-2 px-3 border-r border-zinc-800 w-28 text-center">PIN App (4 Dígitos)</th>
                    <th className="py-2 px-3 border-r border-zinc-800 w-36">Matrícula</th>
                    <th className="py-2 px-3 border-r border-zinc-800 w-36">Telemóvel</th>
                    <th className="py-2 px-3 border-r border-zinc-800 w-24 text-center">Início Turno</th>
                    <th className="py-2 px-3 border-r border-zinc-800 w-24 text-center">Fim Turno</th>
                    <th className="py-2 px-2 text-center w-16">Ativo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 font-sans">
                  {filteredDrivers.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-zinc-500">
                        Nenhum motorista registado. Clique em "+ Adicionar Motorista".
                      </td>
                    </tr>
                  ) : (
                    filteredDrivers.map((d) => {
                      const idx = drivers.indexOf(d);
                      return (
                        <tr key={idx} className="hover:bg-zinc-850/50 transition-colors">
                          <td className="py-1 px-1 text-center border-r border-zinc-800 bg-zinc-900/40">
                            <button
                              onClick={() => deleteDriver(idx)}
                              className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors cursor-pointer"
                              title="Eliminar Motorista"
                            >
                              🗑️
                            </button>
                          </td>
                          <td className="py-1 px-2 border-r border-zinc-800">
                            <input
                              type="text"
                              value={d.name}
                              onChange={(e) => updateDriver(idx, "name", e.target.value)}
                              className="bg-transparent border-none outline-none text-zinc-100 font-bold text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            />
                          </td>
                          <td className="py-1 px-2 text-center border-r border-zinc-800">
                            <input
                              type="text"
                              maxLength={6}
                              value={d.pin}
                              onChange={(e) => updateDriver(idx, "pin", e.target.value)}
                              className="bg-transparent border-none outline-none text-amber-400 font-mono font-bold text-center tracking-widest text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            />
                          </td>
                          <td className="py-1 px-2 border-r border-zinc-800">
                            <input
                              type="text"
                              value={d.matricula || ""}
                              onChange={(e) => updateDriver(idx, "matricula", e.target.value)}
                              className="bg-transparent border-none outline-none text-zinc-200 font-mono text-xs focus:bg-zinc-900 px-1 py-0.5 rounded uppercase w-full"
                              placeholder="00-AA-00"
                            />
                          </td>
                          <td className="py-1 px-2 border-r border-zinc-800">
                            <input
                              type="text"
                              value={d.phone}
                              onChange={(e) => updateDriver(idx, "phone", e.target.value)}
                              className="bg-transparent border-none outline-none text-zinc-300 font-mono text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                              placeholder="910000000"
                            />
                          </td>
                          <td className="py-1 px-2 text-center border-r border-zinc-800">
                            <input
                              type="text"
                              value={d.shift_start}
                              onChange={(e) => updateDriver(idx, "shift_start", e.target.value)}
                              className="bg-transparent border-none outline-none text-zinc-300 font-mono text-center text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            />
                          </td>
                          <td className="py-1 px-2 text-center border-r border-zinc-800">
                            <input
                              type="text"
                              value={d.shift_end}
                              onChange={(e) => updateDriver(idx, "shift_end", e.target.value)}
                              className="bg-transparent border-none outline-none text-zinc-300 font-mono text-center text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            />
                          </td>
                          <td className="py-1 px-2 text-center">
                            <input
                              type="checkbox"
                              checked={d.is_active === 1}
                              onChange={(e) => updateDriver(idx, "is_active", e.target.checked ? 1 : 0)}
                              className="w-4 h-4 text-indigo-600 bg-zinc-950 border-zinc-800 rounded focus:ring-indigo-500 cursor-pointer"
                            />
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

        {/* ------------------------------------------------------------- */}
        {/* TAB 5: REASONS (Aba Motivos Não Entrega)                      */}
        {/* ------------------------------------------------------------- */}
        {activeTab === "reasons" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                  <span>⚠️</span> Motivos de Não Entrega / Insucesso ({reasons.length})
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Defina o catálogo de motivos que os motoristas podem selecionar na aplicação móvel em caso de falha.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Filtrar motivos..."
                  value={searchReasons}
                  onChange={(e) => setSearchReasons(e.target.value)}
                  className="px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 w-44"
                />
                <button
                  onClick={addReason}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-indigo-600 text-zinc-200 hover:text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  + Adicionar Motivo
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950">
              <table className="w-full text-left text-xs border-collapse border border-zinc-800">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/90 text-zinc-300 font-bold uppercase text-[10px]">
                    <th className="py-2 px-1 text-center w-12 border-r border-zinc-800">Ações</th>
                    <th className="py-2 px-3 border-r border-zinc-800 w-28">Código</th>
                    <th className="py-2 px-3 border-r border-zinc-800">Descrição do Motivo</th>
                    <th className="py-2 px-3 border-r border-zinc-800 w-36">Categoria</th>
                    <th className="py-2 px-3 border-r border-zinc-800 w-36">Ação Requerida</th>
                    <th className="py-2 px-2 text-center w-16">Ativo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 font-sans">
                  {filteredReasons.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-zinc-500">
                        Nenhum motivo configurado. Clique em "+ Adicionar Motivo".
                      </td>
                    </tr>
                  ) : (
                    filteredReasons.map((r) => {
                      const idx = reasons.indexOf(r);
                      return (
                        <tr key={idx} className="hover:bg-zinc-850/50 transition-colors">
                          <td className="py-1 px-1 text-center border-r border-zinc-800 bg-zinc-900/40">
                            <button
                              onClick={() => deleteReason(idx)}
                              className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors cursor-pointer"
                              title="Eliminar Motivo"
                            >
                              🗑️
                            </button>
                          </td>
                          <td className="py-1 px-2 border-r border-zinc-800">
                            <input
                              type="text"
                              value={r.code}
                              onChange={(e) => updateReason(idx, "code", e.target.value)}
                              className="bg-transparent border-none outline-none text-zinc-300 font-mono font-bold text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            />
                          </td>
                          <td className="py-1 px-2 border-r border-zinc-800">
                            <input
                              type="text"
                              value={r.reason}
                              onChange={(e) => updateReason(idx, "reason", e.target.value)}
                              className="bg-transparent border-none outline-none text-zinc-100 font-semibold text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            />
                          </td>
                          <td className="py-1 px-2 border-r border-zinc-800">
                            <select
                              value={r.category}
                              onChange={(e) => updateReason(idx, "category", e.target.value)}
                              className="bg-transparent border-none outline-none text-zinc-300 text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full cursor-pointer"
                            >
                              <option value="Cliente">Cliente</option>
                              <option value="Operacional">Operacional</option>
                              <option value="Trânsito">Trânsito</option>
                              <option value="Outro">Outro</option>
                            </select>
                          </td>
                          <td className="py-1 px-2 border-r border-zinc-800">
                            <select
                              value={r.action_required}
                              onChange={(e) => updateReason(idx, "action_required", e.target.value)}
                              className="bg-transparent border-none outline-none text-zinc-300 text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full cursor-pointer"
                            >
                              <option value="Reagendar">Reagendar</option>
                              <option value="Devolver">Devolver</option>
                              <option value="Avisar Vendedor">Avisar Vendedor</option>
                              <option value="Nenhuma">Nenhuma</option>
                            </select>
                          </td>
                          <td className="py-1 px-2 text-center">
                            <input
                              type="checkbox"
                              checked={r.is_active === 1}
                              onChange={(e) => updateReason(idx, "is_active", e.target.checked ? 1 : 0)}
                              className="w-4 h-4 text-indigo-600 bg-zinc-950 border-zinc-800 rounded focus:ring-indigo-500 cursor-pointer"
                            />
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

        {/* Modal de Georreferenciação Manual do Armazém (Unificado) */}
        {geoModalOpen && editingWhIndex !== null && (
          <UnifiedGeocodingModal
            isOpen={geoModalOpen}
            title={`Georreferenciação Manual do Armazém: ${warehouses[editingWhIndex]?.name || "Armazém"}`}
            entityType="warehouse"
            initialData={{
              name: warehouses[editingWhIndex]?.name || "",
              address: warehouses[editingWhIndex]?.address || "",
              cp: warehouses[editingWhIndex]?.cp || "",
              locality: warehouses[editingWhIndex]?.locality || "",
              lat: warehouses[editingWhIndex]?.lat || 0,
              lon: warehouses[editingWhIndex]?.lon || 0,
            }}
            onSave={(data) => {
              updateWarehouse(editingWhIndex, "address", data.address);
              updateWarehouse(editingWhIndex, "cp", data.cp);
              updateWarehouse(editingWhIndex, "locality", data.locality);
              updateWarehouse(editingWhIndex, "lat", data.lat);
              updateWarehouse(editingWhIndex, "lon", data.lon);
              updateWarehouse(editingWhIndex, "quality", data.lat !== 0 && data.lon !== 0 ? 1 : 99);
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
