# 🚚 GeoRoutePlan — Documento Oficial de Especificação, Princípios e Arquitetura

> **🚨 REGRA SUPREMA PARA O AGENTE DE IA / DESENVOLVEDOR:**
> Este é o documento mestre de referência absoluta do projeto. **Todas as sessões de trabalho devem começar pela leitura e alinhamento rigoroso com as especificações aqui descritas.** Não altere código, modelos ou arquitetura sem validar a sua conformidade contra este documento.

---

## 📌 1. Visão Geral e Filosofia do Sistema

O **GeoRoutePlan** (GEORREF Optimizer) é uma plataforma empresarial integrada de georreferenciação inteligente, otimização de rotas de distribuição logística (*Vehicle Routing Problem* - VRP), controlo operacional tático em tempo real e aplicação móvel de campo para motoristas.

### Princípios Invioláveis:

1. **Eficiência de Custos (*Low-Cost Waterfall First*)**:
   * O sistema nunca faz chamadas desnecessárias a APIs pagas.
   * **Cascata Obrigatória de Geocoding**:
     1. Base de Dados Local SQLite (Códigos postais e histórico de moradas geocodificadas).
     2. Web Scraping / Base CTT.
     3. OpenStreetMap (OSM Nominatim).
     4. **Google Maps API**: Usada apenas como último recurso para moradas não resolvidas, renderização avançada de mapas, trânsito em tempo real e cálculo de matrizes de distância de alta precisão.
   * **🚨 DIRETRIZ DE ATIVAÇÃO DE APIS PAGAS DE TRÂNSITO (IMPORTANTE)**:
     * A integração avançada de matrizes de trânsito em tempo real via **Google Routes Matrix API está devidamente planeada e desenhada**, mas **NÃO PODE SER IMPLEMENTADA até existirem clientes comerciais reais e pagantes no sistema**.
     * Enquanto não houver clientes reais a justificar o custo operacional da API, o motor de planeamento mantém-se a **custo zero** utilizando o solver local **Google OR-Tools com matrizes Haversine calibradas e regras de negócio locais**.

2. **Google Maps API Centralizada e Otimizada**:
   * A API do Google Maps está integrada no sistema para geocoding de alta precisão (níveis 0-2), polylines reais e visualização em mapas.
   * Todo o consumo é monitorizado e contabilizado por empresa/cliente no painel de administração (`admin/consumptions`).

3. **O Ficheiro Excel como a Base de Dados do Projeto (*Single Source of Truth*)**:
   * O projeto adota uma arquitetura de dados centrada num **Ficheiro Excel Único de 9 Abas**.
   * **Importação Total**: O sistema importa rigorosamente todos os campos de todas as 9 abas. Se o ficheiro já contiver rotas atribuídas na aba `Rotas`, o sistema recria as rotas imediatamente.
   * **Persistência Bidirecional (*Roundtrip*)**: Qualquer alteração, edição de paragens, novos clientes, correção de coordenadas ou reatribuição de veículos é persistida.
   * **Exportação Fiel**: Ao descarregar o projeto, o sistema gera o ficheiro Excel com as **9 abas totalmente preenchidas e atualizadas** com o estado exato da distribuição.

4. **Idioma e Comunicação**:
   * Toda a documentação, comentários de código estruturais e comunicação devem ser em **Português**.

5. **Uso Obrigatório de SKILLs Especializadas**:
   * Antes de executar tarefas em qualquer camada técnica (Frontend Next.js, Backend FastAPI, Algoritmos OR-Tools, Mobile/PWA, Base de Dados), deve ser invocada e seguida a respetiva SKILL da área.

---

## 📊 2. Estrutura Canónica e Campos Reais do Ficheiro Excel (9 Abas)

O ficheiro Excel do projeto (`GeoRoutePlan.xlsx`) é composto por 9 abas interligadas. Os nomes das abas e as suas colunas correspondem rigorosamente à implementação real do sistema:

