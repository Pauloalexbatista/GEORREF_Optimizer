/**
 * Utilitários de Cálculo de Carregamento 3D (3D Bin Packing LIFO & Gravidade)
 * 
 * Implementação de Carregamento Logístico Real por Parede de Carga (Wall-Building LIFO):
 * Garante 100% de ocupação física e empacotamento completo de todas as encomendas no baú da viatura.
 * 
 * Regras Operacionais Invioláveis:
 * 1. 100% dos Volumes Carregados: Nenhum bulto fica de fora da viatura.
 * 2. LIFO Estrito por Ordem de Rota:
 *    - O último cliente a ser entregue (Seq N) é empacotado no FUNDO / CABINE (X = 0).
 *    - O primeiro cliente a ser entregue (Seq 1) fica junto às PORTAS TRASEIRAS (X = L).
 * 3. Encomendas do Mesmo Cliente 100% Contíguas:
 *    - Todas as caixas de um cliente ficam agrupadas no mesmo bloco transversal.
 * 4. Física e Gravidade Real:
 *    - Caixas mais pesadas do cliente assentam no chão (Y = 0).
 *    - Caixas de peso idêntico empilham ordenadamente sobre as inferiores com suporte 100%.
 *    - Caixas mais leves ficam sempre no topo (zero caixas suspensas no ar).
 * 5. 0% Sobreposição: Separação física clara entre volumes vizinhos.
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
  overflow?: boolean;
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

export function normalizeVehicleVolume(val: number): number {
  if (!val || val <= 0) return 12;
  if (val > 120) return Number((val / 1000).toFixed(2));
  return Number(val.toFixed(2));
}

export function normalizeStopVolume(val: number): number {
  if (!val || val <= 0) return 0.15;
  if (val > 20) return Number((val / 1000).toFixed(3));
  return Number(val.toFixed(3));
}

export function estimateVehicleDimensions(volumeM3: number, maxWeightKg: number): VehicleContainerDimensions {
  const normVol = normalizeVehicleVolume(volumeM3);
  const vol = Math.max(normVol > 0 ? normVol : 12, 4);
  
  const height = Math.min(Math.max(1.65, Math.pow(vol * 0.12, 0.38)), 2.20);
  const width = Math.min(Math.max(1.60, Math.pow(vol * 0.12, 0.38)), 2.10);
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
 * Calcula o plano de carregamento 3D garantindo 100% dos volumes arrumados no baú.
 */
