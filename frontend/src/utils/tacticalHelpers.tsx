import React from "react";

export interface RouteNode {

  id?: number;

  ID_Original?: number;

  Doc_ID?: string;

  Codigo_Cliente?: string;

  Rota: string;

  Armazem: string;

  Ordem: number;

  Cliente: string;

  Nome_Cliente?: string;

  Morada: string;

  CP: string;

  Localidade: string;

  Janela_Horaria: string;

  Janela_Inicio?: string;

  Janela_Fim?: string;

  Estado_Planeamento?: string;

  Motivo_Pendencia?: string;

  Dist_Km?: number;

  Latitude: number;

  Longitude: number;

  Chegada: string;

  Tempo_Espera?: number;

  Tempo_Entrega: number;

  Saida: string;

  KM_Anterior: number;

  Dist_Acum: number;

  Peso_KG?: number;

  Volume_m3?: number;

  Carga_Acum: number;

  Carga_Vol_Acum: number;

  Tipo_Operacao?: string;

  Par_ID?: string;

  Telefone?: string;

  Telefone_Cliente?: string;

  Observacoes?: string;

  Vendedor?: string;

  vendedor?: string;

  Cx_Ambiente?: number;

  Cx_Frio?: number;

  Cx_Congelado?: number;

  Total_Cx?: number;

  cx_ambiente?: number;

  cx_frio?: number;

  cx_congelado?: number;

  total_cx?: number;

}

export interface Delivery {

  id: number;

  codigo_cliente: string;

  morada: string;

  codigo_postal: string;

  concelho: string;

  latitude: number;

  longitude: number;

}

export interface WarehouseData {

  name: string;

  address: string;

  cp: string;

  locality: string;

  lat: number;

  lon: number;

  quality?: number;

}

export interface VehicleData {

  veiculo: string;

  armazem: string;

  capacidade_kg: number;

  capacidade_vol: number;

  custo_km: number;

  velocidade_media: number;

  horario_inicio: string;

  horario_fim: string;

  regras?: string;

  regresso_armazem?: string;

  cap_cx_ambiente?: number;

  cap_cx_frio?: number;

  cap_cx_congelado?: number;

  cap_cx_total?: number;

}

const routeColors = [

  "#6366f1", // Indigo

  "#ec4899", // Pink

  "#f59e0b", // Amber

  "#10b981", // Emerald

  "#3b82f6", // Blue

  "#ef4444", // Red

  "#8b5cf6", // Violet

  "#06b6d4", // Cyan

  "#f97316", // Orange

  "#14b8a6", // Teal

  "#a855f7", // Purple

  "#84cc16", // Lime

  "#0ea5e9", // Sky

  "#e11d48", // Rose

];

export function formatTimeWindow(winStr: string): string {

  if (!winStr || winStr === "Qualquer" || winStr === "--" || winStr === "None") return "Qualquer";

  const cleaned = String(winStr)

    .replace(/\d{4}-\d{2}-\d{2}\s*/g, "")

    .replace(/T/g, " ")

    .replace(/:00(?=\s|$|-)/g, "")

    .trim();

  if (cleaned.includes("-")) {

    const parts = cleaned.split("-").map(p => p.trim().slice(0, 5));

    if (parts[0] && parts[1]) return `${parts[0]} - ${parts[1]}`;

    if (parts[0]) return `${parts[0]} - 23:59`;

  }

  return cleaned.slice(0, 13) || "Qualquer";

}

export interface PipelineWarehouseRow {

  armazem: string;

  entregas_total: number;

  peso_total_kg: number;

  volume_total_m3: number;

  viaturas_disponiveis: number;

  cap_frota_peso_kg: number;

  cap_frota_vol_m3: number;

  entregas_alocadas?: number;

  entregas_pendentes?: number;

  viaturas_mobilizadas?: number;

  viaturas_vazias?: number;

  peso_carregado_kg?: number;

  volume_carregado_m3?: number;

  km_totais?: number;

  tempo_segundos?: number;

  status: "waiting" | "calculating" | "completed" | "completed_pending" | "no_fleet" | "error";

  error_msg?: string;

}

export function matchWarehouse(whA?: string, whB?: string): boolean {

  if (!whA || !whB) return false;

  const a = String(whA).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  const b = String(whB).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  return a === b || a.includes(b) || b.includes(a);

}

export function isPendingRoute(routeName: string) {

  if (!routeName) return true;

  const s = routeName.toUpperCase();

  return s.includes("PENDENTE") || s.includes("DISTRIBUIR");

}