### 1. `Armazéns` (Centros de Distribuição / Depósitos)
| Coluna | Tipo / Importância | Descrição / Exemplo |
| :--- | :---: | :--- |
| `Nome_Armazem` | **Obrigatório** | Identificador único do armazém (ex: *Armazém Central Lisboa*) |
| `Morada` | **Obrigatório** | Endereço completo do armazém (ex: *Rua do Cais, 100*) |
| `CP` | **Obrigatório** | Código postal de 4 ou 7 dígitos (ex: *1900-100*) |
| `Localidade` | Opcional | Localidade / Povoação (ex: *Lisboa*) |
| `Latitude` | Opcional | Coordenada Latitude (ex: *38.7436*) |
| `Longitude` | Opcional | Coordenada Longitude (ex: *-9.1602*) |
| `Hora_Abertura` | Recomendado | Horário de início de operações (ex: *07:00*) |
| `Hora_Fecho` | Recomendado | Horário de encerramento do armazém (ex: *20:00*) |
| `Tempo_Carga_Min` | Recomendado | Duração média de carregamento da viatura em minutos (ex: *30*) |
| `Contacto_Responsavel`| Recomendado | Nome e telemóvel do responsável do cais |

### 2. `Frota` (Veículos e Capacidades Operacionais)
| Coluna | Tipo / Importância | Descrição / Exemplo |
| :--- | :---: | :--- |
| `Armazem` | **Obrigatório** | Nome do armazém base associado (ex: *Armazém Central Lisboa*) |
| `Veiculo` | **Obrigatório** | Nome/Código do veículo ou rota (ex: *Carrinha 01 - Lisboa*) |
| `Capacidade_KG` | **Obrigatório** | Capacidade máxima de carga em KG (ex: *1200*) |
| `Capacidade_Vol` | Recomendado | Capacidade máxima em volume / m³ (ex: *10.5*) |
| `Velocidade_Media` | Recomendado | Velocidade média de circulação em km/h (ex: *45*) |
| `Hora_Inicio_Turno` | **Obrigatório** | Hora de início de turno do motorista (ex: *08:00*) |
| `Hora_Fim_Turno` | **Obrigatório** | Hora limite de fim de turno do motorista (ex: *17:00*) |
| `Custo_KM` | Recomendado | Custo operacional por quilómetro (€/km) (ex: *0.65*) |
| `Custo_Hora` | Recomendado | Custo operacional por hora (€/h) (ex: *12.00*) |
| `Max_Entregas` | Recomendado | Número máximo de paragens permitidas por turno (ex: *25*) |
| `Regras` | Opcional | Tags de restrição da viatura (ex: *[FRIO], [PESADOS], [CENTRO_URBANO]*) |
| `Motorista_Nome` | Recomendado | Nome do condutor principal atribuído |
| `Motorista_Telemovel`| Recomendado | Contacto telefónico do condutor |

### 3. `Entregas` (Lista de Clientes e Encomendas)
| Coluna | Tipo / Importância | Descrição / Exemplo |
| :--- | :---: | :--- |
| `Armazem` | **Obrigatório** | Armazém que abastece a entrega |
| `Doc_ID` | **Obrigatório** | Número da guia/fatura/documento (ex: *FT-2026/001*) |
| `Cliente` | **Obrigatório** | Nome ou código do cliente (ex: *Restaurante Mar e Sol*) |
| `Morada` | **Obrigatório** | Endereço completo da paragem (ex: *Avenida da Liberdade, 24*) |
| `CP` | **Obrigatório** | Código postal CP4 ou CP7 (ex: *1250-096*) |
| `Localidade` | Opcional | Localidade / Freguesia / Concelho |
| `Latitude` | Opcional | Coordenada Latitude geocodificada |
| `Longitude` | Opcional | Coordenada Longitude geocodificada |
| `Telefone_Cliente` | Recomendado | Telefone para contacto na entrega |
| `Peso_KG` | Recomendado | Peso total da encomenda em KG (ex: *45.5*) |
| `Volume_M3` | Recomendado | Volume total em metros cúbicos (ex: *0.8*) |
| `Janela1_Inicio` | **Obrigatório** | Início da janela horária de receção (ex: *09:00*) |
| `Janela1_Fim` | **Obrigatório** | Fim da janela horária de receção (ex: *12:30*) |
| `Tempo_Descarga_Min`| Recomendado | Duração prevista para descarga no cliente (ex: *15*) |
| `Regras` | Opcional | Tags de exigência da entrega (ex: *[FRIO], [ELEVADOR], [ACESSO_RESTRITO]*) |
| `Vendedor` | Opcional | Nome/Código do comercial responsável pela conta |
| `Valor_Cobrar` | Opcional | Valor de cobrança no ato de entrega / COD (€) |
| `Notas_Entrega` | Opcional | Instruções de acesso ou observações logísticas |