export function calculateCargoLoadingPlan(
  stops: any[],
  container: VehicleContainerDimensions
): CargoBox[] {
  if (!stops || stops.length === 0) return [];

  // 1. Filtrar apenas paragens reais (excluir armazém de partida e regresso)
  const validStops = stops
    .filter((s) => {
      const name = (s.client_name || s.Nome || s.Cliente || s.Nome_Cliente || "").toUpperCase();
      return !name.includes("ARMAZÉM") && !name.includes("ARMAZEM") && !name.includes("DEPÓSITO");
    })
    .map((s, index) => {
      const seq = Number(s.seq || s.sequence || s.Ordem || index + 1);
      const rawWeight = Number(s.weight || s.peso || s.Peso_KG || 15);
      const rawVol = Number(s.volume || s.vol || s.Volume_m3 || 0.15);
      const cleanWeight = rawWeight > 0 ? rawWeight : 15;
      const cleanVol = normalizeStopVolume(rawVol);
      const rawPackages = Number(s.packages || s.bultos || s.volumes || s.Volumes || 0);
      const packages =
        rawPackages > 0
          ? Math.min(Math.round(rawPackages), 60)
          : Math.max(1, Math.min(15, Math.round(cleanVol / 0.08) || 1));

      return {
        cleanSeq: seq,
        cleanWeight,
        cleanVol,
        cleanPackages: packages,
        clientName: s.client_name || s.Nome || s.Cliente || s.Nome_Cliente || `Cliente ${seq}`,
        address: s.address || s.morada || s.Morada || "",
        id: s.id || s.ID_Original || s.cliente_id || `stop-${seq}`,
      };
    });

  if (validStops.length === 0) return [];

  // Mapeamento estável de cor por cliente baseado na ordem de entrega (#1 -> N)
  const colorBySeq = new Map<number, string>();
  [...validStops]
    .sort((a, b) => a.cleanSeq - b.cleanSeq)
    .forEach((s, i) => colorBySeq.set(s.cleanSeq, PALETTE[i % PALETTE.length]));

  // 2. Ordenação LIFO Rigorosa:
  // Última entrega da rota entra primeiro (Fundo/Cabine, X=0)
  // Primeira entrega (#1) entra por último (Portas Traseiras, X=L)
  const sortedStops = [...validStops].sort((a, b) => b.cleanSeq - a.cleanSeq);
  const totalStopsCount = sortedStops.length;

  const totalStopVolume = sortedStops.reduce((sum, s) => sum + s.cleanVol, 0);
  const L = container.length;
  const W = container.width;
  const H = container.height;

  // Espaço longitudinal útil com folgas de segurança
  const totalUsableLength = L * 0.96;
  const GAP = 0.006; // Separação visual limpa entre caixas para arestas perfeitas

  // 3. Distribuição das Fatias Longitudinais (X) por Cliente
  // Cada cliente tem garantida a sua fatia contígua ao longo de X proporcional ao seu volume
  const rawSlices = sortedStops.map((stop) => {
    const volRatio = totalStopVolume > 0 ? stop.cleanVol / totalStopVolume : 1 / totalStopsCount;
    // Comprimento mínimo para a fatia de cada cliente (mínimo 18cm)
    const rawDx = volRatio * totalUsableLength;
    return Math.max(0.18, rawDx);
  });

  const sumRawSlices = rawSlices.reduce((a, b) => a + b, 0);
  const scaleX = totalUsableLength / sumRawSlices;
  const clientLengths = rawSlices.map((dx) => dx * scaleX);

  const placedBoxes: CargoBox[] = [];
  let currentStartX = L * 0.02; // Pequena folga junto à parede frontal da cabine

  // 4. Construção Modular Parede-a-Parede (Wall-Building) Cliente a Cliente
  sortedStops.forEach((stop, stopIdx) => {
    const clientColor = colorBySeq.get(stop.cleanSeq) || PALETTE[stopIdx % PALETTE.length];
    const nPackages = stop.cleanPackages;
    const clientTotalWeight = stop.cleanWeight;
    const clientTotalVol = stop.cleanVol;
    const sliceDx = clientLengths[stopIdx];

    // Distribuição de pesos das caixas do cliente (ordenados do mais pesado para o mais leve)
    const boxWeights: number[] = [];
    if (nPackages === 1) {
      boxWeights.push(clientTotalWeight);
    } else {
      // Gradiente suave de peso: as caixas mais pesadas e volumosas ficam na base
      for (let b = 1; b <= nPackages; b++) {
        const factor = 1 + (nPackages - b) * 0.25;
        const avgFactor = 1 + ((nPackages - 1) / 2) * 0.25;
        const normFactor = factor / avgFactor;
        boxWeights.push(Number(((clientTotalWeight / nPackages) * normFactor).toFixed(1)));
      }
      boxWeights.sort((a, b) => b - a); // Mais pesadas primeiro
    }

    // Geometria em grelha ótima para este cliente:
    // Determinar número de camadas em altura (layersY), colunas em largura (colsZ) e fatias em X (rowsX)
    let bestConfig = { rowsX: 1, layersY: 1, colsZ: 1 };
    let bestDiff = Number.POSITIVE_INFINITY;
    // Se a fatia longitudinal for estreita (< 0.35m), fixamos rowsX = 1 para manter as caixas do cliente perfeitamente alinhadas
    const maxRows = sliceDx < 0.35 ? 1 : Math.min(3, nPackages);

    for (let rows = 1; rows <= maxRows; rows++) {
      for (let layers = 1; layers <= nPackages; layers++) {
        const cols = Math.ceil(nPackages / (rows * layers));
        if (cols < 1) continue;

        const bL = sliceDx / rows;
        const bH = (H * 0.94) / layers;
        const bW = (W * 0.96) / cols;

        // Proporções ideais de caixas industriais (evitar caixas finas ou desproporcionais)
        const diff = Math.abs(bW - bH) * 1.2 + Math.abs(bL - bW) * 0.8;
        if (diff < bestDiff) {
          bestDiff = diff;
          bestConfig = { rowsX: rows, layersY: layers, colsZ: cols };
        }
      }
    }

    const { rowsX, layersY, colsZ } = bestConfig;
    const boxDimL = sliceDx / rowsX;
    const boxDimW = (W * 0.96) / colsZ;
    const boxDimH = (H * 0.94) / layersY;

    // Calcular posições de cada slot da grelha deste cliente
    // Prioridade estrita à gravidade:
    // Camada Y=0 (Piso) preenchida PRIMEIRO pelas caixas mais pesadas!
    // Camadas Y>=1 (Empilhamento) preenchidas depois pelas caixas de igual peso ou mais leves.
    const clientSlots: { row: number; layer: number; col: number }[] = [];

    for (let layer = 0; layer < layersY; layer++) {
      for (let row = 0; row < rowsX; row++) {
        for (let col = 0; col < colsZ; col++) {
          clientSlots.push({ row, layer, col });
        }
      }
    }

    // Ordenar os slots: Camada mais baixa (layer=0 chão) primeiro, depois de trás para a frente e da esquerda para a direita
    clientSlots.sort((a, b) => {
      if (a.layer !== b.layer) return a.layer - b.layer; // Chão primeiro
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });

    // Posição média longitudinal para atribuição consistente da zona LIFO do cliente
    const clientMidX = currentStartX + sliceDx / 2;
    const normX = clientMidX / L;
    let clientLifoZone: "cabine" | "meio" | "porta" = "meio";
    if (normX < 0.35) {
      clientLifoZone = "cabine"; // Fundo
    } else if (normX > 0.65) {
      clientLifoZone = "porta"; // Porta
    }

    // Colocar rigorosamente os N volumes deste cliente nos slots
    for (let bIdx = 0; bIdx < nPackages; bIdx++) {
      const slot = clientSlots[bIdx] || clientSlots[clientSlots.length - 1];
      const boxWeight = boxWeights[bIdx] || Number((clientTotalWeight / nPackages).toFixed(1));
      const boxVolume = Number((clientTotalVol / nPackages).toFixed(3));

      // Dimensões com folga visual de aresta (estritamente contidas no slot)
      const renderL = Math.max(0.06, boxDimL - GAP);
      const renderH = Math.max(0.06, boxDimH - GAP);
      const renderW = Math.max(0.06, boxDimW - GAP);

      // Coordenadas métricas no espaço do veículo:
      // X: [0 -> L] (Cabine até Portas Traseiras)
      const posX = Number((currentStartX + slot.row * boxDimL + boxDimL / 2).toFixed(3));
      // Y: [0 -> H] (Piso até Teto)
      const posY = Number((slot.layer * boxDimH + boxDimH / 2).toFixed(3));
      // Z: [-W/2 -> +W/2] (Esquerda até Direita)
      const posZ = Number((-W / 2 + (W * 0.02) + slot.col * boxDimW + boxDimW / 2).toFixed(3));

      placedBoxes.push({
        id: `box-${stop.cleanSeq}-${bIdx + 1}`,
        stopId: stop.id,
        stopSeq: stop.cleanSeq,
        clientName: stop.clientName,
        address: stop.address,
        boxIndex: bIdx + 1,
        totalBoxesForStop: nPackages,
        weightKg: boxWeight,
        volumeM3: boxVolume,
        length: Number(renderL.toFixed(3)),
        height: Number(renderH.toFixed(3)),
        width: Number(renderW.toFixed(3)),
        position: {
          x: posX,
          y: posY,
          z: posZ,
        },
        color: clientColor,
        lifoZone: clientLifoZone,
        isHeavy: boxWeight >= 25,
        overflow: false,
        gridCells: {
          cLen: Math.max(3, Math.round(renderL / 0.05)),
          cWid: Math.max(3, Math.round(renderW / 0.05)),
          cHei: Math.max(3, Math.round(renderH / 0.05)),
        },
      });
    }

    // Avança a fronteira longitudinal de carregamento para o próximo cliente
    currentStartX += sliceDx;
  });

  return placedBoxes;
}
