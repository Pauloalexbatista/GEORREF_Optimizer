"use client";

import React, { useState, useEffect } from "react";
import { apiRequest } from "@/utils/api";

export interface EditDeliveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  delivery: {
    id: number;
    codigo_cliente?: string;
    nome_cliente?: string;
    morada?: string;
    codigo_postal?: string;
    concelho?: string;
    peso_kg?: number;
    volume_m3?: number;
    armazem?: string;
    janela_inicio?: string;
    janela_fim?: string;
    tempo_descarga_min?: number;
    regras?: string;
    observacoes?: string;
    vendedor?: string;
    telefone?: string;
    valor_cobrar?: number;
    latitude?: number;
    longitude?: number;
  } | null;
  maxFleetCap?: { kg: number; vol: number };
  warehouses?: Array<{ name?: string; Nome_Armazem?: string }>;
  onSaveSuccess: (updatedDelivery: any) => void;
}

export default function EditDeliveryModal({
  isOpen,
  onClose,
  delivery,
  maxFleetCap = { kg: 5000, vol: 15 },
  warehouses = [],
  onSaveSuccess,
}: EditDeliveryModalProps) {
  const [formData, setFormData] = useState({
    codigo_cliente: "",
    nome_cliente: "",
    morada: "",
    codigo_postal: "",
    concelho: "",
    peso_kg: 0,
    volume_m3: 0,
    armazem: "",
    janela_inicio: "08:00",
    janela_fim: "19:00",
    tempo_descarga_min: 10,
    regras: "",
    observacoes: "",
    vendedor: "",
    telefone: "",
    valor_cobrar: 0,
  });

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (delivery) {
      setFormData({
        codigo_cliente: delivery.codigo_cliente || "",
        nome_cliente: delivery.nome_cliente || "",
        morada: delivery.morada || "",
        codigo_postal: delivery.codigo_postal || "",
        concelho: delivery.concelho || "",
        peso_kg: Number(delivery.peso_kg) || 0,
        volume_m3: Number(delivery.volume_m3) || 0,
        armazem: delivery.armazem || (warehouses[0]?.name || warehouses[0]?.Nome_Armazem || ""),
        janela_inicio: delivery.janela_inicio || "08:00",
        janela_fim: delivery.janela_fim || "19:00",
        tempo_descarga_min: Number(delivery.tempo_descarga_min) || 10,
        regras: delivery.regras || "",
        observacoes: delivery.observacoes || "",
        vendedor: delivery.vendedor || "",
        telefone: delivery.telefone || "",
        valor_cobrar: Number(delivery.valor_cobrar) || 0,
      });
      setErrorMsg(null);
    }
  }, [delivery, warehouses]);

  if (!isOpen || !delivery) return null;

  const isOverWeight = formData.peso_kg > maxFleetCap.kg;
  const isOverVol = formData.volume_m3 > maxFleetCap.vol;
  const isOverload = isOverWeight || isOverVol;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);

    try {
      const payload = {
        morada: formData.morada,
        codigo_postal: formData.codigo_postal,
        concelho: formData.concelho,
        latitude: delivery.latitude || 0.0,
        longitude: delivery.longitude || 0.0,
        codigo_cliente: formData.codigo_cliente,
        nome_cliente: formData.nome_cliente,
        telefone: formData.telefone,
        peso_kg: formData.peso_kg,
        volume_m3: formData.volume_m3,
        janela_inicio: formData.janela_inicio,
        janela_fim: formData.janela_fim,
        tempo_descarga_min: formData.tempo_descarga_min,
        regras: formData.regras,
        vendedor: formData.vendedor,
        valor_cobrar: formData.valor_cobrar,
        observacoes: formData.observacoes,
        armazem: formData.armazem,
      };

      await apiRequest(`/api/geocoding/delivery/${delivery.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      onSaveSuccess({
        ...delivery,
        ...payload,
      });
      onClose();
    } catch (err: any) {
      console.error("Erro ao atualizar entrega:", err);
      setErrorMsg(err.message || "Erro ao guardar alterações da entrega.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/70">
          <div className="flex items-center space-x-3">
            <span className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 text-lg">
              ✏️
            </span>
            <div>
              <h2 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                <span>Editar Dados da Encomenda</span>
                <span className="text-xs font-mono font-normal text-zinc-400">
                  (ID #{delivery.id})
                </span>
              </h2>
              <p className="text-xs text-zinc-400">
                Ajuste o peso, volume e restantes especificações operacionais da entrega.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Overload Alert Banner */}
          {isOverload ? (
            <div className="p-3 bg-red-950/60 border border-red-500/50 rounded-xl text-xs text-red-200 flex items-start gap-2.5 shadow-sm">
              <span className="text-lg shrink-0">🚨</span>
              <div>
                <strong className="font-bold block text-red-100">
                  Aviso: Carga Excede a Capacidade Máxima da Frota!
                </strong>
                <span>
                  {isOverWeight && `O peso (${formData.peso_kg} kg) excede o limite máximo da frota (${maxFleetCap.kg} kg). `}
                  {isOverVol && `O volume (${formData.volume_m3} m³) excede o teto da frota (${maxFleetCap.vol} m³). `}
                  Verifique se não se trata de erro de digitação de unidades. Corrija abaixo para viabilizar a distribuição.
                </span>
              </div>
            </div>
          ) : (formData.peso_kg === 0 || formData.volume_m3 === 0) ? (
            <div className="p-3 bg-amber-950/40 border border-amber-500/40 rounded-xl text-xs text-amber-200 flex items-center gap-2">
              <span className="text-base">⚠️</span>
              <span>Esta entrega tem peso ou volume igual a 0. Preencha os valores reais de transporte se aplicável.</span>
            </div>
          ) : null}

          {errorMsg && (
            <div className="p-3 bg-rose-950/60 border border-rose-500/50 rounded-xl text-xs text-rose-300">
              {errorMsg}
            </div>
          )}

          {/* Section: Carga (Peso & Volume) */}
          <div className="p-3.5 bg-zinc-950/60 border border-zinc-800 rounded-xl space-y-3">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-400 block">
              📦 Peso & Volume de Transporte
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Peso Total (KG) <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={formData.peso_kg}
                    onChange={(e) =>
                      setFormData({ ...formData, peso_kg: parseFloat(e.target.value) || 0 })
                    }
                    className={`w-full bg-zinc-900 border rounded-xl px-3 py-2 text-sm font-mono text-zinc-100 outline-none transition-all ${
                      isOverWeight
                        ? "border-red-500 focus:border-red-400 bg-red-950/30"
                        : "border-zinc-700 focus:border-indigo-500"
                    }`}
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-zinc-400 font-mono">kg</span>
                </div>
                <span className="text-[10px] text-zinc-500 mt-0.5 block">
                  Capacidade máx. viatura: {maxFleetCap.kg} kg
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Volume (m³) <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    required
                    value={formData.volume_m3}
                    onChange={(e) =>
                      setFormData({ ...formData, volume_m3: parseFloat(e.target.value) || 0 })
                    }
                    className={`w-full bg-zinc-900 border rounded-xl px-3 py-2 text-sm font-mono text-zinc-100 outline-none transition-all ${
                      isOverVol
                        ? "border-red-500 focus:border-red-400 bg-red-950/30"
                        : "border-zinc-700 focus:border-indigo-500"
                    }`}
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-zinc-400 font-mono">m³</span>
                </div>
                <span className="text-[10px] text-zinc-500 mt-0.5 block">
                  Capacidade máx. viatura: {maxFleetCap.vol} m³
                </span>
              </div>
            </div>
          </div>

          {/* Section: Identificação & Armazém */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">Cód. / Doc ID</label>
              <input
                type="text"
                value={formData.codigo_cliente}
                onChange={(e) => setFormData({ ...formData, codigo_cliente: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 font-mono outline-none focus:border-indigo-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-zinc-300 mb-1">Nome do Cliente</label>
              <input
                type="text"
                value={formData.nome_cliente}
                onChange={(e) => setFormData({ ...formData, nome_cliente: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 font-semibold outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">Armazém de Partida</label>
              {warehouses.length > 0 ? (
                <select
                  value={formData.armazem}
                  onChange={(e) => setFormData({ ...formData, armazem: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 outline-none focus:border-indigo-500 cursor-pointer"
                >
                  {warehouses.map((w, idx) => {
                    const wName = w.name || w.Nome_Armazem || `Armazém ${idx + 1}`;
                    return (
                      <option key={idx} value={wName}>
                        {wName}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <input
                  type="text"
                  value={formData.armazem}
                  onChange={(e) => setFormData({ ...formData, armazem: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">Telefone</label>
              <input
                type="text"
                value={formData.telefone}
                onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                placeholder="Ex: 912345678"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 font-mono outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Section: Localização */}
          <div className="p-3.5 bg-zinc-950/40 border border-zinc-800/80 rounded-xl space-y-3">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 block">
              📍 Morada & Localização
            </span>
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">Morada</label>
              <input
                type="text"
                value={formData.morada}
                onChange={(e) => setFormData({ ...formData, morada: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Código Postal</label>
                <input
                  type="text"
                  value={formData.codigo_postal}
                  onChange={(e) => setFormData({ ...formData, codigo_postal: e.target.value })}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs font-mono text-zinc-200 outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Concelho / Localidade</label>
                <input
                  type="text"
                  value={formData.concelho}
                  onChange={(e) => setFormData({ ...formData, concelho: e.target.value })}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Section: Janelas Horárias & Descarga */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">Janela Início</label>
              <input
                type="time"
                value={formData.janela_inicio}
                onChange={(e) => setFormData({ ...formData, janela_inicio: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 font-mono outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">Janela Fim</label>
              <input
                type="time"
                value={formData.janela_fim}
                onChange={(e) => setFormData({ ...formData, janela_fim: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 font-mono outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">Tempo Descarga (min)</label>
              <input
                type="number"
                min="1"
                value={formData.tempo_descarga_min}
                onChange={(e) =>
                  setFormData({ ...formData, tempo_descarga_min: parseInt(e.target.value) || 10 })
                }
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 font-mono outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Section: Regras Operacionais & Observações */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">
                🏷️ Regras / Etiquetas (ex: [O_T_ST_101])
              </label>
              <input
                type="text"
                value={formData.regras}
                onChange={(e) => setFormData({ ...formData, regras: e.target.value })}
                placeholder="ex: [O_T_ST_101][O_T_CTT]"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs font-mono text-purple-300 outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">
                Notas / Observações
              </label>
              <input
                type="text"
                value={formData.observacoes}
                onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                placeholder="Observações para o motorista"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/20 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              {saving ? "A Guardar..." : "💾 Guardar Alterações"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