export function getRouteColor(routeName: string, vehicleList: string[]) {

  if (isPendingRoute(routeName)) return "#f59e0b"; // Amber for pending

  const idx = vehicleList.indexOf(routeName);

  if (idx === -1) return routeColors[0];

  return routeColors[idx % routeColors.length];

}

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {

  const R = 6371.0;

  const dLat = ((lat2 - lat1) * Math.PI) / 180;

  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =

    Math.sin(dLat / 2) * Math.sin(dLat / 2) +

    Math.cos((lat1 * Math.PI) / 180) *

      Math.cos((lat2 * Math.PI) / 180) *

      Math.sin(dLon / 2) *

      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;

}

export function addMinutesToTime(timeStr: string, minutesToAdd: number): string {

  const parts = (timeStr || "08:00").split(":");

  const h = parseInt(parts[0], 10) || 8;

  const m = parseInt(parts[1], 10) || 0;

  const totalMins = h * 60 + m + Math.round(minutesToAdd);

  const newH = Math.floor(totalMins / 60) % 24;

  const newM = totalMins % 60;

  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;

}

export type DeliveryComplianceStatus = "on_time" | "early" | "late";

export interface DeliveryCompliance {

  status: DeliveryComplianceStatus;

  label: string;

  tooltip: string;

  badgeClass: string;

  diffMinutes: number;

}

export function getDeliveryWindowCompliance(

  chegadaStr?: string,

  windowStr?: string

): DeliveryCompliance {

  if (!chegadaStr || !windowStr || windowStr === "Qualquer" || windowStr === "--") {

    return {

      status: "on_time",

      label: "Livre",

      tooltip: "Sem restrição de janela horária",

      badgeClass: "text-zinc-200 bg-zinc-900 border border-zinc-700 font-bold",

      diffMinutes: 0,

    };

  }

  if (chegadaStr.startsWith("+1d") || chegadaStr.startsWith("+2d")) {

    return {

      status: "late",

      label: "Atrasado (+1d)",

      tooltip: `Chegada no dia seguinte (${chegadaStr}), fora da janela acordada (${windowStr})`,

      badgeClass: "text-rose-300 bg-zinc-950 border border-rose-500 font-black shadow-sm",

      diffMinutes: 1440,

    };

  }

  const parts = windowStr.split("-");

  if (parts.length < 2) {

    return {

      status: "on_time",

      label: "OK",

      tooltip: `Horário dentro do previsto`,

      badgeClass: "text-zinc-200 bg-zinc-900 border border-zinc-700 font-bold",

      diffMinutes: 0,

    };

  }

  const parseMins = (t: string) => {

    const clean = t.replace("+1d", "").replace("+2d", "").trim().slice(0, 5);

    const [h, m] = clean.split(":").map((x) => parseInt(x, 10) || 0);

    return h * 60 + m;

  };

  const winStartMin = parseMins(parts[0]);

  const winEndMin = parseMins(parts[1]);

  const arrMin = parseMins(chegadaStr);

  if (arrMin < winStartMin - 15) {

    const earlyMin = winStartMin - arrMin;

    const earlyH = Math.floor(earlyMin / 60);

    const earlyRem = earlyMin % 60;

    const diffStr = earlyH > 0 ? `${earlyH}h${earlyRem > 0 ? `${earlyRem}m` : ""}` : `${earlyRem}m`;

    return {

      status: "early",

      label: `Adiantado (${parts[0].trim()})`,

      tooltip: `Chegada ${diffStr} antes da abertura do cliente (Abre às ${parts[0].trim()})`,

      badgeClass: "text-amber-300 bg-zinc-950 border border-amber-500 font-black tracking-wide shadow-sm",

      diffMinutes: -earlyMin,

    };

  }

  if (arrMin > winEndMin) {

    const lateMin = arrMin - winEndMin;

    const lateH = Math.floor(lateMin / 60);

    const lateRem = lateMin % 60;

    const diffStr = lateH > 0 ? `${lateH}h${lateRem > 0 ? `${lateRem}m` : ""}` : `${lateRem}m`;

    return {

      status: "late",

      label: `Atrasado (${parts[1].trim()})`,

      tooltip: `Chegada ${diffStr} após o fecho do cliente (Fechou às ${parts[1].trim()})`,

      badgeClass: "text-rose-300 bg-zinc-950 border border-rose-500 font-black tracking-wide shadow-sm",

      diffMinutes: lateMin,

    };

  }

  return {

    status: "on_time",

    label: "Pontual",

    tooltip: `Chegada dentro da janela horária acordada (${windowStr})`,

    badgeClass: "text-emerald-300 bg-zinc-950 border border-emerald-500 font-black tracking-wide shadow-sm",

    diffMinutes: 0,

  };

}

