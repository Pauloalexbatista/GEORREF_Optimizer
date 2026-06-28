"use client";

import React, { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useProjects } from "@/context/ProjectContext";
import { apiRequest } from "@/utils/api";
import dynamic from "next/dynamic";

const MapComponent = dynamic(() => import("@/components/MapComponent"), { ssr: false });

interface RouteNode {
  Rota: string;
  Armazem: string;
  Ordem: number;
  Cliente: string;
  Morada: string;
  CP: string;
  Localidade: string;
  Janela_Horaria: string;
  Latitude: number;
  Longitude: number;
  Chegada: string;
  Tempo_Entrega: number;
  Saida: string;
  Nivel_Qualidade: number;
  KM_Anterior: number;
  Dist_Acum: number;
  Carga_Acum: number;
  Carga_Vol_Acum: number;
}

export default function TacticalDashboardPage() {
  const { selectedProject } = useProjects();
  const [loading, setLoading] = useState(false);
  const [solving, setSolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [routes, setRoutes] = useState<RouteNode[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<string[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);

  // Optimization params
  const [showConfig, setShowConfig] = useState(false);
  const [timeLimit, setTimeLimit] = useState(15);
  const [distWeight, setDistWeight] = useState(100);
  const [balWeight, setBalWeight] = useState(30);
  const [maxDur, setMaxDur] = useState(480);

  // Accordion active route state
  const [expandedRoute, setExpandedRoute] = useState<string | null>(null);

  // Fetch initial tactical configurations
  useEffect(() => {
    if (!selectedProject) return;

    async function loadTacticalData() {
      setLoading(true);
      setError(null);
      try {
        // 1. Fetch geocoded warehouses and fleet
        const fleetData = await apiRequest(`/api/fleet/${selectedProject?.id}`);
        setWarehouses(fleetData.warehouses || []);
        const vehicleNames = (fleetData.fleet || []).map((v: any) => v.veiculo);
        setVehicles(vehicleNames);

        // 2. Fetch deliveries to map IDs
        const deliveryList = await apiRequest(`/api/geocoding/${selectedProject?.id}`);
        setDeliveries(deliveryList || []);

        // 3. Fetch optimized routes from last snapshot
        const res = await apiRequest(`/api/solver/${selectedProject?.id}`);
        setRoutes(res.routes || []);
        if (res.routes && res.routes.length > 0) {
          const firstRoute = res.routes[0].Rota;
          setExpandedRoute(firstRoute);
        }
      } catch (e: any) {
        console.error("Failed to load tactical data:", e);
        setError("Erro ao carregar dados táticos. Por favor configure a frota e carregue os clientes primeiro.");
      } finally {
        setLoading(false);
      }
    }
    loadTacticalData();
  }, [selectedProject]);

  const handleSolveRoutes = async () => {
    if (!selectedProject) return;
    setSolving(true);
    setError(null);
    setShowConfig(false);

    try {
      const res = await apiRequest("/api/solver/solve", {
        method: "POST",
        body: JSON.stringify({
          project_id: selectedProject.id,
          params: {
            time_limit: timeLimit,
            distance_weight: distWeight,
            balance_weight: balWeight,
            max_route_duration: maxDur,
          },
        }),
      });

      if (res.status === "failure") {
        let errMsg = "Falha no cálculo matemático das rotas. ";
        if (res.diagnostics?.weight_capacity_insufficient) {
          errMsg += "A capacidade total de peso da frota é insuficiente para as entregas.";
        } else if (res.diagnostics?.volume_capacity_insufficient) {
          errMsg += "A capacidade total volumétrica da frota é insuficiente para as entregas.";
        } else {
          errMsg += "Verifique se a duração máxima por rota ou capacidades dos veículos não estão muito restritivas.";
        }
        setError(errMsg);
      } else {
        setRoutes(res.routes || []);
        if (res.routes && res.routes.length > 0) {
          setExpandedRoute(res.routes[0].Rota);
        }
      }
    } catch (e: any) {
      setError(e.message || "Erro inesperado ao otimizar rotas.");
    } finally {
      setSolving(false);
    }
  };

  const handleMoveClientRoute = async (clientName: string, newRoute: string) => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const res = await apiRequest("/api/solver/reassign", {
        method: "POST",
        body: JSON.stringify({
          project_id: selectedProject.id,
          client_code: clientName,
          new_route: newRoute,
        }),
      });
      setRoutes(res.routes || []);
    } catch (e: any) {
      alert(e.message || "Erro ao reatribuir rota.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateClientCoords = async (clientName: string, lat: number, lon: number) => {
    if (!selectedProject) return;
    // Find delivery ID by matching client name/code
    const match = deliveries.find(d => d.codigo_cliente === clientName);
    if (!match) return;

    setLoading(true);
    try {
      // 1. Update coords in deliveries table
      await apiRequest(`/api/geocoding/delivery/${match.id}`, {
        method: "PUT",
        body: JSON.stringify({
          morada: match.morada,
          codigo_postal: match.codigo_postal,
          concelho: match.concelho,
          latitude: lat,
          longitude: lon,
        }),
      });

      // 2. Automatically re-trigger solver to recalculate the routes
      const solveRes = await apiRequest("/api/solver/solve", {
        method: "POST",
        body: JSON.stringify({
          project_id: selectedProject.id,
          params: {
            time_limit: timeLimit,
            distance_weight: distWeight,
            balance_weight: balWeight,
            max_route_duration: maxDur,
          },
        }),
      });

      if (solveRes.status !== "failure") {
        setRoutes(solveRes.routes || []);
      }
    } catch (e: any) {
      alert(e.message || "Erro ao atualizar coordenadas.");
    } finally {
      setLoading(false);
    }
  };

  // Group routes for accordion view
  const groupedRoutes: { [key: string]: RouteNode[] } = {};
  routes.forEach(r => {
    if (!groupedRoutes[r.Rota]) {
      groupedRoutes[r.Rota] = [];
    }
    groupedRoutes[r.Rota].push(r);
  });

  return (
    <DashboardLayout>
      <div className="space-y-6 h-[calc(100vh-8.5rem)] flex flex-col">
        {/* Header Section */}
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-50 font-sans">Dashboard Tático</h1>
            <p className="text-zinc-400 text-xs mt-1">Calcule trajetos eficientes e acompanhe as rotas de distribuição em tempo real.</p>
          </div>
          
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowConfig(true)}
              className="cursor-pointer bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 hover:border-zinc-700 text-zinc-300 rounded-xl px-4 py-2 text-xs font-semibold transition-colors flex items-center space-x-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Configurações</span>
            </button>
            <button
              onClick={handleSolveRoutes}
              disabled={solving || loading || vehicles.length === 0}
              className="cursor-pointer bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white rounded-xl px-5 py-2 text-xs font-semibold shadow-md shadow-indigo-500/10 transition-all flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {solving ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                  <span>A Calcular...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>Otimizar Rotas</span>
                </>
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-950/40 border border-red-800/80 rounded-xl text-red-200 text-xs shrink-0 flex items-start space-x-2">
            <svg className="w-4 h-4 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Dashboard split content */}
        <div className="flex-1 flex gap-6 min-h-0">
          {/* Left panel: MapComponent */}
          <div className="flex-1 min-w-0">
            {warehouses.length === 0 ? (
              <div className="w-full h-full border border-zinc-800 bg-zinc-900/40 rounded-2xl flex flex-col items-center justify-center text-center p-6 space-y-3">
                <p className="text-sm text-zinc-500 font-medium">Nenhum armazém configurado para exibir o mapa.</p>
                <Link href="/dashboard/fleet" className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold transition-colors">Configurar Frota e Armazéns →</Link>
              </div>
            ) : (
              <MapComponent
                clients={routes.map(r => ({
                  Cliente: r.Cliente,
                  Morada: r.Morada,
                  Latitude: r.Latitude,
                  Longitude: r.Longitude,
                  Rota: r.Rota,
                  Ordem: r.Ordem
                }))}
                warehouses={warehouses.map(w => ({
                  name: w.name,
                  lat: w.lat,
                  lon: w.lon
                }))}
                vehicles={vehicles}
                onMoveClientRoute={handleMoveClientRoute}
                onUpdateClientCoords={handleUpdateClientCoords}
              />
            )}
          </div>

          {/* Right panel: Routing tables */}
          <div className="w-[420px] shrink-0 border border-zinc-800 bg-zinc-900/60 backdrop-blur-md rounded-2xl flex flex-col overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/20">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Rotas e Distribuição</h3>
              {routes.length > 0 && (
                <span className="text-[10px] text-emerald-400 font-semibold px-2 py-0.5 bg-emerald-500/10 rounded-full border border-emerald-500/20">Otimizado</span>
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {routes.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3 text-zinc-500">
                  <svg className="w-8 h-8 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-xs">Não existem rotas calculadas para este projeto.</p>
                  <button
                    onClick={handleSolveRoutes}
                    disabled={solving || vehicles.length === 0}
                    className="cursor-pointer text-xs text-indigo-400 hover:text-indigo-300 font-semibold transition-colors"
                  >
                    Calcular Otimização Agora →
                  </button>
                </div>
              ) : (
                Object.keys(groupedRoutes).map(routeName => {
                  const items = groupedRoutes[routeName];
                  const isExpanded = expandedRoute === routeName;
                  const isPending = routeName.includes("PENDENTE");
                  
                  // Compute stats
                  const totalKg = items.reduce((sum, item) => sum + (item.Carga_Acum || 0), 0);
                  const totalKm = items.length > 0 ? items[items.length - 1].Dist_Acum : 0;
                  
                  return (
                    <div key={routeName} className="bg-zinc-950/40 border border-zinc-800 rounded-xl overflow-hidden">
                      <button
                        onClick={() => setExpandedRoute(isExpanded ? null : routeName)}
                        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-zinc-850/20 transition-colors outline-none cursor-pointer"
                      >
                        <div>
                          <p className={`text-xs font-bold ${isPending ? "text-zinc-400" : "text-zinc-250"}`}>{routeName}</p>
                          <p className="text-[10px] text-zinc-500 mt-0.5">
                            {isPending ? `${items.length} encomendas` : `${items.length} paragens • ${totalKm.toFixed(1)} km`}
                          </p>
                        </div>
                        <svg className={`w-4 h-4 text-zinc-550 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-zinc-800 p-3 space-y-2 bg-zinc-950/20">
                          {items.map((node) => (
                            <div key={node.Cliente} className="p-2.5 bg-zinc-900 border border-zinc-800/80 rounded-lg flex items-center justify-between text-[11px]">
                              <div className="space-y-0.5 min-w-0 pr-2">
                                <p className="font-bold text-zinc-300 truncate">
                                  #{node.Ordem} - Cliente {node.Cliente}
                                </p>
                                <p className="text-[10px] text-zinc-450 truncate">{node.Morada}</p>
                                <p className="text-[9px] font-mono text-zinc-550">
                                  Janela: {node.Janela_Horaria}
                                </p>
                              </div>
                              <div className="text-right shrink-0">
                                {!isPending && (
                                  <>
                                    <p className="font-bold text-indigo-400 font-mono">{node.Chegada}</p>
                                    <p className="text-[9px] text-zinc-500 font-mono">Saída: {node.Saida}</p>
                                    <p className="text-[9px] text-zinc-500 font-mono">+{node.KM_Anterior}km</p>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Optimizer Config Modal */}
      {showConfig && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 w-full max-w-sm rounded-2xl p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-zinc-150">Parâmetros de Otimização</h3>
            
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1">Tempo Limite de Cálculo (s)</label>
                <input
                  type="number"
                  min="5"
                  max="300"
                  value={timeLimit}
                  onChange={e => setTimeLimit(parseInt(e.target.value) || 15)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1">Peso da Distância</label>
                <input
                  type="number"
                  min="0"
                  value={distWeight}
                  onChange={e => setDistWeight(parseInt(e.target.value) || 100)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1">Peso do Balanceamento (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={balWeight}
                  onChange={e => setBalWeight(parseInt(e.target.value) || 30)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-450 mb-1">Duração Máxima da Rota (minutos)</label>
                <input
                  type="number"
                  min="60"
                  value={maxDur}
                  onChange={e => setMaxDur(parseInt(e.target.value) || 480)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowConfig(false)}
                className="bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSolveRoutes}
                className="bg-indigo-500 hover:bg-indigo-650 text-white px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer"
              >
                Salvar & Otimizar
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
