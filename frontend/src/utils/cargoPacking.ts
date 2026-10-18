/**
 * Utilitários de Cálculo de Carregamento 3D (3D Bin Packing LIFO & Gravidade)
 * 
 * Regras Operacionais de Logística:
 * 1. LIFO (Last In, First Out):
 *    - A última paragem a ser entregue (Seq N) é a primeira a ser carregada (fica ao fundo, junto à cabine).
 *    - A primeira paragem (Seq 1) fica junto à porta traseira para acesso imediato sem desmanchar a carga.
 * 2. Gravidade e Estabilidade:
 *    - Volumes pesados/maiores assentam na base (piso da viatura, Y=0).
 *    - Volumes mais leves e frágeis ficam por cima.
 */

export interface CargoBox {
  id: string;
  stopId: string | number;
  stopSeq: number;
  clientName: string;
  address: string;
  boxIndex: number;
  totalBoxesForStop: number;
  weightKg: number;
  volumeM3: number;
  // Dimensões em metros
  length: number; // Eixo X (comprimento da viatura)
  width: number;  // Eixo Z (largura da viatura)
  height: number; // Eixo Y (altura da viatura)
  // Posição no espaço tridimensional (centro geométrico da caixa)
  position: {
    x: number;
    y: number;
    z: number;
  };
  color: string;
  lifoZone: "cabine" | "meio" | "porta";
  isHeavy: boolean;
}

export interface VehicleContainerDimensions {
  length: number; // m (Cabine X=0 até Porta X=L)
  width: number;  // m (Esquerda Z=-W/2 até Direita Z=+W/2)
  height: number; // m (Piso Y=0 até Teto Y=H)
  totalVolumeM3: number;
  maxWeightKg: number;
}

// Cores vivas e contrastantes para identificação visual clara por cliente
const PALETTE = [
  "#3b82f6", // Azul
  "#10b981", // Verde Esmeralda
  "#f59e0b", // Âmbar
  "#ec4899", // Rosa
  "#8b5cf6", // Roxo
  "#06b6d4", // Ciano
  "#f97316", // Laranja
  "#14b8a6", // Turquesa
  "#a855f7", // Violeta
  "#e11d48", // Vermelho Rosado
  "#84cc16", // Lima
  "#0ea5e9", // Céu
  "#d97706", // Ouro Escuro
  "#6366f1", // Índigo
];

/**
 * Normaliza o volume de uma viatura.
 * Se o valor for superior a 120, o utilizador ou ficheiro inseriu o volume em Litros ou dm³ (ex: 6000 L = 6.0 m³).
 * O maior semi-reboque rodoviário TIR tem cerca de 90 m³. Logo, qualquer valor > 120 está em Litros.
 */
export function normalizeVehicleVolume(val: number): number {
  if (!val || val <= 0) return 12;
  if (val > 120) return Number((val / 1000).toFixed(2));
  return Number(val.toFixed(2));
}

/**
 * Normaliza o volume de uma paragem/entrega individual.
 * Uma entrega de carrinha/camião raramente ultrapassa 20 m³.
 * Se o volume for superior a 20, está garantidamente em Litros ou dm³ (ex: 242 L = 0.242 m³).
 */
export function normalizeStopVolume(val: number): number {
  if (!val || val <= 0) return 0.15;
  if (val > 20) return Number((val / 1000).toFixed(3));
  return Number(val.toFixed(3));
}

/**
 * Estima as dimensões realistas do baú da viatura com base no volume máximo registado.
 * Mantém rácios de carrinha/furgão de mercadorias típico (ex: Renault Master, Mercedes Sprinter, Iveco Daily).
 */