export function isDeliveryLate(serviceStartTime: string, windowStr: string): boolean {

  return getDeliveryWindowCompliance(serviceStartTime, windowStr).status !== "on_time";

}

export function calculateDurationString(startStr: string, endStr: string): string {

  const [h1, m1] = (startStr || "08:00").split(":").map(Number);

  const [h2, m2] = (endStr || "08:00").split(":").map(Number);

  let totalMin = h2 * 60 + m2 - (h1 * 60 + m1);

  if (totalMin < 0) totalMin += 24 * 60;

  const hours = Math.floor(totalMin / 60);

  const mins = totalMin % 60;

  if (hours === 0) return `${mins}m`;

  return `${hours}h ${mins > 0 ? `${mins}m` : ""}`;

}

export function renderOperationTypeBadge(opType?: string, parId?: string) {

  const norm = (opType || "D").trim();

  switch (norm) {

    case "P":

      return (

        <span

          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 shadow-sm"

          title="Recolha de Sucata / Retoma (P) - Carrega no cliente para entregar no armazém"

        >

          ♻️ <span className="font-mono">P</span>

        </span>

      );

    case "From":

      return (

        <span

          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30 shadow-sm"

          title={`Levantamento em Loja (From)${parId ? ` - Par Casado: ${parId}` : ""}`}

        >

          🏪⤴️ <span className="font-mono">From</span>

          {parId && <span className="text-[8px] opacity-75 font-mono">#{parId.slice(-4)}</span>}

        </span>

      );

    case "To":

      return (

        <span

          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm"

          title={`Entrega de Loja (To)${parId ? ` - Par Casado: ${parId}` : ""}`}

        >

          🏠⤵️ <span className="font-mono">To</span>

          {parId && <span className="text-[8px] opacity-75 font-mono">#{parId.slice(-4)}</span>}

        </span>

      );

    case "D":

    default:

      return (

        <span

          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30 shadow-sm"

          title="Entrega Normal (D) - Sai do armazém e descarrega no cliente"

        >

          📦 <span className="font-mono">D</span>

        </span>

      );

  }

}

export function extractTags(raw: string): string[] {

  if (!raw) return [];

  const bracketed = raw.match(/\[([^\]]+)\]/g);

  if (bracketed && bracketed.length > 0) {

    const res: string[] = [];

    bracketed.forEach((b) => {

      const inner = b.slice(1, -1).trim();

      inner.split(/[,;|\s]+/).forEach((t) => {

        if (t.trim()) res.push(t.trim().toUpperCase());

      });

    });

    return res;

  }

  return raw.split(/[,;|]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);

}

export function isVehicleCompatibleFrontend(vRulesStr: string, cRulesStr: string, rulesMatrix: any[]): boolean {

  if (!rulesMatrix || rulesMatrix.length === 0) return true;

  const cTags = extractTags(cRulesStr);

  if (cTags.length === 0) return true;

  const vTags = extractTags(vRulesStr);

  const prohibitions = new Set<string>();

  const permissions = new Set<string>();

  const configuredDeliveryTags = new Set<string>();

  rulesMatrix.forEach((r) => {

    const tv = String(r.Tag_Veiculo || r.tag_veiculo || "").trim().toUpperCase();

    const perm = String(r.Permissao || r.permissao || "SIM").trim().toUpperCase();

    const td = String(r.Tag_Entrega || r.tag_entrega || "").trim().toUpperCase();

    if (!tv || !td) return;

    configuredDeliveryTags.add(td);

    if (["NAO", "NÃO", "NO", "PROIBIR", "FALSE", "0"].includes(perm)) {

      prohibitions.add(`${tv}|${td}`);

    } else {

      permissions.add(`${tv}|${td}`);

    }

  });

  // 1. Proibições Rígidas (NAO)

  for (const vt of vTags) {

    for (const dt of cTags) {

      if (prohibitions.has(`${vt}|${dt}`)) return false;

    }

  }

  // 2. Obrigatoriedades para tags configuradas na matriz de regras

  for (const dt of cTags) {

    if (!configuredDeliveryTags.has(dt)) continue;

    let matched = vTags.includes(dt);

    if (!matched) {

      for (const vt of vTags) {

        if (permissions.has(`${vt}|${dt}`)) {

          matched = true;

          break;

        }

      }

    }

    if (!matched) return false;

  }

  return true;

}

