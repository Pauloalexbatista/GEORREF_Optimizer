"use client";

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
];

function getRouteColor(routeName: string, vehicleList: string[]) {
  if (!routeName || routeName.includes("PENDENTE")) return "#f59e0b"; // Amber for pending
  const idx = vehicleList.indexOf(routeName);
  if (idx === -1) return routeColors[0];
  return routeColors[idx % routeColors.length];
}









import React, { useState, useEffect } from "react";



import DashboardLayout from "@/components/DashboardLayout";



import { useProjects } from "@/context/ProjectContext";



import { apiRequest } from "@/utils/api";



import dynamic from "next/dynamic";



import Link from "next/link";







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

  // BroadcastChannel reference for 2nd monitor sync
  const channelRef = React.useRef<any>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      channelRef.current = new BroadcastChannel("georoute_map_sync");
    }
    return () => {
      channelRef.current?.close();
    };
  }, []);





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
  const [limitRouteDuration, setLimitRouteDuration] = useState(true);
  const [maxDurHours, setMaxDurHours] = useState(8);
  const [maxDurMinutes, setMaxDurMinutes] = useState(0);

  // Sync hours and minutes with maxDur when it's set initially from project load
  useEffect(() => {
    if (maxDur && maxDur < 1440 && maxDurHours === 8 && maxDurMinutes === 0) {
      setMaxDurHours(Math.floor(maxDur / 60));
      setMaxDurMinutes(maxDur % 60);
      setLimitRouteDuration(true);
    } else if (maxDur === 1440) {
      setLimitRouteDuration(false);
    }
  }, [maxDur]);

  // Update maxDur automatically based on hours/minutes selection
  useEffect(() => {
    if (limitRouteDuration) {
      setMaxDur(maxDurHours * 60 + maxDurMinutes);
    } else {
      setMaxDur(1440); // 24 hours (unlimited route)
    }
  }, [limitRouteDuration, maxDurHours, maxDurMinutes]);

  const mappedClients = React.useMemo(() => {
    return routes.map(r => ({
      Cliente: r.Cliente,
      Morada: r.Morada,
      Latitude: r.Latitude,
      Longitude: r.Longitude,
      Rota: r.Rota,
      Ordem: r.Ordem,
      Janela_Horaria: r.Janela_Horaria,
      Chegada: r.Chegada,
      Saida: r.Saida,
      KM_Anterior: r.KM_Anterior
    }));
  }, [routes]);

  const formattedWarehouses = React.useMemo(() => {
    return warehouses.map(w => ({
      name: w.Nome_Armazem || w.name || "Armazém",
      address: w.Morada || w.address || "",
      lat: w.Latitude || w.lat || 39.5,
      lon: w.Longitude || w.lon || -8.0
    }));
  }, [warehouses]);

  const broadcastMapUpdate = (cList: any[], wList: any[], vList: string[]) => {
    const payload = { type: "MAP_UPDATE", clients: cList, warehouses: wList, vehicles: vList };
    try {
      channelRef.current?.postMessage(payload);
      localStorage.setItem("georoute_map_state", JSON.stringify(payload));
    } catch (e) {}
  };

  const handleOpenDetachedMap = () => {
    broadcastMapUpdate(mappedClients, formattedWarehouses, vehicles);
    window.open("/dashboard/tactical/detached-map", "GeoRouteDetachedMap", "width=1280,height=800,resizable=yes");
  };

  const handleOpenRoutesMatrix = () => {
    broadcastMapUpdate(mappedClients, formattedWarehouses, vehicles);
    window.open("/dashboard/tactical/routes-matrix", "GeoRouteMatrixMap", "width=1400,height=900,resizable=yes");
  };







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
            time_limit_seconds: timeLimit,



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







    const handleOptimizeSingleRoute = async (routeName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedProject) return;
    setLoading(true);
    try {
      const res = await apiRequest("/api/solver/optimize-single-route", {
        method: "POST",
        body: JSON.stringify({
          project_id: selectedProject.id,
          route_name: routeName,
        }),
      });
      setRoutes(res.routes || []);
    } catch (err: any) {
      alert(err.message || "Erro ao otimizar trajeto da rota.");
    } finally {
      setLoading(false);
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
            time_limit_seconds: timeLimit,



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







  const handleReorderClientStop = async (routeName: string, clientName: string, currentOrder: number, direction: "up" | "down") => {



    if (!selectedProject) return;



    const newOrder = direction === "up" ? currentOrder - 1 : currentOrder + 1;



    setLoading(true);



    try {



      const res = await apiRequest("/api/solver/reorder", {



        method: "POST",



        body: JSON.stringify({



          project_id: selectedProject.id,



          route_name: routeName,



          client_code: clientName,



          new_order: newOrder,



        }),



      });



      setRoutes(res.routes || []);



    } catch (e: any) {



      alert(e.message || "Erro ao reordenar paragem.");



    } finally {



      setLoading(false);



    }



  };







  const handleDownloadFile = async (endpoint: string, filename: string) => {

    try {

      const token = localStorage.getItem("georoute_token");

      const headers = new Headers();

      if (token) {

        headers.set("Authorization", `Bearer ${token}`);

      }

      const response = await fetch(`http://localhost:8000${endpoint}`, {

        headers

      });

      if (!response.ok) {

        throw new Error("Erro ao descarregar ficheiro.");

      }

      const blob = await response.blob();

      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");

      a.href = url;

      a.download = filename;

      document.body.appendChild(a);

      a.click();

      a.remove();

      window.URL.revokeObjectURL(url);

    } catch (e: any) {

      alert(e.message || "Erro ao efetuar o download.");

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
              onClick={handleOpenRoutesMatrix}
              className="cursor-pointer bg-zinc-900 hover:bg-zinc-850 text-indigo-400 border border-zinc-800 rounded-xl px-4 py-2 text-xs font-semibold shadow-sm transition-all flex items-center space-x-2"
              title="Abrir a Matriz de Gestão de Rotas num 3.º monitor"
            >
              <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
              </svg>
              <span>Matriz de Rotas (3º Ecrã)</span>
            </button>
            <button
              onClick={handleOpenDetachedMap}
              className="cursor-pointer bg-zinc-900 hover:bg-zinc-850 text-emerald-400 border border-zinc-800 rounded-xl px-4 py-2 text-xs font-semibold shadow-sm transition-all flex items-center space-x-2"
              title="Abrir o mapa numa janela independente para o 2.º monitor"
            >
              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span>2º Monitor</span>
            </button>



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



                  address: w.address || "",



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

                <>
                  <span className="text-[10px] text-emerald-400 font-semibold px-2 py-0.5 bg-emerald-500/10 rounded-full border border-emerald-500/20">Otimizado</span>
                  <button
                    type="button"
                    onClick={() => handleDownloadFile(`/api/solver/export-full/${selectedProject?.id}`, `GeoRoute_Completo_${selectedProject?.id}.xlsx`)}
                    className="cursor-pointer bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white rounded-lg px-3 py-1.5 text-[10px] font-semibold shadow-md shadow-emerald-500/10 transition-all flex items-center space-x-1.5"
                    title="Exportar Excel Completo"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    <span>Exportar Excel</span>
                  </button>
                </>
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



                    <div 
                      key={routeName} 
                      className="bg-zinc-950/40 border border-zinc-800 rounded-xl overflow-hidden transition-all shadow-sm"
                      style={{ borderLeft: `4px solid ${getRouteColor(routeName, vehicles)}` }}
                    >



                                            <div className="w-full px-4 py-3 flex items-center justify-between hover:bg-zinc-850/20 transition-colors">
                        <div 
                          onClick={() => setExpandedRoute(isExpanded ? null : routeName)}
                          className="flex-1 cursor-pointer flex items-center space-x-2.5"
                        >
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: getRouteColor(routeName, vehicles) }} />
                          <div>
                            <p className={`text-xs font-bold ${isPending ? "text-zinc-400" : "text-zinc-200"}`}>{routeName}</p>
                            <p className="text-[10px] text-zinc-400 mt-0.5 font-mono">
                              {isPending ? `${items.length} encomendas` : `${items.length} paragens • ${totalKm.toFixed(1)} km`}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2">
                          {!isPending && (
                            <button
                              onClick={(e) => handleOptimizeSingleRoute(routeName, e)}
                              className="bg-indigo-950/90 hover:bg-indigo-900 border border-indigo-700/80 text-indigo-300 hover:text-white px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center space-x-1 cursor-pointer shadow-sm"
                              title="Ordenar sequência pelo trajeto mais curto (distância mínima)"
                            >
                              <svg className="w-3 h-3 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                              </svg>
                              <span>⚡ Ordenar</span>
                            </button>
                          )}
                          <button
                            onClick={() => setExpandedRoute(isExpanded ? null : routeName)}
                            className="p-1 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                          >
                            <svg className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        </div>
                      </div>







                      {isExpanded && (



                        <div className="border-t border-zinc-800 p-3 space-y-2 bg-zinc-950/20">



                          {items.map((node, index) => {



                            const isFirst = index === 0;



                            const isLast = index === items.length - 1;



                            return (



                              <div key={node.Cliente} className="p-2.5 bg-zinc-900 border border-zinc-800/80 rounded-lg flex items-center justify-between text-[11px] space-x-2">



                                {/* Reorder buttons */}



                                {!isPending && (



                                  <div className="flex flex-col space-y-0.5 shrink-0">



                                    <button



                                      type="button"



                                      disabled={isFirst || loading}



                                      onClick={() => handleReorderClientStop(routeName, node.Cliente, node.Ordem, "up")}



                                      className="p-0.5 hover:bg-zinc-800 rounded disabled:opacity-30 disabled:hover:bg-transparent text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"



                                      title="Mover para cima"



                                    >



                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">



                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />



                                      </svg>



                                    </button>



                                    <button



                                      type="button"



                                      disabled={isLast || loading}



                                      onClick={() => handleReorderClientStop(routeName, node.Cliente, node.Ordem, "down")}



                                      className="p-0.5 hover:bg-zinc-800 rounded disabled:opacity-30 disabled:hover:bg-transparent text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"



                                      title="Mover para baixo"



                                    >



                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">



                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />



                                      </svg>



                                    </button>



                                  </div>



                                )}



                                



                                <div className="space-y-0.5 min-w-0 pr-2 flex-1">



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



                                      <p className="text-[9px] text-zinc-500 font-mono">Saida: {node.Saida}</p>



                                      <p className="text-[9px] text-zinc-500 font-mono">+{node.KM_Anterior}km</p>



                                    </>



                                  )}



                                </div>



                              </div>



                            );



                          })}



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



            



                        <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-0.5">Tempo Limite do Algoritmo (Segundos)</label>
                <input
                  type="number"
                  min="5"
                  max="300"
                  value={timeLimit}
                  onChange={e => setTimeLimit(parseInt(e.target.value) || 15)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                />
                <p className="text-[9px] text-zinc-500 mt-1">Tempo máximo que o computador passa a procurar uma solução melhor. 15s a 30s é o ideal.</p>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-0.5">Importância da Distância (Redução de KM)</label>
                <input
                  type="number"
                  min="0"
                  value={distWeight}
                  onChange={e => setDistWeight(parseInt(e.target.value) || 100)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                />
                <p className="text-[9px] text-zinc-500 mt-1">Prioridade dada à redução da quilometragem total da frota para poupança de combustível.</p>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-0.5">Equilíbrio de Trabalho entre Viaturas (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={balWeight}
                  onChange={e => setBalWeight(parseInt(e.target.value) || 30)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                />
                <p className="text-[9px] text-zinc-500 mt-1">Prioridade para equilibrar o número de paragens ou tempo de serviço entre os vários motoristas.</p>
              </div>

              <div className="pt-2 border-t border-zinc-800/60">
                <label className="flex items-center space-x-2 cursor-pointer mb-2">
                  <input
                    type="checkbox"
                    checked={limitRouteDuration}
                    onChange={e => setLimitRouteDuration(e.target.checked)}
                    className="rounded border-zinc-800 bg-zinc-950 text-indigo-500 focus:ring-0"
                  />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Limitar tempo máximo por rota</span>
                </label>
                
                {limitRouteDuration && (
                  <div className="flex items-center space-x-2 mt-1">
                    <div className="flex items-center space-x-1">
                      <input
                        type="number"
                        min="0"
                        max="24"
                        value={maxDurHours}
                        onChange={e => setMaxDurHours(Math.max(0, Math.min(24, parseInt(e.target.value) || 0)))}
                        className="w-12 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-200 text-center outline-none focus:border-indigo-500"
                      />
                      <span className="text-[10px] text-zinc-400">h</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <input
                        type="number"
                        min="0"
                        max="59"
                        value={maxDurMinutes}
                        onChange={e => setMaxDurMinutes(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                        className="w-12 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-200 text-center outline-none focus:border-indigo-500"
                      />
                      <span className="text-[10px] text-zinc-400">min</span>
                    </div>
                  </div>
                )}
                <p className="text-[9px] text-zinc-500 mt-1">Limite máximo de condução/trabalho contínuo por motorista (ex: 6h30min, 8h00min).</p>
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


