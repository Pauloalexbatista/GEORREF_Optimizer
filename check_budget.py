import json
import os
import pandas as pd
from datetime import datetime

USAGE_FILE = 'config/usage.json'
LOG_FILE = 'config/google_api_log.csv'

def check_budget():
    print("--- Estado do Orcamento Google Maps ---")
    
    if not os.path.exists(USAGE_FILE):
        print("[ERRO] Ficheiro de uso nao encontrado (config/usage.json).")
        return

    try:
        with open(USAGE_FILE, 'r') as f:
            data = json.load(f)
        
        count = data.get('count', 0)
        limit = data.get('limit', 1000)
        month = data.get('current_month', 'N/A')
        
        percent = (count / limit) * 100 if limit > 0 else 100
        
        print(f"Mês Atual: {month}")
        print(f"Uso: {count} / {limit} ({percent:.1f}%)")
        
        if count >= limit:
            print("[ALERTA] Limite atingido!")
        else:
            print(f"[OK] Disponivel: {limit - count} creditos")
            
    except Exception as e:
        print(f"Erro ao ler ficheiro de uso: {e}")

    print("\n--- Ultimas 5 Transacoes (Log) ---")
    if os.path.exists(LOG_FILE):
        try:
            df = pd.read_csv(LOG_FILE)
            print(df.tail(5).to_string(index=False))
        except Exception as e:
            print(f"Erro ao ler log: {e}")
    else:
        print("[INFO] Nenhum log de transacoes encontrado ainda.")

if __name__ == "__main__":
    check_budget()
