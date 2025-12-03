# User Guide - AntiGravity Route Optimizer

## 📖 Índice

1. [Iniciar a Aplicação](#iniciar-a-aplicação)
2. [Gestão de Templates](#gestão-de-templates)
3. [Geocoding de Moradas](#geocoding-de-moradas)
4. [Gestão de Falhas de Geocoding](#-gestão-de-falhas-de-geocoding)
5. [Otimização de Rotas](#otimização-de-rotas)
6. [Gestão de Frota](#gestão-de-frota)
7. [Níveis de Qualidade](#níveis-de-qualidade)
8. [Resolução de Problemas](#resolução-de-problemas)

---

## Iniciar a Aplicação

### Windows
1. Navegue até à pasta do projeto
2. Execute `run_geocoder.bat`
3. Aguarde que o browser abra automaticamente

### Linha de Comandos
```bash
cd "c:\AntiGravity Project PB\PRJT_GEO"
python -m streamlit run app.py
```

---

## Gestão de Templates

### Exportar Templates Vazios

Na **sidebar**, secção "📁 Gestão de Templates":

1. Clique em **"📥 Entregas"** para descarregar template de entregas
2. Clique em **"📥 Frota"** para descarregar template de frota

Cada template inclui uma linha de exemplo.

### Gerar Dados de Teste

Para testar o sistema sem dados reais:

1. **Escolha o número de entregas** (10-500)
2. **Selecione níveis de qualidade** (1-7)
   - Níveis baixos = maior precisão
   - Recomendado: 1, 2, 3, 4, 5
3. Clique em **"🎲 Entregas"** ou **"🎲 Frota"**
4. Descarregue o ficheiro gerado

Os dados são **reais** (moradas da base de dados) com informações fictícias (pesos, prioridades).

---

## Geocoding de Moradas

### Passo 1: Preparar Ficheiro

Preencha o template de entregas com:
- **Codigo_Cliente**: Identificador único (ex: CL001)
- **Morada**: Endereço completo
- **Codigo_Postal**: CP4 (1000) ou CP7 (1000-001)
- **Concelho**: Município
- **Peso_KG**: Peso da entrega
- **Prioridade**: 1=Alta, 2=Normal, 3=Baixa
- **Janela_Inicio/Fim**: Horário de entrega (ex: 09:00)
- **Observacoes**: Notas opcionais

### Passo 2: Carregar Ficheiro

1. Na página principal, clique em **"Carregar Excel com Moradas"**
2. Selecione o ficheiro `.xlsx`
3. Verifique o número de linhas carregadas

### Passo 3: Mapear Colunas

O sistema tenta detetar automaticamente, mas pode ajustar:
- **Coluna Morada**: Endereço completo
- **Coluna CP**: Código postal
- **Coluna Concelho/Cidade**: Município

### Passo 4: Geocodificar

1. Clique em **"🚀 Iniciar Geocoding"**
2. Acompanhe o progresso em tempo real
3. Aguarde a conclusão (tempo varia conforme quantidade)

### Passo 5: Analisar Resultados

**Estatísticas:**
- Total processado
- Sucesso (Níveis 1-2)
- Falhas (Nível 8)

**Mapa:**
- Pontos coloridos por nível de qualidade
- Verde = alta precisão
- Vermelho = falha

**Tabela:**
- Morada encontrada
- Coordenadas (Latitude/Longitude)
- Nível de qualidade
- Fonte (LOCAL/OSM/GOOGLE)
- Score de correspondência

---

## 🚨 Gestão de Falhas de Geocoding

### O que acontece quando há falhas?

Se alguns clientes não puderem ser geocodificados (Nível 8), o sistema **pausa automaticamente** e apresenta 3 opções para decidir como proceder.

**Exemplo de situação:**
```
⚠️ ATENÇÃO: Geocoding Incompleto

Foram geocodificados com sucesso: 245/250 clientes (98%)
Falharam: 5 clientes (2%) - Nível 8

Motivos das falhas:
• 3 clientes sem morada preenchida
• 2 clientes com código postal inválido
```

### Opção 1: 🔴 Cancelar e Exportar

**Quando usar**: 
- Muitas falhas (>5% dos clientes)
- Dados críticos em falta
- Prefere corrigir tudo antes de continuar

**O que acontece**:
1. Sistema exporta **2 ficheiros Excel**:
   - `geocodificados_sucesso_YYYYMMDD_HHMMSS.xlsx` - Clientes geocodificados com sucesso
   - `geocodificados_falhas_YYYYMMDD_HHMMSS.xlsx` - Clientes falhados + motivos específicos
2. Processo é **reiniciado** (dados não são perdidos)
3. Pode corrigir os dados falhados no ficheiro exportado
4. Voltar a importar quando tiver dados corretos

**Vantagens**:
- ✅ Mantém qualidade dos dados
- ✅ Ficheiro de sucessos pode ser reutilizado
- ✅ Motivos de falha ajudam a corrigir

**Ficheiro de falhas inclui**:
- Todos os dados originais do cliente
- Coluna "Motivo_Falha" (ex: "Morada vazia", "CP inválido")
- Sugestões de correção quando aplicável

---

### Opção 2: 🟡 Continuar com Limitações

**Quando usar**: 
- Poucas falhas (<2% dos clientes)
- Falhas não são críticas
- Quer ver resultado geral rapidamente

**O que acontece**:
1. Clientes não geocodificados recebem **coordenadas do armazém**
2. São colocados numa **rota separada** chamada "⚠️ Entregas Pendentes de Validação"
3. Esta rota **NÃO é otimizada** pelo algoritmo
4. Aparecem com **marcador vermelho** no mapa
5. Processo continua normalmente para os restantes clientes

**Limitações**:
- ⚠️ Distâncias e tempos não são reais para estes clientes
- ⚠️ Rota deve ser planeada manualmente depois
- ⚠️ Podem existir múltiplos clientes na mesma coordenada

**Vantagens**:
- ✅ Não bloqueia o processo
- ✅ Pode otimizar os restantes clientes
- ✅ Identifica claramente os problemáticos

**Visualização no mapa**:
- Ícone vermelho com símbolo de aviso ⚠️
- Tooltip: "Localização Aproximada (Armazém)"
- Agrupados num cluster separado

---

### Opção 3: 🟢 Corrigir Agora

**Quando usar**: 
- Poucas falhas (<5 clientes)
- Tem os dados corretos à mão
- Quer resolver tudo numa sessão

**O que acontece**:
1. Sistema abre **interface de correção manual**
2. Para cada cliente falhado:
   - Mostra dados originais
   - Permite editar Morada, CP, Concelho
   - Sugere endereços similares da base de dados
   - Permite testar geocoding antes de guardar
3. Após correções, **re-executa geocoding** só para estes clientes
4. Continua para otimização com **todos os dados corretos**

**Vantagens**:
- ✅ Processo completo numa só sessão
- ✅ Dados ficam corretos desde o início
- ✅ Sugestões inteligentes facilitam correção
- ✅ Pode testar antes de confirmar

**Interface de correção**:
```
Cliente: CL001 - João Silva
┌─────────────────────────────────────┐
│ Morada: [Rua das Flores, 123    ]  │
│ CP:     [1200-001]                  │
│ Concelho: [Lisboa              ]    │
│                                     │
│ 💡 Sugestões da BD:                 │
│   ○ Rua das Flores, 1200-001 Lisboa │
│   ○ Rua das Flores, 1200-002 Lisboa │
│                                     │
│ [Testar Geocoding] [Guardar] [Skip]│
└─────────────────────────────────────┘
```

---

### Comparação das Opções

| Critério | Opção 1 | Opção 2 | Opção 3 |
|----------|---------|---------|---------|
| **Tempo** | Médio (requer reimport) | Rápido | Médio |
| **Qualidade** | ⭐⭐⭐ Alta | ⭐ Baixa | ⭐⭐⭐ Alta |
| **Melhor para** | Muitas falhas | Poucas falhas não críticas | Poucas falhas com dados |
| **Requer dados** | Sim (depois) | Não | Sim (agora) |
| **Resultado** | Completo (depois) | Parcial | Completo (agora) |

---

### Dicas para Evitar Falhas

✅ **Antes de importar**:
- Verifique que todas as moradas estão preenchidas
- Use CP7 sempre que possível (1000-001 em vez de 1000)
- Normalize concelhos (ex: "Lisboa" em vez de "Lx")
- Evite abreviaturas (ex: "Rua" em vez de "R.")

✅ **Se tiver muitas falhas**:
- Use Opção 1 para exportar e analisar motivos
- Corrija no Excel com calma
- Re-importe ficheiro limpo

✅ **Se tiver poucas falhas**:
- Use Opção 3 se tiver dados à mão
- Use Opção 2 se não forem críticas



---

## Otimização de Rotas

### Passo 1: Configurar Frota

Após geocoding bem-sucedido, desça até **"🚚 Otimização de Rotas"**.

**Opção A: Editar Manualmente**
- Use a tabela interativa
- Adicione/remova/edite veículos
- Clique nas células para editar

**Opção B: Importar de Excel** *(em breve)*
- Carregue ficheiro de frota
- Dados são importados para a tabela
- Pode editar após importação

**Campos:**
- **Veículo**: Nome/identificador
- **Capacidade**: Peso máximo (kg)
- **Custo/KM**: Custo por quilómetro (€)

### Passo 2: Definir Armazém

Escolha um método:

**Coordenadas:**
- Insira Latitude e Longitude manualmente

**Pesquisa de Morada:**
- Digite a morada do armazém
- Clique em "📍 Encontrar Armazém"
- Sistema geocodifica automaticamente

**Selecionar no Mapa:**
- Clique no mapa interativo
- Localização é atualizada automaticamente

### Passo 3: Otimizar

1. Clique em **"🛠️ Otimizar Rotas"**
2. Sistema calcula:
   - Matriz de distâncias
   - Rotas otimizadas por veículo
   - Custos e tempos estimados

### Passo 4: Visualizar Resultados

**Métricas Globais:**
- Distância total (km)
- Tempo estimado (horas)
- Custo total (€)
- Número de veículos utilizados

**Detalhes por Veículo:**
- Distância da rota
- Tempo estimado
- Custo da rota
- Número de paragens

**Visualizações:**
- **🌍 Abrir Mapa**: Mapa interativo com rotas coloridas
- **📋 Ver Horários**: Tabela detalhada com sequência de entregas

### Passo 5: Exportar

Clique em **"📥 Descarregar Folhas de Rota (Excel)"** para obter:
- Folhas separadas por veículo
- Sequência de entregas
- Distâncias acumuladas
- Informações de cliente

---

## Gestão de Frota

### Edição Manual

A tabela de frota é **totalmente editável**:

**Adicionar veículo:**
- Clique no `+` no topo da tabela
- Preencha os campos

**Editar veículo:**
- Clique na célula
- Altere o valor
- Pressione Enter

**Remover veículo:**
- Clique no `×` ao lado da linha

### Importar de Excel *(em desenvolvimento)*

1. Prepare ficheiro com template de frota
2. Carregue na aplicação
3. Dados são importados para a tabela
4. Edite conforme necessário

### Exportar Configuração *(em desenvolvimento)*

Salve a configuração atual da frota para reutilizar.

---

## Níveis de Qualidade

O sistema classifica cada geocoding em 8 níveis:

| Nível | Nome | Descrição | Precisão | Cor |
|-------|------|-----------|----------|-----|
| 0 | Cliente | Coordenadas fornecidas pelo cliente | Exata | Roxo |
| 1 | Ouro | Rua + Número de porta | ~10m | Verde |
| 2 | Prata | Rua + CP4 | ~50m | Azul |
| 3 | Bronze | CP7 completo | ~100m | Azul claro |
| 4 | Ferro | CP4 (centroide) | ~500m | Laranja |
| 5 | Pedra | Localidade | ~1km | Cinza claro |
| 6 | Concelho | Concelho/Município | ~5km | Cinza |
| 7 | Distrito | Distrito/Região | ~20km | Preto |
| 8 | Falha | Não encontrado | N/A | Vermelho |

**Recomendações:**
- **Níveis 1-2**: Ideal para entregas urbanas
- **Níveis 3-4**: Aceitável para zonas rurais
- **Níveis 5-7**: Apenas para estimativas
- **Nível 8**: Requer correção manual

---

## Resolução de Problemas

### Erro: "File does not exist: app.py"

**Causa**: Caminho incorreto ou espaços no nome da pasta

**Solução**: Use o ficheiro `run_geocoder.bat` atualizado

### Erro: "UnicodeEncodeError"

**Causa**: Caracteres especiais no console

**Solução**: Já corrigido na versão atual

### Geocoding muito lento

**Causas possíveis:**
- Muitas moradas (>1000)
- Poucas moradas na base de dados local
- Uso excessivo de Google API

**Soluções:**
- Divida em lotes menores
- Verifique níveis de qualidade obtidos
- Monitore orçamento Google na sidebar

### Limite Google atingido

**Sintoma**: Mensagem "Limite Atingido! Google Maps desativado"

**Solução**:
- Aguarde início do próximo mês (reset automático)
- Ou aumente o limite em `config/usage.json`
- Sistema continua a funcionar com OSM

### Rotas não otimizadas

**Verificações:**
- Todas as moradas foram geocodificadas?
- Frota está configurada corretamente?
- Armazém está definido?

---

## Dicas e Boas Práticas

### Geocoding
✅ Use CP7 sempre que possível (maior precisão)  
✅ Preencha o concelho para melhor correspondência  
✅ Normalize moradas (evite abreviaturas)  
✅ Teste com dados aleatórios primeiro  

### Otimização
✅ Configure capacidades realistas  
✅ Use custos/km reais para análise precisa  
✅ Defina armazém com precisão  
✅ Revise rotas no mapa antes de executar  

### Performance
✅ Geocodifique em lotes de 100-200 moradas  
✅ Use base de dados local sempre que possível  
✅ Monitore uso da API Google  
✅ Gere dados de teste para desenvolvimento  

---

**Última Atualização**: 2025-11-28  
**Versão**: 1.0
