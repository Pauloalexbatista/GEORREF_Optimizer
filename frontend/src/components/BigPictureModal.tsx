"use client";

import React, { useMemo, useState, useEffect } from "react";
import { parseWindowStartEnd } from "@/utils/geoNormalize";

export interface BigPictureDelivery {
  id?: number | string;
  Doc_ID?: string;
  Cliente?: string;
  Nome_Cliente?: string;
  Janela_Horaria?: string;
  Janela_Inicio?: string;
  Janela_Fim?: string;
  Peso_KG?: number;
  Volume_m3?: number;
  Rota?: string;
  Armazem?: string;
  Morada?: string;
  Localidade?: string;
  Cx_Ambiente?: number;
  Cx_Frio?: number;
  Cx_Congelado?: number;
  Total_Cx?: number;
}

export interface BigPictureVehicle {
  veiculo: string;
  armazem?: string;
  capacidade_kg?: number;
  capacidade_vol?: number;
  capacidade_caixas?: number;
  horario_inicio?: string;
  horario_fim?: string;
  max_entregas?: number;
}

export interface TimePeriodStat {
  id: "am" | "pm" | "night" | "flexible";
  label: string;
  timeRange: string;
  count: number;
  pct: number;
  totalKg: number;
  totalVol: number;
  fleetCapacityStops: number;
  deficitStops: number;
  deficitVehicles: number;
  status: "surplus" | "balanced" | "warning" | "critical";
  deliveries: BigPictureDelivery[];
}

export interface BigPictureAnalysis {
  totalDeliveries: number;
  totalVehicles: number;
  totalKg: number;
  totalVol: number;
  totalBoxes: number;
  fleetMaxKg: number;
  fleetMaxVol: number;
  weightOccupancyPct: number;
  volOccupancyPct: number;
  periods: Record<"am" | "pm" | "night" | "flexible", TimePeriodStat>;
  criticalPeriod: TimePeriodStat | null;
  overallStatus: "balanced" | "warning" | "critical";
  recommendedVehicles: number;
  summaryMessage: string;
}