### 4. `Regras` (Matriz de Compatibilidade e Restrições)
| Coluna | Tipo / Importância | Descrição / Exemplo |
| :--- | :---: | :--- |
| `Tag_Veiculo` | **Obrigatório** | Tag associada à viatura (ex: *CARRINHA_PEQUENA*) |
| `Permissao` | **Obrigatório** | Tipo de regra (*PERMITIR* ou *PROIBIR*) |
| `Tag_Entrega` | **Obrigatório** | Tag associada à entrega/cliente (ex: *ACESSO_RESTRITO_LX*) |
| `Descricao` | Opcional | Explicação detalhada da regra de negócio |

### 5. `Rotas` (Rotas Planeadas e Sequência de Paragens)
| Coluna | Tipo / Importância | Descrição / Exemplo |
| :--- | :---: | :--- |
| `ID_Original` | **Obrigatório** | Doc_ID ou identificador único da paragem |
| `Cliente` | **Obrigatório** | Nome do cliente |
| `Morada` | **Obrigatório** | Morada da paragem |
| `Localidade` | **Obrigatório** | Localidade da entrega |
| `CodPostal` | **Obrigatório** | Código postal |
| `Rota` | Recomendado | Nome da rota / Veículo atribuído (ex: *Carrinha 01*) |
| `Ordem` | Recomendado | Posição sequencial na rota (1, 2, 3...) |
| `Janela_Inicio` | Recomendado | Horário previsto de chegada |
| `Janela_Fim` | Recomendado | Horário limite de saída |
| `Peso` | Recomendado | Peso da entrega (KG) |
| `Volumes` | Recomendado | Volume da entrega (m³) |
| `Contacto` | Recomendado | Telefone de contacto |
| `Vendedor` | Opcional | Vendedor associado |
| `Valor_Cobrar` | Opcional | Valor a cobrar na paragem (€) |
| `Observações` | Opcional | Notas da rota ou do motorista |

### 6. `Manifestos` (Resumo Operacional de Carga por Veículo)
| Coluna | Tipo / Importância | Descrição / Exemplo |
| :--- | :---: | :--- |
| `Armazem` | Manifesto | Armazém de partida |
| `Veiculo` | Manifesto | Identificador da viatura |
| `Motorista` | Manifesto | Nome do condutor |
| `Total_Paragens` | Manifesto | Número total de paragens da rota |
| `Volume_Total_M3` | Manifesto | Volume total carregado (m³) |
| `Peso_Total_KG` | Manifesto | Peso total carregado (KG) |
| `Taxa_Ocupacao_Peso`| Manifesto | % de ocupação da viatura face à capacidade máxima |
| `Distancia_Total_KM`| Manifesto | Quilometragem total estimada da rota |
| `Tempo_Total_Estimado`| Manifesto| Duração total estimada do turno |
| `Custo_Total_Estimado`| Manifesto| Custo financeiro estimado da rota (€) |
| `Lista_Documentos` | Opcional | Lista concatenada de números de guias/faturas |

