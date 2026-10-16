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
 * Estima as dimensões realistas do baú da viatura com base no volume máximo registado.
 * Mantém rácios de carrinha/furgão de mercadorias típico (ex: Renault Master, Mercedes Sprinter, Iveco Daily).
 */
export function estimateVehicleDimensions(volumeM3: number, maxWeightKg: number): VehicleContainerDimensions {
  const vol = Math.max(volumeM3 > 0 ? volumeM3 : 12, 6);
  
  // Altura útil interior típica de furgão: entre 1.80m e 2.10m
  const height = Math.min(Math.max(1.75, Math.pow(vol * 0.15, 0.4)), 2.15);
  // Largura útil interior: 1.80m a 2.10m
  const width = Math.min(Math.max(1.75, Math.pow(vol * 0.15, 0.4)), 2.05);
  // Comprimento resultante do volume restante com folga de embalamento
  const length = Math.max(2.4, (vol / (width * height)));

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
      const name = (s.client_name || s.Nome || "").toUpperCase();
      return !name.includes("ARMAZÉM") && !name.includes("ARMAZEM") && !name.includes("DEPÓSITO");
    })
    .map((s, index) => {
      const seq = s.seq || s.sequence || (index + 1);
      const weight = Number(s.weight || s.peso || 15);
      const vol = Number(s.volume || s.vol || 0.15);
      const packages = Math.max(1, Number(s.packages || s.bultos || 1));
      return {
        ...s,
        cleanSeq: seq,
        cleanWeight: weight > 0 ? weight : 15,
        cleanVol: vol > 0 ? vol : 0.15,
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
      // Estima dimensões tridimensionais proporcionais ao volume unitário
      // Rácio modular tipo caixa de cartão logística (ex: 50x40x35cm)
      const baseSide = Math.pow(unitVol, 1 / 3);
      const l = Number(Math.max(0.25, Math.min(1.0, baseSide * 1.15)).toFixed(2));
      const w = Number(Math.max(0.25, Math.min(0.9, baseSide * 0.95)).toFixed(2));
      const h = Number(Math.max(0.20, Math.min(1.1, unitVol / (l * w))).toFixed(2));

      rawBoxes.push({
        stopId: stop.id || stop.cliente_id || `stop-${stop.cleanSeq}`,
        stopSeq: stop.cleanSeq,
        clientName: stop.client_name || stop.Nome || `Cliente ${stop.cleanSeq}`,
        address: stop.address || stop.morada || "",
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

  // 2. Ordenação LIFO (Last In First Out):
  // Primeiro as paragens com maior sequência (descarregadas em último)
  // Dentro de paragens equivalentes, as mais pesadas e volumosas ficam em primeiro (em baixo)
  rawBoxes.sort((a, b) => {
    if (b.stopSeq !== a.stopSeq) {
      return b.stopSeq - a.stopSeq; // LIFO decrescente
    }
    // Critério de Gravidade: mais pesada primeiro
    return b.weightKg - a.weightKg;
  });

  // 3. Empacotamento Tridimensional (Grid Placement com suporte físico)
  // X = [0 -> length] (0 = Cabine/Frente, length = Portas Traseiras)
  // Z = [-width/2 -> +width/2] (Esquerda -> Direita)
  // Y = [0 -> height] (0 = Piso da viatura -> Teto)

  const placedBoxes: CargoBox[] = [];
  const padding = 0.03; // 3cm de folga entre caixas para realismo
  const L = container.length;
  const W = container.width;
  const H = container.height;

  // Alocação por faixas longitudinais baseadas na prioridade LIFO
  // Dividimos o comprimento do carro em fatias conforme a sequência da paragem
  let currentX = padding;
  let currentZ = -W / 2 + padding;
  let currentY = 0;
  let currentMaxRowHeight = 0;
  let currentMaxSliceLength = 0;

  for (const box of rawBoxes) {
    // Cálculo da fatia teórica no eixo X pela regra LIFO
    // Seq totalStops fica perto de 0 (Cabine); Seq 1 fica perto de L (Porta)
    const lifoRatio = (totalStops - box.stopSeq) / Math.max(1, totalStops - 1);
    const targetMinX = lifoRatio * (L - box.length - padding * 2);
    
    // Se o ponto atual de X estiver muito atrás da faixa LIFO recomendada, avança
    if (currentX < targetMinX && currentY === 0) {
      currentX = targetMinX;
    }

    // Se ultrapassar a largura do carro na fila atual, recua Z e empilha ou cria nova linha
    if (currentZ + box.width > W / 2 - padding) {
      currentZ = -W / 2 + padding;
      currentX += currentMaxSliceLength + padding;
      currentMaxSliceLength = 0;
      currentY = 0;
    }

    // Se ultrapassar o comprimento do carro, tenta empilhar (subir em Y)
    if (currentX + box.length > L - padding) {
      currentX = padding;
      currentZ = -W / 2 + padding;
      currentY += currentMaxRowHeight + padding;
      currentMaxRowHeight = 0;
    }

    // Se mesmo assim ultrapassar a altura máxima do teto, assenta em topo seguro
    const finalY = Math.min(currentY, Math.max(0, H - box.height));
    const finalX = Math.min(currentX, Math.max(0, L - box.length - padding));
    const finalZ = Math.min(currentZ, Math.max(-W / 2 + padding, W / 2 - box.width - padding));

    // O centro geométrico é o canto inferior esquerdo + metade das dimensões
    const posX = finalX + box.length / 2;
    const posY = finalY + box.height / 2;
    const posZ = finalZ + box.width / 2;

    placedBoxes.push({
      ...box,
      id: `box-${box.stopSeq}-${box.boxIndex}`,
      position: {
        x: Number(posX.toFixed(3)),
        y: Number(posY.toFixed(3)),
        z: Number(posZ.toFixed(3)),
      },
    });

    // Atualiza ponteiros de posição
    currentZ += box.width + padding;
    if (box.height > currentMaxRowHeight) {
      currentMaxRowHeight = box.height;
    }
    if (box.length > currentMaxSliceLength) {
      currentMaxSliceLength = box.length;
    }
  }

  return placedBoxes;
}
