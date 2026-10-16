/**
 * Geo & Time Normalization Utilities
 * Pure helper functions decoupled from UI / Leaflet to allow safe SSR in Next.js.
 */

export function parseWindowStartEnd(winStr?: string): { start: number; end: number; formatted: string } | null {
  if (!winStr || winStr === "Qualquer" || winStr === "--" || winStr === "None" || String(winStr).trim() === "") {
    return null;
  }
  const cleaned = String(winStr)
    .replace(/\d{4}-\d{2}-\d{2}\s*/g, "")
    .replace(/T/g, " ")
    .trim();
  const times = cleaned.match(/\b\d{1,2}(?::\d{2})?\b/g);
  if (!times || times.length === 0) return null;

  const toMinutes = (t: string) => {
    const p = t.split(":");
    const h = parseInt(p[0], 10);
    const m = p[1] ? parseInt(p[1], 10) : 0;
    return h * 60 + m;
  };

  const toStr = (mins: number) => {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  const startMin = toMinutes(times[0]);
  const endMin = times.length > 1 ? toMinutes(times[1]) : startMin + 120;

  return {
    start: startMin,
    end: endMin,
    formatted: `${toStr(startMin)} - ${toStr(endMin)}`
  };
}

export function parseTimeToMinutes(t?: string): number {
  if (!t) return 0;
  const parts = t.split(":");
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

export function normalizeLocality(locStr?: string, cpStr?: string): string {
  if (locStr && String(locStr).trim() !== "") {
    const clean = String(locStr)
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Z\s]/g, " ")
      .trim();
    if (clean) {
      const known = [
        "LISBOA", "SINTRA", "CASCAIS", "OEIRAS", "AMADORA", "LOURES", "ODIVELAS", 
        "ALMADA", "SEIXAL", "SETUBAL", "BARREIRO", "MAFRA", "VILA FRANCA", "ALVERCA",
        "PORTO", "GAIA", "MATOSINHOS", "MAIA", "COIMBRA", "BRAGA", "FARO", "LEIRIA", "SANTAREM"
      ];
      for (const k of known) {
        if (clean.includes(k)) return k;
      }
      const parts = clean.split(/\s+/).filter(Boolean);
      if (parts.length > 0 && parts[0].length >= 3) return parts[0];
    }
  }

  if (cpStr) {
    const cpDigits = String(cpStr).replace(/\D/g, "").slice(0, 4);
    const cpNum = parseInt(cpDigits, 10);
    if (!isNaN(cpNum)) {
      if (cpNum >= 1000 && cpNum <= 1999) return "LISBOA";
      if (cpNum >= 2600 && cpNum <= 2699) return "LOURES / ODIVELAS";
      if (cpNum >= 2700 && cpNum <= 2729) return "AMADORA";
      if (cpNum >= 2730 && cpNum <= 2749) return "OEIRAS";
      if (cpNum >= 2710 && cpNum <= 2725) return "SINTRA";
      if (cpNum >= 2750 && cpNum <= 2775) return "CASCAIS";
      if (cpNum >= 2800 && cpNum <= 2899) return "MARGEM SUL";
      if (cpNum >= 2900 && cpNum <= 2999) return "SETUBAL";
      if (cpNum >= 4000 && cpNum <= 4499) return "PORTO";
    }
  }
  return "GERAL";
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

export function formatTimeWindow(winStr?: string): string {
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
