# 🤖 Regras do Agente & Arranque de Sessão

## 🚨 REGRA SUPREMA DE ARRANQUE:
No início de **TODAS** as sessões de trabalho, deves ler e seguir rigorosamente as especificações do documento mestre do sistema:
👉 **[GeoRoutePlan.md](GeoRoutePlan.md)**

## 🛠️ Diretrizes Operacionais:
1. **Uso Obrigatório de SKILLs**: Antes de qualquer ação de código ou refatoração, deves invocar e seguir a Skill da área respetiva (ex: Next.js/Frontend, FastAPI/Backend, OR-Tools VRP Solver, PWA Mobile).
2. **Princípio Low-Cost**: Respeitar a cascata de geocoding (Local DB -> Scraping -> OSM -> Google Maps API).
3. **Congelamento de APIs Pagas de Matriz de Trânsito**: A Google Routes Matrix API só será implementada quando existirem clientes reais pagantes. Até lá, o solver mantém-se a custo zero com OR-Tools local + Haversine calibrado.
4. **Padrão de Dados 9 Abas**: Qualquer alteração ou persistência deve manter a integridade do ficheiro Excel canónico de 9 abas.
5. **Idioma**: Toda a comunicação e documentação deve ser em **Português**.