export function estimateVehicleDimensions(volumeM3: number, maxWeightKg: number): VehicleContainerDimensions {
  const normVol = normalizeVehicleVolume(volumeM3);
  const vol = Math.max(normVol > 0 ? normVol : 12, 4);
  
  // Altura útil interior típica de furgão: entre 1.65m e 2.20m
  const height = Math.min(Math.max(1.65, Math.pow(vol * 0.12, 0.38)), 2.20);
  // Largura útil interior: 1.60m a 2.10m
  const width = Math.min(Math.max(1.60, Math.pow(vol * 0.12, 0.38)), 2.10);
  // Comprimento resultante do volume restante com folga de embalamento
  const length = Math.max(2.2, Number((vol / (width * height)).toFixed(2)));

  return {
    length: Number(length.toFixed(2)),
    width: Number(width.toFixed(2)),
    height: Number(height.toFixed(2)),
    totalVolumeM3: Number(vol.toFixed(2)),
    maxWeightKg: maxWeightKg > 0 ? maxWeightKg : 1500,
  };
}

/**
 * Gera as caixas 3D e calcula as posições no espaço do baú com algoritmo LIFO + Gravidade
 */
export function calculateCargoLoadingPlan(
  stops: any[],
  container: VehicleContainerDimensions
): CargoBox[] {
  if (!stops || stops.length === 0) return [];

  // Filtrar apenas paragens reais (excluir armazém de partida e regresso)
  const validStops = stops
    .filter(s => {
      const name = (s.client_name || s.Nome || s.Cliente || "").toUpperCase();
      return !name.includes("ARMAZÉM") && !name.includes("ARMAZEM") && !name.includes("DEPÓSITO");
    })
    .map((s, index) => {
      const seq = s.seq || s.sequence || (index + 1);
      const rawWeight = Number(s.weight || s.peso || s.Peso_KG || 15);
      const rawVol = Number(s.volume || s.vol || s.Volume_m3 || 0.15);
      const cleanWeight = rawWeight > 0 ? rawWeight : 15;
      const cleanVol = normalizeStopVolume(rawVol);
      
      const rawPackages = Number(s.packages || s.bultos || s.volumes || s.Volumes || 0);
      let packages = 1;
      if (rawPackages > 0 && rawPackages <= 20) {
        packages = Math.round(rawPackages);
      } else {
        // Estima caixas modulares logísticas (uma caixa média de ~0.06m³ a 0.12m³)
        packages = Math.max(1, Math.min(10, Math.round(cleanVol / 0.08) || 1));
      }
      // Teto máximo de segurança por paragem para garantir 60 FPS no Three.js
      packages = Math.min(packages, 12);

      return {
        ...s,
        cleanSeq: seq,
        cleanWeight,
        cleanVol,
        cleanPackages: packages,
      };
    });

  if (validStops.length === 0) return [];

  const totalStops = validStops.length;

  // 1. Desdobrar paragens em bultos individuais
  const rawBoxes: {
    stopId: string | number;
    stopSeq: number;
    clientName: string;
    address: string;
    boxIndex: number;
    totalBoxesForStop: number;
    weightKg: number;
    volumeM3: number;
    length: number;
    width: number;
    height: number;
    color: string;
    isHeavy: boolean;
    lifoZone: "cabine" | "meio" | "porta";
  }[] = [];

  validStops.forEach((stop, sIdx) => {
    const color = PALETTE[sIdx % PALETTE.length];
    const nPackages = stop.cleanPackages;
    const unitVol = Math.max(0.015, stop.cleanVol / nPackages);
    const unitWeight = stop.cleanWeight / nPackages;
    
    // Classificação de zona LIFO
    const relativePos = stop.cleanSeq / totalStops;
    let zone: "cabine" | "meio" | "porta" = "meio";
    if (relativePos > 0.65) zone = "cabine"; // Entregue no fim -> Fica na cabine
    else if (relativePos <= 0.35) zone = "porta"; // Entregue no início -> Fica na porta

    for (let b = 1; b <= nPackages; b++) {
      // Cada bulto é modelado como um cubo/paralelepípedo equilátero robusto e realista (nunca achatado como papel)
      // Raiz cúbica do volume unitário garante formato de caixa/cubo logístico
      const cubeSide = Math.max(0.32, Math.min(0.65, Math.pow(unitVol, 1 / 3)));
      const l = Number(cubeSide.toFixed(2));
      const w = Number(cubeSide.toFixed(2));
      const h = Number(cubeSide.toFixed(2));

      rawBoxes.push({
        stopId: stop.id || stop.cliente_id || `stop-${stop.cleanSeq}`,
        stopSeq: stop.cleanSeq,
        clientName: stop.client_name || stop.Nome || stop.Cliente || `Cliente ${stop.cleanSeq}`,
        address: stop.address || stop.morada || stop.Morada || "",
        boxIndex: b,
        totalBoxesForStop: nPackages,
        weightKg: Number(unitWeight.toFixed(1)),
        volumeM3: Number(unitVol.toFixed(3)),
        length: l,
        width: w,
        height: h,
        color,
        isHeavy: unitWeight >= 25,
        lifoZone: zone,
      });
    }
  });

  // 2. Ordenação LIFO e Gravidade Hierárquica:
  // Primeiro as paragens com maior sequência (descarregadas em último -> Cabine/Fundo)
  // Dentro de paragens equivalentes, as caixas mais pesadas e volumosas assentam primeiro no piso
  rawBoxes.sort((a, b) => {
    if (b.stopSeq !== a.stopSeq) {
      return b.stopSeq - a.stopSeq;
    }
    const weightDiff = b.weightKg - a.weightKg;
    if (Math.abs(weightDiff) > 0.5) {
      return weightDiff;
    }
    return b.volumeM3 - a.volumeM3;
  });

  // 3. Empacotamento Tridimensional Sem Sobreposição (Zero-Overlap 3D Packing com Suporte e Gravidade)
  const placedBoxes: CargoBox[] = [];
  const placedRects: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number; weightKg: number }[] = [];
  const pad = 0.02; // 2cm de folga física realista entre caixas

  const L = container.length;
  const W = container.width;
  const H = container.height;

  // Função para verificar colisão com caixas já colocadas
  function collidesWithPlaced(minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number): boolean {
    const eps = 0.005;
    for (const p of placedRects) {
      if (
        minX < p.maxX - eps &&
        maxX > p.minX + eps &&
        minY < p.maxY - eps &&
        maxY > p.minY + eps &&
        minZ < p.maxZ - eps &&
        maxZ > p.minZ + eps
      ) {
        return true;
      }
    }
    return false;
  }

  // Verifica suporte físico: se estiver em cima (Y > 0), tem de ter caixa sólida por baixo
  // E nunca permite uma caixa pesada pousar em cima de uma caixa muito mais leve
  function isValidSupport(minX: number, maxX: number, posY: number, minZ: number, maxZ: number, boxWeight: number): boolean {
    if (posY <= 0.01) return true; // No piso do carro -> suporte 100% garantido!

    for (const p of placedRects) {
      if (Math.abs(p.maxY - posY) <= 0.04) {
        const overlapX = Math.min(maxX, p.maxX) - Math.max(minX, p.minX);
        const overlapZ = Math.min(maxZ, p.maxZ) - Math.max(minZ, p.minZ);
        if (overlapX > 0.08 && overlapZ > 0.08) {
          if (p.weightKg >= boxWeight * 0.5) {
            return true;
          }
        }
      }
    }
    return false;
  }

  for (const box of rawBoxes) {
    // Cálculo do target longitudinal X pela regra LIFO
    // Última entrega (Seq N) -> Cabine (X=0); Primeira entrega (Seq 1) -> Portas Traseiras (X=L)
    const lifoRatio = (totalStops - box.stopSeq) / Math.max(1, totalStops - 1);
    const targetX = lifoRatio * Math.max(0, L - box.length - pad * 2);

    // Margens longitudinais estritas por zona:
    // Uma entrega "junto à porta" NUNCA é colocada no fundo da cabine e vice-versa!
    let minAllowedX = pad;
    let maxAllowedX = L - box.length - pad;

    if (box.lifoZone === "cabine") {
      minAllowedX = pad;
      maxAllowedX = Math.min(L * 0.45, L - box.length - pad);
    } else if (box.lifoZone === "porta") {
      minAllowedX = Math.max(pad, L * 0.52);
      maxAllowedX = L - box.length - pad;
    } else { // meio
      minAllowedX = Math.max(pad, L * 0.20);
      maxAllowedX = Math.min(L * 0.80, L - box.length - pad);
    }

    // Âncoras candidatas
    const candidateAnchors: { x: number; y: number; z: number }[] = [
      { x: Math.max(minAllowedX, Math.min(targetX, maxAllowedX)), y: 0, z: -W / 2 + pad }
    ];

    for (const p of placedRects) {
      if (p.maxX + pad <= maxAllowedX && p.maxX >= minAllowedX) {
        candidateAnchors.push({ x: p.maxX + pad, y: p.minY, z: p.minZ });
      }
      if (p.minX >= minAllowedX && p.minX <= maxAllowedX) {
        candidateAnchors.push(
          { x: p.minX, y: p.maxY + pad, z: p.minZ },
          { x: p.minX, y: p.minY, z: p.maxZ + pad }
        );
      }
    }

    let bestPos: { x: number; y: number; z: number } | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const anchor of candidateAnchors) {
      const posX = Math.max(minAllowedX, Math.min(anchor.x, maxAllowedX));
      const posY = anchor.y;
      const posZ = Math.max(-W / 2 + pad, Math.min(anchor.z, W / 2 - box.width - pad));

      const minX = posX;
      const maxX = posX + box.length;
      const minY = posY;
      const maxY = posY + box.height;
      const minZ = posZ;
      const maxZ = posZ + box.width;

      if (maxX > maxAllowedX + pad * 0.5 || maxY > H || maxZ > W / 2 - pad * 0.5) {
        continue;
      }

      if (collidesWithPlaced(minX, maxX, minY, maxY, minZ, maxZ)) {
        continue;
      }

      if (!isValidSupport(minX, maxX, minY, minZ, maxZ, box.weightKg)) {
        continue;
      }

      // Gravidade forte: valoriza fortemente Y=0 (piso) e penaliza subir em altura
      // LIFO: penaliza afastar-se do targetX da encomenda
      const distLIFO = Math.abs(posX - targetX);
      const score = posY * 60 + distLIFO * 15 + (posZ + W / 2) * 0.5;

      if (score < bestScore) {
        bestScore = score;
        bestPos = { x: posX, y: posY, z: posZ };
      }
    }

    // Se nenhuma âncora serviu, varrimento estrito dentro da faixa permitida
    if (!bestPos) {
      scanLoop:
      for (let y = 0; y <= H - box.height; y += 0.05) {
        for (let x = targetX; x <= maxAllowedX; x += 0.05) {
          for (let z = -W / 2 + pad; z <= W / 2 - box.width - pad; z += 0.05) {
            if (!collidesWithPlaced(x, x + box.length, y, y + box.height, z, z + box.width)) {
              if (isValidSupport(x, x + box.length, y, z, z + box.width, box.weightKg)) {
                bestPos = { x, y, z };
                break scanLoop;
              }
            }
          }
        }
        for (let x = targetX; x >= minAllowedX; x -= 0.05) {
          for (let z = -W / 2 + pad; z <= W / 2 - box.width - pad; z += 0.05) {
            if (!collidesWithPlaced(x, x + box.length, y, y + box.height, z, z + box.width)) {
              if (isValidSupport(x, x + box.length, y, z, z + box.width, box.weightKg)) {
                bestPos = { x, y, z };
                break scanLoop;
              }
            }
          }
        }
      }
    }

    const finalX = bestPos ? bestPos.x : Math.max(minAllowedX, Math.min(targetX, maxAllowedX));
    const finalY = bestPos ? bestPos.y : 0;
    const finalZ = bestPos ? bestPos.z : -W / 2 + pad;

    placedRects.push({
      minX: finalX,
      maxX: finalX + box.length,
      minY: finalY,
      maxY: finalY + box.height,
      minZ: finalZ,
      maxZ: finalZ + box.width,
      weightKg: box.weightKg,
    });

    const centerX = finalX + box.length / 2;
    const centerY = finalY + box.height / 2;
    const centerZ = finalZ + box.width / 2;

    placedBoxes.push({
      ...box,
      id: `box-${box.stopSeq}-${box.boxIndex}`,
      position: {
        x: Number(centerX.toFixed(3)),
        y: Number(centerY.toFixed(3)),
        z: Number(centerZ.toFixed(3)),
      },
    });
  }

  return placedBoxes;
}
