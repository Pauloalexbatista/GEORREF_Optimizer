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

interface Driver {
  name: string;
  pin: string;
  vehicle: string;
  matricula: string;
  phone: string;
  route: string;
  is_active: number;
}

interface Reason {
  reason: string;
  category: string;
}

export default function FleetPage() {
  const { selectedProject } = useProjects();
  const { t } = useI18n();

  const [activeTab, setActiveTab] = useState<"warehouses" | "fleet" | "drivers" | "reasons">("warehouses");
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [fleet, setFleet] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [reasons, setReasons] = useState<Reason[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // Search filters
  const [searchFleet, setSearchFleet] = useState("");
  const [searchDrivers, setSearchDrivers] = useState("");
  const [searchReasons, setSearchReasons] = useState("");

  // Geocoding modal for warehouse
  const [geoModalOpen, setGeoModalOpen] = useState(false);
  const [editingWhIndex, setEditingWhIndex] = useState<number | null>(null);
  const [geocodingWh, setGeocodingWh] = useState(false);

  // Load project configuration
  const loadFleetConfig = async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const data = await apiRequest(`/api/fleet/${selectedProject.id}`);

      if (data.warehouses) {
        setWarehouses(
          data.warehouses.map((w: any) => ({
            name: w.name || "Armazém Principal",
            address: w.address || "",
            cp: w.cp || "",
            locality: w.locality || "",
            lat: Number(w.lat) || 0,
            lon: Number(w.lon) || 0,
            quality: w.quality || 1,
            open_time: w.open_time || "06:00:00",
            close_time: w.close_time || "22:00:00",
            load_time: w.load_time !== undefined ? Number(w.load_time) : 30,
            contact: w.contact || "",
          }))
        );
      } else {
        setWarehouses([]);
      }

      if (data.fleet) {
        setFleet(
          data.fleet.map((v: any) => ({
            armazem: v.armazem || (data.warehouses?.[0]?.name || "Armazém Principal"),
            veiculo: v.veiculo || "Viatura Nova",
            capacidade_kg: Number(v.capacidade_kg) || 1000,
            capacidade_vol: Number(v.capacidade_vol || v.capacidade_volume) || 10,
            velocidade_media: Number(v.velocidade_media) || 50,
            horario_inicio: v.horario_inicio || "08:00:00",
            horario_fim: v.horario_fim || "18:00:00",
            custo_km: Number(v.custo_km) || 0.65,
            custo_hora: Number(v.custo_hora) || 12.50,
            max_entregas: Number(v.max_entregas) || 30,
            regras: v.regras || "",
            motorista_nome: v.motorista_nome || v.motorista || "",
            motorista_telemovel: v.motorista_telemovel || "",
            is_active: v.is_active !== undefined ? Number(v.is_active) : 1,
          }))
        );
      } else {
        setFleet([]);
      }

      if (data.drivers) {
        setDrivers(
          data.drivers.map((d: any) => ({
            name: d.name || "Motorista Novo",
            pin: d.pin || "1234",
            vehicle: d.vehicle || d.viatura || "",
            matricula: d.matricula || "",
            phone: d.phone || d.telemovel || "",
            route: d.route || d.rota || "",
            is_active: d.is_active !== undefined ? Number(d.is_active) : 1,
          }))
        );
      } else {
        setDrivers([]);
      }

      if (data.reasons) {
        setReasons(
          data.reasons.map((r: any) => ({
            reason: r.reason || r.motivo || "",
            category: r.category || r.categoria || "Geral",
          }))
        );
      } else {
        setReasons([]);
      }
    } catch (err: any) {
      console.error("Failed to load fleet config:", err);
      setFeedback({ type: "error", msg: "Erro ao carregar dados do projeto." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFleetConfig();
  }, [selectedProject]);

  // Persist all tables to backend
  const persistAllTables = async () => {
    if (!selectedProject) return;
    setSaving(true);
    setFeedback(null);
    try {
      await apiRequest(`/api/fleet/${selectedProject.id}/save`, {
        method: "POST",
        body: JSON.stringify({
          warehouses,
          fleet,
          drivers,
          reasons,
        }),
      });
      setFeedback({ type: "success", msg: "Todas as tabelas foram guardadas com sucesso!" });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setFeedback({ type: "error", msg: "Erro ao guardar tabelas: " + (err.message || "Erro desconhecido") });
    } finally {
      setSaving(false);
    }
  };

  // Warehouse handlers
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
      quality: 99,
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
    try {
      const updated = [...warehouses];
      for (let i = 0; i < updated.length; i++) {
        const wh = updated[i];
        if (wh.address.trim()) {
          const query = `${wh.address} ${wh.cp} ${wh.locality}`.trim();
          const res = await apiRequest(`/api/geocoding/suggest?q=${encodeURIComponent(query)}`);
          const first = res?.suggestions?.[0] || res?.[0];
          if (first && first.lat && first.lon) {
            updated[i] = {
              ...wh,
              lat: Number(first.lat),
              lon: Number(first.lon),
              quality: 1,
            };
          }
        }
      }
      setWarehouses(updated);
      setFeedback({ type: "success", msg: "Georreferenciação automática de armazéns concluída!" });
    } catch (err: any) {
      setFeedback({ type: "error", msg: "Erro ao georreferenciar armazéns: " + err.message });
    } finally {
      setGeocodingWh(false);
    }
  };

  // Vehicle handlers
  const updateVehicle = (index: number, field: keyof Vehicle, value: any) => {
    setFleet((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const addVehicle = () => {
    const defaultWh = warehouses[0]?.name || "Armazém Principal";
    const newVeh: Vehicle = {
      armazem: defaultWh,
      veiculo: `Viatura ${fleet.length + 1}`,
      capacidade_kg: 1000,
      capacidade_vol: 10,
      velocidade_media: 50,
      horario_inicio: "08:00:00",
      horario_fim: "18:00:00",
      custo_km: 0.65,
      custo_hora: 12.50,
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

  // Driver handlers
  const updateDriver = (index: number, field: keyof Driver, value: any) => {
    setDrivers((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const addDriver = () => {
    const newDriver: Driver = {
      name: `Motorista ${drivers.length + 1}`,
      pin: "1234",
      vehicle: fleet[0]?.veiculo || "",
      matricula: "",
      phone: "",
      route: "",
      is_active: 1,
    };
    setDrivers((prev) => [...prev, newDriver]);
  };

  const deleteDriver = (index: number) => {
    setDrivers((prev) => prev.filter((_, i) => i !== index));
  };

  // Reason handlers
  const updateReason = (index: number, field: keyof Reason, value: any) => {
    setReasons((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const addReason = () => {
    const newReason: Reason = {
      reason: "Novo Motivo de Não Entrega",
      category: "Geral",
    };
    setReasons((prev) => [...prev, newReason]);
  };

  const deleteReason = (index: number) => {
    setReasons((prev) => prev.filter((_, i) => i !== index));
  };

  // Filtered lists
  const filteredFleet = useMemo(() => {
    const q = searchFleet.toLowerCase().trim();
    if (!q) return fleet;
    return fleet.filter(
      (v) =>
        v.veiculo.toLowerCase().includes(q) ||
        v.armazem.toLowerCase().includes(q) ||
        v.motorista_nome.toLowerCase().includes(q) ||
        v.motorista_telemovel.toLowerCase().includes(q)
    );
  }, [fleet, searchFleet]);

  const filteredDrivers = useMemo(() => {
    const q = searchDrivers.toLowerCase().trim();
    if (!q) return drivers;
    return drivers.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.phone.toLowerCase().includes(q) ||
        d.vehicle.toLowerCase().includes(q) ||
        d.matricula.toLowerCase().includes(q) ||
        d.route.toLowerCase().includes(q)
    );
  }, [drivers, searchDrivers]);

  const filteredReasons = useMemo(() => {
    const q = searchReasons.toLowerCase().trim();
    if (!q) return reasons;
    return reasons.filter(
      (r) => r.reason.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)
    );
  }, [reasons, searchReasons]);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-900 border border-zinc-800 p-5 rounded-2xl shadow-xl">
          <div>
            <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2.5">
              <span>📋</span> 2. Tabelas de Suporte & Frota
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Configure armazéns de partida, viaturas, motoristas com PINs diários e motivos de não entrega.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={persistAllTables}
              disabled={saving}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center space-x-2 transition-all cursor-pointer"
            >
              {saving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>A Gravar Tabelas...</span>
                </>
              ) : (
                <>
                  <span>💾</span>
                  <span>Guardar Tabelas</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`p-3.5 rounded-xl text-xs font-semibold flex items-center justify-between animate-in fade-in duration-200 border ${
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
        <div className="flex items-center space-x-2 border-b border-zinc-800 pb-1 overflow-x-auto">
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
            <span>⚠️</span> 4. Justificação de Entregas ({reasons.length})
          </button>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* TAB 1: WAREHOUSES (Aba Armazéns)                              */}
        {/* ------------------------------------------------------------- */}
        {activeTab === "warehouses" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl p-5 space-y-4">
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
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm shadow-emerald-600/20 transition-all cursor-pointer disabled:opacity-50"
                  title="Georreferenciar automaticamente todos os armazéns a partir da morada/código postal"
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

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-950/80 text-zinc-400 font-bold uppercase text-[10px]">
                    <th className="py-2.5 px-3">Nome Armazém</th>
                    <th className="py-2.5 px-3">Morada</th>
                    <th className="py-2.5 px-3">Código Postal</th>
                    <th className="py-2.5 px-3">Localidade</th>
                    <th className="py-2.5 px-3 text-center">Abertura</th>
                    <th className="py-2.5 px-3 text-center">Fecho</th>
                    <th className="py-2.5 px-3 text-center">Carga (min)</th>
                    <th className="py-2.5 px-3">Contacto</th>
                    <th className="py-2.5 px-3 text-center">Coordenadas</th>
                    <th className="py-2.5 px-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {warehouses.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-zinc-500">
                        Nenhum armazém configurado. Clique em "+ Adicionar Armazém" ou importe o ficheiro Excel.
                      </td>
                    </tr>
                  ) : (
                    warehouses.map((wh, idx) => (
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
                            placeholder="Estrada / Rua..."
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="text"
                            value={wh.cp}
                            onChange={(e) => updateWarehouse(idx, "cp", e.target.value)}
                            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-24 font-mono"
                            placeholder="2625-441"
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="text"
                            value={wh.locality}
                            onChange={(e) => updateWarehouse(idx, "locality", e.target.value)}
                            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-32"
                            placeholder="Forte da Casa"
                          />
                        </td>
                        <td className="py-2 px-3 text-center">
                          <input
                            type="text"
                            value={wh.open_time || "06:00:00"}
                            onChange={(e) => updateWarehouse(idx, "open_time", e.target.value)}
                            className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-zinc-100 w-20 text-center font-mono text-[11px]"
                            placeholder="06:00:00"
                          />
                        </td>
                        <td className="py-2 px-3 text-center">
                          <input
                            type="text"
                            value={wh.close_time || "22:00:00"}
                            onChange={(e) => updateWarehouse(idx, "close_time", e.target.value)}
                            className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-zinc-100 w-20 text-center font-mono text-[11px]"
                            placeholder="22:00:00"
                          />
                        </td>
                        <td className="py-2 px-3 text-center">
                          <input
                            type="number"
                            value={wh.load_time !== undefined ? wh.load_time : 30}
                            onChange={(e) => updateWarehouse(idx, "load_time", parseInt(e.target.value, 10) || 30)}
                            className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-zinc-100 w-16 text-center font-mono text-[11px]"
                            min={1}
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="text"
                            value={wh.contact || ""}
                            onChange={(e) => updateWarehouse(idx, "contact", e.target.value)}
                            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-28 text-[11px]"
                            placeholder="912345678"
                          />
                        </td>
                        <td className="py-2 px-3 text-center">
                          {wh.lat !== 0 && wh.lon !== 0 ? (
                            <button
                              onClick={() => {
                                setEditingWhIndex(idx);
                                setGeoModalOpen(true);
                              }}
                              className="px-2.5 py-1 bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-400 hover:text-emerald-300 rounded-lg text-[11px] font-mono border border-emerald-800/60 flex items-center gap-1.5 mx-auto transition-all cursor-pointer"
                              title="Coordenadas válidas. Clique para abrir o georreferenciador no mapa."
                            >
                              <span>📍</span> {wh.lat.toFixed(4)}, {wh.lon.toFixed(4)}
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                setEditingWhIndex(idx);
                                setGeoModalOpen(true);
                              }}
                              className="px-2.5 py-1 bg-amber-950/60 hover:bg-amber-900/80 text-amber-300 hover:text-amber-200 rounded-lg text-[11px] font-semibold border border-amber-800/80 animate-pulse flex items-center gap-1 mx-auto transition-all cursor-pointer"
                              title="Armazém sem coordenadas. Clique para georreferenciar no mapa."
                            >
                              <span>⚠️</span> Georreferenciar
                            </button>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="flex items-center justify-end space-x-1">
                            <button
                              onClick={() => {
                                setEditingWhIndex(idx);
                                setGeoModalOpen(true);
                              }}
                              className="p-1 text-zinc-400 hover:text-indigo-400 transition-colors cursor-pointer"
                              title="Abrir Georreferenciação Manual"
                            >
                              🗺️
                            </button>
                            <button
                              onClick={() => deleteWarehouse(idx)}
                              className="p-1 text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
                              title="Eliminar Armazém"
                            >
                              🗑️
                            </button>
                          </div>
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
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                  <span>🚚</span> Frota de Viaturas ({fleet.length})
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Configure viaturas, capacidades de carga, turnos, custos, regras e motoristas atribuídos.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="🔍 Filtrar viatura, motorista, armazém..."
                  value={searchFleet}
                  onChange={(e) => setSearchFleet(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 w-60 outline-none focus:border-indigo-500"
                />
                <button
                  onClick={addVehicle}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-indigo-600 text-zinc-200 hover:text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  + Adicionar Viatura
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-950/80 text-zinc-400 font-bold uppercase text-[10px]">
                    <th className="py-2.5 px-3">Armazém Origem</th>
                    <th className="py-2.5 px-3">Veículo</th>
                    <th className="py-2.5 px-3 text-center">Capacidade (kg)</th>
                    <th className="py-2.5 px-3 text-center">Volume (m³)</th>
                    <th className="py-2.5 px-3 text-center">Velocidade (km/h)</th>
                    <th className="py-2.5 px-3 text-center">Início Turno</th>
                    <th className="py-2.5 px-3 text-center">Fim Turno</th>
                    <th className="py-2.5 px-3 text-center">Custo KM (€)</th>
                    <th className="py-2.5 px-3 text-center">Custo Hora (€)</th>
                    <th className="py-2.5 px-3 text-center">Máx. Entregas</th>
                    <th className="py-2.5 px-3">Regras</th>
                    <th className="py-2.5 px-3">Motorista Nome</th>
                    <th className="py-2.5 px-3">Motorista Telemóvel</th>
                    <th className="py-2.5 px-3 text-center">Ativo</th>
                    <th className="py-2.5 px-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {filteredFleet.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="py-8 text-center text-zinc-500">
                        Nenhuma viatura encontrada.
                      </td>
                    </tr>
                  ) : (
                    filteredFleet.map((v) => {
                      const idx = fleet.indexOf(v);
                      return (
                        <tr key={idx} className="hover:bg-zinc-850/30">
                          <td className="py-2 px-3">
                            <select
                              value={v.armazem}
                              onChange={(e) => updateVehicle(idx, "armazem", e.target.value)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-300 w-36 text-xs"
                            >
                              {warehouses.map((wh) => (
                                <option key={wh.name} value={wh.name}>
                                  {wh.name}
                                </option>
                              ))}
                              {!warehouses.some((w) => w.name === v.armazem) && (
                                <option value={v.armazem}>{v.armazem}</option>
                              )}
                            </select>
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={v.veiculo}
                              onChange={(e) => updateVehicle(idx, "veiculo", e.target.value)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-32 font-bold"
                            />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="number"
                              value={v.capacidade_kg}
                              onChange={(e) => updateVehicle(idx, "capacidade_kg", parseFloat(e.target.value) || 0)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-20 text-center font-mono"
                              step="50"
                            />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="number"
                              value={v.capacidade_vol}
                              onChange={(e) => updateVehicle(idx, "capacidade_vol", parseFloat(e.target.value) || 0)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-16 text-center font-mono"
                              step="0.5"
                            />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="number"
                              value={v.velocidade_media}
                              onChange={(e) => updateVehicle(idx, "velocidade_media", parseFloat(e.target.value) || 0)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-16 text-center font-mono"
                            />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="text"
                              value={v.horario_inicio}
                              onChange={(e) => updateVehicle(idx, "horario_inicio", e.target.value)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-zinc-100 w-20 text-center font-mono text-[11px]"
                              placeholder="08:00:00"
                            />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="text"
                              value={v.horario_fim}
                              onChange={(e) => updateVehicle(idx, "horario_fim", e.target.value)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-zinc-100 w-20 text-center font-mono text-[11px]"
                              placeholder="18:00:00"
                            />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="number"
                              step="0.01"
                              value={v.custo_km}
                              onChange={(e) => updateVehicle(idx, "custo_km", parseFloat(e.target.value) || 0)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-16 text-center font-mono"
                            />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="number"
                              step="0.5"
                              value={v.custo_hora}
                              onChange={(e) => updateVehicle(idx, "custo_hora", parseFloat(e.target.value) || 0)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-16 text-center font-mono"
                            />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="number"
                              value={v.max_entregas}
                              onChange={(e) => updateVehicle(idx, "max_entregas", parseInt(e.target.value, 10) || 0)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-16 text-center font-mono"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={v.regras}
                              onChange={(e) => updateVehicle(idx, "regras", e.target.value)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-300 w-28 text-xs"
                              placeholder="Regras..."
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={v.motorista_nome}
                              onChange={(e) => updateVehicle(idx, "motorista_nome", e.target.value)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-200 w-32"
                              placeholder="Nome Motorista..."
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={v.motorista_telemovel}
                              onChange={(e) => updateVehicle(idx, "motorista_telemovel", e.target.value)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-300 w-28 font-mono text-[11px]"
                              placeholder="910000000"
                            />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={v.is_active === 1}
                              onChange={(e) => updateVehicle(idx, "is_active", e.target.checked ? 1 : 0)}
                              className="w-4 h-4 text-indigo-600 bg-zinc-950 border-zinc-800 rounded focus:ring-indigo-500 cursor-pointer"
                            />
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
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* TAB 3: DRIVERS (Aba Motoristas e Carros)                      */}
        {/* ------------------------------------------------------------- */}
        {activeTab === "drivers" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                  <span>👤</span> Motoristas & Credenciais App ({drivers.length})
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Gira o acesso à Mobile WebApp dos motoristas, PINs de autenticação, matrículas e rotas atribuídas.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="🔍 Filtrar por nome, telemóvel, viatura, matrícula..."
                  value={searchDrivers}
                  onChange={(e) => setSearchDrivers(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 w-64 outline-none focus:border-indigo-500"
                />
                <button
                  onClick={addDriver}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-indigo-600 text-zinc-200 hover:text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  + Adicionar Motorista
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-950/80 text-zinc-400 font-bold uppercase text-[10px]">
                    <th className="py-2.5 px-3">Nome Motorista</th>
                    <th className="py-2.5 px-3 text-center">PIN App</th>
                    <th className="py-2.5 px-3">Viatura Atribuída</th>
                    <th className="py-2.5 px-3">Matrícula</th>
                    <th className="py-2.5 px-3">Telemóvel</th>
                    <th className="py-2.5 px-3">Rota Atribuída</th>
                    <th className="py-2.5 px-3 text-center">Ativo</th>
                    <th className="py-2.5 px-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {filteredDrivers.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-zinc-500">
                        Nenhum motorista registado.
                      </td>
                    </tr>
                  ) : (
                    filteredDrivers.map((d) => {
                      const idx = drivers.indexOf(d);
                      return (
                        <tr key={idx} className="hover:bg-zinc-850/30">
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={d.name}
                              onChange={(e) => updateDriver(idx, "name", e.target.value)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-44 font-bold"
                            />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="text"
                              value={d.pin}
                              onChange={(e) => updateDriver(idx, "pin", e.target.value)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-indigo-400 font-mono text-center font-bold w-20"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <select
                              value={d.vehicle}
                              onChange={(e) => updateDriver(idx, "vehicle", e.target.value)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-300 w-40 text-xs"
                            >
                              <option value="">-- Nenhuma Viatura --</option>
                              {fleet.map((v) => (
                                <option key={v.veiculo} value={v.veiculo}>
                                  {v.veiculo}
                                </option>
                              ))}
                              {!fleet.some((f) => f.veiculo === d.vehicle) && d.vehicle && (
                                <option value={d.vehicle}>{d.vehicle}</option>
                              )}
                            </select>
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={d.matricula || ""}
                              onChange={(e) => updateDriver(idx, "matricula", e.target.value)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-emerald-400 font-mono font-bold w-28"
                              placeholder="54-TG-22"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={d.phone}
                              onChange={(e) => updateDriver(idx, "phone", e.target.value)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-300 font-mono w-32"
                              placeholder="910000000"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={d.route || ""}
                              onChange={(e) => updateDriver(idx, "route", e.target.value)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-300 w-36"
                              placeholder="Rota 1..."
                            />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={d.is_active === 1}
                              onChange={(e) => updateDriver(idx, "is_active", e.target.checked ? 1 : 0)}
                              className="w-4 h-4 text-indigo-600 bg-zinc-950 border-zinc-800 rounded focus:ring-indigo-500 cursor-pointer"
                            />
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
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* TAB 4: REASONS (Aba Justificação de Entregas)                 */}
        {/* ------------------------------------------------------------- */}
        {activeTab === "reasons" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                  <span>⚠️</span> Motivos de Não Entrega ({reasons.length})
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Configure as justificações que os motoristas podem selecionar na App Mobile ao falhar uma paragem.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="🔍 Filtrar motivos..."
                  value={searchReasons}
                  onChange={(e) => setSearchReasons(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 w-52 outline-none focus:border-indigo-500"
                />
                <button
                  onClick={addReason}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-indigo-600 text-zinc-200 hover:text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  + Adicionar Motivo
                </button>
              </div>
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
                  {filteredReasons.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-zinc-500">
                        Nenhum motivo configurado.
                      </td>
                    </tr>
                  ) : (
                    filteredReasons.map((r) => {
                      const idx = reasons.indexOf(r);
                      return (
                        <tr key={idx} className="hover:bg-zinc-850/30">
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={r.reason}
                              onChange={(e) => updateReason(idx, "reason", e.target.value)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 w-80 font-bold"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={r.category}
                              onChange={(e) => updateReason(idx, "category", e.target.value)}
                              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-300 w-52"
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
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Modal de Geocodificação Manual do Armazém (Unificado) */}
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
