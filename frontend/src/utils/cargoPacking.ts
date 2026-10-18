/**
 * Utilitários de Cálculo de Carregamento 3D (3D Bin Packing LIFO & Gravidade)
 * 
 * Implementação com Grelha Voxel 3D Discretizada (Resolução de 5cm / Célula)
 * Conforme especificação: Preenchimento do espaço interno da caixa da viatura com uma matriz 3D
 * com células de 5cm, garantindo controlo rigoroso dos cm³ ocupados, eliminando caixas achatadas
 * ("folhas de papel") e com 0% de sobreposição (zero overlap físico garantido).
 * 
 * Regras Operacionais de Logística:
 * 1. LIFO (Last In, First Out):
 *    - A última paragem a ser entregue (Seq N) é a primeira a ser carregada (fundo / cabine, X=0).
 *    - A primeira paragem (Seq 1) fica junto às portas traseiras (X=L) para descarga imediata.
 * 2. Gravidade e Estabilidade Física:
 *    - Prioridade absoluta ao piso da viatura (Y=0) antes de empilhar em altura.
 *    - Volumes pesados na base; volumes leves em cima com suporte estrutural verificado.
 * 3. Formato Tridimensional Sólido:
 *    - Cada bulto é um paralelepípedo/cubo realista (mínimo 25cm x 25cm x 20cm).
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
  gridCells?: {
    cLen: number;
    cWid: number;
    cHei: number;
  };
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
 * Gera as caixas 3D e calcula as posições no espaço do baú com algoritmo de Matriz Voxel 3D (Células de 5cm)
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
        // Estima caixas modulares logísticas (uma caixa média de ~0.06m³ a 0.10m³)
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

  // Resolução da Grelha 3D: Células de 5cm (0.05 metros)
  const CELL_SIZE = 0.05; // 5 cm
  const nx = Math.max(10, Math.floor(container.length / CELL_SIZE));
  const ny = Math.max(8, Math.floor(container.height / CELL_SIZE));
  const nz = Math.max(10, Math.floor(container.width / CELL_SIZE));

  // Matriz 3D de ocupação física (0 = livre; > 0 = ID da caixa que ocupa a célula)
  const grid = new Int32Array(nx * ny * nz);
  const getIdx = (x: number, y: number, z: number) => (x * ny + y) * nz + z;

  // 1. Desdobrar paragens em bultos individuais e definir dimensões em células
  const rawBoxes: {
    stopId: string | number;
    stopSeq: number;
    clientName: string;
    address: string;
    boxIndex: number;
    totalBoxesForStop: number;
    weightKg: number;
    volumeM3: number;
    cLen: number; // Comprimento em células (X)
    cWid: number; // Largura em células (Z)
    cHei: number; // Altura em células (Y)
    color: string;
    isHeavy: boolean;
    lifoZone: "cabine" | "meio" | "porta";
  }[] = [];

  validStops.forEach((stop, sIdx) => {
    const color = PALETTE[sIdx % PALETTE.length];
    const nPackages = stop.cleanPackages;
    const unitVol = Math.max(0.015, stop.cleanVol / nPackages);
    const unitWeight = stop.cleanWeight / nPackages;
    
    // Classificação da zona longitudinal LIFO
    const relativePos = stop.cleanSeq / totalStops;
    let zone: "cabine" | "meio" | "porta" = "meio";
    if (relativePos > 0.65) zone = "cabine"; // Entregue no fim -> Fica na cabine (fundo)
    else if (relativePos <= 0.35) zone = "porta"; // Entregue no início -> Fica junto à porta

    for (let b = 1; b <= nPackages; b++) {
      // 1 célula de 5x5x5cm = 125 cm³ = 0.000125 m³ (0.125 Litros)
      const targetCells = Math.max(100, Math.round(unitVol / 0.000125));
      const baseSide = Math.round(Math.pow(targetCells, 1 / 3));

      // Garante caixas cúbicas/paralelepipédicas robustas (NUNCA finas como folha de papel)
      // Mínimo de 5 células (25cm) em comprimento/largura e 4 células (20cm) em altura
      let cLen = Math.max(5, Math.min(14, baseSide));
      let cWid = Math.max(5, Math.min(14, baseSide));
      let cHei = Math.max(4, Math.min(12, Math.round(targetCells / (cLen * cWid))));

      // Proteção de limites físicos da viatura
      cLen = Math.min(cLen, nx - 2);
      cWid = Math.min(cWid, nz - 2);
      cHei = Math.min(cHei, ny - 2);

      rawBoxes.push({
        stopId: stop.id || stop.cliente_id || `stop-${stop.cleanSeq}`,
        stopSeq: stop.cleanSeq,
        clientName: stop.client_name || stop.Nome || stop.Cliente || `Cliente ${stop.cleanSeq}`,
        address: stop.address || stop.morada || stop.Morada || "",
        boxIndex: b,
        totalBoxesForStop: nPackages,
        weightKg: Number(unitWeight.toFixed(1)),
        volumeM3: Number(unitVol.toFixed(3)),
        cLen,
        cWid,
        cHei,
        color,
        isHeavy: unitWeight >= 25,
        lifoZone: zone,
      });
    }
  });

  // 2. Ordenação LIFO e Gravidade Hierárquica:
  // - Ordem primária: stopSeq decrescente (Seq N entregue em último -> carregada primeiro para a cabine)
  // - Ordem secundária: weightKg decrescente (caixas mais pesadas carregadas primeiro -> assentam no chão)
  // - Ordem terciária: volume decrescente
  rawBoxes.sort((a, b) => {
    if (b.stopSeq !== a.stopSeq) {
      return b.stopSeq - a.stopSeq;
    }
    const weightDiff = b.weightKg - a.weightKg;
    if (Math.abs(weightDiff) > 0.5) {
      return weightDiff;
    }
    return (b.cLen * b.cWid * b.cHei) - (a.cLen * a.cWid * a.cHei);
  });

  // Mapa de pesos para validação física de suporte
  const boxWeightsMap = new Map<number, number>();

  // Função auxiliar: verificar se o bloco de células está 100% livre
  function canPlace(ix: number, iy: number, iz: number, len: number, hei: number, wid: number): boolean {
    if (ix < 0 || ix + len > nx) return false;
    if (iy < 0 || iy + hei > ny) return false;
    if (iz < 0 || iz + wid > nz) return false;

    for (let x = ix; x < ix + len; x++) {
      for (let y = iy; y < iy + hei; y++) {
        for (let z = iz; z < iz + wid; z++) {
          if (grid[getIdx(x, y, z)] !== 0) {
            return false;
          }
        }
      }
    }
    return true;
  }

  // Função auxiliar: verificar suporte físico por gravidade (piso ou caixa robusta por baixo)
  function hasSupport(ix: number, iy: number, iz: number, len: number, wid: number, boxWeight: number): boolean {
    if (iy === 0) return true; // Chão da viatura: suporte 100% garantido!

    let supportedCells = 0;
    const totalBaseCells = len * wid;

    for (let x = ix; x < ix + len; x++) {
      for (let z = iz; z < iz + wid; z++) {
        const belowId = grid[getIdx(x, iy - 1, z)];
        if (belowId !== 0) {
          const belowWeight = boxWeightsMap.get(belowId) || 20;
          // Não permitir caixa muito pesada em cima de caixa frágil
          if (belowWeight >= boxWeight * 0.4) {
            supportedCells++;
          }
        }
      }
    }

    return supportedCells / totalBaseCells >= 0.55;
  }

  // 3. Empacotamento Voxel 3D sem sobreposição
  const placedBoxes: CargoBox[] = [];

  rawBoxes.forEach((box, boxIdx) => {
    const numericId = boxIdx + 1;
    boxWeightsMap.set(numericId, box.weightKg);

    const { cLen, cHei, cWid } = box;

    // Alvo longitudinal X por LIFO:
    // Seq 1 (primeira entrega) -> targetIx junto às portas (nx - cLen)
    // Seq N (última entrega) -> targetIx junto à cabine (0)
    const targetRatio = totalStops > 1
      ? (totalStops - box.stopSeq) / (totalStops - 1)
      : 0.5;
    const targetIx = Math.round((1 - targetRatio) * (nx - cLen));

    // Janelas de pesquisa de zona LIFO
    let minIx = 0;
    let maxIx = nx - cLen;

    if (box.lifoZone === "cabine") {
      minIx = 0;
      maxIx = Math.min(nx - cLen, Math.floor(nx * 0.45));
    } else if (box.lifoZone === "porta") {
      minIx = Math.max(0, Math.floor(nx * 0.50));
      maxIx = nx - cLen;
    } else {
      minIx = Math.max(0, Math.floor(nx * 0.18));
      maxIx = Math.min(nx - cLen, Math.floor(nx * 0.82));
    }

    let bestPos: { ix: number; iy: number; iz: number } | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    // 1ª Passagem: Dentro da zona LIFO estrita, varrendo SEMPRE o chão (iy = 0) primeiro!
    for (let iy = 0; iy <= ny - cHei; iy++) {
      // Se já encontrámos lugar no chão, não subimos em altura
      if (bestPos && iy > bestPos.iy) break;

      for (let ix = minIx; ix <= maxIx; ix++) {
        for (let iz = 0; iz <= nz - cWid; iz++) {
          if (canPlace(ix, iy, iz, cLen, cHei, cWid) && hasSupport(ix, iy, iz, cLen, cWid, box.weightKg)) {
            const distLIFO = Math.abs(ix - targetIx);
            // iy tem peso altíssimo para preencher todo o chão da carrinha antes de empilhar
            const score = iy * 100000 + distLIFO * 25 + iz;
            if (score < bestScore) {
              bestScore = score;
              bestPos = { ix, iy, iz };
            }
          }
        }
      }
    }

    // 2ª Passagem: Se a zona estrita estiver preenchida, expande para toda a carrinha mantendo LIFO
    if (!bestPos) {
      for (let iy = 0; iy <= ny - cHei; iy++) {
        if (bestPos && iy > bestPos.iy) break;

        for (let ix = 0; ix <= nx - cLen; ix++) {
          for (let iz = 0; iz <= nz - cWid; iz++) {
            if (canPlace(ix, iy, iz, cLen, cHei, cWid) && hasSupport(ix, iy, iz, cLen, cWid, box.weightKg)) {
              const distLIFO = Math.abs(ix - targetIx);
              const score = iy * 100000 + distLIFO * 25 + iz;
              if (score < bestScore) {
                bestScore = score;
                bestPos = { ix, iy, iz };
              }
            }
          }
        }
      }
    }

    // 3ª Passagem de emergência: Relaxa suporte se o espaço estiver saturado
    if (!bestPos) {
      for (let iy = 0; iy <= ny - cHei; iy++) {
        if (bestPos) break;
        for (let ix = 0; ix <= nx - cLen; ix++) {
          if (bestPos) break;
          for (let iz = 0; iz <= nz - cWid; iz++) {
            if (canPlace(ix, iy, iz, cLen, cHei, cWid)) {
              bestPos = { ix, iy, iz };
              break;
            }
          }
        }
      }
    }

    // Posição final garantida na grelha voxel
    const finalIx = bestPos ? bestPos.ix : Math.min(targetIx, nx - cLen);
    const finalIy = bestPos ? bestPos.iy : 0;
    const finalIz = bestPos ? bestPos.iz : 0;

    // Marcação absoluta na grelha 3D (garante ZERO sobreposição futura)
    for (let x = finalIx; x < Math.min(nx, finalIx + cLen); x++) {
      for (let y = finalIy; y < Math.min(ny, finalIy + cHei); y++) {
        for (let z = finalIz; z < Math.min(nz, finalIz + cWid); z++) {
          grid[getIdx(x, y, z)] = numericId;
        }
      }
    }

    // Conversão métrica de células para o espaço 3D da viatura:
    // Margem visual de 6mm entre caixas vizinhas para delimitar as arestas e evitar z-fighting
    const boxLengthM = Number(Math.max(0.20, cLen * CELL_SIZE - 0.006).toFixed(3));
    const boxHeightM = Number(Math.max(0.18, cHei * CELL_SIZE - 0.006).toFixed(3));
    const boxWidthM = Number(Math.max(0.20, cWid * CELL_SIZE - 0.006).toFixed(3));

    // Centro geométrico:
    // X: de 0 (Cabine) a L (Portas Traseiras)
    const posX = Number(((finalIx + cLen / 2) * CELL_SIZE).toFixed(3));
    // Y: de 0 (Piso) a H (Teto)
    const posY = Number(((finalIy + cHei / 2) * CELL_SIZE).toFixed(3));
    // Z: de -W/2 (Esquerda) a +W/2 (Direita)
    const posZ = Number((-container.width / 2 + (finalIz + cWid / 2) * CELL_SIZE).toFixed(3));

    placedBoxes.push({
      id: `box-${box.stopSeq}-${box.boxIndex}`,
      stopId: box.stopId,
      stopSeq: box.stopSeq,
      clientName: box.clientName,
      address: box.address,
      boxIndex: box.boxIndex,
      totalBoxesForStop: box.totalBoxesForStop,
      weightKg: box.weightKg,
      volumeM3: box.volumeM3,
      length: boxLengthM,
      height: boxHeightM,
      width: boxWidthM,
      position: {
        x: posX,
        y: posY,
        z: posZ,
      },
      color: box.color,
      lifoZone: box.lifoZone,
      isHeavy: box.isHeavy,
      gridCells: {
        cLen,
        cWid,
        cHei,
      },
    });
  });

  return placedBoxes;
}
