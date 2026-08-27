import os
import pandas as pd

output_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Template_AppGeoRoutePlan_Exemplo.xlsx")

# 1. Rotas
rotas_data = [
    {
        "Rota": "Rota Norte 1",
        "Sequência": 1,
        "Cliente": "Supermercado Central do Porto",
        "Morada": "Rua de Santa Catarina 450",
        "Código Postal": "4000-444",
        "Localidade": "Porto",
        "Contacto": "912345678",
        "Volume (m3)": 1.2,
        "Peso (kg)": 45.0,
        "Bultos": 3,
        "Vendedor": "Manuel Pires",
        "Observações": "Entregar nas traseiras / cais 2",
        "Valor a Cobrar": 0.0
    },
    {
        "Rota": "Rota Norte 1",
        "Sequência": 2,
        "Cliente": "Restaurante Foz Velha",
        "Morada": "Avenida do Brasil 120",
        "Código Postal": "4150-151",
        "Localidade": "Porto",
        "Contacto": "934567890",
        "Volume (m3)": 0.5,
        "Peso (kg)": 15.0,
        "Bultos": 2,
        "Vendedor": "Manuel Pires",
        "Observações": "Recebe apenas até às 12h00",
        "Valor a Cobrar": 125.50
    },
    {
        "Rota": "Rota Norte 1",
        "Sequência": 3,
        "Cliente": "Farmácia Boavista",
        "Morada": "Praça Mouzinho de Albuquerque 25",
        "Código Postal": "4100-359",
        "Localidade": "Porto",
        "Contacto": "961122334",
        "Volume (m3)": 0.3,
        "Peso (kg)": 5.0,
        "Bultos": 1,
        "Vendedor": "Ana Santos",
        "Observações": "Falar com Dra. Maria",
        "Valor a Cobrar": 0.0
    },
    {
        "Rota": "Rota Sul 2",
        "Sequência": 1,
        "Cliente": "Café & Bistrô Avenida",
        "Morada": "Avenida da Liberdade 200",
        "Código Postal": "1250-147",
        "Localidade": "Lisboa",
        "Contacto": "925566778",
        "Volume (m3)": 0.8,
        "Peso (kg)": 25.0,
        "Bultos": 2,
        "Vendedor": "Rui Costa",
        "Observações": "Pedir carimbo na fatura",
        "Valor a Cobrar": 85.00
    },
    {
        "Rota": "Rota Sul 2",
        "Sequência": 2,
        "Cliente": "Hotel Baixa Chiado",
        "Morada": "Rua Garrett 88",
        "Código Postal": "1200-204",
        "Localidade": "Lisboa",
        "Contacto": "919988776",
        "Volume (m3)": 2.5,
        "Peso (kg)": 120.0,
        "Bultos": 6,
        "Vendedor": "Rui Costa",
        "Observações": "Entrada pelo elevador de serviço",
        "Valor a Cobrar": 0.0
    }
]
df_rotas = pd.DataFrame(rotas_data)

# 2. Motoristas e Carros
drivers_data = [
    {
        "Motorista": "João Silva",
        "Viatura": "Mercedes Sprinter (54-AB-12)",
        "PIN/Password": "1111",
        "Rota Atribuída": "Rota Norte 1"
    },
    {
        "Motorista": "Carlos Sousa",
        "Viatura": "Renault Master (89-XY-34)",
        "PIN/Password": "2222",
        "Rota Atribuída": "Rota Sul 2"
    }
]
df_drivers = pd.DataFrame(drivers_data)

# 3. Justificação entregas
reasons_data = [
    {"Motivos de Insucesso": "Cliente Ausente / Fechado"},
    {"Motivos de Insucesso": "Carga Não Conforme / Danificada"},
    {"Motivos de Insucesso": "Cliente Recusou a Carga"},
    {"Motivos de Insucesso": "Morada Incorreta ou Incompleta"},
    {"Motivos de Insucesso": "Sem Acesso / Rua em Obras"},
    {"Motivos de Insucesso": "Fora do Horário de Descarga"},
    {"Motivos de Insucesso": "Falta de Pagamento (Cobrança)"},
    {"Motivos de Insucesso": "Outro Motivo (ver notas)"}
]
df_reasons = pd.DataFrame(reasons_data)

with pd.ExcelWriter(output_file, engine="openpyxl") as writer:
    df_rotas.to_excel(writer, sheet_name="Rotas", index=False)
    df_drivers.to_excel(writer, sheet_name="Motoristas e Carros", index=False)
    df_reasons.to_excel(writer, sheet_name="Justificação entregas", index=False)

print(f"Ficheiro de exemplo gerado com sucesso: {output_file}")
