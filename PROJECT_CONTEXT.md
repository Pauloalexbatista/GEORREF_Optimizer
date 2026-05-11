# GeoRoute Pro - Contexto do Projeto

## 2026-03-17 - Versão Comercial (v2.0)

### Novas Funcionalidades Implementadas

#### Sistema de Autenticação Multi-Tenant
- ✅ Login/Registo de empresas
- ✅ Hash de passwords seguro
- ✅ Sessão persistente
- ✅ Gestão de projetos por empresa

#### Sistema de Planos e Limites
- ✅ Starter (29€/mês) - 100 entregas/mês, 1 utilizador
- ✅ Pro (79€/mês) - 1000 entregas/mês, 5 utilizadores
- ✅ Enterprise (199€/mês) - 10000 entregas/mês, utilizadores ilimitados

#### Dashboard de Métricas
- ✅ Métricas por projeto
- ✅ Métricas agregadas por empresa
- ✅ Uso vs limite do plano
- ✅ Histórico de atividade

#### Google API Centralizada
- ✅ API key configurada pelo admin
- ✅ Usada por todas as empresas
- ✅ Configurável no painel admin

#### Gestão de Servidor
- ✅ Ficheiros BAT (INICIAR.bat, PARAR.bat)
- ✅ Servidor na porta 8503

### Estrutura de Ficheiros

```
PRJT_GEO/
├── app.py                    # Aplicação principal
├── database.py               # Base de dados (novo)
├── auth.py                   # Autenticação (novo)
├── admin.py                  # Painel admin (novo)
├── server.py                 # Gestor servidor (novo)
├── INICIAR.bat               # Iniciar servidor (novo)
├── PARAR.bat                 # Parar servidor (novo)
├── components/
│   └── dashboard.py          # Dashboard métricas (novo)
├── tests/
│   ├── test_geocoder.py
│   └── test_integration.py
├── geocoding_multi.db        # Base de dados SQLite
└── requirements.txt
```

### Credenciais Demo
- Email: demo@georoute.pt
- Password: demo123
- Plano: Starter

### URLs
- Servidor: http://localhost:8503
- Admin: Botão na sidebar (só admins)

---

## Regras Importantes
- **NÃO MISTURAR** com outros projetos
- Manter foco na eficiência de custos (evitar chamadas desnecessárias a APIs pagas)
- Templates são a única forma de import/export de dados
- Google API é centralizada (custo do administrador)