### 7. `Motoristas e Carros` (Credenciais Móveis e Viaturas)
| Coluna | Tipo / Importância | Descrição / Exemplo |
| :--- | :---: | :--- |
| `Motorista` | **Obrigatório** | Nome completo do motorista |
| `PIN/Password` | **Obrigatório** | PIN de autenticação para a App Móvel (ex: *1111*) |
| `Viatura` | Recomendado | Nome da viatura associada |
| `Matrícula` | Opcional | Matrícula da viatura (ex: *AA-00-BB*) |
| `Telemóvel` | Recomendado | Número de telefone do motorista |
| `Rota Atribuída` | Opcional | Identificador da rota em execução |

### 8. `Justificação entregas` (Catálogo de Motivos de Não Entrega)
| Coluna | Tipo / Importância | Descrição / Exemplo |
| :--- | :---: | :--- |
| `Motivo de Não Entrega` | **Obrigatório** | Descrição do motivo (ex: *Cliente Ausente*, *Carga Recusada*, *Morada Incorreta*, *Estabelecimento Encerrado*) |
| `Categoria / Ação` | Recomendado | Ação operacional recomendada (ex: *Reagendar*, *Devolver ao Armazém*, *Contactar Comercial*) |

### 9. `Instruções` (Legenda e Regras de Preenchimento)
| Coluna | Tipo / Importância | Descrição |
| :--- | :---: | :--- |
| `Secção` | Instruções | Identificador da aba ou módulo |
| `Campo_ou_Regra` | Instruções | Nome da coluna ou parâmetro |
| `Obrigatorio` | Instruções | Nível de exigência (*Sim*, *Recomendado*, *Opcional*) |
| `Formato_Aceite` | Instruções | Tipo de dados aceite (Texto, Numérico, HH:MM, etc.) |
| `Exemplo` | Instruções | Valor de exemplo representativo |
| `Descricao_e_Recomendacoes`| Instruções| Guia detalhado de boas práticas |

---

## 🏗️ 3. Arquitetura do Sistema e Componentes

O ecossistema GeoRoutePlan é composto pelos seguintes módulos:

### A. Frontend Web Principal (Gestor de Tráfego) — `frontend/`
* Desenvolvido em **Next.js 15+ / React / TailwindCSS**.
* **Módulos Principais**:
  1. `dashboard/georeferencing`: Upload do Excel unificado, geocodificação em cascata, correção manual de coordenadas e auditoria de qualidade.
  2. `dashboard/fleet`: Gestão integrada de **5 Tabelas de Suporte e Regras**:
     * 🏠 **1. Armazéns**: Centros de distribuição, moradas, horários de abertura/fecho, tempos de carga e contactos.
     * 🚚 **2. Frota & Viaturas**: Veículos, capacidades (KG e Vol), turnos, custos (€/km e €/h), limites de entregas e motoristas atribuídos.
     * ⚖️ **3. Regras**: Matriz de compatibilidade entre tags de viaturas e tags de entregas.
     * 👤 **4. Motoristas & PINs**: Credenciais móveis, PINs de acesso, matrículas e rotas associadas.
     * ⚠️ **5. Justificação de Entregas**: Catálogo padronizado de motivos de não entrega e ações recomendadas.
  3. `dashboard/tactical`: Painel tático com visualização de timeline de rotas, edição interativa de paragens, transferência de clientes e reordenação.
     * **Sincronização 100% Bidirecional com Mapa Destacado (`detached-map`)**:
       * A comunicação entre o ecrã principal e a janela destacada do mapa é feita via `BroadcastChannel("georoute_map_sync")` (com fallback para `StorageEvent`).
       * **Ecrã Principal -> Mapa Destacado**: Filtros de pesquisa, seleção de armazém, filtros de estado e recálculos de rotas refletem-se instantaneamente no mapa externo.
       * **Mapa Destacado -> Ecrã Principal**: Reatribuição de paragens a novas viaturas, transferências em lote e ajustes manuais de coordenadas no mapa atualizam e recalculam a grelha tática em tempo real.
  4. `dashboard/maps`: Ferramenta de mapeamento avançado por **Zonas e Códigos Postais (CPs)**:
     * Definição de zonas personalizadas através do agrupamento de faixas de CP4 (ex: 1000, 2600), com associação a Concelhos, Distritos e Freguesias.
     * Renderização de centroides e polígonos coloridos por zona no mapa interativo.
     * **Visão de Evolução**: Exploração aprofundada da Google Maps JavaScript API (Data Layer, clustering inteligente e densidade de procura por zona).
  5. `dashboard/tracking`: Torre de controlo em tempo real (posição GPS dos motoristas, estados de entrega atualizados ao vivo).
  6. `dashboard/reports`: Exportação do ficheiro Excel com as 9 abas preenchidas, relatórios de produtividade e análise de custos.
  7. `dashboard/admin`: Painel de Administração e Gestão de Licenças (detalhado na Secção 4).

