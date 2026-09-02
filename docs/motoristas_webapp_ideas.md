# AppGeoRoutePlan - Planeamento e Ideias (Atualizado)

## 1. Identidade & UI/UX
* **Nome:** AppGeoRoutePlan
* **Temas:** Modo Claro e Modo Escuro (otimizado para luz solar e condução noturna).
* **Idiomas (i18n):** Português (PT), Inglês (UK), Espanhol (ESP), Francês (FR).
* **Layout Mobile:** Header fixo (status de rede/sincronização, idioma, tema) e Footer fixo (navegação rápida com botões de polegar).

## 2. Arquitetura e Fluxo de Dados (Standalone)
* **Independência Total:** A WebApp funciona de forma isolada da aplicação principal.
* **Excel como "Base de Dados":** 
    * **Folha 1 (Rotas):** Cópia das rotas geradas. (Nota: prever no futuro colunas para Pagamentos/Cobranças).
    * **Folha 2 (Motoristas e Carros):** Inclui as senhas (passwords) dos motoristas.
    * **Folha 3 (Justificações):** Tabela de motivos para entregas falhadas.
    * **Folha 4 (Relatório):** Relatório de distribuição (Exportado no fim do dia).
* **Ciclo de Vida Diário:** Importação de manhã, limpeza e exportação no fim do dia.

## 3. Stack Tecnológico
* **Backend (Servidor/Gestor):** Python (Flask/FastAPI) - Processa o Excel e serve o Dashboard.
* **Frontend (Motoristas):** Aplicação Web Progressiva (PWA - HTML/JS/CSS). Leve, com suporte nativo para funcionar **offline**, sincronizando dados com o servidor em background.

## 4. Perfis de Utilizador e Funcionalidades

### A. Gestor de Tráfego / Distribuição
* **Acesso e Gestão:** Password master. Atribui motoristas e carros às rotas. Controla a lista de "Motivos de Falha".
* **Acompanhamento Live (Dashboard Mobile/Web):** Dashboard responsivo (pode ser aberto no PC ou no telemóvel do Gestor).
* **Rastreio de Rotas (Tracking):**
    * Acompanha o fecho das entregas em tempo real.
    * **Localização GPS:** A WebApp dos motoristas envia as coordenadas GPS do telemóvel a cada sincronização (ex: de 5 em 5 minutos), permitindo ao Gestor ver num mapa onde andam os carros.
* **Fecho do Dia:** Gera o relatório final. Lê e processa as "Notas de motorista".

### B. Motoristas
* **Acesso:** Login com a senha exclusiva. Acesso apenas à sua rota.
* **Fluxo de Trabalho na Rota (Mobile):**
    1. **Abertura:** Abrem a rota (registo de hora).
    2. **Conferência:** Consultam a carga associada ao carro.
    3. **Navegação Livre (Lista):** O motorista escolhe e clica para ver detalhes do cliente.
    4. **Cartão de Entrega (Detalhes):** Informação útil (Morada, Vendedor, Observações). Botão para *Google Maps*.
    5. **Ato da Entrega & Edição (Correções):** 
        * Marcam "Entregue" ou "Não Entregue" (com Motivo).
        * **Reversão / Edição:** O motorista pode alterar o estado. Cada alteração regista a hora exata.
        * Campo de Notas/Feedback.
    6. **Sincronização Inteligente & GPS:** Grava dados localmente se não houver rede, e sincroniza as atualizações e a localização GPS assim que apanha rede.
    7. **Fecho:** Encerramento da rota com ecrã de resumo e devoluções.
