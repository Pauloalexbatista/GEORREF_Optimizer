# Configuração de API Keys

## ⚠️ IMPORTANTE - Segurança

Este diretório contém ficheiros de configuração sensíveis que **NUNCA** devem ser enviados para o GitHub.

## Como configurar a Google Maps API Key

1. **Cria um ficheiro local** chamado `google_config.json` neste diretório:

```json
{
  "google_maps_api_key": "SUA_CHAVE_API_AQUI",
  "geocoding_enabled": true,
  "max_requests_per_day": 1000,
  "cache_results": true
}
```

2. **Substitui** `SUA_CHAVE_API_AQUI` pela tua nova chave do Google Cloud Console

3. **Verifica** que o ficheiro está no `.gitignore` (já está protegido!)

## Ficheiros Protegidos

Os seguintes padrões estão no `.gitignore` e **não serão enviados** para o GitHub:
- `config/*.json`
- `config/*.csv`
- `config/google_api_log.csv`
- `config/usage.json`
- Qualquer ficheiro `.key` ou `.pem`

## Como obter uma nova API Key

1. Vai a: https://console.cloud.google.com/apis/credentials
2. Clica em "Criar credenciais" → "Chave de API"
3. **IMPORTANTE**: Adiciona restrições à chave:
   - **Restrições de aplicação**: HTTP referrers (websites)
   - **Restrições de API**: Seleciona apenas:
     - Maps JavaScript API
     - Geocoding API
     - Places API (se necessário)

## Uso no Código

O código lê automaticamente a chave do ficheiro `google_config.json`:

```python
import json

with open('config/google_config.json', 'r') as f:
    config = json.load(f)
    api_key = config['google_maps_api_key']
```

## ✅ Checklist de Segurança

- [ ] Chave antiga eliminada no Google Cloud Console
- [ ] Nova chave criada com restrições
- [ ] Ficheiro `google_config.json` criado localmente
- [ ] Verificado que ficheiro NÃO aparece no `git status`
- [ ] Aplicação testada com a nova chave
