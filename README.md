# AntiGravity - Otimizador de Rotas 🚀

Sistema de geocoding e otimização de rotas low-cost para distribuição logística em Portugal.

## 🎯 Características Principais

- **Geocoding Inteligente**: Sistema waterfall (Local DB → Web Scraper → OSM → Google Maps API)
- **Otimização de Rotas**: Algoritmo VRP usando Google OR-Tools
- **Templates Padronizados**: Sistema de import/export com 2 templates únicos
- **Geração de Dados de Teste**: Cria ficheiros aleatórios a partir da base de dados
- **Gestão de Orçamento**: Controlo automático de uso da Google Maps API

## 📦 Instalação

### Requisitos
- Python 3.10+
- Windows/Linux/Mac

### Passos

1. **Clone o repositório**
```bash
cd "c:\AntiGravity Project PB\PRJT_GEO"
```

2. **Instale as dependências**
```bash
pip install -r requirements.txt
```

3. **Configure a API do Google Maps** (opcional)
   - Obtenha uma chave em [Google Cloud Console](https://console.cloud.google.com/)
   - Ative a Geocoding API
   - Insira a chave na aplicação via sidebar

4. **Execute a aplicação**
```bash
python -m streamlit run app.py
```
Ou use o ficheiro `run_geocoder.bat` (Windows)

## 🚀 Quick Start

1. **Exporte um template vazio**
   - Na sidebar: "Gestão de Templates" → "📥 Entregas"

2. **Preencha o ficheiro Excel**
   - Adicione códigos de cliente, moradas, pesos, etc.

3. **Importe e geocodifique**
   - Carregue o ficheiro na aplicação
   - Selecione as colunas corretas
   - Clique em "🚀 Iniciar Geocoding"

4. **Otimize rotas**
   - Configure a frota
   - Defina o armazém
   - Clique em "🛠️ Otimizar Rotas"

5. **Visualize e exporte**
   - Abra o mapa interativo
   - Veja horários detalhados
   - Descarregue folhas de rota em Excel

## 📁 Estrutura de Templates

### Template 1: Entregas
| Coluna | Descrição | Exemplo |
|--------|-----------|---------|
| Codigo_Cliente | Identificador único | CL001 |
| Morada | Endereço completo | Rua Exemplo, 123 |
| Codigo_Postal | CP4 ou CP7 | 1000-001 |
| Concelho | Município | Lisboa |
| Peso_KG | Peso da entrega | 50.0 |
| Prioridade | 1=Alta, 2=Normal, 3=Baixa | 2 |
| Janela_Inicio | Hora início | 09:00 |
| Janela_Fim | Hora fim | 18:00 |
| Observacoes | Notas opcionais | Frágil |

### Template 2: Frota
| Coluna | Descrição | Exemplo |
|--------|-----------|---------|
| Veiculo | Nome do veículo | Carrinha 1 |
| Capacidade_KG | Capacidade máxima | 500 |
| Custo_KM | Custo por km (€) | 0.50 |
| Velocidade_Media | Velocidade média (km/h) | 40 |
| Horario_Inicio | Hora início | 08:00 |
| Horario_Fim | Hora fim | 18:00 |

## 🧪 Testes

### Gerar Dados Aleatórios
Use a sidebar para gerar ficheiros de teste:
- Escolha o número de entregas (10-500)
- Selecione níveis de qualidade (1-7)
- Clique em "🎲 Entregas" ou "🎲 Frota"
- Descarregue o ficheiro gerado

## 🛠️ Tecnologias

- **Backend**: Python 3.14
- **UI**: Streamlit
- **Geocoding**: Google Maps API, OpenStreetMap (Nominatim), Web Scraping
- **Otimização**: Google OR-Tools
- **Mapas**: Folium
- **Base de Dados**: SQLite

## 📊 Níveis de Qualidade

| Nível | Descrição | Precisão |
|-------|-----------|----------|
| 0 | Cliente (coordenadas fornecidas) | Exata |
| 1 | Rua + Porta | ~10m |
| 2 | Rua + CP4 | ~50m |
| 3 | CP7 | ~100m |
| 4 | CP4 | ~500m |
| 5 | Localidade | ~1km |
| 6 | Concelho | ~5km |
| 7 | Distrito | ~20km |
| 8 | Falha | N/A |

## 💰 Gestão de Orçamento Google

O sistema controla automaticamente o uso da API:
- Limite padrão: 1000 chamadas/mês
- Visualização em tempo real na sidebar
- Bloqueio automático ao atingir o limite
- Log detalhado de transações

## 📝 Licença

Projeto interno - Todos os direitos reservados

## 🤝 Suporte

Para questões ou sugestões, contacte a equipa de desenvolvimento.
