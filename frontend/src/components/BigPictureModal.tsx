"use client";

import React, { useMemo, useState, useEffect } from "react";
import { parseWindowStartEnd, normalizeLocality } from "@/utils/geoNormalize";

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
  Morada?: string;
  Localidade?: string;
}

export interface BigPictureVehicle {
  veiculo: string;
  armazem?: string;
  capacidade_kg?: number;
  capacidade_vol?: number;
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

/**
 * Motor de diagnóstico executivo de capacidade temporal e física (The Big Picture).
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
  deliveries.forEach((d) => {
    totalKg += Number(d.Peso_KG) || 0;
    totalVol += Number(d.Volume_m3) || 0;
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

    const startH = parsed.start / 60;
    const endH = parsed.end / 60;
    const durationH = endH - startH;

    // Se a janela for ampla (>= 7 horas), consideramos flexível para o dia todo
    if (durationH >= 7) {
      flexibleDeliveries.push(d);
      return;
    }

    // Pós-Laboral / Noite: Início às 18:00 ou mais tarde
    if (startH >= 18.0) {
      nightDeliveries.push(d);
    }
    // Tarde (PM): Início a partir das 12:30 ou término exclusivo à tarde (início >= 12h e fim <= 19h)
    else if (startH >= 12.5) {
      pmDeliveries.push(d);
    }
    // Manhã (AM): Término até às 13:30 (ex: 08:00-12:00, 09:00-13:00)
    else if (endH <= 13.5) {
      amDeliveries.push(d);
    }
    // Janelas que cruzam o almoço com foco vespertino
    else if (startH >= 11.0 && endH >= 16.0) {
      pmDeliveries.push(d);
    }
    // Caso padrão matinal
    else {
      amDeliveries.push(d);
    }
  });

  // Capacidade estimada por viatura em cada período (considerando paragem média de 25 min incluindo trânsito)
  // Turno Matinal: ~4.5h -> ~9 paragens por viatura
  // Turno Vespertino: ~4.5h -> ~9 paragens por viatura
  // Turno Noturno: ~2.5h -> ~5 paragens por viatura
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
    list: BigPictureDelivery[],
    cap: number,
    perVehStops: number
  ): TimePeriodStat => {
    const count = list.length;
    const pct = totalDeliveries > 0 ? Math.round((count / totalDeliveries) * 100) : 0;
    const kg = list.reduce((sum, item) => sum + (Number(item.Peso_KG) || 0), 0);
    const vol = list.reduce((sum, item) => sum + (Number(item.Volume_m3) || 0), 0);

    const deficitStops = Math.max(0, count - cap);
    const deficitVehicles = deficitStops > 0 ? Math.ceil(deficitStops / perVehStops) : 0;

    let status: "surplus" | "balanced" | "warning" | "critical" = "balanced";
    if (id === "flexible") {
      status = "balanced";
    } else {
      const ratio = cap > 0 ? count / cap : 0;
      if (ratio > 1.25) status = "critical";
      else if (ratio > 1.0) status = "warning";
      else if (ratio < 0.6) status = "surplus";
      else status = "balanced";
    }

    return {
      id,
      label,
      timeRange,
      count,
      pct,
      totalKg: Math.round(kg),
      totalVol: Number(vol.toFixed(1)),
      fleetCapacityStops: cap,
      deficitStops,
      deficitVehicles,
      status,
      deliveries: list,
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

  // Cálculo da frota recomendada
  // A frota deve cobrir tanto o pico temporal mais crítico como o peso físico
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

export interface ZoneBigPictureStat {
  id: string;
  name: string;
  dominantLocality: string;
  vehicles: string[];
  deliveries: BigPictureDelivery[];
  analytics: BigPictureAnalysis;
}

/**
 * Agrupa as entregas e viaturas por Zonas Territoriais e executa a análise
 * Big Picture individualizada para cada zona ("The Big Picture em Estrutura").
 */
export function computeZonalBigPictureAnalytics(
  deliveries: BigPictureDelivery[],
  vehicles: BigPictureVehicle[]
): ZoneBigPictureStat[] {
  const zoneGroups = new Map<string, BigPictureDelivery[]>();

  deliveries.forEach((d) => {
    const loc = normalizeLocality(d.Localidade, (d as any).CP || (d as any).Codigo_Postal);
    if (!zoneGroups.has(loc)) {
      zoneGroups.set(loc, []);
    }
    zoneGroups.get(loc)!.push(d);
  });

  const zones: ZoneBigPictureStat[] = [];

  zoneGroups.forEach((zoneDeliveries, locKey) => {
    const zoneId = `zone_${locKey.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
    const displayName = locKey === "GERAL" 
      ? "Geral / Mista" 
      : `Zona ${locKey.charAt(0) + locKey.slice(1).toLowerCase()}`;

    // Viaturas que têm paragens nesta zona
    const zoneVehicleNames = Array.from(new Set(
      zoneDeliveries
        .map(d => d.Rota)
        .filter(r => r && r !== "Por Distribuir" && !r.includes("Pendente"))
    )) as string[];

    // Veículos correspondentes da frota
    const zoneVehicles = vehicles.filter(v => zoneVehicleNames.includes(v.veiculo));

    // Se nenhuma viatura estiver atribuída nesta zona, estimar com base na capacidade padrão
    const effectiveVehicles = zoneVehicles.length > 0
      ? zoneVehicles
      : (vehicles.length > 0 ? vehicles.slice(0, 1) : [{ veiculo: "Estimada", capacidade_kg: 1200, capacidade_vol: 10 }]);

    const analytics = computeBigPictureAnalytics(zoneDeliveries, effectiveVehicles);

    zones.push({
      id: zoneId,
      name: displayName,
      dominantLocality: locKey,
      vehicles: zoneVehicleNames,
      deliveries: zoneDeliveries,
      analytics,
    });
  });

  // Ordenar por criticidade e depois por volume de entregas
  return zones.sort((a, b) => {
    const score = (st: string) => (st === "critical" ? 3 : st === "warning" ? 2 : 1);
    const scoreDiff = score(b.analytics.overallStatus) - score(a.analytics.overallStatus);
    if (scoreDiff !== 0) return scoreDiff;
    return b.deliveries.length - a.deliveries.length;
  });
}

export interface BigPictureModalProps {
  isOpen: boolean;
  onClose: () => void;
  deliveries: BigPictureDelivery[];
  vehicles: BigPictureVehicle[];
  initialZoneId?: string;
  onSelectZoneOnMap?: (zoneId: string) => void;
}

export default function BigPictureModal({
  isOpen,
  onClose,
  deliveries,
  vehicles,
  initialZoneId = "all",
  onSelectZoneOnMap,
}: BigPictureModalProps) {
  const [selectedZoneId, setSelectedZoneId] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"summary" | "zones" | "am" | "pm" | "night" | "flexible">("summary");

  useEffect(() => {
    if (initialZoneId) {
      setSelectedZoneId(initialZoneId);
    }
  }, [initialZoneId, isOpen]);

  const zonalStats = useMemo(() => {
    return computeZonalBigPictureAnalytics(deliveries, vehicles);
  }, [deliveries, vehicles]);

  const activeZoneStat = useMemo(() => {
    if (selectedZoneId === "all") return null;
    return zonalStats.find(z => z.id === selectedZoneId) || null;
  }, [zonalStats, selectedZoneId]);

  const activeDeliveries = useMemo(() => {
    if (!activeZoneStat) return deliveries;
    return activeZoneStat.deliveries;
  }, [deliveries, activeZoneStat]);

  const activeVehicles = useMemo(() => {
    if (!activeZoneStat) return vehicles;
    const zVehs = vehicles.filter(v => activeZoneStat.vehicles.includes(v.veiculo));
    return zVehs.length > 0 ? zVehs : vehicles.slice(0, 1);
  }, [vehicles, activeZoneStat]);

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
                  The Big Picture — Diagnóstico Executivo de Capacidade & Viabilidade
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
                Avaliação de afunilamento temporal por períodos (Manhã, Tarde, Noite) e balanço de carga física
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Seletor Rápido de Território / Zona */}
            <div className="flex items-center space-x-1.5 bg-zinc-900 border border-zinc-700/80 rounded-lg px-2.5 py-1 text-xs">
              <span className="text-[11px] text-zinc-400 font-bold shrink-0">Território:</span>
              <select
                value={selectedZoneId}
                onChange={(e) => {
                  setSelectedZoneId(e.target.value);
                  if (activeTab === "zones") setActiveTab("summary");
                }}
                className="bg-transparent text-white font-bold outline-none cursor-pointer max-w-[190px] truncate"
              >
                <option value="all" className="bg-zinc-900 text-white">
                  🌐 Todas as Zonas ({deliveries.length} entregas)
                </option>
                {zonalStats.map((z) => (
                  <option key={z.id} value={z.id} className="bg-zinc-900 text-white">
                    📍 {z.name} ({z.deliveries.length}p · {z.vehicles.length}v)
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
            {overallStatus === "critical" ? "⚠️" : overallStatus === "warning" ? "⚡" : "✅"}
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
            onClick={() => setActiveTab("zones")}
            className={`cursor-pointer py-2.5 px-3 border-b-2 font-semibold transition-colors flex items-center space-x-1.5 shrink-0 ${
              activeTab === "zones"
                ? "border-indigo-500 text-indigo-400 bg-zinc-800/40"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span>🗺️ Estrutura por Zonas</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              {zonalStats.length} Zonas
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
            <span>🌇 Tarde (PM)</span>
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
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-300">
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
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-300">
              {periods.flexible.count}
            </span>
          </button>
        </div>

        {/* CONTEÚDO PRINCIPAL (COM SCROLL) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* BANNER DE FOCO TERRITORIAL ATIVO */}
          {selectedZoneId !== "all" && activeZoneStat && (
            <div className="bg-indigo-950/40 border border-indigo-800/80 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs text-indigo-200">
              <div className="flex items-center space-x-2">
                <span className="px-2.5 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30">
                  📍 Foco Ativo: {activeZoneStat.name}
                </span>
                <span className="text-zinc-300 font-medium">
                  {activeDeliveries.length} entregas · {activeVehicles.length} {activeVehicles.length === 1 ? "viatura" : "viaturas"} ({activeVehicles.map(v => v.veiculo).join(", ")})
                </span>
              </div>
              <div className="flex items-center space-x-2">
                {onSelectZoneOnMap && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectZoneOnMap(selectedZoneId);
                      onClose();
                    }}
                    className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg transition cursor-pointer text-xs flex items-center space-x-1 shadow-xs"
                  >
                    <span>🗺️ Focar no Mapa</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedZoneId("all")}
                  className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg transition cursor-pointer text-xs font-semibold"
                >
                  Ver Global ✕
                </button>
              </div>
            </div>
          )}

          {activeTab === "summary" && (
            <div className="space-y-4">
              {/* CARTÕES DE PERÍODO TEMPORAL (OS 4 PILARES) */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                  1. Balanço Temporal da Procura vs. Capacidade da Frota
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  {[periods.am, periods.pm, periods.night, periods.flexible].map((p) => {
                    const isCrit = p.status === "critical";
                    const isWarn = p.status === "warning";
                    const isSurplus = p.status === "surplus";

                    return (
                      <div
                        key={p.id}
                        onClick={() => setActiveTab(p.id)}
                        className={`cursor-pointer rounded-lg p-3 border transition-all hover:border-zinc-500 ${
                          isCrit
                            ? "bg-rose-950/20 border-rose-800/70"
                            : isWarn
                            ? "bg-amber-950/20 border-amber-800/70"
                            : "bg-zinc-900/60 border-zinc-800"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-zinc-200">{p.label}</span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            isCrit
                              ? "bg-rose-500/20 text-rose-300"
                              : isWarn
                              ? "bg-amber-500/20 text-amber-300"
                              : isSurplus
                              ? "bg-indigo-500/20 text-indigo-300"
                              : "bg-emerald-500/20 text-emerald-300"
                          }`}>
                            {isCrit ? "Défice!" : isWarn ? "Limite" : isSurplus ? "Folga" : "Equilibrado"}
                          </span>
                        </div>
                        <span className="text-[10px] text-zinc-400 block mt-0.5">{p.timeRange}</span>

                        <div className="mt-2.5 flex items-baseline justify-between">
                          <div>
                            <span className="text-xl font-extrabold text-white">{p.count}</span>
                            <span className="text-xs text-zinc-400 ml-1">entregas</span>
                          </div>
                          <span className="text-xs font-mono text-zinc-400 font-bold">{p.pct}%</span>
                        </div>

                        {/* Barra de Procura vs Capacidade */}
                        {p.id !== "flexible" && (
                          <div className="mt-2 text-[11px] space-y-1">
                            <div className="flex justify-between text-[10px] text-zinc-400 font-mono">
                              <span>Capacidade: ~{p.fleetCapacityStops}</span>
                              <span className={p.deficitStops > 0 ? "text-rose-400 font-bold" : "text-emerald-400"}>
                                {p.deficitStops > 0 ? `-${p.deficitStops} vts` : "OK"}
                              </span>
                            </div>
                            <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  isCrit ? "bg-rose-500" : isWarn ? "bg-amber-500" : "bg-indigo-500"
                                }`}
                                style={{
                                  width: `${Math.min(100, p.fleetCapacityStops > 0 ? (p.count / p.fleetCapacityStops) * 100 : 0)}%`,
                                }}
                              />
                            </div>
                          </div>
                        )}

                        <div className="mt-2 pt-2 border-t border-zinc-800/80 flex justify-between text-[10px] text-zinc-400">
                          <span>{p.totalKg.toLocaleString("pt-PT")} kg</span>
                          <span>{p.totalVol} m³</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* BALANÇO FÍSICO GLOBAL (PESO E VOLUME) */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                  2. Balanço Físico da Carga (Frota Disponível: {analytics.totalVehicles} viaturas)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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

                  {/* Ocupação em Volume */}
                  <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-zinc-300">📦 Volume Cúbico Total</span>
                      <span className={`font-mono font-bold ${
                        analytics.volOccupancyPct > 100 ? "text-rose-400" : "text-emerald-400"
                      }`}>
                        {analytics.volOccupancyPct}% da capacidade
                      </span>
                    </div>
                    <div className="mt-2 flex items-baseline justify-between text-xs">
                      <span className="text-lg font-bold text-white">
                        {analytics.totalVol.toFixed(1)} <span className="text-xs font-normal text-zinc-400">m³ a entregar</span>
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
                    {analytics.volOccupancyPct > 100 && (
                      <p className="text-[11px] text-rose-400 mt-2">
                        ⚠️ O volume cúbico ultrapassa o limite da frota. Algumas encomendas poderão requerer viaturas de maior porte.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* 3. RECOMENDAÇÃO TÁTICA ANTES DE OTIMIZAR */}
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

          {/* TAB: ESTRUTURA POR ZONAS TERRITORIAIS */}
          {activeTab === "zones" && (
            <div className="space-y-4">
              {/* Header de Resumo Zonal */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
                  <span className="text-[10px] uppercase font-bold text-zinc-400 block">Zonas Mapeadas</span>
                  <span className="text-xl font-extrabold text-white">{zonalStats.length}</span>
                  <span className="text-[10px] text-zinc-500 block">aglomerados territoriais</span>
                </div>
                <div className="bg-rose-950/20 border border-rose-900/40 rounded-xl p-3">
                  <span className="text-[10px] uppercase font-bold text-rose-400 block">Zonas Críticas</span>
                  <span className="text-xl font-extrabold text-rose-300">
                    {zonalStats.filter(z => z.analytics.overallStatus === "critical").length}
                  </span>
                  <span className="text-[10px] text-rose-400/80 block">com défice de frota no pico</span>
                </div>
                <div className="bg-amber-950/20 border border-amber-900/40 rounded-xl p-3">
                  <span className="text-[10px] uppercase font-bold text-amber-400 block">Zonas em Atenção</span>
                  <span className="text-xl font-extrabold text-amber-300">
                    {zonalStats.filter(z => z.analytics.overallStatus === "warning").length}
                  </span>
                  <span className="text-[10px] text-amber-400/80 block">limite de carga / janelas</span>
                </div>
                <div className="bg-emerald-950/20 border border-emerald-900/40 rounded-xl p-3">
                  <span className="text-[10px] uppercase font-bold text-emerald-400 block">Zonas Equilibradas</span>
                  <span className="text-xl font-extrabold text-emerald-300">
                    {zonalStats.filter(z => z.analytics.overallStatus === "balanced").length}
                  </span>
                  <span className="text-[10px] text-emerald-400/80 block">100% viáveis com a frota</span>
                </div>
              </div>

              {/* Lista Estruturada de Zonas */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs text-zinc-400 font-bold uppercase tracking-wider px-1">
                  <span>Diagnóstico Estruturado por Zona Territorial</span>
                  <span>{zonalStats.length} Zonas Ativas</span>
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  {zonalStats.map((z) => {
                    const isCrit = z.analytics.overallStatus === "critical";
                    const isWarn = z.analytics.overallStatus === "warning";
                    const isSelected = selectedZoneId === z.id;
                    const totalStops = z.deliveries.length;
                    const amCount = z.analytics.periods.am.count;
                    const pmCount = z.analytics.periods.pm.count;
                    const nightCount = z.analytics.periods.night.count;
                    const flexCount = z.analytics.periods.flexible.count;

                    return (
                      <div
                        key={z.id}
                        className={`rounded-xl border p-3.5 transition-all text-xs ${
                          isSelected
                            ? "bg-indigo-950/40 border-indigo-500 shadow-md shadow-indigo-500/10"
                            : isCrit
                            ? "bg-zinc-900/90 border-rose-900/60 hover:border-rose-700"
                            : isWarn
                            ? "bg-zinc-900/90 border-amber-900/60 hover:border-amber-700"
                            : "bg-zinc-900/90 border-zinc-800 hover:border-zinc-700"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-2">
                          <div className="flex items-center space-x-2">
                            <span className="text-base">📍</span>
                            <div>
                              <div className="flex items-center space-x-2">
                                <span className="font-extrabold text-white text-sm tracking-tight">{z.name}</span>
                                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                                  isCrit
                                    ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                                    : isWarn
                                    ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                                    : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                }`}>
                                  {isCrit ? "🔴 Sobrecarga no Pico" : isWarn ? "🟡 Atenção" : "🟢 Viável & Equilibrada"}
                                </span>
                              </div>
                              <span className="text-[11px] text-zinc-400">
                                Concelho Dominante: <strong className="text-zinc-200">{z.dominantLocality}</strong> · Frota: <strong className="text-indigo-300">{z.vehicles.join(", ") || "Sem rota fixa"}</strong> ({z.vehicles.length} {z.vehicles.length === 1 ? "viatura" : "viaturas"})
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedZoneId(z.id);
                                setActiveTab("summary");
                              }}
                              className="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 transition cursor-pointer flex items-center space-x-1"
                              title="Ver diagnóstico completo para esta zona"
                            >
                              <span>🔍</span>
                              <span>Analisar Detalhe</span>
                            </button>

                            {onSelectZoneOnMap && (
                              <button
                                type="button"
                                onClick={() => {
                                  onSelectZoneOnMap(z.id);
                                  onClose();
                                }}
                                className="px-2.5 py-1 rounded-lg text-xs font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition cursor-pointer flex items-center space-x-1"
                                title="Focar esta zona no mapa"
                              >
                                <span>🗺️</span>
                                <span>Focar no Mapa</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Indicadores Chave da Zona */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2.5 text-[11px]">
                          <div className="bg-zinc-950/60 rounded-lg p-2 border border-zinc-800/80">
                            <span className="text-zinc-500 block">Total Entregas</span>
                            <span className="text-white font-bold font-mono text-sm">{totalStops}</span>
                            <span className="text-zinc-500 block text-[10px]">clientes nesta zona</span>
                          </div>

                          <div className="bg-zinc-950/60 rounded-lg p-2 border border-zinc-800/80">
                            <span className="text-zinc-500 block">Carga & Capacidade</span>
                            <span className={`font-bold font-mono text-sm ${z.analytics.weightOccupancyPct > 100 ? "text-rose-400" : "text-white"}`}>
                              {z.analytics.totalKg.toLocaleString("pt-PT")} kg
                            </span>
                            <span className="text-zinc-400 block text-[10px] font-mono">
                              {z.analytics.weightOccupancyPct}% da frota ({z.analytics.totalVol.toFixed(1)} m³)
                            </span>
                          </div>

                          <div className="bg-zinc-950/60 rounded-lg p-2 border border-zinc-800/80 sm:col-span-2">
                            <div className="flex items-center justify-between text-zinc-400 mb-1">
                              <span>Mix Temporal (Janelas)</span>
                              <span className="font-mono text-zinc-300">
                                🌅 {amCount} · 🌇 {pmCount} · 🌙 {nightCount} · 🔄 {flexCount}
                              </span>
                            </div>
                            {/* Barra Empilhada Proporcional */}
                            <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden flex">
                              {totalStops > 0 && (
                                <>
                                  <div style={{ width: `${(amCount / totalStops) * 100}%` }} className="bg-sky-500 h-full" title={`Manhã: ${amCount}`} />
                                  <div style={{ width: `${(pmCount / totalStops) * 100}%` }} className="bg-amber-500 h-full" title={`Tarde: ${pmCount}`} />
                                  <div style={{ width: `${(nightCount / totalStops) * 100}%` }} className="bg-purple-500 h-full" title={`Pós-Laboral: ${nightCount}`} />
                                  <div style={{ width: `${(flexCount / totalStops) * 100}%` }} className="bg-zinc-500 h-full" title={`Flexíveis: ${flexCount}`} />
                                </>
                              )}
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-zinc-500 mt-1">
                              <span className="text-sky-400">AM ({totalStops > 0 ? Math.round((amCount / totalStops) * 100) : 0}%)</span>
                              <span className="text-amber-400">PM ({totalStops > 0 ? Math.round((pmCount / totalStops) * 100) : 0}%)</span>
                              <span className="text-purple-400">Noite ({totalStops > 0 ? Math.round((nightCount / totalStops) * 100) : 0}%)</span>
                              <span className="text-zinc-400">Flex ({totalStops > 0 ? Math.round((flexCount / totalStops) * 100) : 0}%)</span>
                            </div>
                          </div>
                        </div>

                        {/* Diagnóstico de Gargalo se existir */}
                        {z.analytics.criticalPeriod && z.analytics.criticalPeriod.deficitStops > 0 && (
                          <div className="mt-2 p-2 rounded-lg bg-rose-950/30 border border-rose-900/50 text-[11px] text-rose-300 flex items-center justify-between">
                            <span className="flex items-center space-x-1.5">
                              <span>⚠️</span>
                              <span>
                                <strong>Gargalo em {z.analytics.criticalPeriod.label}:</strong> {z.analytics.criticalPeriod.count} paragens para capacidade estimada de {z.analytics.criticalPeriod.fleetCapacityStops} (défice de {z.analytics.criticalPeriod.deficitStops} paragens).
                              </span>
                            </span>
                            <span className="font-bold shrink-0 ml-2 text-rose-200">
                              +~{z.analytics.criticalPeriod.deficitVehicles} vt no pico
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

          {/* TAB DETALHADA POR PERÍODO */}
          {["am", "pm", "night", "flexible"].includes(activeTab) && (() => {
            const periodKey = activeTab as "am" | "pm" | "night" | "flexible";
            const currentPeriod = periods[periodKey];
            return (
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-zinc-900/60 p-3 rounded-lg border border-zinc-800">
                  <div>
                    <h4 className="text-sm font-bold text-white">{currentPeriod.label}</h4>
                    <p className="text-xs text-zinc-400">
                      Janela Horária: {currentPeriod.timeRange} · {currentPeriod.count} paragens ({currentPeriod.pct}% do total)
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-zinc-400 block font-mono">
                      Peso: {currentPeriod.totalKg.toLocaleString("pt-PT")} kg | Vol: {currentPeriod.totalVol} m³
                    </span>
                    {periodKey !== "flexible" && (
                      <span className={`text-[11px] font-bold ${
                        currentPeriod.deficitStops > 0 ? "text-rose-400" : "text-emerald-400"
                      }`}>
                        {currentPeriod.deficitStops > 0
                          ? `Défice de ~${currentPeriod.deficitVehicles} viatura(s)`
                          : "Capacidade da frota suficiente"}
                      </span>
                    )}
                  </div>
                </div>

                {/* Tabela de Clientes do Período */}
                <div className="border border-zinc-800 rounded-lg overflow-hidden max-h-[360px] overflow-y-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-zinc-900/90 text-zinc-400 uppercase text-[10px] sticky top-0 border-b border-zinc-800">
                      <tr>
                        <th className="p-2">Doc / ID</th>
                        <th className="p-2">Cliente</th>
                        <th className="p-2">Janela</th>
                        <th className="p-2">Localidade / CP</th>
                        <th className="p-2 text-right">Peso (kg)</th>
                        <th className="p-2 text-right">Rota Atual</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 bg-zinc-950">
                      {currentPeriod.deliveries.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-4 text-center text-zinc-500 font-sans">
                            Nenhuma paragem classificada neste período.
                          </td>
                        </tr>
                      ) : (
                        currentPeriod.deliveries.map((d, idx) => (
                          <tr key={idx} className="hover:bg-zinc-900/50 transition-colors">
                            <td className="p-2 text-zinc-400">{d.Doc_ID || d.id || "-"}</td>
                            <td className="p-2 text-zinc-100 font-sans font-medium truncate max-w-[180px]">
                              {d.Cliente || d.Nome_Cliente || "Sem Nome"}
                            </td>
                            <td className="p-2 text-amber-400 font-bold">
                              {d.Janela_Horaria || (d.Janela_Inicio ? `${d.Janela_Inicio} - ${d.Janela_Fim}` : "Qualquer")}
                            </td>
                            <td className="p-2 text-zinc-400 truncate max-w-[140px]">
                              {d.Localidade || ""}{d.Localidade ? " " : ""}{d.Morada ? `(${d.Morada})` : ""}
                            </td>
                            <td className="p-2 text-right text-zinc-200">
                              {Number(d.Peso_KG) || 0}
                            </td>
                            <td className="p-2 text-right">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
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
            );
          })()}
        </div>

        {/* RODAPÉ DO MODAL */}
        <div className="p-3 border-t border-zinc-800 bg-zinc-900/80 flex items-center justify-between text-xs">
          <span className="text-zinc-400">
            Total de {analytics.totalDeliveries} paragens analisadas contra {analytics.totalVehicles} viaturas disponíveis.
          </span>
          <button
            onClick={onClose}
            className="cursor-pointer px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium rounded-lg transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