### B. Backend API — `backend/`
* Desenvolvido em **FastAPI (Python 3.10+)**.
* Módulos de Routers (`backend/api/`):
  * `auth.py`: Autenticação JWT, sessões e multi-tenancy.
  * `projects.py`: Gestão de projetos, importação e exportação do Excel de 9 abas.
  * `geocoding.py`: Orquestração do geocodificador waterfall e persistência de coordenadas.
  * `fleet.py`: Gestão integral das 5 tabelas de suporte e regras.
  * `solver.py`: Interface de execução e parametrização do solver Google OR-Tools integrado com o motor de regras.
  * `maps.py`: Geração de dados geoespaciais, polylines, trânsito e mapeamento de CPs/Zonas.
  * `tracking.py`: Ingestão de telemetria GPS e atualização de estados vindos dos motoristas.
  * `reports.py`: Geração do ficheiro Excel final com as 9 abas preenchidas (`utils/export_engine.py`).
  * `admin_users.py`: Administração do sistema, controlo de utilizadores, tempos de acesso e auditoria de consumos da Google API.

### C. Motores de Cálculo e Algoritmos — `utils/`

#### 1. Módulo do Motor de Regras (`utils/rules_engine.py`) — *Núcleo Estratégico de Negócio*
* **Função Crítica**: Define e avalia as regras da distribuição, que variam dinamicamente conforme cada projeto/cliente.
* **Ligação Direta ao Cálculo de Rotas**: O motor de regras é injetado diretamente no Solver (`optimization_solver.py`), condicionando quais veículos têm permissão legal e operacional para servir cada cliente.
* **Mecanismo de Avaliação Multi-Tag**:
  * Processamento de tags nas viaturas (ex: `[FRIO]`, `[ELEVADOR]`, `[CENTRO_HISTORICO]`, `[PESADOS]`, `[ADR]`, `[PORTA_PALETES]`).
  * Processamento de tags nas entregas/clientes (ex: `[FRIO]`, `[ACESSO_RESTRITO_LX]`, `[DESCARGA_RAMPA]`, `[URGENTE]`).
  * Validação contra a matriz da Folha 4 (`Regras`: `Tag_Veiculo` + `Permissao: PERMITIR/PROIBIR` + `Tag_Entrega`).
* **Restrições Rígidas no Solver**: Impede a alocação de entregas a viaturas incompatíveis antes do cálculo (`routing.VehicleVar(node).SetValues(allowed_vehicles)`), garantindo planos de rota 100% executáveis na prática.

#### 2. Motor de Otimização VRP (`utils/optimization_solver.py`)
* Motor baseado em **Google OR-Tools** (Execução local a custo zero):
  * Restrições de capacidade física (peso em KG e volume em m³).
  * Janelas horárias (*Time Windows*) por cliente e horários de funcionamento do armazém.
  * Múltiplos armazéns com depósitos de partida e chegada diferenciados.
  * Balanceamento dinâmico de carga de trabalho entre viaturas.
  * Meta-heurística *Guided Local Search* (GLS) para fuga de mínimos locais.