export function matchWarehouse(whA?: string, whB?: string): boolean {
  if (!whA || !whB) return false;
  const a = whA.toLowerCase().trim();
  const b = whB.toLowerCase().trim();
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * Motor de diagnóstico executivo de capacidade temporal e física.
 * Analisa a simetria entre a procura de cada período (Manhã, Tarde, Noite, Flexível)
 * contra a capacidade horária e física da frota disponível.
 */
export function computeBigPictureAnalytics(
  deliveries: BigPictureDelivery[],
  vehicles: BigPictureVehicle[]
): BigPictureAnalysis {
  const totalDeliveries = deliveries.length;
  const numVehicles = Math.max(1, vehicles.length);

  let totalKg = 0;
  let totalVol = 0;
  let totalBoxes = 0;
  deliveries.forEach((d) => {
    totalKg += Number(d.Peso_KG) || 0;
    totalVol += Number(d.Volume_m3) || 0;
    const b = Number(d.Total_Cx) || (Number(d.Cx_Ambiente || 0) + Number(d.Cx_Frio || 0) + Number(d.Cx_Congelado || 0)) || 0;
    totalBoxes += b;
  });

  let fleetMaxKg = 0;
  let fleetMaxVol = 0;
  vehicles.forEach((v) => {
    fleetMaxKg += Number(v.capacidade_kg) || 1200;
    fleetMaxVol += Number(v.capacidade_vol) || 10;
  });

  const weightOccupancyPct = fleetMaxKg > 0 ? Math.round((totalKg / fleetMaxKg) * 100) : 0;
  const volOccupancyPct = fleetMaxVol > 0 ? Math.round((totalVol / fleetMaxVol) * 100) : 0;

  // Classificação temporal de cada entrega
  const amDeliveries: BigPictureDelivery[] = [];
  const pmDeliveries: BigPictureDelivery[] = [];
  const nightDeliveries: BigPictureDelivery[] = [];
  const flexibleDeliveries: BigPictureDelivery[] = [];

  deliveries.forEach((d) => {
    const rawWindow = d.Janela_Horaria || (d.Janela_Inicio && d.Janela_Fim ? `${d.Janela_Inicio}-${d.Janela_Fim}` : "");
    const parsed = parseWindowStartEnd(rawWindow);

    if (!parsed) {
      flexibleDeliveries.push(d);
      return;
    }

    const { start: startMin, end: endMin } = parsed;

    if (endMin <= 780) {
      amDeliveries.push(d);
    } else if (startMin >= 780 && endMin <= 1140) {
      pmDeliveries.push(d);
    } else if (startMin >= 1080) {
      nightDeliveries.push(d);
    } else if (startMin <= 600 && endMin >= 1080) {
      flexibleDeliveries.push(d);
    } else if (startMin < 780 && endMin > 780) {
      const amSpan = 780 - startMin;
      const pmSpan = endMin - 780;
      if (amSpan >= pmSpan) {
        amDeliveries.push(d);
      } else {
        pmDeliveries.push(d);
      }
    } else {
      flexibleDeliveries.push(d);
    }
  });

  // Capacidade estimada de paragens por período por viatura (média operacional de 20-30 min por entrega)
  const avgStopsPerVehicleAM = 9;
  const avgStopsPerVehiclePM = 9;
  const avgStopsPerVehicleNight = 5;

  const fleetCapAM = numVehicles * avgStopsPerVehicleAM;
  const fleetCapPM = numVehicles * avgStopsPerVehiclePM;
  const fleetCapNight = numVehicles * avgStopsPerVehicleNight;

  const buildPeriodStat = (
    id: "am" | "pm" | "night" | "flexible",
    label: string,
    timeRange: string,
    items: BigPictureDelivery[],
    fleetCap: number,
    stopsPerVehicle: number
  ): TimePeriodStat => {
    const count = items.length;
    const pct = totalDeliveries > 0 ? Math.round((count / totalDeliveries) * 100) : 0;
    let periodKg = 0;
    let periodVol = 0;
    items.forEach((it) => {
      periodKg += Number(it.Peso_KG) || 0;
      periodVol += Number(it.Volume_m3) || 0;
    });

    const deficitStops = Math.max(0, count - fleetCap);
    const deficitVehicles = deficitStops > 0 ? Math.ceil(deficitStops / stopsPerVehicle) : 0;

    let status: "surplus" | "balanced" | "warning" | "critical" = "balanced";
    if (deficitStops > 0) {
      status = deficitStops > stopsPerVehicle ? "critical" : "warning";
    } else if (fleetCap > 0 && count < fleetCap * 0.4) {
      status = "surplus";
    }

    return {
      id,
      label,
      timeRange,
      count,
      pct,
      totalKg: periodKg,
      totalVol: periodVol,
      fleetCapacityStops: fleetCap,
      deficitStops,
      deficitVehicles,
      status,
      deliveries: items,
    };
  };

  const periodAM = buildPeriodStat("am", "Manhã (AM)", "08:00 – 13:00", amDeliveries, fleetCapAM, avgStopsPerVehicleAM);
  const periodPM = buildPeriodStat("pm", "Tarde (PM)", "13:00 – 18:30", pmDeliveries, fleetCapPM, avgStopsPerVehiclePM);
  const periodNight = buildPeriodStat("night", "Pós-Laboral / Noite", "18:00 – 22:00", nightDeliveries, fleetCapNight, avgStopsPerVehicleNight);
  const periodFlex = buildPeriodStat("flexible", "Flexível / Dia Inteiro", "Sem restrição estrita", flexibleDeliveries, totalDeliveries, 15);

  const periods = { am: periodAM, pm: periodPM, night: periodNight, flexible: periodFlex };

  // Identificação do Período Mais Crítico / Gargalo
  const timeConstrained = [periodAM, periodPM, periodNight];
  const criticalPeriod = timeConstrained.reduce((max, p) => (p.deficitStops > (max?.deficitStops || 0) ? p : max), null as TimePeriodStat | null);

  const vehByWeight = fleetMaxKg > 0 ? Math.ceil(totalKg / (fleetMaxKg / numVehicles)) : numVehicles;
  const vehByCriticalPeriod = criticalPeriod && criticalPeriod.deficitVehicles > 0 ? numVehicles + criticalPeriod.deficitVehicles : numVehicles;
  const recommendedVehicles = Math.max(numVehicles, vehByWeight, vehByCriticalPeriod);

  let overallStatus: "balanced" | "warning" | "critical" = "balanced";
  let summaryMessage = "Distribuição perfeitamente equilibrada e viável com a frota atual.";

  if (weightOccupancyPct > 105) {
    overallStatus = "critical";
    summaryMessage = `Sobrecarga física de carga: o peso total (${totalKg.toLocaleString("pt-PT")} kg) excede em ${weightOccupancyPct - 100}% a capacidade máxima da frota.`;
  } else if (criticalPeriod && criticalPeriod.deficitVehicles > 0) {
    overallStatus = criticalPeriod.status === "critical" ? "critical" : "warning";
    summaryMessage = `Gargalo identificado no período ${criticalPeriod.label}: existem ${criticalPeriod.count} paragens para uma capacidade estimada de ${criticalPeriod.fleetCapacityStops} entregas. Défice de ~${criticalPeriod.deficitVehicles} viatura(s) no pico.`;
  } else if (weightOccupancyPct > 90) {
    overallStatus = "warning";
    summaryMessage = `Atenção à carga: a frota está a 90%+ da capacidade física máxima (${totalKg.toLocaleString("pt-PT")} kg).`;
  }

  return {
    totalDeliveries,
    totalVehicles: numVehicles,
    totalKg,
    totalVol,
    totalBoxes,
    fleetMaxKg,
    fleetMaxVol,
    weightOccupancyPct,
    volOccupancyPct,
    periods,
    criticalPeriod: criticalPeriod && criticalPeriod.deficitStops > 0 ? criticalPeriod : null,
    overallStatus,
    recommendedVehicles,
    summaryMessage,
  };
}

export interface WarehouseBigPictureStat {
  id: string;
  name: string;
  vehicles: string[];
  deliveries: BigPictureDelivery[];
  totalDeliveries: number;
  totalKg: number;
  totalVol: number;
  totalBoxes: number;
  analytics: BigPictureAnalysis;
}

/**
 * Agrupa as entregas e viaturas por Armazém / Loja e executa o diagnóstico
 * individualizado para cada armazém ("Análise por Armazém / Loja").
 */
export function computeWarehouseBigPictureAnalytics(
  deliveries: BigPictureDelivery[],
  vehicles: BigPictureVehicle[]
): WarehouseBigPictureStat[] {
  const whGroups = new Map<string, BigPictureDelivery[]>();

  // 1. Agrupar entregas por Armazém
  deliveries.forEach((d) => {
    const rawWh = (d.Armazem || (d as any).armazem || "Sem Armazém").trim();
    if (!whGroups.has(rawWh)) {
      whGroups.set(rawWh, []);
    }
    whGroups.get(rawWh)!.push(d);
  });

  // 2. Assegurar que armazéns da frota também constam
  vehicles.forEach((v) => {
    const vWh = (v.armazem || "").trim();
    if (vWh) {
      let found = false;
      for (const existingWh of whGroups.keys()) {
        if (matchWarehouse(existingWh, vWh)) {
          found = true;
          break;
        }
      }
      if (!found) {
        whGroups.set(vWh, []);
      }
    }
  });

  const list: WarehouseBigPictureStat[] = [];

  whGroups.forEach((whDeliveries, whName) => {
    const whId = `wh_${whName.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

    // Viaturas alocadas a este Armazém/Loja
    const whVehicles = vehicles.filter((v) => {
      if (matchWarehouse(v.armazem, whName)) return true;
      if (whDeliveries.some((d) => d.Rota === v.veiculo)) return true;
      const vPrefix = v.veiculo.includes("_") ? v.veiculo.split("_")[0].toLowerCase() : v.veiculo.toLowerCase();
      const whNorm = whName.toLowerCase();
      if (whNorm.includes(vPrefix) || (vPrefix.length >= 3 && whNorm.slice(0, 5).includes(vPrefix.slice(0, 3)))) return true;
      return false;
    });

    const effectiveVehicles = whVehicles.length > 0
      ? whVehicles
      : (vehicles.length > 0 ? vehicles : [{ veiculo: "Estimada", capacidade_kg: 1200, capacidade_vol: 10 }]);

    const analytics = computeBigPictureAnalytics(whDeliveries, effectiveVehicles);

    let totalBoxes = 0;
    whDeliveries.forEach((d) => {
      const b = Number(d.Total_Cx) || (Number(d.Cx_Ambiente || 0) + Number(d.Cx_Frio || 0) + Number(d.Cx_Congelado || 0)) || 0;
      totalBoxes += b;
    });

    list.push({
      id: whId,
      name: whName,
      vehicles: whVehicles.map((v) => v.veiculo),
      deliveries: whDeliveries,
      totalDeliveries: whDeliveries.length,
      totalKg: analytics.totalKg,
      totalVol: analytics.totalVol,
      totalBoxes,
      analytics,
    });
  });

  return list.sort((a, b) => {
    const score = (st: string) => (st === "critical" ? 3 : st === "warning" ? 2 : 1);
    const scoreDiff = score(b.analytics.overallStatus) - score(a.analytics.overallStatus);
    if (scoreDiff !== 0) return scoreDiff;
    return b.totalDeliveries - a.totalDeliveries;
  });
}

// Retro-compatibilidade se algum componente ainda chamar computeZonalBigPictureAnalytics
export const computeZonalBigPictureAnalytics = computeWarehouseBigPictureAnalytics as any;

export interface BigPictureModalProps {
  isOpen: boolean;
  onClose: () => void;
  deliveries: BigPictureDelivery[];
  vehicles: BigPictureVehicle[];
  initialWarehouseId?: string;
  initialZoneId?: string; // backwards compatibility
  onSelectWarehouse?: (warehouseName: string) => void;
  onSelectZoneOnMap?: (zoneId: string) => void; // backwards compatibility
}

export default function BigPictureModal({
  isOpen,
  onClose,
  deliveries,
  vehicles,
  initialWarehouseId,
  initialZoneId,
  onSelectWarehouse,
  onSelectZoneOnMap,
}: BigPictureModalProps) {
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"summary" | "warehouses" | "am" | "pm" | "night" | "flexible">("summary");

  const warehouseStats = useMemo(() => {
    return computeWarehouseBigPictureAnalytics(deliveries, vehicles);
  }, [deliveries, vehicles]);

  useEffect(() => {
    const initTarget = initialWarehouseId || initialZoneId;
    if (initTarget && initTarget !== "all") {
      const match = warehouseStats.find(w => matchWarehouse(w.name, initTarget) || w.id === initTarget);
      if (match) {
        setSelectedWarehouseId(match.id);
      }
    }
  }, [initialWarehouseId, initialZoneId, isOpen, warehouseStats]);

  const activeWarehouseStat = useMemo(() => {
    if (selectedWarehouseId === "all") return null;
    return warehouseStats.find(w => w.id === selectedWarehouseId) || null;
  }, [warehouseStats, selectedWarehouseId]);

  const activeDeliveries = useMemo(() => {
    if (!activeWarehouseStat) return deliveries;
    return activeWarehouseStat.deliveries;
  }, [deliveries, activeWarehouseStat]);

  const activeVehicles = useMemo(() => {
    if (!activeWarehouseStat) return vehicles;
    const wVehs = vehicles.filter(v => activeWarehouseStat.vehicles.includes(v.veiculo));
    return wVehs.length > 0 ? wVehs : vehicles;
  }, [vehicles, activeWarehouseStat]);

  const analytics = useMemo(() => {
    return computeBigPictureAnalytics(activeDeliveries, activeVehicles);
  }, [activeDeliveries, activeVehicles]);

  if (!isOpen) return null;

  const { periods, criticalPeriod, overallStatus } = analytics;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-zinc-100">
        {/* CABEÇALHO EXECUTIVO */}
        <div className="p-4 border-b border-zinc-800/80 bg-zinc-900/80 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-lg border ${
              overallStatus === "critical"
                ? "bg-rose-950/70 border-rose-800 text-rose-400"
                : overallStatus === "warning"
                ? "bg-amber-950/70 border-amber-800 text-amber-400"
                : "bg-emerald-950/70 border-emerald-800 text-emerald-400"
            }`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold tracking-tight text-white">
                  Análise — Diagnóstico de Capacidade & Viabilidade
                </h2>
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                  overallStatus === "critical"
                    ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                    : overallStatus === "warning"
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                    : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                }`}>
                  {overallStatus === "critical" ? "Sobrecarga / Risco" : overallStatus === "warning" ? "Atenção" : "Viável & Equilibrado"}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Avaliação de afunilamento temporal por períodos (Manhã, Tarde, Noite) e balanço de carga por Armazém / Loja
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Seletor Rápido de Armazém / Loja */}
            <div className="flex items-center space-x-1.5 bg-zinc-900 border border-zinc-700/80 rounded-lg px-2.5 py-1 text-xs">
              <span className="text-[11px] text-zinc-400 font-bold shrink-0">Armazém / Loja:</span>
              <select
                value={selectedWarehouseId}
                onChange={(e) => {
                  setSelectedWarehouseId(e.target.value);
                  if (activeTab === "warehouses") setActiveTab("summary");
                }}
                className="bg-transparent text-white font-bold outline-none cursor-pointer max-w-[210px] truncate"
              >
                <option value="all" className="bg-zinc-900 text-white">
                  🏬 Todos os Armazéns ({deliveries.length} entregas • {vehicles.length}v)
                </option>
                {warehouseStats.map((w) => (
                  <option key={w.id} value={w.id} className="bg-zinc-900 text-white">
                    🏬 {w.name} ({w.totalDeliveries}p • {w.vehicles.length}v)
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={onClose}
              className="cursor-pointer p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors"
              title="Fechar Diagnóstico"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* BANNER DE ALERTA EXECUTIVO */}
        <div className={`p-3.5 border-b text-xs flex items-start space-x-3 ${
          overallStatus === "critical"
            ? "bg-rose-950/40 border-rose-900/60 text-rose-200"
            : overallStatus === "warning"
            ? "bg-amber-950/40 border-amber-900/60 text-amber-200"
            : "bg-emerald-950/40 border-emerald-900/60 text-emerald-200"
        }`}>
          <span className="text-base mt-[-2px]">
            {overallStatus === "critical" ? "🚨" : overallStatus === "warning" ? "⚠️" : "✅"}
          </span>
          <div className="flex-1">
            <span className="font-semibold">{analytics.summaryMessage}</span>
            {criticalPeriod && criticalPeriod.deficitVehicles > 0 && (
              <p className="mt-1 text-[11px] opacity-90">
                👉 <strong>Sugestão Operacional:</strong> Adicionar <strong>{criticalPeriod.deficitVehicles} viatura(s)</strong> de reforço ou negociar com <strong>~{criticalPeriod.deficitStops} clientes</strong> a transferência da janela de <em>{criticalPeriod.label}</em> para outro período menos concorrido.
              </p>
            )}
          </div>
          {analytics.recommendedVehicles > analytics.totalVehicles && (
            <div className="bg-zinc-900/90 border border-zinc-700/80 px-2.5 py-1.5 rounded-lg text-center shrink-0">
              <span className="text-[10px] text-zinc-400 uppercase font-bold block">Frota Ideal</span>
              <span className="text-sm font-extrabold text-amber-400">
                {analytics.recommendedVehicles} viaturas
              </span>
              <span className="text-[10px] text-zinc-500 block">
                (atual: {analytics.totalVehicles})
              </span>
            </div>
          )}
        </div>

        {/* NAVEGAÇÃO DE TABS */}
        <div className="flex border-b border-zinc-800 bg-zinc-900/40 px-4 text-xs font-medium overflow-x-auto">
          <button
            onClick={() => setActiveTab("summary")}
            className={`cursor-pointer py-2.5 px-3 border-b-2 font-semibold transition-colors flex items-center space-x-1.5 shrink-0 ${
              activeTab === "summary"
                ? "border-indigo-500 text-indigo-400 bg-zinc-800/40"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span>📊 Visão Geral & Métricas</span>
          </button>
          <button
            onClick={() => setActiveTab("warehouses")}
            className={`cursor-pointer py-2.5 px-3 border-b-2 font-semibold transition-colors flex items-center space-x-1.5 shrink-0 ${
              activeTab === "warehouses"
                ? "border-indigo-500 text-indigo-400 bg-zinc-800/40"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span>🏬 Por Armazém / Loja</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              {warehouseStats.length} Lojas
            </span>
          </button>
          <button
            onClick={() => setActiveTab("am")}
            className={`cursor-pointer py-2.5 px-3 border-b-2 transition-colors flex items-center space-x-1.5 ${
              activeTab === "am"
                ? "border-indigo-500 text-indigo-400 bg-zinc-800/40"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span>🌅 Manhã (AM)</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
              periods.am.status === "critical"
                ? "bg-rose-500/20 text-rose-300"
                : periods.am.status === "warning"
                ? "bg-amber-500/20 text-amber-300"
                : "bg-zinc-800 text-zinc-300"
            }`}>
              {periods.am.count}
            </span>
          </button>
          <button
            onClick={() => setActiveTab("pm")}
            className={`cursor-pointer py-2.5 px-3 border-b-2 transition-colors flex items-center space-x-1.5 ${
              activeTab === "pm"
                ? "border-indigo-500 text-indigo-400 bg-zinc-800/40"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span>🌆 Tarde (PM)</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
              periods.pm.status === "critical"
                ? "bg-rose-500/20 text-rose-300"
                : periods.pm.status === "warning"
                ? "bg-amber-500/20 text-amber-300"
                : "bg-zinc-800 text-zinc-300"
            }`}>
              {periods.pm.count}
            </span>
          </button>
          <button
            onClick={() => setActiveTab("night")}
            className={`cursor-pointer py-2.5 px-3 border-b-2 transition-colors flex items-center space-x-1.5 ${
              activeTab === "night"
                ? "border-indigo-500 text-indigo-400 bg-zinc-800/40"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span>🌙 Pós-Laboral</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-zinc-800 text-zinc-300">
              {periods.night.count}
            </span>
          </button>
          <button
            onClick={() => setActiveTab("flexible")}
            className={`cursor-pointer py-2.5 px-3 border-b-2 transition-colors flex items-center space-x-1.5 ${
              activeTab === "flexible"
                ? "border-indigo-500 text-indigo-400 bg-zinc-800/40"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span>🔄 Flexíveis</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-zinc-800 text-zinc-300">
              {periods.flexible.count}
            </span>
          </button>
        </div>

        {/* CORPO DO MODAL */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {/* TAB: VISÃO GERAL */}
          {activeTab === "summary" && (
            <div className="space-y-4">
              {/* Contexto do Armazém Selecionado */}
              {activeWarehouseStat && (
                <div className="bg-indigo-950/30 border border-indigo-800/60 rounded-xl p-3 flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2">
                    <span className="text-base">🏬</span>
                    <div>
                      <span className="font-bold text-white text-sm">
                        {activeWarehouseStat.name}
                      </span>
                      <span className="text-zinc-400 text-[11px] block">
                        A analisar isoladamente as {activeWarehouseStat.deliveries.length} entregas e {activeWarehouseStat.vehicles.length} viaturas desta loja
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedWarehouseId("all")}
                    className="text-indigo-300 hover:text-white px-2.5 py-1 rounded bg-indigo-900/50 hover:bg-indigo-800 transition-colors font-medium cursor-pointer"
                  >
                    Ver Todos os Armazéns
                  </button>
                </div>
              )}

              {/* 1. BALANÇO TEMPORAL */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                  1. Balanço Temporal da Procura vs. Capacidade da Frota
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  {[periods.am, periods.pm, periods.night, periods.flexible].map((p) => {
                    const isCritical = p.status === "critical";
                    const isWarning = p.status === "warning";
                    const isSurplus = p.status === "surplus";

                    return (
                      <div
                        key={p.id}
                        onClick={() => setActiveTab(p.id)}
                        className={`p-3 rounded-lg border transition-all cursor-pointer ${
                          isCritical
                            ? "bg-rose-950/30 border-rose-800 hover:bg-rose-900/40"
                            : isWarning
                            ? "bg-amber-950/30 border-amber-800 hover:bg-amber-900/40"
                            : isSurplus
                            ? "bg-sky-950/30 border-sky-800 hover:bg-sky-900/40"
                            : "bg-zinc-900/60 border-zinc-800 hover:bg-zinc-850"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-xs text-white">{p.label}</span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                            isCritical
                              ? "bg-rose-500/20 text-rose-300"
                              : isWarning
                              ? "bg-amber-500/20 text-amber-300"
                              : isSurplus
                              ? "bg-sky-500/20 text-sky-300"
                              : "bg-emerald-500/20 text-emerald-300"
                          }`}>
                            {isCritical ? "Défice" : isWarning ? "Limite" : isSurplus ? "Folga" : "Equilibrado"}
                          </span>
                        </div>
                        <span className="text-[10px] text-zinc-400 block mt-0.5">{p.timeRange}</span>

                        <div className="mt-3 flex items-baseline justify-between">
                          <span className="text-xl font-bold text-white">
                            {p.count} <span className="text-xs font-normal text-zinc-400">entregas</span>
                          </span>
                          <span className="text-xs font-mono font-bold text-zinc-400">{p.pct}%</span>
                        </div>

                        {p.id !== "flexible" && (
                          <div className="mt-2 text-[10px] text-zinc-400 flex items-center justify-between">
                            <span>Capacidade: ~{p.fleetCapacityStops}</span>
                            <span className={isCritical ? "text-rose-400 font-bold" : isWarning ? "text-amber-400 font-bold" : "text-emerald-400"}>
                              {isCritical ? `-${p.deficitStops} vagas` : isWarning ? `-${p.deficitStops} vagas` : "OK"}
                            </span>
                          </div>
                        )}

                        <div className="w-full bg-zinc-800 rounded-full h-1 mt-2 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              isCritical ? "bg-rose-500" : isWarning ? "bg-amber-400" : "bg-indigo-500"
                            }`}
                            style={{ width: `${Math.min(100, p.fleetCapacityStops > 0 ? (p.count / p.fleetCapacityStops) * 100 : 0)}%` }}
                          />
                        </div>

                        <div className="mt-2 pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[10px] text-zinc-400">
                          <span>{p.totalKg.toLocaleString("pt-PT")} kg</span>
                          <span>{p.totalVol.toFixed(1)} m³</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 2. BALANÇO FÍSICO */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                  2. Balanço Físico da Carga (Frota Disponível: {analytics.totalVehicles} Viaturas)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Ocupação em Peso */}
                  <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-zinc-300">⚖️ Peso Total de Mercadoria</span>
                      <span className={`font-mono font-bold ${
                        analytics.weightOccupancyPct > 100 ? "text-rose-400" : "text-emerald-400"
                      }`}>
                        {analytics.weightOccupancyPct}% da capacidade
                      </span>
                    </div>
                    <div className="mt-2 flex items-baseline justify-between text-xs">
                      <span className="text-lg font-bold text-white">
                        {analytics.totalKg.toLocaleString("pt-PT")} <span className="text-xs font-normal text-zinc-400">kg a entregar</span>
                      </span>
                      <span className="text-xs text-zinc-400">
                        Capacidade Frota: {analytics.fleetMaxKg.toLocaleString("pt-PT")} kg
                      </span>
                    </div>
                    <div className="w-full bg-zinc-800 rounded-full h-2 mt-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          analytics.weightOccupancyPct > 100
                            ? "bg-rose-500"
                            : analytics.weightOccupancyPct > 85
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                        }`}
                        style={{ width: `${Math.min(100, analytics.weightOccupancyPct)}%` }}
                      />
                    </div>
                    {analytics.weightOccupancyPct > 100 && (
                      <p className="text-[11px] text-rose-400 mt-2">
                        ⚠️ O peso total excede a carga máxima combinada dos veículos. É mandatória a realização de 2ª voltas ou viaturas de reforço.
                      </p>
                    )}
                  </div>

                  {/* Ocupação em Volume / Caixas */}
                  <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-zinc-300">
                        {analytics.totalBoxes > 0 ? "📦 Caixas & Volume Cúbico" : "📦 Volume Cúbico Total"}
                      </span>
                      <span className={`font-mono font-bold ${
                        analytics.volOccupancyPct > 100 ? "text-rose-400" : "text-emerald-400"
                      }`}>
                        {analytics.volOccupancyPct}% da capacidade
                      </span>
                    </div>
                    <div className="mt-2 flex items-baseline justify-between text-xs">
                      <span className="text-lg font-bold text-white">
                        {analytics.totalBoxes > 0 ? `${analytics.totalBoxes} Cx` : `${analytics.totalVol.toFixed(1)} m³`}{" "}
                        <span className="text-xs font-normal text-zinc-400">
                          {analytics.totalBoxes > 0 ? `(${analytics.totalVol.toFixed(1)} m³)` : "a entregar"}
                        </span>
                      </span>
                      <span className="text-xs text-zinc-400">
                        Capacidade Frota: {analytics.fleetMaxVol.toFixed(1)} m³
                      </span>
                    </div>
                    <div className="w-full bg-zinc-800 rounded-full h-2 mt-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          analytics.volOccupancyPct > 100
                            ? "bg-rose-500"
                            : analytics.volOccupancyPct > 85
                            ? "bg-amber-500"
                            : "bg-indigo-500"
                        }`}
                        style={{ width: `${Math.min(100, analytics.volOccupancyPct)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. RECOMENDAÇÃO TÁTICA */}
              <div className="bg-indigo-950/20 border border-indigo-900/40 rounded-lg p-3 text-xs text-zinc-300">
                <span className="font-bold text-indigo-300 block mb-1">
                  💡 Como o Gestor de Tráfego pode atuar antes do Solver:
                </span>
                <ul className="list-disc list-inside space-y-1 text-zinc-400 text-[11px]">
                  <li>
                    Se tiver um período em <strong>vermelho (défice)</strong> e outro em <strong>azul (folga)</strong>, consulte a lista de clientes desse período e tente contactar alguns clientes flexíveis para acordar a entrega na slot alternativa.
                  </li>
                  <li>
                    Se o peso total estiver acima de 100%, certifique-se de que a opção de <strong>2ª Volta</strong> está ativa na Frota para permitir recargas ao depósito durante a tarde.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* TAB: ESTRUTURA POR ARMAZÉM / LOJA */}
          {activeTab === "warehouses" && (
            <div className="space-y-4">
              {/* Header de Resumo por Armazém */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
                  <span className="text-[10px] uppercase font-bold text-zinc-400 block">Lojas Mapeadas</span>
                  <span className="text-xl font-extrabold text-white">{warehouseStats.length}</span>
                  <span className="text-[10px] text-zinc-500 block">centros de distribuição</span>
                </div>
                <div className="bg-rose-950/20 border border-rose-900/40 rounded-xl p-3">
                  <span className="text-[10px] uppercase font-bold text-rose-400 block">Lojas Críticas</span>
                  <span className="text-xl font-extrabold text-rose-300">
                    {warehouseStats.filter(w => w.analytics.overallStatus === "critical").length}
                  </span>
                  <span className="text-[10px] text-rose-400/80 block">com défice de frota no pico</span>
                </div>
                <div className="bg-amber-950/20 border border-amber-900/40 rounded-xl p-3">
                  <span className="text-[10px] uppercase font-bold text-amber-400 block">Lojas em Atenção</span>
                  <span className="text-xl font-extrabold text-amber-300">
                    {warehouseStats.filter(w => w.analytics.overallStatus === "warning").length}
                  </span>
                  <span className="text-[10px] text-amber-400/80 block">limite de carga / janelas</span>
                </div>
                <div className="bg-emerald-950/20 border border-emerald-900/40 rounded-xl p-3">
                  <span className="text-[10px] uppercase font-bold text-emerald-400 block">Lojas Equilibradas</span>
                  <span className="text-xl font-extrabold text-emerald-300">
                    {warehouseStats.filter(w => w.analytics.overallStatus === "balanced").length}
                  </span>
                  <span className="text-[10px] text-emerald-400/80 block">100% viáveis com a frota</span>
                </div>
              </div>

              {/* Lista de Cards de Armazéns / Lojas */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-zinc-400 font-bold uppercase tracking-wider">
                  <span>Diagnóstico Individual por Armazém / Loja</span>
                  <span>{warehouseStats.length} Lojas</span>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {warehouseStats.map((wh) => {
                    const st = wh.analytics.overallStatus;
                    const amCount = wh.analytics.periods.am.count;
                    const pmCount = wh.analytics.periods.pm.count;
                    const nightCount = wh.analytics.periods.night.count;
                    const flexCount = wh.analytics.periods.flexible.count;
                    const totalStops = Math.max(1, wh.deliveries.length);

                    return (
                      <div
                        key={wh.id}
                        className={`bg-zinc-900/70 border rounded-xl p-4 transition-all ${
                          st === "critical"
                            ? "border-rose-800/80 hover:border-rose-700 bg-rose-950/10"
                            : st === "warning"
                            ? "border-amber-800/80 hover:border-amber-700 bg-amber-950/10"
                            : "border-zinc-800 hover:border-zinc-700"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-2.5">
                          <div className="flex items-center space-x-2.5">
                            <span className="text-lg">🏬</span>
                            <div>
                              <div className="flex items-center space-x-2">
                                <h4 className="font-bold text-sm text-white">{wh.name}</h4>
                                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                                  st === "critical"
                                    ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                                    : st === "warning"
                                    ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                                    : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                }`}>
                                  {st === "critical" ? "Sobrecarga / Risco" : st === "warning" ? "Atenção" : "Viável & Equilibrado"}
                                </span>
                              </div>
                              <span className="text-[11px] text-zinc-400 block mt-0.5">
                                {wh.deliveries.length} paragens • {wh.vehicles.length} viaturas alocadas
                                {wh.totalBoxes > 0 ? ` • ${wh.totalBoxes} caixas` : ""}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedWarehouseId(wh.id);
                                setActiveTab("summary");
                              }}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer flex items-center space-x-1.5 shadow-sm"
                            >
                              <span>🔍 Analisar Este Armazém</span>
                            </button>
                            {onSelectWarehouse && (
                              <button
                                type="button"
                                onClick={() => {
                                  onSelectWarehouse(wh.name);
                                  onClose();
                                }}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                                title="Filtrar ecra tatico para esta loja"
                              >
                                Filtrar Ecrã
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Indicadores do Armazém */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3 text-[11px]">
                          <div className="bg-zinc-950/60 rounded-lg p-2.5 border border-zinc-800/80">
                            <span className="text-[10px] text-zinc-400 block uppercase font-bold">Entregas</span>
                            <span className="text-sm font-bold text-white mt-0.5 block">{wh.deliveries.length}</span>
                            <span className="text-[10px] text-zinc-500">encomendas</span>
                          </div>

                          <div className="bg-zinc-950/60 rounded-lg p-2.5 border border-zinc-800/80">
                            <span className="text-[10px] text-zinc-400 block uppercase font-bold">Carga & Frota</span>
                            <span className="text-sm font-bold text-white mt-0.5 block">
                              {wh.totalKg.toLocaleString("pt-PT")} kg
                            </span>
                            <span className={`text-[10px] font-mono font-bold ${
                              wh.analytics.weightOccupancyPct > 100 ? "text-rose-400" : "text-emerald-400"
                            }`}>
                              {wh.analytics.weightOccupancyPct}% da capacidade
                            </span>
                          </div>

                          <div className="bg-zinc-950/60 rounded-lg p-2.5 border border-zinc-800/80 sm:col-span-2">
                            <div className="flex items-center justify-between text-zinc-400 mb-1">
                              <span className="text-[10px] uppercase font-bold">Proporção Horária (AM / PM / Noite)</span>
                              <span className="font-mono text-[10px]">
                                AM: {amCount} | PM: {pmCount}
                              </span>
                            </div>
                            <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden flex">
                              <div style={{ width: `${(amCount / totalStops) * 100}%` }} className="bg-sky-500 h-full" title={`Manhã: ${amCount}`} />
                              <div style={{ width: `${(pmCount / totalStops) * 100}%` }} className="bg-amber-500 h-full" title={`Tarde: ${pmCount}`} />
                              <div style={{ width: `${(nightCount / totalStops) * 100}%` }} className="bg-purple-500 h-full" title={`Noite: ${nightCount}`} />
                              <div style={{ width: `${(flexCount / totalStops) * 100}%` }} className="bg-zinc-500 h-full" title={`Flexível: ${flexCount}`} />
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-zinc-500 mt-1">
                              <span className="text-sky-400">🌅 Manhã: {amCount}</span>
                              <span className="text-amber-400">🌆 Tarde: {pmCount}</span>
                              <span className="text-purple-400">🌙 Noite: {nightCount}</span>
                              <span>🔄 Flex: {flexCount}</span>
                            </div>
                          </div>
                        </div>

                        {wh.analytics.criticalPeriod && wh.analytics.criticalPeriod.deficitVehicles > 0 && (
                          <div className="mt-2.5 p-2 rounded-lg bg-rose-950/30 border border-rose-900/50 text-[11px] text-rose-300 flex items-center justify-between">
                            <span>
                              ⚠️ Défice no período {wh.analytics.criticalPeriod.label}: faltam ~{wh.analytics.criticalPeriod.deficitVehicles} viatura(s) para {wh.analytics.criticalPeriod.count} entregas.
                            </span>
                            <span className="font-bold text-rose-200">
                              Frota ideal: {wh.analytics.recommendedVehicles}v (alocadas: {wh.vehicles.length}v)
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB: LISTAGEM DETALHADA DE CLIENTES POR PERÍODO */}
          {["am", "pm", "night", "flexible"].includes(activeTab) && (() => {
            const periodKey = activeTab as "am" | "pm" | "night" | "flexible";
            const currentPeriod = periods[periodKey];

            return (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                      <span>{currentPeriod.label}</span>
                      <span className="text-xs text-zinc-400 font-normal">({currentPeriod.timeRange})</span>
                    </h3>
                    <p className="text-xs text-zinc-400">
                      {currentPeriod.count} paragens classificadas neste período
                      {activeWarehouseStat ? ` para a loja ${activeWarehouseStat.name}` : ""}
                    </p>
                  </div>
                  <span className={`text-xs font-bold px-2 py-1 rounded border ${
                    currentPeriod.status === "critical"
                      ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                      : currentPeriod.status === "warning"
                      ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                      : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                  }`}>
                    {currentPeriod.status === "critical"
                      ? `Défice de ${currentPeriod.deficitStops} paragens`
                      : currentPeriod.status === "warning"
                      ? `Limite de frota atingido`
                      : "Capacidade Segura"}
                  </span>
                </div>

                <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-900/40">
                  <div className="max-h-96 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-zinc-850 text-zinc-400 font-semibold sticky top-0 border-b border-zinc-800">
                        <tr>
                          <th className="p-2.5">Cliente / Nome</th>
                          <th className="p-2.5">Armazém / Loja</th>
                          <th className="p-2.5">Janela Horária</th>
                          <th className="p-2.5">Morada / Localidade</th>
                          <th className="p-2.5 text-right">Peso (kg)</th>
                          <th className="p-2.5 text-right">Caixas</th>
                          <th className="p-2.5 text-right">Rota Atribuída</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/60 font-mono">
                        {currentPeriod.deliveries.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-6 text-center text-zinc-500 font-sans">
                              Nenhuma entrega classificada neste período.
                            </td>
                          </tr>
                        ) : (
                          currentPeriod.deliveries.map((d, idx) => (
                            <tr key={idx} className="hover:bg-zinc-800/40 transition-colors">
                              <td className="p-2.5 text-zinc-200 font-sans">
                                <span className="font-bold text-white block">{d.Nome_Cliente || d.Cliente || "Sem Nome"}</span>
                                <span className="text-[10px] text-zinc-400 font-mono">{d.Doc_ID || d.Cliente}</span>
                              </td>
                              <td className="p-2.5 text-zinc-300 font-sans text-[11px]">
                                {d.Armazem || "—"}
                              </td>
                              <td className="p-2.5 text-amber-300 font-bold">
                                {d.Janela_Horaria || (d.Janela_Inicio && d.Janela_Fim ? `${d.Janela_Inicio}-${d.Janela_Fim}` : "Flexível")}
                              </td>
                              <td className="p-2.5 text-zinc-400 font-sans text-[11px] truncate max-w-[200px]">
                                {d.Morada ? `${d.Morada}, ` : ""}{d.Localidade || ""}
                              </td>
                              <td className="p-2.5 text-right text-zinc-300">
                                {d.Peso_KG ? Number(d.Peso_KG).toLocaleString("pt-PT") : "0"}
                              </td>
                              <td className="p-2.5 text-right text-zinc-300">
                                {d.Total_Cx || (Number(d.Cx_Ambiente || 0) + Number(d.Cx_Frio || 0) + Number(d.Cx_Congelado || 0)) || "—"}
                              </td>
                              <td className="p-2.5 text-right">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  !d.Rota || d.Rota === "Por Distribuir"
                                    ? "bg-amber-500/20 text-amber-300"
                                    : "bg-indigo-500/20 text-indigo-300"
                                }`}>
                                  {d.Rota || "Por Distribuir"}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* RODAPÉ DO MODAL */}
        <div className="p-3 border-t border-zinc-800 bg-zinc-900/60 flex items-center justify-between text-xs text-zinc-400">
          <span>
            Total de {activeDeliveries.length} paragens analisadas contra {activeVehicles.length} viaturas disponíveis
            {activeWarehouseStat ? ` (${activeWarehouseStat.name})` : ""}.
          </span>
          <button
            onClick={onClose}
            className="cursor-pointer bg-zinc-800 hover:bg-zinc-700 text-white font-medium px-4 py-1.5 rounded-lg transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
