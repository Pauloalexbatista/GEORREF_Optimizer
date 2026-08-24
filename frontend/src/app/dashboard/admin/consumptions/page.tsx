"use client";

import React, { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/utils/api";
import { useRouter } from "next/navigation";

interface EmpresaConsumo {
  empresa_id: number;
  empresa_nome: string;
  plano: string;
  total_pedidos: number;
  total_custo: number;
  ultimo_consumo: string | null;
}

interface TransacaoConsumo {
  id: number;
  created_at: string;
  empresa_nome: string;
  projeto_nome: string;
  servico: string;
  num_pedidos: number;
  custo_estimado: number;
}

interface ConsumoResumo {
  total_pedidos_mes: number;
  total_custo_mes: number;
  quota_limit: number;
  quota_count: number;
  total_all_time: number;
  current_month: string;
  empresas: EmpresaConsumo[];
  transacoes: TransacaoConsumo[];
}

export default function ConsumptionsAdminPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<ConsumoResumo | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await apiRequest("/api/admin/consumptions");
      setData(res);
    } catch (err) {
      console.error("Failed to load consumptions:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && !(user as any).is_superadmin) {
      router.push("/dashboard/tactical");
      return;
    }
    fetchData();
  }, [user]);

  if (!user || !(user as any).is_superadmin) {
    return null;
  }

  const filteredEmpresas = (data?.empresas || []).filter(e => 
    e.empresa_nome.toLowerCase().includes(searchQuery.toLowerCase()) ||
    e.plano.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const quotaPercent = data && data.quota_limit > 0
    ? Math.min(100, Math.round((data.quota_count / data.quota_limit) * 100))
    : 0;

  return (
    <DashboardLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8 animate-fadeIn font-sans">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800/80 pb-6">
          <div>
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
                  98. Registo de Consumos Google API
                </h1>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Painel exclusivo do SuperAdmin para monitorização de custos, quotas e consumo por empresa.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={fetchData}
              className="bg-white dark:bg-zinc-850 hover:bg-zinc-50 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/80 text-zinc-700 dark:text-zinc-200 px-4 py-2 rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer flex items-center space-x-2"
            >
              <svg className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Atualizar Dados</span>
            </button>
          </div>
        </div>

        {/* Top KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
          {/* Card 1: Monthly Requests */}
          <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/80 shadow-sm relative overflow-hidden">
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Pedidos no Mês Atual</p>
            <p className="text-3xl font-extrabold text-zinc-900 dark:text-zinc-100 mt-2">
              {data?.quota_count ?? 0} <span className="text-xs font-medium text-zinc-400">/ {data?.quota_limit ?? 1000}</span>
            </p>
            <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-2 rounded-full mt-3 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  quotaPercent > 85 ? "bg-rose-500" : quotaPercent > 60 ? "bg-amber-500" : "bg-emerald-500"
                }`}
                style={{ width: `${quotaPercent}%` }}
              />
            </div>
            <p className="text-[10px] text-zinc-400 mt-1.5">{quotaPercent}% do plafond mensal de 1000 consumido</p>
          </div>

          {/* Card 2: Estimated Cost This Month */}
          <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/80 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Custo Estimado (Mês)</p>
            <p className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-2">
              {(data?.total_custo_mes ?? 0).toFixed(2)} €
            </p>
            <p className="text-[10px] text-emerald-700 dark:text-emerald-400/80 mt-2 bg-emerald-50 dark:bg-emerald-950/40 p-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800/40">
              ✓ 100% coberto pelo crédito gratuito Google de 200$
            </p>
          </div>

          {/* Card 3: Free Balance Available */}
          <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/80 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Plafond Grátis Disponível</p>
            <p className="text-3xl font-extrabold text-indigo-600 dark:text-indigo-400 mt-2">
              {Math.max(0, (data?.quota_limit ?? 1000) - (data?.quota_count ?? 0))}
            </p>
            <p className="text-[10px] text-zinc-400 mt-2">pedidos restantes no mês de {data?.current_month || "corrente"}</p>
          </div>

          {/* Card 4: Total All Time */}
          <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/80 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Total Histórico (All-Time)</p>
            <p className="text-3xl font-extrabold text-zinc-900 dark:text-zinc-100 mt-2">
              {data?.total_all_time ?? 0}
            </p>
            <p className="text-[10px] text-zinc-400 mt-2">pedidos efetuados desde o início</p>
          </div>
        </div>

        {/* Company Breakdown Table */}
        <div className="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/80 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Consumo por Empresa / Cliente</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Quota de tráfego e cálculo de rotas consumida por cada organização.</p>
            </div>
            <div className="w-full sm:w-72">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="🔍 Filtrar por empresa ou plano..."
                className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-xs text-zinc-600 dark:text-zinc-300">
              <thead className="bg-zinc-50 dark:bg-zinc-950/80 text-[11px] uppercase font-bold text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3">Plano</th>
                  <th className="px-4 py-3 text-right">Pedidos Google</th>
                  <th className="px-4 py-3 text-right">Custo Estimado</th>
                  <th className="px-4 py-3">Último Consumo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/60 font-medium">
                {filteredEmpresas.map((emp) => (
                  <tr key={emp.empresa_id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors">
                    <td className="px-4 py-3 font-bold text-zinc-900 dark:text-zinc-100">
                      {emp.empresa_nome}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/60 text-indigo-600 dark:text-indigo-300">
                        {emp.plano.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-zinc-900 dark:text-zinc-100">
                      {emp.total_pedidos}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {emp.total_custo.toFixed(2)} €
                    </td>
                    <td className="px-4 py-3 text-zinc-400 text-[11px]">
                      {emp.ultimo_consumo || "Sem registos recentes"}
                    </td>
                  </tr>
                ))}
                {filteredEmpresas.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-zinc-400 text-xs">
                      Nenhuma empresa encontrada com os filtros atuais.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Latest Transactions Log */}
        <div className="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/80 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Últimas Transações Google API</h2>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-xs text-zinc-600 dark:text-zinc-300">
              <thead className="bg-zinc-50 dark:bg-zinc-950/80 text-[11px] uppercase font-bold text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="px-4 py-2.5">Data / Hora</th>
                  <th className="px-4 py-2.5">Empresa</th>
                  <th className="px-4 py-2.5">Projeto</th>
                  <th className="px-4 py-2.5">Serviço</th>
                  <th className="px-4 py-2.5 text-right">Pedidos</th>
                  <th className="px-4 py-2.5 text-right">Custo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/60">
                {(data?.transacoes || []).map((tr) => (
                  <tr key={tr.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors font-mono text-[11px]">
                    <td className="px-4 py-2 text-zinc-400">{tr.created_at}</td>
                    <td className="px-4 py-2 font-sans font-semibold text-zinc-800 dark:text-zinc-200">{tr.empresa_nome || "N/A"}</td>
                    <td className="px-4 py-2 font-sans text-zinc-500 dark:text-zinc-400">{tr.projeto_nome || "N/A"}</td>
                    <td className="px-4 py-2 text-indigo-500 dark:text-indigo-400">{tr.servico}</td>
                    <td className="px-4 py-2 text-right font-bold text-zinc-900 dark:text-zinc-100">{tr.num_pedidos}</td>
                    <td className="px-4 py-2 text-right text-emerald-600 dark:text-emerald-400">{tr.custo_estimado.toFixed(3)} €</td>
                  </tr>
                ))}
                {(data?.transacoes || []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-zinc-400 text-xs font-sans">
                      Ainda não existem transações registadas este mês.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
