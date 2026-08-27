# AppGeoRoutePlan 🚚

Aplicação web independente (PWA) de navegação e gestão de entregas para motoristas, com painel de controlo em tempo real para o gestor de tráfego, rastreio GPS, suporte offline e ciclo de vida diário efêmero baseado em ficheiros Excel.

---

## 🚀 Como Iniciar a Aplicação

### Opção 1: Executar o script Batch
Dê um duplo clique no ficheiro:
```bat
motoristas_webapp\run_webapp.bat
```

### Opção 2: Via Terminal (PowerShell / CMD)
```bash
cd motoristas_webapp
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload
```

A aplicação ficará disponível em:
* **No Computador / Servidor:** `http://localhost:8000`
* **Na Rede Local / Telemóvel dos Motoristas:** `http://<IP-DO-SERVIDOR>:8000`

---

## 🔐 Acessos e Perfis

| Perfil | Identificador / Login | Password Padrão | O que pode fazer |
|---|---|---|---|
| **Gestor de Tráfego** | Login Master | `admin123` | Importar Excel diário, atribuir motoristas, acompanhar progresso em tempo real, mapa live com GPS, exportar relatório final e limpar o dia. |
| **Motorista 1 (João Silva)** | PIN de Acesso | `1111` | Ver a lista de clientes da sua rota, abrir morada no Google Maps, marcar entregas/falhas, deixar notas e sincronizar offline. |
| **Motorista 2 (Carlos Sousa)**| PIN de Acesso | `2222` | Mesmas ações, exclusivo para a sua rota. |

> *Nota:* A password do Gestor pode ser personalizada através da variável de ambiente `GEO_MANAGER_PASSWORD`. As senhas dos motoristas são definidas diretamente na **Folha 2** do ficheiro Excel de importação.

---

## 📊 Estrutura do Ficheiro Excel de Importação / Exportação

O ficheiro Excel serve como a "Base de Dados" da operação diária:

1. **Folha 1 - `Rotas`**: Lista de paragens/clientes planeados (ID Rota, Sequência, Cliente, Morada, Contacto, Volume/Peso, Bultos, Vendedor, Observações, Valor a Cobrar/COD, Estado, Motivo, Notas).
2. **Folha 2 - `Motoristas e Carros`**: Registo dos motoristas, matrículas e PINs de acesso.
3. **Folha 3 - `Justificação entregas`**: Lista de motivos de insucesso configuráveis (ex: *Cliente Ausente*, *Carga Recusada*, *Morada Incorreta*).
4. **Folha 4 - `Relatório de distribuição`**: Resumo consolidado gerado automaticamente na exportação de fim de dia (% entregues, % falhadas, horas de registo, total cobrado).

Ficheiro de exemplo pronto a usar: `Template_AppGeoRoutePlan_Exemplo.xlsx`.

---

## ✨ Principais Funcionalidades

- **📱 PWA & Suporte Offline**: A app dos motoristas funciona mesmo sem rede no telemóvel. As marcações ficam guardadas localmente e sincronizam automaticamente de 5 em 5 minutos ou ao recuperar internet.
- **🛰️ Rastreio GPS Live**: Envio automático de coordenadas em background a cada sincronização para visualização dos veículos no mapa do Gestor.
- **🌓 Temas Claro e Escuro**: Alternância rápida de tema (otimizado para luz solar de dia e condução noturna).
- **🌍 Multilingue (i18n)**: Suporte completo para **Português (PT)**, **Inglês (UK)**, **Espanhol (ESP)** e **Francês (FR)**.
- **🔄 Edição Dinâmica de Estados**: O motorista pode alterar um estado anteriormente marcado (ex: se o cliente ausente afinal chegou a casa), gravando o histórico exato com novo timestamp.
- **🧹 Ciclo de Vida Descartável**: Ao final do dia, o Gestor exporta o Excel final e clica em "Limpar Dia" para deixar a aplicação limpa e pronta para a manhã seguinte.
