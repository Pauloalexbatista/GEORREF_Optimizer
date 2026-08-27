"use client";

import React, { useState, useEffect, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { apiRequest } from "@/utils/api";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";

interface AdminUser {
  id: number;
  empresa_id: number;
  empresa_nome: string;
  responsavel: string;
  email: string;
  is_admin: boolean;
  is_superadmin: boolean;
  is_active: boolean;
  data_validade: string;
  programas: string;
  dias_restantes: number;
  password_plain?: string;
  driver_password?: string;
  created_at?: string;
}

export default function AdminUsersPage() {
  const { user } = useAuth();
  const { t } = useI18n();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "expired" | "expiring">("all");

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [saving, setSaving] = useState(false);

  // Form State
  const [formEmpresa, setFormEmpresa] = useState("");
  const [formResponsavel, setFormResponsavel] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formDataValidade, setFormDataValidade] = useState("");
  const [formProgSite, setFormProgSite] = useState(true);
  const [formProgApp, setFormProgApp] = useState(true);
  const [formDriverPassword, setFormDriverPassword] = useState("");
  const [formIsActive, setFormIsActive] = useState(true);
  const [visiblePasswords, setVisiblePasswords] = useState<Record<number, boolean>>({});

  const loadUsers = async () => {
    try {
      setLoading(true);
      const data = await apiRequest("/api/admin/users");
      setUsers(data || []);
    } catch (err: any) {
      alert("Erro ao carregar utilizadores: " + (err.message || JSON.stringify(err)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleOpenCreate = () => {
    setEditingUser(null);
    setFormEmpresa("");
    setFormResponsavel("");
    setFormEmail("");
    setFormPassword(generateRandomPassword());
    // Default 1 year from today
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    setFormDataValidade(nextYear.toISOString().split("T")[0]);
    setFormProgSite(true);
    setFormProgApp(true);
    setFormDriverPassword(generateRandomPassword());
    setFormIsActive(true);
    setShowModal(true);
  };

  const handleOpenEdit = (u: AdminUser) => {
    setEditingUser(u);
    setFormEmpresa(u.empresa_nome);
    setFormResponsavel(u.responsavel);
    setFormEmail(u.email);
    setFormPassword(u.password_plain || "");
    setFormDataValidade(u.data_validade ? u.data_validade.slice(0, 10) : "2027-12-31");
    setFormProgSite(u.programas.includes("site"));
    setFormProgApp(u.programas.includes("app"));
    setFormDriverPassword(u.driver_password || "");
    setFormIsActive(u.is_active);
    setShowModal(true);
  };

  const generateRandomPassword = () => {
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$";
    let pass = "";
    for (let i = 0; i < 8; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pass;
  };

  const handleSetQuickDays = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setFormDataValidade(d.toISOString().split("T")[0]);
  };

  const handleSetQuickDate = (months: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    setFormDataValidade(d.toISOString().split("T")[0]);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formEmpresa.trim() || !formResponsavel.trim() || !formEmail.trim() || !formDataValidade) {
      alert("Por favor preencha todos os campos obrigatórios.");
      return;
    }

    const progs: string[] = [];
    if (formProgSite) progs.push("site");
    if (formProgApp) progs.push("app");
    if (progs.length === 0) {
      alert("Selecione pelo menos um programa de acesso (Site ou App).");
      return;
    }
    const programasStr = progs.join(",");

    setSaving(true);
    try {
      if (editingUser) {
        // Update
        await apiRequest(`/api/admin/users/${editingUser.id}`, {
          method: "PUT",
          body: JSON.stringify({
            empresa_nome: formEmpresa.trim(),
            responsavel: formResponsavel.trim(),
            email: formEmail.trim(),
            password: formPassword.trim() || undefined,
            driver_password: formDriverPassword.trim(),
            data_validade: formDataValidade,
            programas: programasStr,
            is_active: formIsActive,
          }),
        });
      } else {
        // Create
        await apiRequest("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({
            empresa_nome: formEmpresa.trim(),
            responsavel: formResponsavel.trim(),
            email: formEmail.trim(),
            password: formPassword.trim() || "123456",
            driver_password: formDriverPassword.trim(),
            data_validade: formDataValidade,
            programas: programasStr,
            is_admin: false,
          }),
        });
      }
      setShowModal(false);
      await loadUsers();
    } catch (err: any) {
      alert("Erro ao guardar: " + (err.message || JSON.stringify(err)));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (u: AdminUser) => {
    try {
      await apiRequest(`/api/admin/users/${u.id}/toggle-status`, { method: "POST" });
      await loadUsers();
    } catch (err: any) {
      alert("Erro ao alterar estado: " + (err.message || JSON.stringify(err)));
    }
  };

  const handleDelete = async (u: AdminUser) => {
    if (u.email.toLowerCase() === user?.email.toLowerCase()) {
      alert("Não é permitido eliminar a sua própria conta de Administrador.");
      return;
    }
    if (!window.confirm(`Tem a certeza que deseja eliminar o utilizador "${u.responsavel}" da empresa "${u.empresa_nome}"?`)) {
      return;
    }
    try {
      await apiRequest(`/api/admin/users/${u.id}`, { method: "DELETE" });
      await loadUsers();
    } catch (err: any) {
      alert("Erro ao eliminar: " + (err.message || JSON.stringify(err)));
    }
  };

  const togglePasswordVisibility = (id: number) => {
    setVisiblePasswords((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Stats calculation
  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter((u) => u.is_active && u.dias_restantes > 0).length;
    const expiring = users.filter((u) => u.is_active && u.dias_restantes > 0 && u.dias_restantes <= 15).length;
    const expired = users.filter((u) => u.dias_restantes <= 0).length;
    return { total, active, expiring, expired };
  }, [users]);

  // Filtered list
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchSearch =
        u.empresa_nome.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.responsavel.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchSearch) return false;

      if (filterStatus === "active") return u.is_active && u.dias_restantes > 0;
      if (filterStatus === "expiring") return u.is_active && u.dias_restantes > 0 && u.dias_restantes <= 15;
      if (filterStatus === "expired") return u.dias_restantes <= 0;
      return true;
    });
  }, [users, searchQuery, filterStatus]);

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-7xl mx-auto pb-12">
        {/* Header Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-zinc-900 to-zinc-900/60 p-6 rounded-2xl border border-zinc-800 shadow-xl">
          <div>
            <div className="flex items-center space-x-2.5 mb-1.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-black shadow-inner">
                👑
              </div>
              <h1 className="text-xl font-bold text-zinc-50 tracking-tight">
                0. Gestão Mestre de Contas & Licenciamento
              </h1>
            </div>
            <p className="text-xs text-zinc-300">
              Crie empresas e utilizadores, defina passwords, datas de validade com corte automático e atribua acesso aos módulos (Site Web / App Motoristas).
            </p>
          </div>

          <div className="flex items-center space-x-3 shrink-0">
            <button
              onClick={loadUsers}
              disabled={loading}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-semibold border border-zinc-700 transition-all flex items-center space-x-1.5 cursor-pointer shadow-sm"
            >
              <svg className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Atualizar</span>
            </button>
            <button
              onClick={handleOpenCreate}
              className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-500/20 flex items-center space-x-1.5 cursor-pointer"
            >
              <span className="text-sm font-black">+</span>
              <span>Criar Novo Utilizador / Licença</span>
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl shadow-sm">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Total Contas</span>
            <div className="text-2xl font-extrabold text-zinc-50 mt-1">{stats.total}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl shadow-sm">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">Contas Ativas</span>
            <div className="text-2xl font-extrabold text-emerald-400 mt-1">{stats.active}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl shadow-sm">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">A Expirar (≤ 15d)</span>
            <div className="text-2xl font-extrabold text-amber-400 mt-1">{stats.expiring}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl shadow-sm">
            <span className="text-[11px] font-bold uppercase tracking-wider text-red-400">Expiradas / Bloqueadas</span>
            <div className="text-2xl font-extrabold text-red-400 mt-1">{stats.expired}</div>
          </div>
        </div>

        {/* Filters and Search */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-zinc-900/60 p-3 rounded-xl border border-zinc-800">
          <div className="w-full sm:w-80 relative">
            <input
              type="text"
              placeholder="Pesquisar por empresa, responsável ou email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex items-center space-x-1.5 self-end sm:self-auto">
            <button
              onClick={() => setFilterStatus("all")}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                filterStatus === "all" ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              Todos ({users.length})
            </button>
            <button
              onClick={() => setFilterStatus("active")}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                filterStatus === "active" ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              Ativos ({stats.active})
            </button>
            <button
              onClick={() => setFilterStatus("expiring")}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                filterStatus === "expiring" ? "bg-amber-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              A Expirar ({stats.expiring})
            </button>
            <button
              onClick={() => setFilterStatus("expired")}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                filterStatus === "expired" ? "bg-red-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              Expirados ({stats.expired})
            </button>
          </div>
        </div>

        {/* DATA TABLE */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/80 text-zinc-400 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3.5 px-4">Empresa</th>
                  <th className="py-3.5 px-4">Responsável</th>
                  <th className="py-3.5 px-4">Email de Acesso</th>
                  <th className="py-3.5 px-4">Password</th>
                  <th className="py-3.5 px-4">Data de Validade</th>
                  <th className="py-3.5 px-4 text-center">Dias Restantes</th>
                  <th className="py-3.5 px-4 text-center">Módulos / Programas</th>
                  <th className="py-3.5 px-4 text-center">Estado</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-medium">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-zinc-400">
                      Nenhum utilizador encontrado com os filtros selecionados.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const isExp = u.dias_restantes <= 0;
                    const isSoon = u.dias_restantes > 0 && u.dias_restantes <= 15;
                    const isSuper = u.is_superadmin;
                    const passVisible = visiblePasswords[u.id];

                    return (
                      <tr
                        key={u.id}
                        className={`hover:bg-zinc-850/50 transition-colors ${
                          !u.is_active ? "opacity-60 bg-red-950/10" : isExp ? "bg-amber-950/10" : ""
                        }`}
                      >
                        {/* Empresa */}
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-zinc-100 flex items-center space-x-1.5">
                            <span>{u.empresa_nome}</span>
                            {isSuper && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                SUPERADMIN
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Responsável */}
                        <td className="py-3.5 px-4 text-zinc-200">{u.responsavel}</td>

                        {/* Email */}
                        <td className="py-3.5 px-4 font-mono text-indigo-400 font-semibold">{u.email}</td>

                        {/* Password */}
                        <td className="py-3.5 px-4 font-mono text-zinc-300">
                          <div className="flex items-center space-x-1.5">
                            <span>
                              {passVisible ? (u.password_plain || "••••••••") : "••••••••"}
                            </span>
                            {u.password_plain && (
                              <button
                                onClick={() => togglePasswordVisibility(u.id)}
                                className="p-1 text-zinc-400 hover:text-zinc-200 cursor-pointer transition-colors"
                                title={passVisible ? "Ocultar" : "Ver Password"}
                              >
                                {passVisible ? "🙈" : "👁️"}
                              </button>
                            )}
                          </div>
                        </td>

                        {/* Data Validade */}
                        <td className="py-3.5 px-4 font-mono text-zinc-200">
                          {isSuper ? (
                            <span className="text-emerald-400 font-bold">Vitalício (2099)</span>
                          ) : (
                            <span>{u.data_validade ? u.data_validade.slice(0, 10) : "--"}</span>
                          )}
                        </td>

                        {/* Dias Restantes */}
                        <td className="py-3.5 px-4 text-center">
                          {isSuper ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                              Vitalício
                            </span>
                          ) : isExp ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-red-500/10 text-red-400 border border-red-500/30 animate-pulse">
                              🔴 Expirado
                            </span>
                          ) : isSoon ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                              🟡 {u.dias_restantes} dias
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                              🟢 {u.dias_restantes} dias
                            </span>
                          )}
                        </td>

                        {/* Módulos / Programas */}
                        <td className="py-3.5 px-4 text-center">
                          <div className="inline-flex items-center space-x-1">
                            {u.programas.includes("site") && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/25" title="Acesso ao Site Web">
                                🌐 Site
                              </span>
                            )}
                            {u.programas.includes("app") && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/25" title="Acesso à App dos Motoristas">
                                📱 App
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Estado */}
                        <td className="py-3.5 px-4 text-center">
                          <button
                            onClick={() => handleToggleStatus(u)}
                            disabled={isSuper}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all cursor-pointer border ${
                              u.is_active
                                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30"
                                : "bg-red-500/20 text-red-300 border-red-500/40 hover:bg-red-500/30"
                            }`}
                          >
                            {u.is_active ? "Ativo" : "Bloqueado"}
                          </button>
                        </td>

                        {/* Ações */}
                        <td className="py-3.5 px-4 text-right space-x-1.5">
                          <button
                            onClick={() => handleOpenEdit(u)}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-indigo-600 text-zinc-300 hover:text-white border border-zinc-700 transition-colors cursor-pointer"
                            title="Editar utilizador / Mudar Password"
                          >
                            ✏️
                          </button>
                          {u.email.toLowerCase() !== user?.email.toLowerCase() && (
                            <button
                              onClick={() => handleDelete(u)}
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-red-600 text-zinc-300 hover:text-white border border-zinc-700 transition-colors cursor-pointer"
                              title="Eliminar conta"
                            >
                              🗑️
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* MODAL CRIAR / EDITAR UTILIZADOR */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
              <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
                <h3 className="text-base font-bold text-zinc-50 flex items-center space-x-2">
                  <span>{editingUser ? "Editar Conta e Licença" : "Criar Nova Conta / Licença"}</span>
                </h3>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-zinc-400 hover:text-white transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSave} className="p-6 space-y-4 text-xs">
                {/* Empresa & Responsavel */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">
                      Nome da Empresa *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: TransLog Lda"
                      value={formEmpresa}
                      onChange={(e) => setFormEmpresa(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">
                      Nome do Responsável *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: João Silva"
                      value={formResponsavel}
                      onChange={(e) => setFormResponsavel(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                {/* Email */}
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">
                    Email de Acesso (Login) *
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="Ex: contacto@empresa.pt"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                {/* Password */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase">
                      {editingUser ? "Alterar Password (Opcional)" : "Password de Acesso *"}
                    </label>
                    <button
                      type="button"
                      onClick={() => setFormPassword(generateRandomPassword())}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer"
                    >
                      ⚡ Gerar Password
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder={editingUser ? "Deixe em branco para manter a atual" : "Defina a password"}
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                {/* Data Validade + Quick Shortcuts */}
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">
                    Data Limite de Validade da Subscrição *
                  </label>
                  <div className="flex items-center space-x-2 mb-2">
                    <input
                      type="date"
                      required
                      value={formDataValidade}
                      onChange={(e) => setFormDataValidade(e.target.value)}
                      className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <span className="text-[10px] text-zinc-400 mr-1">Atalhos:</span>
                    <button
                      type="button"
                      onClick={() => handleSetQuickDate(1)}
                      className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-semibold cursor-pointer"
                    >
                      +1 Mês
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetQuickDays(35)}
                      className="px-2 py-0.5 rounded bg-indigo-950/60 hover:bg-indigo-900/60 text-indigo-300 border border-indigo-800/60 text-[10px] font-semibold cursor-pointer"
                      title="1 Mês + 5 dias de tolerância para pagamento"
                    >
                      +1 Mês (+5d)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetQuickDate(3)}
                      className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-semibold cursor-pointer"
                    >
                      +3 Meses
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetQuickDate(6)}
                      className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-semibold cursor-pointer"
                    >
                      +6 Meses
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetQuickDate(12)}
                      className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-semibold cursor-pointer"
                    >
                      +1 Ano
                    </button>
                  </div>
                </div>

                {/* Program Access Checkboxes */}
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-2">
                    Módulos / Programas Autorizados
                  </label>
                  <div className="grid grid-cols-2 gap-2 bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                    <label className="flex items-center space-x-2 text-zinc-200 cursor-pointer font-semibold">
                      <input
                        type="checkbox"
                        checked={formProgSite}
                        onChange={(e) => setFormProgSite(e.target.checked)}
                        className="rounded border-zinc-700 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                      />
                      <span>🌐 Acesso ao Site Web (GeoRoutePlan)</span>
                    </label>
                    <label className="flex items-center space-x-2 text-zinc-200 cursor-pointer font-semibold">
                      <input
                        type="checkbox"
                        checked={formProgApp}
                        onChange={(e) => setFormProgApp(e.target.checked)}
                        className="rounded border-zinc-700 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                      />
                      <span>📱 Acesso à App dos Motoristas (PWA)</span>
                    </label>
                  </div>
                </div>

                {/* Is Active Toggle */}
                {editingUser && (
                  <div className="flex items-center space-x-2 pt-1">
                    <input
                      type="checkbox"
                      id="activeCheck"
                      checked={formIsActive}
                      onChange={(e) => setFormIsActive(e.target.checked)}
                      className="rounded border-zinc-700 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                    />
                    <label htmlFor="activeCheck" className="text-xs text-zinc-200 font-semibold cursor-pointer">
                      Conta Ativa (Desmarque para bloquear o acesso)
                    </label>
                  </div>
                )}

                {/* Modal Actions */}
                <div className="flex items-center justify-end space-x-2.5 pt-4 border-t border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl font-semibold transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl font-bold transition-all shadow-md shadow-indigo-500/20 cursor-pointer flex items-center space-x-1.5"
                  >
                    <span>{saving ? "A guardar..." : editingUser ? "Atualizar Conta" : "Criar Conta e Licença"}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
