"use client";

import React, { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useProjects } from "@/context/ProjectContext";
import { apiRequest } from "@/utils/api";
import Link from "next/link";

export default function DashboardPage() {
  const { selectedProject } = useProjects();
  const [stats, setStats] = useState({
    deliveriesCount: 0,
    geocodedCount: 0,
    hasFleet: false,
    hasRoutes: false,
    loading: true,
  });

  useEffect(() => {
    if (!selectedProject) return;
    const projId = selectedProject.id;

    async function loadStats() {
      try {
        setStats((prev) => ({ ...prev, loading: true }));
        const deliveries = await apiRequest(`/api/geocoding/${projId}`);
        const total = deliveries.length;
        const geocoded = deliveries.filter((d: any) => d.latitude !== 0.0 && d.longitude !== 0.0).length;

        const fleetData = await apiRequest(`/api/fleet/${projId}`);
        const hasWh = fleetData.warehouses && fleetData.warehouses.length > 0;
        const hasVeh = fleetData.fleet && fleetData.fleet.length > 0;

        setStats({
          deliveriesCount: total,
          geocodedCount: geocoded,
          hasFleet: hasWh && hasVeh,
          hasRoutes: false,
          loading: false,
        });
      } catch (e) {
        console.error("Failed to load project stats:", e);
        setStats((prev) => ({ ...prev, loading: false }));
      }
    }

    loadStats();
  }, [selectedProject]);

  return (
    <DashboardLayout>
      <div className="space-y-8 max-w-5xl">
        <div className="bg-gradient-to-r from-zinc-900 to-zinc-900/40 border border-zinc-800 rounded-2xl p-8 relative overflow-hidden">
          <div className="absolute top-[-40%] right-[-10%] w-[40%] h-[120%] rounded-full bg-indigo-500/5 blur-[80px] pointer-events-none" />
          <h1 className="text-2xl font-bold text-zinc-50">
            Bem-vindo ao Planeamento de Rotas
          </h1>
          <p className="text-zinc-450 text-sm mt-2 max-w-xl">
            Siga os três passos para importar dados de clientes, configurar a sua frota e calcular as rotas otimizadas com o motor OR-Tools.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700/80 transition-all rounded-2xl p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">Passo 1</span>
                {stats.loading ? (
                  <span className="w-2.5 h-2.5 rounded-full bg-zinc-650 animate-pulse" />
                ) : stats.deliveriesCount > 0 ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
                    {stats.geocodedCount}/{stats.deliveriesCount} Geocodificados
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 border border-amber-500/25 text-amber-400">
                    Pendente
                  </span>
                )}
              </div>
              <h3 className="text-lg font-bold text-zinc-150 mb-2">Importar & Georreferenciar</h3>
              <p className="text-zinc-450 text-xs leading-relaxed mb-6">
                Carregue a folha Excel de encomendas. O sistema geocodifica as moradas em cascata (Nominatim/Google/CTT).
              </p>
            </div>
            <Link
              href="/dashboard/georeferencing"
              className="w-full text-center bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-200 hover:text-white rounded-xl py-2 text-xs font-semibold transition-all"
            >
              Iniciar Importação
            </Link>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700/80 transition-all rounded-2xl p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">Passo 2</span>
                {stats.loading ? (
                  <span className="w-2.5 h-2.5 rounded-full bg-zinc-650 animate-pulse" />
                ) : stats.hasFleet ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
                    Configurado
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 border border-amber-500/25 text-amber-400">
                    Pendente
                  </span>
                )}
              </div>
              <h3 className="text-lg font-bold text-zinc-150 mb-2">Frota e Armazéns</h3>
              <p className="text-zinc-450 text-xs leading-relaxed mb-6">
                Defina os pontos de partida (armazéns) e a capacidade em peso/volume de cada veículo da sua frota de entregas.
              </p>
            </div>
            <Link
              href="/dashboard/fleet"
              className="w-full text-center bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-200 hover:text-white rounded-xl py-2 text-xs font-semibold transition-all"
            >
              Configurar Frota
            </Link>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700/80 transition-all rounded-2xl p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-550">Passo 3</span>
                {stats.loading ? (
                  <span className="w-2.5 h-2.5 rounded-full bg-zinc-650 animate-pulse" />
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 border border-amber-500/25 text-amber-400">
                    Pendente
                  </span>
                )}
              </div>
              <h3 className="text-lg font-bold text-zinc-150 mb-2">Dashboard Tático</h3>
              <p className="text-zinc-450 text-xs leading-relaxed mb-6">
                Calcule rotas otimizadas com IA, visualize os trajetos no mapa interativo e faça ajustes arrastando clientes.
              </p>
            </div>
            <Link
              href="/dashboard/tactical"
              className="w-full text-center bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-200 hover:text-white rounded-xl py-2 text-xs font-semibold transition-all"
            >
              Abrir Dashboard
            </Link>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