#### 3. Motores de Geocodificação e Rotas
* `geocoder_engine.py`: Motor de geocodificação em cascata (Local DB -> Scraping -> OSM -> Google Maps).
* `google_routes_engine.py`: Integração com serviços de rotas, matrizes de distância e trânsito da Google Maps API.
* `template_manager.py` e `export_engine.py`: Criação, leitura e escrita consistente do template de 9 abas.

### D. App Móvel para Motoristas — `motoristas_webapp/`
* Aplicação web progressiva (**PWA**) otimizada para telemóveis (ecrãs táteis, modo claro/escuro para dia/noite).
* **Funcionalidades da App de Campo**:
  * Login simples e seguro por **PIN** configurado na Folha 7 (`Motoristas e Carros`).
  * Lista sequencial de paragens da rota diária com morada, contacto, volumes e notas.
  * Botão de navegação direta (abre Google Maps / Waze).
  * Marcação do estado da entrega:
    * **Entregue**: Registo imediato de sucesso com timestamp.
    * **Não Entregue**: Registo com seleção obrigatória do motivo configurado na Folha 8 (`Justificação entregas`).
  * **Operação Offline-First**: O motorista continua a trabalhar sem rede; as marcações sincronizam automaticamente ao recuperar internet.
  * **Telemetria GPS**: Envio periódico da localização do veículo para a Torre de Controlo.

---

## 🛡️ 4. Módulo de Administração, Licenciamento e Controlo de Custos

O sistema dispõe de um módulo dedicado de administração para gestão multi-tenant, segurança e faturação:

### 1. Gestão de Utilizadores e Tempos de Utilização
* **Criação e Gestão de Contas**: Registo de empresas e utilizadores com palavras-passe encriptadas com hash seguro.
* **Controlo de Tempo de Utilização e Validade (`data_validade`)**:
  * O sistema define e controla a data de expiração do acesso de cada cliente com base no pagamento/subscrição efetuada.
  * Bloqueio ou ativação dinâmica de contas (`is_active`).
  * Gestão granular de perfis: Administrador, Superadmin e operadores de tráfego.

### 2. Auditoria e Controlo de Custos da Google Maps API por Cliente
* **Registo Centralizado de Transações**: Contabilização detalhada de todas as chamadas à Google Maps API (Geocoding, Maps, Directions/Routes).
* **Painel de Consumos (`admin/consumptions`)**:
  * Visibilidade do número de pedidos e custo financeiro estimado (€) consumido por cada cliente/empresa.
  * Controlo de limites de quota mensal por plano (`quota_limit`, `quota_count`, `total_custo_mes`).
  * Prevenção de derrapagens orçamentais e desativação automática de chamadas pagas ao atingir o teto contratado.

---

## 🔍 5. Níveis de Qualidade de Georreferenciação

O sistema audita e classifica cada coordenada de entrega em 9 níveis de precisão (0 a 8):

| Nível | Classificação | Descrição da Precisão | Tolerância Aprox. | Ação do Sistema |
| :---: | :--- | :--- | :---: | :--- |
| **0** | Cliente / Manual | Coordenadas fornecidas explicitamente no Excel ou corrigidas no mapa | Exata | Aceite imediatamente |
| **1** | Ouro (*Rua + Porta*) | Morada completa validada com número de polícia | ~10m | Ótimo para otimização |
| **2** | Prata (*Rua + CP4*) | Rua identificada associada ao código postal de 4 dígitos | ~50m | Válido para distribuição |
| **3** | Bronze (*CP7 Completo*) | Centroide de código postal completo (ex: 1000-001) | ~100m | Aceitável em zonas urbanas |
| **4** | Ferro (*CP4*) | Centroide do código postal genérico de 4 dígitos | ~500m | Aceitável em zonas rurais |
| **5** | Pedra (*Localidade*) | Centroide da localidade ou povoação | ~1km | Alerta de baixa precisão |
| **6** | Concelho | Centroide do município/concelho | ~5km | Requer revisão manual |
| **7** | Distrito | Centroide da capital de distrito | ~20km | Não recomendado para rotas |
| **8** | Falha (*Não Encontrado*) | Endereço inválido ou não localizado | N/A | Exige intervenção manual |

