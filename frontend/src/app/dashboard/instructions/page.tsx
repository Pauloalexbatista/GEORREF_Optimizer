"use client";

import React, { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import Link from "next/link";

interface SectionItem {
  id: string;
  title: string;
  badge: string;
  badgeColor: string;
  icon: string;
  summary: string;
  content: React.ReactNode;
}

export default function InstructionsPage() {
  const [activeTab, setActiveTab] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [expandedSection, setExpandedSection] = useState<string | null>("flow");

  const sections: SectionItem[] = [
    {
      id: "flow",
      title: "1. Visão Geral & Fluxo Operacional Sequencial",
      badge: "Fluxo 3 Fases",
      badgeColor: "bg-indigo-950/80 text-indigo-300 border-indigo-800",
      icon: "🚀",
      summary: "O fluxo canónico do GeoRoutePlan desenhado em 3 Fases obrigatórias antes da operação de campo e fecho.",
      content: (
        <div className="space-y-4 text-sm text-zinc-300">
          <p>
            O <strong>GeoRoutePlan</strong> foi concebido para operações logísticas reais de alta densidade com custo zero de infraestrutura e fidelidade absoluta aos dados da empresa.
            O trabalho diário segue uma cadeia de 3 Fases integradas:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 my-4">
            <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800">
              <div className="text-xs font-bold text-sky-400 uppercase tracking-wider mb-1">Fase 1</div>
              <h4 className="font-bold text-zinc-100 text-base mb-2">📁 Georreferenciação</h4>
              <p className="text-xs text-zinc-400">
                Upload do ficheiro Excel de 9 abas, auditoria de importação <strong>Tudo-ou-Nada</strong> e conferência milimétrica das coordenadas geográficas no mapa.
              </p>
              <div className="mt-3">
                <Link href="/dashboard/georeferencing" className="text-xs text-sky-400 hover:underline font-semibold">
                  Abrir Georreferenciação ➔
                </Link>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800">
              <div className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-1">Fase 2</div>
              <h4 className="font-bold text-zinc-100 text-base mb-2">🚚 Tabelas de Suporte</h4>
              <p className="text-xs text-zinc-400">
                Ativação dos armazéns, viaturas aptas (KG, m³, turnos e 2ª volta), motoristas com PIN de 4 dígitos e regras de compatibilidade entre tags.
              </p>
              <div className="mt-3">
                <Link href="/dashboard/fleet" className="text-xs text-amber-400 hover:underline font-semibold">
                  Abrir Tabelas de Frota ➔
                </Link>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800">
              <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-1">Fase 3</div>
              <h4 className="font-bold text-zinc-100 text-base mb-2">⚡ Planeamento Tático</h4>
              <p className="text-xs text-zinc-400">
                Otimização com Google OR-Tools VRPTW, simulação 3D LIFO da carga no baú, ajuste manual de paragens e despacho para os motoristas.
              </p>
              <div className="mt-3">
                <Link href="/dashboard/tactical" className="text-xs text-emerald-400 hover:underline font-semibold">
                  Abrir Planeamento Tático ➔
                </Link>
              </div>
            </div>
          </div>
          <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-xs">
            <strong className="text-zinc-200">📌 Regra Inviolável de Arranque:</strong> Cada novo dia de distribuição deve ter a sua data real registada na criação do projeto (ex: <em>2026-10-20</em>). O ciclo de vida do serviço conta a partir da data de estrada e tem auto-arquivo de salvaguarda permanente aos 10 dias.
          </div>
        </div>
      ),
    },
    {
      id: "georeferencing",
      title: "2. Fase 1: Importação Excel & Georreferenciação",
      badge: "Upload & Moradas",
      badgeColor: "bg-sky-950/80 text-sky-300 border-sky-800",
      icon: "📍",
      summary: "Importação íntegra das 9 abas com barreira Tudo-ou-Nada e validação visual de coordenadas.",
      content: (
        <div className="space-y-4 text-sm text-zinc-300">
          <h4 className="font-bold text-zinc-100 text-base">Passos para Carregar e Validar Entregas:</h4>
          <ol className="list-decimal list-inside space-y-2 text-zinc-300 ml-1">
            <li>
              <strong>Criar ou Escolher a Distribuição:</strong> No seletor superior, selecione o projeto ativo ou clique em <em>"+ Novo Projeto"</em> indicando a data de entrega pretendida.
            </li>
            <li>
              <strong>Arrastar o Ficheiro Excel Canónico:</strong> No separador de upload, arraste o ficheiro Excel canónico de 9 abas (ou ficheiro de clientes). O sistema deteta automaticamente as colunas principais: <code className="text-xs bg-zinc-800 px-1 py-0.5 rounded text-amber-300">Doc_ID</code>, <code className="text-xs bg-zinc-800 px-1 py-0.5 rounded text-amber-300">Cliente</code>, <code className="text-xs bg-zinc-800 px-1 py-0.5 rounded text-amber-300">Morada</code>, <code className="text-xs bg-zinc-800 px-1 py-0.5 rounded text-amber-300">CP</code>, <code className="text-xs bg-zinc-800 px-1 py-0.5 rounded text-amber-300">Peso_KG</code>, <code className="text-xs bg-zinc-800 px-1 py-0.5 rounded text-amber-300">Volume_M3</code> e <code className="text-xs bg-zinc-800 px-1 py-0.5 rounded text-amber-300">Janelas Horárias</code>.
            </li>
            <li>
              <strong>Auditoria Transacional Tudo-ou-Nada:</strong> O sistema inspeciona todas as abas. Se alguma linha tiver erros críticos (ex: PIN em falta ou coordenadas inválidas), a importação parcial é rejeitada com <em>Rollback</em> de segurança para nunca perder dados.
            </li>
            <li>
              <strong>Conferência de Qualidade de Coordenadas (Níveis 0 a 8):</strong>
              <ul className="list-disc list-inside ml-4 mt-1 text-xs space-y-1 text-zinc-400">
                <li><span className="text-emerald-400 font-bold">Nível 1 a 3 (Verde/Azul):</span> Geocodificação exata por Morada/Número de Polícia. Pronta para distribuição.</li>
                <li><span className="text-amber-400 font-bold">Nível 4 a 8 (Laranja/Vermelho):</span> Geocodificação aproximada por Código Postal ou Concelho. Clicar no cliente para abrir a ferramenta de correção.</li>
                <li><span className="text-purple-400 font-bold">Nível 0 (Manual):</span> Ajuste cirúrgico manual clicando diretamente no mapa sobre a porta do cliente.</li>
              </ul>
            </li>
            <li>
              Clique no botão <strong>"Avançar para Frota e Armazéns ➡️"</strong> após todas as moradas estarem conferidas.
            </li>
          </ol>
        </div>
      ),
    },
    {
      id: "fleet",
      title: "3. Fase 2: Gestão de Suporte (Armazéns, Frota & Regras)",
      badge: "5 Tabelas",
      badgeColor: "bg-amber-950/80 text-amber-300 border-amber-800",
      icon: "🚛",
      summary: "Configuração das 5 tabelas operacionais: viaturas ativas, capacidades, turnos, motoristas e restrições.",
      content: (
        <div className="space-y-4 text-sm text-zinc-300">
          <p>
            O módulo de Tabelas (<code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-200">/dashboard/fleet</code>) gere os parâmetros físicos e contratuais antes do cálculo matemático das rotas:
          </p>

          <div className="space-y-3">
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
              <strong className="text-zinc-100">1. Armazéns:</strong> Define as bases logísticas de partida e chegada, horários de cais e coordenadas dos centros de distribuição.
            </div>
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
              <strong className="text-zinc-100">2. Frota & Viaturas:</strong>
              <ul className="list-disc list-inside mt-1 text-xs text-zinc-400 space-y-1">
                <li><strong>Capacidade KG e Volume m³:</strong> Limites rígidos físicos que o solver nunca ultrapassará.</li>
                <li><strong>Hora Início e Fim de Turno:</strong> Limite contratual da jornada de trabalho do motorista.</li>
                <li><strong>2ª Volta (Sim / Não):</strong> Permite que a mesma carrinha regresse ao armazém para recarregar e saia num segundo turno à tarde.</li>
                <li><strong>Max Entregas:</strong> Teto de clientes por rota (ex: 25 a 30 paragens).</li>
                <li><strong>Coluna 'Ativo' (Inativação Sem Caixote do Lixo):</strong> Nenhuma viatura é apagada do Excel. Apenas desmarque a checkbox <em>Ativo</em> para que o solver não a utilize no dia.</li>
              </ul>
            </div>
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
              <strong className="text-zinc-100">3. Matriz de Regras de Compatibilidade:</strong> Permite cruzar etiquetas de viatura com etiquetas de entrega (ex: <code className="text-xs bg-zinc-800 text-rose-300 px-1 rounded">PROIBIR [Pesados] em [Acesso_Restrito_Lx]</code>). O solver respeita as proibições a 100%.
            </div>
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
              <strong className="text-zinc-100">4. Motoristas & PINs de 4 Dígitos:</strong> Registo dos condutores e associação do PIN numérico individual para acesso seguro à aplicação móvel.
            </div>
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
              <strong className="text-zinc-100">5. Justificação de Entregas (Motivos Oficiais):</strong> Catálogo de motivos oficiais que o motorista poderá escolher na rua caso o cliente esteja encerrado ou ausente.
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "tactical",
      title: "4. Fase 3: Planeamento Tático, Otimização VRPTW & Regras de Janela",
      badge: "Motor VRPTW",
      badgeColor: "bg-emerald-950/80 text-emerald-300 border-emerald-800",
      icon: "⚡",
      summary: "Otimização exata com OR-Tools, controlo estrito de horários, tolerância zero a atrasos e almoço máximo de 1 hora.",
      content: (
        <div className="space-y-4 text-sm text-zinc-300">
          <h4 className="font-bold text-zinc-100 text-base">Princípios do Motor de Otimização:</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
              <strong className="text-emerald-400 block mb-1">🎯 Prioridade a Clientes Distantes</strong>
              Se a capacidade ou o tempo da frota for insuficiente, as entregas que ficam de fora são SEMPRE as mais próximas do armazém para minimizar km perdidos.
            </div>
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
              <strong className="text-emerald-400 block mb-1">⏱️ Zero Tolerância a Atrasos</strong>
              Entregas com janela horária (ex: 09:00 - 13:00) são Hard Constraints estritas. Nenhuma entrega é agendada para lá da hora acordada com o cliente.
            </div>
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
              <strong className="text-amber-400 block mb-1">🛑 Proibição de Espera & Almoço de 1h</strong>
              O motorista NUNCA fica horas parado à espera de um cliente abrir. O tempo de almoço/pausa está estritamente limitado a <strong>1 hora no máximo (60 minutos)</strong>.
            </div>
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
              <strong className="text-amber-400 block mb-1">🕒 Sincronização de Partida</strong>
              Se a paragem anterior acabar às 09:39 e a seguinte só abrir às 14:00, o carro não vai para a porta esperar 4 horas. O sistema sincroniza a partida para as 14:00 após o descanso operacional.
            </div>
          </div>

          <h4 className="font-bold text-zinc-100 text-base mt-4">Comandos e Ferramentas do Painel Tático:</h4>
          <ul className="list-disc list-inside space-y-2 text-xs text-zinc-300 ml-1">
            <li><strong>🛠️ Otimizar Rotas:</strong> Executa a resolução global VRPTW com todos os veículos ativos e clientes georreferenciados.</li>
            <li><strong>🗺️ Mapa Destacado (Detached Map):</strong> Abre o mapa de rotas numa janela independente para trabalhar confortavelmente com 2 monitores lado a lado em tempo real.</li>
            <li><strong>⇄ Mover Rota em Lote:</strong> Transfere instantaneamente todas as entregas de um carro para outro (útil para viaturas avariadas).</li>
            <li><strong>⚡ Ordenar Trajeto:</strong> Reordena de forma inteligente as entregas de uma viatura específica pela sequência mais rápida sem violar janelas horárias.</li>
            <li><strong>🔄 Reset Geral:</strong> Envia todas as entregas de volta para a coluna <em>"Por Distribuir"</em> para permitir reconfiguração total da frota.</li>
          </ul>
        </div>
      ),
    },
    {
      id: "cargo3d",
      title: "5. Carregamento 3D LIFO Wall-Building",
      badge: "Visualizador 3D",
      badgeColor: "bg-blue-950/80 text-blue-300 border-blue-800",
      icon: "📦",
      summary: "Simulador de arrumação física volumétrica do baú com LIFO rigoroso, contiguidade e gravidade por peso.",
      content: (
        <div className="space-y-4 text-sm text-zinc-300">
          <p>
            O módulo <strong>Carregamento 3D</strong> (<code className="text-xs bg-zinc-800 px-1 py-0.5 rounded text-zinc-200">/dashboard/cargo-3d</code>) traduz a rota planeada em instruções visuais físicas de estiva para o cais de carga:
          </p>

          <div className="space-y-3 text-xs">
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
              <strong className="text-blue-400 block mb-1">1. Sequência LIFO Inviolável (Last In, First Out)</strong>
              As entregas do fim da rota são arrumadas encostadas ao <strong>fundo do baú / cabine ($X=0$)</strong>. A arrumação avança cliente a cliente em direção às <strong>portas traseiras ($X=L$)</strong>, ficando a Paragem 1 logo à saída para descarga direta sem desarrumar a viatura.
            </div>
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
              <strong className="text-blue-400 block mb-1">2. Contiguidade 100% dos Volumes do Cliente</strong>
              Todas as caixas de uma mesma encomenda ficam estritamente agrupadas no mesmo bloco transversal (*Wall-Building*). É proibido que volumes do mesmo cliente fiquem dispersos pelo camião.
            </div>
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
              <strong className="text-blue-400 block mb-1">3. Integridade dos Volumes ($X$ Volumes = $X$ Caixas)</strong>
              O simulador renderiza no baú exatamente os $X$ volumes físicos registados no Excel para cada cliente.
            </div>
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
              <strong className="text-blue-400 block mb-1">4. Física da Gravidade e Estabilidade por Peso</strong>
              As caixas mais pesadas de cada cliente assentam obrigatoriamente no chão ($Y=0$). Caixas de peso igual empilham com 100% de base apoiada, e caixas mais leves ficam sempre no topo (zero caixas suspensas e 0% sobreposição).
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "driverapp",
      title: "6. Operação de Campo: App dos Motoristas (PWA)",
      badge: "Mobile PWA",
      badgeColor: "bg-teal-950/80 text-teal-300 border-teal-800",
      icon: "📱",
      summary: "Aplicação móvel de telemóvel para os condutores com baixa de guias, navegação GPS e respeito RGPD.",
      content: (
        <div className="space-y-4 text-sm text-zinc-300">
          <p>
            A aplicação móvel de motoristas corre diretamente no navegador do smartphone ou como aplicação instalada (PWA):
          </p>
          <ul className="list-disc list-inside space-y-2 text-xs text-zinc-300 ml-1">
            <li><strong>Acesso Rápido por PIN:</strong> O condutor entra apenas com o seu PIN de 4 dígitos (ex: <em>1111</em>) configurado na Fase 2.</li>
            <li><strong>Guias & Sequência Diária:</strong> Vê a lista ordenada das suas paragens com nome, morada, caixas, notas do operador e botão de chamada telefónica imediata ao cliente.</li>
            <li><strong>Navegação GPS com 1 Clique:</strong> Botão que abre a morada diretamente no <strong>Google Maps</strong> ou <strong>Waze</strong>.</li>
            <li><strong>Baixa de Entrega:</strong>
              <ul className="list-disc list-inside ml-4 mt-1 space-y-1 text-zinc-400">
                <li><span className="text-emerald-400 font-bold">Verde (Entregue):</span> Regista a hora de confirmação e avança para a próxima paragem.</li>
                <li><span className="text-rose-400 font-bold">Vermelho (Não Entregue):</span> Obriga à escolha de um motivo oficial cadastrado (ex: <em>Cliente Ausente</em>).</li>
              </ul>
            </li>
            <li><strong>Modo Offline-First:</strong> Em garagens ou caves sem rede móvel, todas as operações são salvas localmente no telefone e sincronizadas automaticamente quando houver sinal.</li>
            <li><strong>Conformidade RGPD / CNPD:</strong> O motorista dispõe de botão de Pausa/Almoço que <strong>desliga expressamente o sinal de GPS</strong>, cumprindo as diretrizes legais de privacidade.</li>
          </ul>
        </div>
      ),
    },
    {
      id: "reports",
      title: "7. Relatórios, Exportação do Excel Canónico & Ciclo de Vida",
      badge: "Excel 9 Abas",
      badgeColor: "bg-purple-950/80 text-purple-300 border-purple-800",
      icon: "📊",
      summary: "Emissão do manifesto diário, download limpo do Excel de 9 abas timbrado e política de arquivo aos 10 dias.",
      content: (
        <div className="space-y-4 text-sm text-zinc-300">
          <h4 className="font-bold text-zinc-100 text-base">Fecho do Serviço e Salvaguarda:</h4>
          <ul className="list-disc list-inside space-y-2 text-xs text-zinc-300 ml-1">
            <li><strong>Conferência de Métricas:</strong> Quilómetros totais percorridos pela frota, custos operacionais calculados, taxa de ocupação em peso e volume e taxa de pontualidade.</li>
            <li>
              <strong>Exportação Fiel do Excel de 9 Abas:</strong> O botão <em>"📥 Exportar Excel 9 Abas"</em> gera o ficheiro canónico timbrado com a folha <em>Rotas</em> preenchida com a sequência exata de paragens, horas de chegada e saída calculadas.
            </li>
            <li><strong>Download Silencioso e Seguro:</strong> O download processa-se em memória com segurança multitenant, sem expor URLs técnicos nem tokens no browser.</li>
            <li>
              <strong>Ciclo de Vida de 10 Dias & Auto-Arquivo:</strong>
              <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg mt-2 text-xs space-y-1 text-zinc-400">
                <p><span className="text-amber-400 font-bold">⚠️ Dias 7 a 10:</span> O painel exibe um aviso amarelo de expiração próxima para alertar o utilizador.</p>
                <p><span className="text-indigo-400 font-bold">📦 Ao 10º Dia:</span> O sistema grava automaticamente o Excel Canónico de 9 abas na pasta de arquivo permanente (<code className="text-zinc-200">/storage/archives/</code>) e purga a base de dados SQLite operacional, mantendo o sistema ultrarrápido a custo zero.</p>
                <p><span className="text-emerald-400 font-bold">📥 Download Permanente:</span> O ficheiro arquivado fica sempre disponível para download no dashboard através do botão <em>"Descarregar Excel Arquivado"</em>.</p>
              </div>
            </li>
          </ul>
        </div>
      ),
    },
  ];

  const filteredSections = sections.filter((s) => {
    const matchesSearch =
      s.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.summary.toLowerCase().includes(searchTerm.toLowerCase());
    if (!matchesSearch) return false;
    if (activeTab === "all") return true;
    return s.id === activeTab;
  });

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-6 shadow-xl backdrop-blur-md">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center space-x-2 text-xs font-semibold text-sky-400 uppercase tracking-wider mb-1">
                <span>📖 Manual de Operação & Documentação Oficial</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-zinc-100 tracking-tight">
                Instruções Passo a Passo do Programa
              </h1>
              <p className="text-sm text-zinc-400 mt-1">
                Guia interativo completo sobre como importar ficheiros, configurar tabelas, otimizar rotas com o solver VRPTW e gerir a operação.
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Link
                href="/dashboard/georeferencing"
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-sky-900/30 flex items-center space-x-1.5"
              >
                <span>🚀 Começar Fase 1</span>
              </Link>
            </div>
          </div>

          {/* Quick Filters & Search */}
          <div className="mt-6 pt-4 border-t border-zinc-800/80 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center space-x-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
              <button
                onClick={() => setActiveTab("all")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  activeTab === "all"
                    ? "bg-zinc-100 text-zinc-900 shadow"
                    : "bg-zinc-800/60 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Todas as Secções
              </button>
              {sections.map((sec) => (
                <button
                  key={sec.id}
                  onClick={() => setActiveTab(sec.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition flex items-center space-x-1 ${
                    activeTab === sec.id
                      ? "bg-sky-600 text-white shadow-md shadow-sky-900/40"
                      : "bg-zinc-800/60 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <span>{sec.icon}</span>
                  <span>{sec.badge}</span>
                </button>
              ))}
            </div>

            <div className="w-full sm:w-64">
              <input
                type="text"
                placeholder="Pesquisar instruções..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-sky-500 transition"
              />
            </div>
          </div>
        </div>

        {/* Sections List */}
        <div className="space-y-4">
          {filteredSections.map((section) => {
            const isExpanded = expandedSection === section.id;
            return (
              <div
                key={section.id}
                className={`bg-zinc-900/70 border rounded-2xl transition duration-200 shadow-md backdrop-blur-sm overflow-hidden ${
                  isExpanded ? "border-zinc-700 bg-zinc-900/90" : "border-zinc-800/80 hover:border-zinc-700/80"
                }`}
              >
                <button
                  onClick={() => setExpandedSection(isExpanded ? null : section.id)}
                  className="w-full p-5 text-left flex items-start sm:items-center justify-between gap-4 focus:outline-none"
                >
                  <div className="flex items-start sm:items-center space-x-3">
                    <span className="text-2xl p-2 rounded-xl bg-zinc-950 border border-zinc-800/80 shrink-0">
                      {section.icon}
                    </span>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h2 className="text-base sm:text-lg font-bold text-zinc-100">
                          {section.title}
                        </h2>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${section.badgeColor}`}>
                          {section.badge}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        {section.summary}
                      </p>
                    </div>
                  </div>
                  <span className="text-zinc-500 text-sm font-mono mt-1 sm:mt-0">
                    {isExpanded ? "▲ Recolher" : "▼ Expandir"}
                  </span>
                </button>

                {isExpanded && (
                  <div className="px-6 pb-6 pt-2 border-t border-zinc-800/60 bg-zinc-950/40">
                    {section.content}
                  </div>
                )}
              </div>
            );
          })}

          {filteredSections.length === 0 && (
            <div className="p-12 text-center bg-zinc-900/40 border border-zinc-800 rounded-2xl text-zinc-400 text-sm">
              Nenhuma instrução encontrada para o termo <code className="text-zinc-200 font-bold">"{searchTerm}"</code>.
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
