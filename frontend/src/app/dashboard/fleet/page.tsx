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
  segunda_volta?: string;
  regresso_armazem?: string;
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

interface ClientDeliveryItem {
  id: number;
  codigo_cliente: string;
  nome_cliente: string;
  morada: string;
  codigo_postal: string;
  concelho: string;
  peso_kg: number;
  volume_m3: number;
  janela_inicio: string;
  janela_fim: string;
  tempo_descarga_min: number;
  regras: string;
  vendedor: string;
  telefone: string;
  valor_cobrar: number;
  armazem: string;
  latitude: number;
  longitude: number;
  nivel_qualidade?: number;
  fonte_match?: string;
  rota?: string;
  ordem?: number;
}

type TabType = "warehouses" | "fleet" | "clients" | "rules" | "drivers" | "reasons";

export default function FleetPage() {
  const { selectedProject } = useProjects();
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TabType>("warehouses");

  // State for all 6 tables
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [fleet, setFleet] = useState<Vehicle[]>([]);
  const [clients, setClients] = useState<ClientDeliveryItem[]>([]);
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [reasons, setReasons] = useState<NonDeliveryReason[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [geocodingWh, setGeocodingWh] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // Search/Filters per tab
  const [searchFleet, setSearchFleet] = useState("");
  const [searchClients, setSearchClients] = useState("");
  const [searchRules, setSearchRules] = useState("");
  const [searchDrivers, setSearchDrivers] = useState("");
  const [searchReasons, setSearchReasons] = useState("");

  // Geocoding Modal State
  const [geoModalOpen, setGeoModalOpen] = useState(false);
  const [editingWhIndex, setEditingWhIndex] = useState<number | null>(null);
  const [editingClient, setEditingClient] = useState<ClientDeliveryItem | null>(null);

  // Rules Simulator State (Ponto 2 GeoRoutePlan)
  const [simVehicleIndex, setSimVehicleIndex] = useState<number>(0);
  const [simDeliveryIndex, setSimDeliveryIndex] = useState<number>(0);
  const [simCustomVehicleTags, setSimCustomVehicleTags] = useState<string>("");
  const [simCustomDeliveryTags, setSimCustomDeliveryTags] = useState<string>("");
  const [simCustomCP, setSimCustomCP] = useState<string>("");
  const [simUseCustom, setSimUseCustom] = useState<boolean>(false);
  const [simResult, setSimResult] = useState<{
    compatible: boolean;
    explanation: string;
    vehicle_name?: string;
    vehicle_tags?: string[];
    delivery_tags?: string[];
    postal_code?: string;
    applied_rules_count?: number;
  } | null>(null);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);

  const runRulesSimulation = async () => {
    if (!selectedProject) return;
    setIsSimulating(true);
    try {
      let vName = "Viatura";
      let vTags = "";
      let dTags = "";
      let dCp = "";

      if (simUseCustom) {
        vTags = simCustomVehicleTags;
        dTags = simCustomDeliveryTags;
        dCp = simCustomCP;
      } else {
        const v = fleet[simVehicleIndex];
        if (v) {
          vName = v.veiculo;
          vTags = v.regras || "";
        }
        const d = clients[simDeliveryIndex];
        if (d) {
          dTags = d.regras || "";
          dCp = d.codigo_postal || "";
        }
      }

      const res = await apiRequest(`/api/fleet/${selectedProject.id}/rules/simulate`, {
        method: "POST",
        body: JSON.stringify({
          vehicle_name: vName,
          vehicle_tags: vTags,
          delivery_tags: dTags,
          delivery_cp: dCp,
          rules_matrix: rules
        })
      });
      setSimResult(res);
    } catch (err: any) {
      alert("Erro na simulação de regras: " + (err.message || "Erro desconhecido"));
    } finally {
      setIsSimulating(false);
    }
  };

  // Load all tables on project change
  useEffect(() => {
    if (!selectedProject) return;

    const loadAllTables = async () => {
      setLoading(true);
      setFeedback(null);
      try {
        const [data, clientsRes] = await Promise.all([
          apiRequest(`/api/fleet/${selectedProject.id}`),
          apiRequest(`/api/geocoding/${selectedProject.id}`)
        ]);
        if (data) {
          if (data.warehouses) setWarehouses(data.warehouses);
          if (data.fleet) setFleet(data.fleet);
          if (data.rules_matrix) setRules(data.rules_matrix);
          if (data.drivers) setDrivers(data.drivers);
          if (data.reasons) setReasons(data.reasons);
        }
        if (Array.isArray(clientsRes)) {
          setClients(clientsRes.map((c: any) => ({
            id: c.id,
            codigo_cliente: c.codigo_cliente || "",
            nome_cliente: c.nome_cliente || c.codigo_cliente || "",
            morada: c.morada || "",
            codigo_postal: c.codigo_postal || "",
            concelho: c.concelho || "",
            peso_kg: Number(c.peso_kg || 0),
            volume_m3: Number(c.volume_m3 || 0),
            janela_inicio: c.janela_inicio || "08:00",
            janela_fim: c.janela_fim || "18:00",
            tempo_descarga_min: Number(c.tempo_descarga_min || 10),
            regras: c.regras || "",
            vendedor: c.vendedor || "",
            telefone: c.telefone || "",
            valor_cobrar: Number(c.valor_cobrar || 0),
            armazem: c.armazem || (data?.warehouses?.[0]?.name || "Armazém Principal"),
            latitude: Number(c.latitude || 0),
            longitude: Number(c.longitude || 0),
            nivel_qualidade: c.nivel_qualidade,
            fonte_match: c.fonte_match,
            rota: c.rota || "Por Distribuir",
            ordem: c.ordem || 0,
          })));
        }
      } catch (err: any) {
        console.error("Erro ao carregar tabelas de frota e clientes:", err);
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
        clients,
      };

      await apiRequest(`/api/fleet/${selectedProject.id}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setFeedback({ type: "success", msg: "Todas as tabelas de suporte, regras e clientes foram guardadas com sucesso!" });
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
      segunda_volta: "Não",
      regresso_armazem: "Sim",
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

  // --- CLIENTS HANDLERS ---
  const updateClientField = (id: number, field: keyof ClientDeliveryItem, value: any) => {
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  };

  const addClient = () => {
    const newId = clients.length > 0 ? Math.max(...clients.map((c) => c.id || 0)) + 1 : 1;
    const newClient: ClientDeliveryItem = {
      id: newId,
      codigo_cliente: `CLI_${newId}`,
      nome_cliente: `Novo Cliente ${newId}`,
      morada: "",
      codigo_postal: "",
      concelho: "",
      peso_kg: 50,
      volume_m3: 0.5,
      janela_inicio: "08:00",
      janela_fim: "18:00",
      tempo_descarga_min: 10,
      regras: "",
      vendedor: "",
      telefone: "",
      valor_cobrar: 0,
      armazem: warehouses[0]?.name || "Armazém Principal",
      latitude: 0,
      longitude: 0,
      nivel_qualidade: 99,
      rota: "Por Distribuir",
      ordem: 0,
    };
    setClients((prev) => [newClient, ...prev]);
  };

  const deleteClient = async (id: number) => {
    if (!confirm("Tem a certeza que deseja eliminar esta entrega/cliente?")) return;
    try {
      await apiRequest(`/api/geocoding/delivery/${id}`, { method: "DELETE" });
      setClients((prev) => prev.filter((c) => c.id !== id));
      setFeedback({ type: "success", msg: "Cliente/entrega eliminado com sucesso." });
    } catch (err: any) {
      setFeedback({ type: "error", msg: err.message || "Erro ao eliminar cliente." });
    }
  };

  // Filtered lists
  const filteredClients = useMemo(() => {
    if (!searchClients.trim()) return clients;
    const q = searchClients.toLowerCase().trim();
    return clients.filter(
      (c) =>
        (c.codigo_cliente && c.codigo_cliente.toLowerCase().includes(q)) ||
        (c.nome_cliente && c.nome_cliente.toLowerCase().includes(q)) ||
        (c.morada && c.morada.toLowerCase().includes(q)) ||
        (c.concelho && c.concelho.toLowerCase().includes(q)) ||
        (c.vendedor && c.vendedor.toLowerCase().includes(q)) ||
        (c.regras && c.regras.toLowerCase().includes(q)) ||
        (c.armazem && c.armazem.toLowerCase().includes(q))
    );
  }, [clients, searchClients]);

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
            onClick={() => setActiveTab("clients")}
            className={`px-3.5 py-2 text-xs font-bold rounded-t-xl transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
              activeTab === "clients"
                ? "bg-zinc-850 border-indigo-500 text-indigo-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            }`}
          >
            <span>📦</span> 3. Clientes & Encomendas ({clients.length})
          </button>

          <button
            onClick={() => setActiveTab("rules")}
            className={`px-3.5 py-2 text-xs font-bold rounded-t-xl transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
              activeTab === "rules"
                ? "bg-zinc-850 border-indigo-500 text-indigo-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            }`}
          >
            <span>⚖️</span> 4. Regras ({rules.length})
          </button>

          <button
            onClick={() => setActiveTab("drivers")}
            className={`px-3.5 py-2 text-xs font-bold rounded-t-xl transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
              activeTab === "drivers"
                ? "bg-zinc-850 border-indigo-500 text-indigo-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            }`}
          >
            <span>👤</span> 5. Motoristas & PINs ({drivers.length})
          </button>

          <button
            onClick={() => setActiveTab("reasons")}
            className={`px-3.5 py-2 text-xs font-bold rounded-t-xl transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
              activeTab === "reasons"
                ? "bg-zinc-850 border-indigo-500 text-indigo-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            }`}
          >
            <span>⚠️</span> 6. Justificação de Entregas ({reasons.length})
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
                    <th className="py-2 px-1 text-center border-r border-zinc-800 w-20">2ª Volta</th>
                    <th className="py-2 px-1 text-center border-r border-zinc-800 w-20">Regresso</th>
                    <th className="py-2 px-2 text-center w-16">Ativo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 font-sans">
                  {filteredFleet.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="py-8 text-center text-zinc-500">
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
                              placeholder="ex: [FRIO], [CP:1000..1999]..."
                              title="Tags ou restrições de CP (ex: [CP:1000..1999] para zona permitida, [!CP:1100..1200] para proibição)"
                            />
                          </td>
                          <td className="py-1 px-1 text-center border-r border-zinc-800">
                            <select
                              value={v.segunda_volta || "Não"}
                              onChange={(e) => updateVehicle(idx, "segunda_volta", e.target.value)}
                              className={`px-1.5 py-0.5 rounded text-[11px] font-bold border outline-none cursor-pointer transition-colors ${
                                (v.segunda_volta === "Sim")
                                  ? "bg-emerald-950/80 text-emerald-400 border-emerald-600"
                                  : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700"
                              }`}
                            >
                              <option value="Não" className="bg-zinc-900 text-zinc-300">Não</option>
                              <option value="Sim" className="bg-zinc-900 text-emerald-400 font-bold">Sim</option>
                            </select>
                          </td>
                          <td className="py-1 px-1 text-center border-r border-zinc-800">
                            <select
                              value={v.regresso_armazem || "Sim"}
                              onChange={(e) => updateVehicle(idx, "regresso_armazem", e.target.value)}
                              className={`px-1.5 py-0.5 rounded text-[11px] font-bold border outline-none cursor-pointer transition-colors ${
                                (v.regresso_armazem === "Não")
                                  ? "bg-amber-950/80 text-amber-400 border-amber-600"
                                  : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700"
                              }`}
                              title={v.regresso_armazem === "Não" ? "Rota Aberta: término na última paragem (sem regresso à base)" : "Regresso obrigatório à base central"}
                            >
                              <option value="Sim" className="bg-zinc-900 text-zinc-300">Sim</option>
                              <option value="Não" className="bg-zinc-900 text-amber-400 font-bold">Não</option>
                            </select>
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
        {/* TAB 3: CLIENTES & ENCOMENDAS (Aba Clientes do Projeto)        */}
        {/* ------------------------------------------------------------- */}
        {activeTab === "clients" && (
          <div className="space-y-3 animate-in fade-in">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-zinc-900/60 p-3.5 rounded-2xl border border-zinc-800">
              <div>
                <h3 className="text-sm font-bold text-zinc-100 flex items-center space-x-2">
                  <span>📦</span>
                  <span>Clientes & Encomendas de Distribuição ({clients.length})</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Configure restrições operacionais, tempos de descarga e etiquetas de regras das encomendas.
                </p>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input
                  type="text"
                  placeholder="Pesquisar cliente, morada, regras, vendedor..."
                  value={searchClients}
                  onChange={(e) => setSearchClients(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 px-3 py-1.5 rounded-xl outline-none focus:border-indigo-500 w-full sm:w-72"
                />
                <button
                  onClick={addClient}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md transition-all shrink-0 cursor-pointer flex items-center gap-1"
                >
                  <span>+</span> <span>Adicionar Cliente</span>
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto border border-zinc-800 rounded-2xl bg-zinc-900/40 backdrop-blur-sm max-h-[68vh]">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-zinc-900/90 text-zinc-400 font-bold uppercase tracking-wider text-[10px] sticky top-0 z-10 border-b border-zinc-800">
                  <tr>
                    <th className="py-2.5 px-1.5 text-center w-16 border-r border-zinc-800">Ações</th>
                    <th className="py-2.5 px-2 border-r border-zinc-800 w-28">Cód / Doc</th>
                    <th className="py-2.5 px-2 border-r border-zinc-800 w-44">Cliente</th>
                    <th className="py-2.5 px-2 border-r border-zinc-800 w-36">Armazém</th>
                    <th className="py-2.5 px-2 border-r border-zinc-800 min-w-[200px]">Morada & Localidade</th>
                    <th className="py-2.5 px-1 text-center border-r border-zinc-800 w-20">Peso (kg)</th>
                    <th className="py-2.5 px-1 text-center border-r border-zinc-800 w-16">Vol. (m³)</th>
                    <th className="py-2.5 px-1 text-center border-r border-zinc-800 w-28">Janela Horária</th>
                    <th className="py-2.5 px-1 text-center border-r border-zinc-800 w-16">Descarga</th>
                    <th className="py-2.5 px-2 border-r border-zinc-800 min-w-[160px] bg-purple-950/20 text-purple-300">
                      🏷️ Regras da Entrega
                    </th>
                    <th className="py-2.5 px-2 border-r border-zinc-800 w-28">Vendedor</th>
                    <th className="py-2.5 px-1 text-center border-r border-zinc-800 w-20">Cobrar (€)</th>
                    <th className="py-2.5 px-2 text-center w-28">Rota Atribuída</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 font-sans">
                  {filteredClients.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="py-8 text-center text-zinc-500">
                        Nenhum cliente encontrado com os filtros atuais.
                      </td>
                    </tr>
                  ) : (
                    filteredClients.map((c) => (
                      <tr key={c.id} className="hover:bg-zinc-850/50 transition-colors">
                        <td className="py-1 px-1.5 text-center border-r border-zinc-800 bg-zinc-900/40">
                          <div className="flex items-center justify-center space-x-1">
                            <button
                              onClick={() => setEditingClient(c)}
                              className="p-1 text-zinc-400 hover:text-amber-400 hover:bg-amber-950/40 rounded transition-colors cursor-pointer"
                              title="Corrigir Georreferenciação no Mapa"
                            >
                              📍
                            </button>
                            <button
                              onClick={() => deleteClient(c.id)}
                              className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors cursor-pointer"
                              title="Eliminar Cliente / Entrega"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                        <td className="py-1 px-2 border-r border-zinc-800 font-mono text-zinc-400 text-[11px]">
                          {c.codigo_cliente}
                        </td>
                        <td className="py-1 px-2 border-r border-zinc-800">
                          <input
                            type="text"
                            value={c.nome_cliente}
                            onChange={(e) => updateClientField(c.id, "nome_cliente", e.target.value)}
                            className="bg-transparent border-none outline-none text-zinc-100 font-bold text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                          />
                        </td>
                        <td className="py-1 px-2 border-r border-zinc-800">
                          <select
                            value={c.armazem || (warehouses[0]?.name || "")}
                            onChange={(e) => updateClientField(c.id, "armazem", e.target.value)}
                            className="bg-transparent border-none outline-none text-zinc-300 w-full text-xs focus:bg-zinc-900 px-1 py-0.5 rounded cursor-pointer"
                          >
                            {warehouses.map((w, wIdx) => (
                              <option key={wIdx} value={w.name} className="bg-zinc-900 text-zinc-200">
                                {w.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1 px-2 border-r border-zinc-800 text-[11px]">
                          <div className="flex flex-col">
                            <input
                              type="text"
                              value={c.morada}
                              onChange={(e) => updateClientField(c.id, "morada", e.target.value)}
                              className="bg-transparent border-none outline-none text-zinc-200 font-medium text-[11px] focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            />
                            <div className="flex items-center space-x-1 text-zinc-500 text-[10px] pl-1 font-mono">
                              <span>{c.codigo_postal}</span>
                              <span>{c.concelho}</span>
                            </div>
                          </div>
                        </td>
                        <td className="py-1 px-1 text-center border-r border-zinc-800">
                          <input
                            type="number"
                            step="0.1"
                            value={c.peso_kg}
                            onChange={(e) => updateClientField(c.id, "peso_kg", parseFloat(e.target.value) || 0)}
                            className="bg-transparent border-none outline-none text-zinc-200 font-mono text-center text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                          />
                        </td>
                        <td className="py-1 px-1 text-center border-r border-zinc-800">
                          <input
                            type="number"
                            step="0.01"
                            value={c.volume_m3}
                            onChange={(e) => updateClientField(c.id, "volume_m3", parseFloat(e.target.value) || 0)}
                            className="bg-transparent border-none outline-none text-zinc-200 font-mono text-center text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                          />
                        </td>
                        <td className="py-1 px-1 text-center border-r border-zinc-800">
                          <div className="flex items-center justify-center space-x-1">
                            <input
                              type="text"
                              value={c.janela_inicio}
                              onChange={(e) => updateClientField(c.id, "janela_inicio", e.target.value)}
                              className="bg-transparent border-none outline-none text-zinc-300 font-mono text-center text-[10.5px] focus:bg-zinc-900 px-0.5 py-0.5 rounded w-12"
                            />
                            <span className="text-zinc-600">-</span>
                            <input
                              type="text"
                              value={c.janela_fim}
                              onChange={(e) => updateClientField(c.id, "janela_fim", e.target.value)}
                              className="bg-transparent border-none outline-none text-zinc-300 font-mono text-center text-[10.5px] focus:bg-zinc-900 px-0.5 py-0.5 rounded w-12"
                            />
                          </div>
                        </td>
                        <td className="py-1 px-1 text-center border-r border-zinc-800">
                          <input
                            type="number"
                            value={c.tempo_descarga_min}
                            onChange={(e) => updateClientField(c.id, "tempo_descarga_min", parseInt(e.target.value, 10) || 0)}
                            className="bg-transparent border-none outline-none text-zinc-200 font-mono text-center text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                          />
                        </td>
                        <td className="py-1 px-2 border-r border-zinc-800 bg-purple-950/10">
                          <input
                            type="text"
                            value={c.regras || ""}
                            onChange={(e) => updateClientField(c.id, "regras", e.target.value)}
                            placeholder="ex: [M_V_Normal], [FRIO]..."
                            className="bg-transparent border-none outline-none text-purple-200 font-mono font-semibold text-xs focus:bg-zinc-900 px-1.5 py-0.5 rounded w-full placeholder:text-zinc-600"
                          />
                        </td>
                        <td className="py-1 px-2 border-r border-zinc-800">
                          <input
                            type="text"
                            value={c.vendedor || ""}
                            onChange={(e) => updateClientField(c.id, "vendedor", e.target.value)}
                            className="bg-transparent border-none outline-none text-zinc-300 text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                          />
                        </td>
                        <td className="py-1 px-1 text-center border-r border-zinc-800">
                          <input
                            type="number"
                            step="0.01"
                            value={c.valor_cobrar || 0}
                            onChange={(e) => updateClientField(c.id, "valor_cobrar", parseFloat(e.target.value) || 0)}
                            className="bg-transparent border-none outline-none text-zinc-200 font-mono text-center text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                          />
                        </td>
                        <td className="py-1 px-2 text-center text-[10.5px]">
                          <span
                            className={`px-2 py-0.5 rounded-full font-bold ${
                              c.rota && !c.rota.includes("Distribuir")
                                ? "bg-indigo-950 text-indigo-300 border border-indigo-700/60"
                                : "bg-amber-950/80 text-amber-300 border border-amber-800/60"
                            }`}
                          >
                            {c.rota || "Por Distribuir"}
                          </span>
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
        {/* TAB 4: RULES (Aba Regras / Matriz de Compatibilidade)         */}
        {/* ------------------------------------------------------------- */}
        {activeTab === "rules" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                  <span>⚖️</span> Matriz de Regras & Compatibilidade de Acesso ({rules.length})
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Configure restrições por etiquetas operacionais (ex: Lisboa, Pequeno) ou regras canónicas de Código Postal (ex: CP:1000..1999).
                </p>
                <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[10px]">
                  <span className="font-semibold text-zinc-400">Padrões CP:</span>
                  <span className="bg-zinc-800 text-indigo-300 px-1.5 py-0.5 rounded font-mono border border-zinc-700/60" title="Intervalo numérico de CP4">CP:1000..1999 (Faixa)</span>
                  <span className="bg-zinc-800 text-indigo-300 px-1.5 py-0.5 rounded font-mono border border-zinc-700/60" title="Prefixo de Código Postal">CP:27* (Prefixo)</span>
                  <span className="bg-zinc-800 text-indigo-300 px-1.5 py-0.5 rounded font-mono border border-zinc-700/60" title="Código postal exato">CP:1050-023 (Exato)</span>
                  <span className="text-zinc-500 italic ml-1">Filtro automático no Solver pelo CP da encomenda</span>
                </div>
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
                    <th className="py-2 px-3 border-r border-zinc-800 w-48">Tag Entrega / Código Postal</th>
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
                              placeholder="Ex: PESADO, CARRINHA_01..."
                              className="bg-transparent border-none outline-none text-zinc-100 font-bold text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full"
                            />
                          </td>
                          <td className="py-1 px-2 border-r border-zinc-800">
                            <input
                              type="text"
                              value={r.tag_entrega}
                              onChange={(e) => updateRule(idx, "tag_entrega", e.target.value)}
                              placeholder="Ex: CP:1100..1299, CP:27*, FRIO..."
                              className="bg-transparent border-none outline-none text-zinc-200 text-xs focus:bg-zinc-900 px-1 py-0.5 rounded w-full font-mono"
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
                              placeholder="Ex: Pesados proibidos na Baixa ou centro histórico."
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

            {/* --------------------------------------------------------- */}
            {/* SIMULADOR INTERATIVO DE REGRAS (Ponto 2 GeoRoutePlan)     */}
            {/* --------------------------------------------------------- */}
            <div className="mt-4 pt-4 border-t border-zinc-800 bg-zinc-950/60 p-4 rounded-xl border border-zinc-800/80 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold text-zinc-100 flex items-center gap-1.5">
                    <span>🧪</span> Simulador Interativo de Regras & Compatibilidade
                  </h3>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Teste antes de otimizar: verifique instantaneamente se uma viatura pode transportar uma encomenda considerando as regras de tags e zonas de Código Postal.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSimUseCustom(!simUseCustom)}
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 underline font-semibold cursor-pointer"
                  >
                    {simUseCustom ? "← Usar Dados Reais da Frota/Clientes" : "⚙️ Modo Teste Livre (Digitar Tags Manuais)"}
                  </button>
                </div>
              </div>

              {!simUseCustom ? (
                /* Modo Seleção Rápida de Dados Reais */
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                  <div className="md:col-span-5">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                      1. Viatura da Frota ({fleet.length})
                    </label>
                    <select
                      value={simVehicleIndex}
                      onChange={(e) => setSimVehicleIndex(parseInt(e.target.value, 10))}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      {fleet.map((v, i) => (
                        <option key={i} value={i}>
                          {v.veiculo} {v.regras ? `— Tags: [${v.regras}]` : "— [Sem restrições]"}
                        </option>
                      ))}
                      {fleet.length === 0 && <option value="0">Nenhuma viatura carregada</option>}
                    </select>
                  </div>

                  <div className="md:col-span-5">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                      2. Encomenda / Cliente ({clients.length})
                    </label>
                    <select
                      value={simDeliveryIndex}
                      onChange={(e) => setSimDeliveryIndex(parseInt(e.target.value, 10))}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      {clients.slice(0, 100).map((c, i) => (
                        <option key={i} value={i}>
                          {c.codigo_cliente || `CLI_${i+1}`} — {c.nome_cliente || c.morada} (CP: {c.codigo_postal || "-"}) {c.regras ? `[${c.regras}]` : ""}
                        </option>
                      ))}
                      {clients.length === 0 && <option value="0">Nenhum cliente carregado</option>}
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <button
                      type="button"
                      onClick={runRulesSimulation}
                      disabled={isSimulating || fleet.length === 0 || clients.length === 0}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-1.5 px-3 rounded-lg text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-md shadow-indigo-600/20"
                    >
                      <span>⚡</span> <span>{isSimulating ? "A testar..." : "Simular"}</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* Modo Entrada Livre */
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                  <div className="md:col-span-4">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                      Tags da Viatura
                    </label>
                    <input
                      type="text"
                      value={simCustomVehicleTags}
                      onChange={(e) => setSimCustomVehicleTags(e.target.value)}
                      placeholder="Ex: [PESADO][CP:1000..1999]"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 font-mono outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="md:col-span-4">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                      Tags da Entrega
                    </label>
                    <input
                      type="text"
                      value={simCustomDeliveryTags}
                      onChange={(e) => setSimCustomDeliveryTags(e.target.value)}
                      placeholder="Ex: [FRIO][LISBOA]"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 font-mono outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                      Código Postal
                    </label>
                    <input
                      type="text"
                      value={simCustomCP}
                      onChange={(e) => setSimCustomCP(e.target.value)}
                      placeholder="Ex: 1050-023"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 font-mono outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <button
                      type="button"
                      onClick={runRulesSimulation}
                      disabled={isSimulating}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-1.5 px-3 rounded-lg text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <span>⚡</span> <span>{isSimulating ? "A testar..." : "Simular"}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Resultado Detalhado do Diagnóstico */}
              {simResult && (
                <div className={`mt-3 p-3.5 rounded-xl border text-xs flex items-start gap-3 transition-all ${
                  simResult.compatible
                    ? "bg-emerald-950/40 border-emerald-800/80 text-emerald-200"
                    : "bg-rose-950/40 border-rose-800/80 text-rose-200"
                }`}>
                  <span className="text-xl shrink-0 mt-0.5">{simResult.compatible ? "✅" : "❌"}</span>
                  <div className="space-y-1 w-full">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs uppercase tracking-wide">
                        {simResult.compatible ? "Compatibilidade Aprovada" : "Bloqueio de Regras Detetado"}
                      </span>
                      <span className="text-[10px] font-mono opacity-80">
                        {simResult.applied_rules_count} regras avaliadas
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      {simResult.explanation}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1.5 text-[10px] font-mono opacity-90 border-t border-white/10 mt-1">
                      <span>Viatura: <b>{simResult.vehicle_name}</b> {simResult.vehicle_tags?.length ? `[${simResult.vehicle_tags.join(", ")}]` : "[sem tags]"}</span>
                      <span>•</span>
                      <span>Entrega: {simResult.delivery_tags?.length ? `[${simResult.delivery_tags.join(", ")}]` : "[sem tags]"}</span>
                      {simResult.postal_code && (
                        <>
                          <span>•</span>
                          <span>CP: <b>{simResult.postal_code}</b></span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
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

        {/* Modal de Georreferenciação Manual do Cliente (Unificado) */}
        {editingClient && (
          <UnifiedGeocodingModal
            isOpen={!!editingClient}
            title={`Georreferenciação Manual do Cliente: ${editingClient.codigo_cliente} (${editingClient.nome_cliente})`}
            entityType="delivery"
            initialData={{
              name: editingClient.nome_cliente || editingClient.codigo_cliente,
              address: editingClient.morada || "",
              cp: editingClient.codigo_postal || "",
              locality: editingClient.concelho || "",
              lat: Number(editingClient.latitude || 0),
              lon: Number(editingClient.longitude || 0),
            }}
            onSave={async (data) => {
              updateClientField(editingClient.id, "morada", data.address);
              updateClientField(editingClient.id, "codigo_postal", data.cp);
              updateClientField(editingClient.id, "concelho", data.locality);
              updateClientField(editingClient.id, "latitude", data.lat);
              updateClientField(editingClient.id, "longitude", data.lon);
              updateClientField(editingClient.id, "nivel_qualidade", 1);

              try {
                await apiRequest(`/api/geocoding/delivery/${editingClient.id}`, {
                  method: "PUT",
                  body: JSON.stringify({
                    morada: data.address,
                    codigo_postal: data.cp,
                    concelho: data.locality,
                    latitude: data.lat,
                    longitude: data.lon,
                  }),
                });
                setFeedback({ type: "success", msg: `Localização de ${editingClient.nome_cliente} atualizada com sucesso!` });
              } catch (e: any) {
                console.error("Erro ao guardar coordenadas do cliente:", e);
              }
              setEditingClient(null);
            }}
            onClose={() => setEditingClient(null)}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