---

## 🧹 6. Levantamento de Código: Componentes Ativos vs. Legado

### ✅ Componentes Ativos e Principais (Manter e Evoluir):
* `frontend/`: Aplicação Next.js completa (UI moderna de gestão).
* `backend/`: API FastAPI e endpoints REST.
* `motoristas_webapp/`: Aplicação PWA de distribuição para motoristas.
* `utils/optimization_solver.py`: Motor OR-Tools VRP.
* `utils/rules_engine.py`: Motor de avaliação de regras de distribuição e compatibilidade multi-tag.
* `utils/geocoder_engine.py`: Motor de geocodificação em cascata.
* `utils/template_manager.py` e `utils/export_engine.py`: Gestores do Excel de 9 abas.
* `utils/google_routes_engine.py`: Integração com serviços Google Maps.
* `database.py`: Estrutura de dados SQLite e multi-tenancy.

### ⚠️ Componentes Legados / Obsoletos (Isolados em `_legacy_archive/`):
* `_legacy_archive/`: Guarda o monólito Streamlit antigo (`app.py`), componentes antigos (`components/`), páginas legadas, backups pesados de bases de dados e templates antigos.

---

## 🚀 7. Roadmap e Próximos Passos de Desenvolvimento

1. **Expansão da App de Motoristas (`motoristas_webapp`)**:
   * Assinatura digital no ecrã (*Proof of Delivery - POD*).
   * Captura de fotos como comprovativo de entrega ou justificação de falha.
   * Leitor de códigos de barras / QR Code via câmara para conferência de volumes.
2. **Desenvolvimento Avançado do Módulo de Regras (`utils/rules_engine.py`)**:
   * Expansão para suporte a regras compostas (precedências, descansos obrigatórios, limites por categoria).
   * Simulador visual de regras no frontend (`dashboard/fleet`).
3. **Evolução da Ferramenta de Zonas & Códigos Postais**:
   * Integração com a Google Maps JavaScript API para desenho dinâmico de polígonos, clustering de entregas por CP4/CP7 e mapa de calor de densidade.
4. **Torre de Controlo e ETA Dinâmico**:
   * Recálculo automático de previsões de chegada (ETA) no painel de tráfego com base em ocorrências de campo reportadas pelos motoristas.
5. **Futura Integração da Google Routes Matrix (Condicionada a Clientes Reais)**:
   * A ativação da API de trânsito em tempo real da Google para a matriz do solver fica guardada e planeada, mas **só será implementada quando houver clientes comerciais reais a operar no sistema**.

---

## 📋 8. Checklist de Início de Sessão para o Desenvolvedor / Agente

Antes de iniciar qualquer desenvolvimento:
- [ ] Ler este documento (`GeoRoutePlan.md`) na íntegra.
- [ ] Ativar a **SKILL** correspondente à área de trabalho (Frontend Next.js, Backend FastAPI, OR-Tools Solver, PWA Motoristas).
- [ ] Respeitar o princípio *Low-Cost* e uso racional das APIs.
- [ ] Garantir que qualquer alteração de dados mantém a compatibilidade integral com o **Ficheiro Excel de 9 Abas** e os seus campos canónicos.
- [ ] Validar que todas as alterações ao solver respeitam as restrições avaliadas pelo **Motor de Regras** (`utils/rules_engine.py`).
- [ ] **Manter a regra de custo zero de matrizes (Haversine + OR-Tools) até haver clientes reais pagantes para ativar a Google Routes Matrix API**.
