"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useProjects } from "@/context/ProjectContext";
import { useI18n, languageOptions } from "@/context/I18nContext";
import { useTheme } from "@/context/ThemeContext";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { projects, selectedProject, selectProject, createProject, deleteProject } = useProjects();
  const { t, language, setLanguage } = useI18n();
  const { theme, toggleTheme } = useTheme();

  const [showCreateProj, setShowCreateProj] = useState(false);
  const [newProjName, setNewProjName] = useState("");
  const [newProjDesc, setNewProjDesc] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeletingProj, setIsDeletingProj] = useState(false);
  const [createProjError, setCreateProjError] = useState<string | null>(null);
  const [showLangMenu, setShowLangMenu] = useState(false);

  const menuItems = [
    {
      name: t.navigation.geocoding,
      href: "/dashboard/georeferencing",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      name: t.navigation.fleet,
      href: "/dashboard/fleet",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 17a5 5 0 01-.916-9.916 5.002 5.002 0 019.832 0A5.002 5.002 0 0116 17m-7-5l3-3m0 0l3 3m-3-3v12" />
        </svg>
      ),
    },
    {
      name: t.navigation.tactical,
      href: "/dashboard/tactical",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
      ),
    },
    {
      name: (t.navigation as any).maps || "9. Mapas CodPostal",
      href: "/dashboard/maps",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      name: "📱 App Motoristas",
      href: "https://driver.testeweb.cloud",
      isExternal: true,
      icon: (
        <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      ),
    },
    ...((user as any)?.is_superadmin
      ? [
          {
            name: "98. Registo de Consumos",
            href: "/dashboard/admin/consumptions",
            icon: (
              <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            ),
          },
          {
            name: "99. Gestão de Acessos",
            href: "/dashboard/admin",
            icon: (
              <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            ),
          },
        ]
      : []),
  ];

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjName.trim()) return;
    setCreateProjError(null);
    try {
      await createProject(newProjName, newProjDesc);
      setNewProjName("");
      setNewProjDesc("");
      setShowCreateProj(false);
    } catch (err: any) {
      setCreateProjError(err.message || "Erro ao criar projeto.");
    }
  };

  const handleDeleteCurrentProject = async () => {
    if (!selectedProject) return;
    setIsDeletingProj(true);
    try {
      await deleteProject(selectedProject.id);
      setShowDeleteConfirm(false);
    } catch (err: any) {
      alert("Erro ao eliminar projeto: " + (err.message || "Erro desconhecido"));
    } finally {
      setIsDeletingProj(false);
    }
  };

  if (!user) return null;

  const currentLang = languageOptions.find((l) => l.code === language) || languageOptions[0];

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100 font-sans">
      {/* Sidebar */}
      <aside className="w-64 border-r border-zinc-800 bg-zinc-900/60 backdrop-blur-xl flex flex-col justify-between z-30 shrink-0 no-print">
        <div>
          {/* Logo / Header */}
          <div className="h-16 flex items-center px-6 border-b border-zinc-800">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <span className="font-bold text-sm tracking-wide bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-transparent">
                  {t.common.appName}
                </span>
                <span className="block text-[9px] text-zinc-300 font-mono tracking-wider">
                  v2.0 PRO
                </span>
              </div>
            </div>
          </div>

          {/* Project Selector Bar */}
          <div className="p-4 border-b border-zinc-800 bg-zinc-950/40">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                {t.navigation.projects}
              </label>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                projects.length >= 10
                  ? "bg-rose-950/60 border-rose-800/80 text-rose-300 font-bold"
                  : projects.length >= 8
                  ? "bg-amber-950/60 border-amber-800/80 text-amber-300 font-semibold"
                  : "bg-zinc-850 border-zinc-800 text-zinc-400"
              }`}>
                {projects.length}/10 Max
              </span>
            </div>
            <div className="flex items-center space-x-1.5">
              <select
                value={selectedProject ? selectedProject.id : ""}
                onChange={(e) => {
                  selectProject(parseInt(e.target.value, 10));
                }}
                className="w-full bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 outline-none transition-all cursor-pointer truncate"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
                {projects.length === 0 && <option value="">{t.navigation.noProjects}</option>}
              </select>

              {/* Add Project Button */}
              <button
                type="button"
                onClick={() => {
                  setCreateProjError(null);
                  setShowCreateProj(true);
                }}
                className="bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 p-1.5 rounded-lg text-zinc-300 hover:text-white transition-all cursor-pointer shrink-0"
                title={projects.length >= 10 ? "Limite de 10 projetos atingido" : t.navigation.newProject}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>

              {/* Delete Current Project Button */}
              {selectedProject && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="bg-zinc-850 hover:bg-rose-950/60 border border-zinc-800 hover:border-rose-700/80 p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 transition-all cursor-pointer shrink-0"
                  title={`Eliminar projeto "${selectedProject.nome}"`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Navigation Menu */}
          <nav className="p-4 space-y-1.5">
            {menuItems.map((item: any) => {
              if (item.isExternal) {
                return (
                  <a
                    key={item.name}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold text-emerald-400 hover:bg-emerald-950/40 hover:text-emerald-300 border border-emerald-500/30 bg-emerald-950/20 shadow-sm transition-all cursor-pointer"
                  >
                    <div className="flex items-center space-x-3">
                      {item.icon}
                      <span>{item.name}</span>
                    </div>
                    <svg className="w-3.5 h-3.5 text-emerald-400/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                );
              }
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? "bg-indigo-600/15 border border-indigo-500/30 text-indigo-300 shadow-sm"
                      : "text-zinc-400 hover:bg-zinc-850/60 hover:text-zinc-200 border border-transparent"
                  }`}
                >
                  {item.icon}
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* User Info & License Status & Logout */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950/20 flex flex-col space-y-3">
          <div className="flex items-center space-x-3 px-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center font-bold text-white text-xs shadow-md shrink-0">
              {user.nome ? user.nome.charAt(0).toUpperCase() : "U"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center space-x-1.5">
                <p className="text-xs font-bold text-zinc-100 truncate">{user.nome}</p>
                {((user as any).is_superadmin || (user as any).is_admin) && (
                  <span className="px-1 py-0.2 rounded text-[8px] font-black uppercase tracking-wider bg-amber-400/20 text-amber-400 border border-amber-400/30">
                    {(user as any).is_superadmin ? "ADMIN" : "ADMIN"}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-zinc-400 truncate">{user.email}</p>
            </div>
          </div>

          <div className="flex items-center justify-between px-2 py-1.5 rounded-xl bg-zinc-900/80 border border-zinc-800 text-[10px] text-zinc-300">
            <span className="text-zinc-400 uppercase font-mono">Subscrição</span>
            <span className="font-bold text-amber-400">
              {Boolean((user as any)?.is_superadmin)
                ? "Vitalícia"
                : (user as any)?.data_validade
                ? `Até ${(user as any).data_validade}`
                : "Ativa"}
            </span>
          </div>

          <button
            type="button"
            onClick={logout}
            className="w-full flex items-center justify-center space-x-2 px-3 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-850/80 border border-zinc-800/80 transition-all cursor-pointer"
          >
            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>{t.auth.logout}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-zinc-950">
        {/* Top Header */}
        <header className="h-16 border-b border-zinc-800 bg-zinc-900/40 backdrop-blur-xl flex items-center justify-between px-8 z-20 shrink-0 no-print">
          <div className="flex items-center space-x-4">
            <h2 className="text-sm font-bold text-zinc-100 truncate">
              {selectedProject ? selectedProject.nome : t.navigation.noProjectSelected}
            </h2>
            {selectedProject && selectedProject.descricao && (
              <span className="text-xs text-zinc-400 hidden md:inline border-l border-zinc-800 pl-4 truncate">
                {selectedProject.descricao}
              </span>
            )}
          </div>

          <div className="flex items-center space-x-3">
            {/* App Motoristas Direct Link (High Contrast for Light & Dark Mode) */}
            <a
              href="https://driver.testeweb.cloud"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-xl text-xs transition-all shadow-md shadow-emerald-600/20 border border-emerald-500 cursor-pointer"
              title="Abrir AppGeoRoutePlan (WebApp dos Motoristas)"
            >
              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <span>📱 App Motoristas</span>
              <svg className="w-3 h-3 text-emerald-400/70 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>

            {/* License info pill */}
            <div className="hidden lg:flex items-center space-x-2 bg-zinc-850 border border-zinc-800 px-3 py-1.5 rounded-xl text-xs">
              <span className="text-zinc-400">Licença:</span>
              <span className="font-bold text-amber-400 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                {Boolean((user as any)?.is_superadmin)
                  ? "Admin Vitalício"
                  : (user as any)?.data_validade
                  ? `Ativa até ${(user as any).data_validade}`
                  : "Licença Ativa"}
              </span>
            </div>

            {/* Language Selector Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowLangMenu(!showLangMenu)}
                className="flex items-center space-x-1.5 bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 px-2.5 py-1.5 rounded-xl text-xs text-zinc-200 transition-all cursor-pointer"
              >
                <span>{currentLang.flag}</span>
                <span className="font-mono uppercase text-[11px]">{currentLang.code}</span>
                <svg className="w-3 h-3 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showLangMenu && (
                <div className="absolute right-0 mt-1.5 w-36 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl py-1 z-50">
                  {languageOptions.map((opt) => (
                    <button
                      key={opt.code}
                      type="button"
                      onClick={() => {
                        setLanguage(opt.code);
                        setShowLangMenu(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center space-x-2 transition-colors cursor-pointer ${
                        language === opt.code
                          ? "bg-indigo-600/20 text-indigo-300 font-semibold"
                          : "text-zinc-200 hover:bg-zinc-800 hover:text-zinc-100"
                      }`}
                    >
                      <span>{opt.flag}</span>
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Theme Toggle (☀️ Light / 🌙 Dark) */}
            <button
              type="button"
              onClick={toggleTheme}
              className="p-1.5 rounded-lg bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-zinc-100 transition-all cursor-pointer flex items-center justify-center"
              title={theme === "dark" ? t.common.lightMode : t.common.darkMode}
            >
              {theme === "dark" ? (
                <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>

            {/* Role Badge */}
            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              {user.is_admin ? t.auth.roleAdmin : t.auth.roleUser}
            </span>
          </div>
        </header>

        {/* Dynamic View Body */}
        <main className="flex-1 p-6 overflow-y-auto">
          {selectedProject ? (
            children
          ) : (
            <div className="flex flex-col items-center justify-center h-full max-w-md mx-auto text-center space-y-4">
              <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-full text-zinc-300">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-zinc-200">{t.navigation.noProjectSelected}</h3>
              <p className="text-zinc-400 text-xs leading-relaxed">
                {t.navigation.noProjectSelectedDesc}
              </p>
              <button
                type="button"
                onClick={() => setShowCreateProj(true)}
                className="bg-gradient-to-r from-indigo-500 to-violet-500 text-white rounded-xl px-4 py-2 text-xs font-semibold shadow-md shadow-indigo-500/20 hover:from-indigo-600 hover:to-violet-600 transition-all cursor-pointer"
              >
                {t.navigation.createFirstProject}
              </button>
            </div>
          )}
        </main>
      </div>

      {/* Modal Criar Projeto */}
      {showCreateProj && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-zinc-100">{t.navigation.newProject}</h3>
              <span className={`text-xs font-mono px-2 py-0.5 rounded border ${
                projects.length >= 10
                  ? "bg-rose-950/60 border-rose-800 text-rose-300 font-bold"
                  : "bg-zinc-800 border-zinc-700 text-zinc-400"
              }`}>
                {projects.length}/10 Projetos
              </span>
            </div>

            {projects.length >= 10 ? (
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs text-rose-200 leading-relaxed">
                  <p className="font-bold flex items-center space-x-1.5 text-rose-300 mb-1">
                    <span>⚠️</span> <span>Limite de 10 Projetos Atingido</span>
                  </p>
                  Atingiu o limite máximo de 10 projetos ativos por empresa. Por favor, elimine um projeto antigo com o botão 🗑️ antes de criar um novo.
                </div>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateProj(false)}
                    className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateProject} className="space-y-4">
                {createProjError && (
                  <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800 text-xs text-rose-300 font-medium">
                    {createProjError}
                  </div>
                )}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                    {t.navigation.projectName}
                  </label>
                  <input
                    type="text"
                    required
                    value={newProjName}
                    onChange={(e) => setNewProjName(e.target.value)}
                    placeholder="Ex: Planeamento de Agosto 2026"
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 rounded-xl px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-400 transition-all outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                    {t.navigation.projectDesc}
                  </label>
                  <textarea
                    value={newProjDesc}
                    onChange={(e) => setNewProjDesc(e.target.value)}
                    placeholder="Descrição opcional..."
                    rows={3}
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 rounded-xl px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-400 transition-all outline-none resize-none"
                  />
                </div>

                <div className="flex justify-end space-x-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateProj(false)}
                    className="bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  >
                    {t.common.cancel}
                  </button>
                  <button
                    type="submit"
                    className="bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white px-4 py-1.5 rounded-xl text-xs font-semibold transition-all shadow-md shadow-indigo-500/10 cursor-pointer"
                  >
                    {t.navigation.createProjectBtn}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Modal Eliminar Projeto */}
      {showDeleteConfirm && selectedProject && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center text-lg shrink-0">
                🗑️
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-100">Eliminar Projeto</h3>
                <p className="text-xs text-zinc-400">Esta ação é irreversível.</p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-950/60 border border-zinc-800 text-xs text-zinc-300 space-y-2">
              <p>
                Tem a certeza que deseja eliminar o projeto <b className="text-white font-bold">"{selectedProject.nome}"</b>?
              </p>
              <p className="text-[11px] text-rose-400/90 font-medium">
                ⚠️ Serão eliminadas permanentemente todas as entregas, viaturas e rotas calculadas deste projeto.
              </p>
            </div>

            <div className="flex space-x-3 pt-2">
              <button
                type="button"
                disabled={isDeletingProj}
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 bg-zinc-850 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeletingProj}
                onClick={handleDeleteCurrentProject}
                className="flex-1 bg-rose-600 hover:bg-rose-500 text-white py-2.5 rounded-xl text-xs font-bold shadow-lg shadow-rose-600/20 transition-all cursor-pointer disabled:opacity-50"
              >
                {isDeletingProj ? "A eliminar..." : "Sim, Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
