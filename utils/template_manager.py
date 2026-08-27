# -*- coding: utf-8 -*-
import os
import io
from io import BytesIO
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

FONT_FAMILY = "Segoe UI"
FONT_HEADER = Font(name=FONT_FAMILY, size=11, bold=True, color="FFFFFF")
FONT_DATA = Font(name=FONT_FAMILY, size=10, color="1F2937")
FONT_DATA_BOLD = Font(name=FONT_FAMILY, size=10, bold=True, color="1F2937")

# Cores Padrão
COLOR_REQ = "1E3A8A"        # Azul Escuro (OBRIGATÓRIO)
COLOR_REC = "2563EB"        # Azul Mais Claro (RECOMENDADO)
COLOR_OPT = "64748B"        # Cinza (OPCIONAL)
COLOR_INSTRUCOES = "1E293B" # Ardósia Escuro

FILL_ZEBRA = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
FILL_WHITE = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")

THIN_BORDER_SIDE = Side(border_style="thin", color="CBD5E1")
BORDER_CELL = Border(left=THIN_BORDER_SIDE, right=THIN_BORDER_SIDE, top=THIN_BORDER_SIDE, bottom=THIN_BORDER_SIDE)
BORDER_HEADER = Border(
    left=Side(border_style="thin", color="CBD5E1"),
    right=Side(border_style="thin", color="CBD5E1"),
    top=Side(border_style="medium", color="0F172A"),
    bottom=Side(border_style="medium", color="0F172A")
)

ALIGN_LEFT = Alignment(horizontal="left", vertical="center")
ALIGN_CENTER = Alignment(horizontal="center", vertical="center")
ALIGN_RIGHT = Alignment(horizontal="right", vertical="center")
ALIGN_WRAP_LEFT = Alignment(horizontal="left", vertical="center", wrap_text=True)

def apply_sheet_headers_tiered(ws, headers_spec):
    ws.views.sheetView[0].showGridLines = True
    ws.freeze_panes = "A2"
    ws.row_dimensions[1].height = 28
    for col_idx, (col_name, color_hex) in enumerate(headers_spec, start=1):
        fill = PatternFill(start_color=color_hex, end_color=color_hex, fill_type="solid")
        c = ws.cell(row=1, column=col_idx, value=col_name)
        c.font = FONT_HEADER
        c.fill = fill
        c.alignment = ALIGN_CENTER
        c.border = BORDER_HEADER

def autofit_columns(ws, max_cols=30, min_width=12):
    for col in ws.columns:
        col_letter = get_column_letter(col[0].column)
        if col[0].column > max_cols:
            continue
        max_len = 0
        for cell in col:
            val_str = str(cell.value or "")
            if len(val_str) > max_len:
                max_len = len(val_str)
        ws.column_dimensions[col_letter].width = max(max_len + 4, min_width)

def format_data_rows(ws, start_row, end_row, num_cols, center_cols=(), right_cols=()):
    for r_idx in range(start_row, end_row + 1):
        ws.row_dimensions[r_idx].height = 20
        row_fill = FILL_ZEBRA if (r_idx % 2 == 0) else FILL_WHITE
        for c_idx in range(1, num_cols + 1):
            cell = ws.cell(row=r_idx, column=c_idx)
            cell.font = FONT_DATA
            cell.fill = row_fill
            cell.border = BORDER_CELL
            if c_idx in center_cols:
                cell.alignment = ALIGN_CENTER
            elif c_idx in right_cols:
                cell.alignment = ALIGN_RIGHT
            else:
                cell.alignment = ALIGN_LEFT

def build_sheet_armazem(wb):
    ws = wb.active
    ws.title = "Armazém"
    headers_spec = [
        ("Nome_Armazem", COLOR_REQ),
        ("Morada", COLOR_REQ),
        ("CP", COLOR_REQ),
        ("Localidade", COLOR_OPT),
        ("Latitude", COLOR_OPT),
        ("Longitude", COLOR_OPT),
        ("Hora_Abertura", COLOR_REC),
        ("Hora_Fecho", COLOR_REC),
        ("Tempo_Carga_Min", COLOR_REC)
    ]
    apply_sheet_headers_tiered(ws, headers_spec)
    data = [
        ["Armazém Principal", "Estrada 10, Quinta Maçarocas", "2695-719", "São João da Talha", 38.8245, -9.0912, "06:30", "20:00", 20],
        ["Pólo Norte (Maia)", "Rua Manuel Sousa Moreira Cruz 240", "4470-396", "Maia", 41.2291, -8.6620, "06:30", "20:00", 20]
    ]
    for r_idx, row_vals in enumerate(data, start=2):
        for c_idx, val in enumerate(row_vals, start=1):
            ws.cell(row=r_idx, column=c_idx, value=val)
    format_data_rows(ws, start_row=2, end_row=1 + len(data), num_cols=len(headers_spec), center_cols=(3, 7, 8, 9), right_cols=(5, 6))
    autofit_columns(ws, len(headers_spec))

def build_sheet_rotas(wb):
    ws = wb.create_sheet("Rotas")
    headers_spec = [
        ("ID_Original", COLOR_REQ),
        ("Cliente", COLOR_REQ),
        ("Morada", COLOR_REQ),
        ("Localidade", COLOR_REQ),
        ("CodPostal", COLOR_REQ),
        ("Rota", COLOR_REC),
        ("Ordem", COLOR_REC),
        ("Janela_Inicio", COLOR_REC),
        ("Janela_Fim", COLOR_REC),
        ("Peso", COLOR_REC),
        ("Volumes", COLOR_REC),
        ("Contacto", COLOR_REC),
        ("Vendedor", COLOR_OPT),
        ("Valor_Cobrar", COLOR_OPT),
        ("Observações", COLOR_OPT)
    ]
    apply_sheet_headers_tiered(ws, headers_spec)
    data = [
        ["D17932246", "Mário Pires", "Rua Manuel Antonio Gomes Lote 2 4K", "Lisboa", "1750-168", "Rota Norte 1", 1, "08:00", "10:00", 160.0, 4, "910000001", "TNB", 0.0, "Entregar porta 4K"],
        ["D17932606", "António Raposo Laura Furtado LDA", "Estrada Militar - Terminal Arnaud", "Camarate", "2680-183", "Rota Norte 1", 2, "09:00", "13:00", 286.0, 8, "910000002", "TNB", 0.0, "Cais das traseiras"],
        ["D17932331", "Sérgio Azul", "Rua Virgínia Vitorino 10, 7esquerdo", "Lisboa", "1600-784", "Rota Norte 1", 3, "09:00", "13:00", 45.0, 1, "910000003", "TNB", 120.5, "Cobrar no ato de entrega"],
        ["D17931267", "Costa & Associados", "Rua 3, N16 3 C", "Pedrouços", "1500-605", "Rota Norte 1", 4, "09:00", "13:00", 336.0, 10, "910000004", "TNB", 0.0, "Ligar antes de chegar"],
        ["D17863817", "Vanessa Machado", "Av. Uruguai Nº 19, 1º Esq.", "Lisboa", "1500-611", "Rota Sul 2", 1, "09:00", "13:00", 174.0, 3, "910000005", "TNB", 0.0, "Tocar à campainha"]
    ]
    for r_idx, row_vals in enumerate(data, start=2):
        for c_idx, val in enumerate(row_vals, start=1):
            ws.cell(row=r_idx, column=c_idx, value=val)
    format_data_rows(ws, start_row=2, end_row=1 + len(data), num_cols=len(headers_spec), center_cols=(1, 5, 6, 7, 8, 9, 11, 12, 13), right_cols=(10, 14))
    autofit_columns(ws, len(headers_spec))

def build_sheet_motoristas_carros(wb):
    ws = wb.create_sheet("Motoristas e Carros")
    headers_spec = [
        ("Motorista", COLOR_REQ),
        ("PIN/Password", COLOR_REQ),
        ("Viatura", COLOR_REC),
        ("Matrícula", COLOR_OPT),
        ("Telemóvel", COLOR_REC),
        ("Rota Atribuída", COLOR_OPT)
    ]
    apply_sheet_headers_tiered(ws, headers_spec)
    data = [
        ["João Silva", "1111", "Mercedes Sprinter", "54-AB-12", "910000001", "Rota Norte 1"],
        ["Carlos Sousa", "2222", "Renault Master", "89-XY-34", "910000002", "Rota Sul 2"],
        ["António Ferreira", "3333", "Iveco Daily", "12-ZZ-99", "910000003", ""]
    ]
    for r_idx, row_vals in enumerate(data, start=2):
        for c_idx, val in enumerate(row_vals, start=1):
            ws.cell(row=r_idx, column=c_idx, value=val)
    format_data_rows(ws, start_row=2, end_row=1 + len(data), num_cols=len(headers_spec), center_cols=(2, 4, 5, 6))
    autofit_columns(ws, len(headers_spec))

def build_sheet_justificacoes(wb):
    ws = wb.create_sheet("Justificação entregas")
    headers_spec = [
        ("Motivo de Não Entrega", COLOR_REQ),
        ("Categoria / Ação", COLOR_REC)
    ]
    apply_sheet_headers_tiered(ws, headers_spec)
    data = [
        ["Cliente Ausente / Fechado", "Ausência"],
        ["Cliente Recusou a Carga", "Recusa"],
        ["Morada Não Encontrada / Errada", "Morada"],
        ["Mercadoria Danificada", "Avaria"],
        ["Falta de Tempo / Fora de Horas", "Operacional"],
        ["Sem Dinheiro para Cobrança", "Financeiro"]
    ]
    for r_idx, row_vals in enumerate(data, start=2):
        for c_idx, val in enumerate(row_vals, start=1):
            ws.cell(row=r_idx, column=c_idx, value=val)
    format_data_rows(ws, start_row=2, end_row=1 + len(data), num_cols=len(headers_spec), center_cols=(2,))
    autofit_columns(ws, len(headers_spec))

def build_sheet_instrucoes(wb):
    ws = wb.create_sheet("Instruções")
    headers_spec = [
        ("Secção", COLOR_INSTRUCOES),
        ("Campo", COLOR_INSTRUCOES),
        ("Obrigatoriedade", COLOR_INSTRUCOES),
        ("Formato", COLOR_INSTRUCOES),
        ("Exemplo", COLOR_INSTRUCOES),
        ("Descrição / Dica", COLOR_INSTRUCOES)
    ]
    apply_sheet_headers_tiered(ws, headers_spec)
    instructions = [
        ["0. LEGENDA DE CORES", "Azul Escuro (#1E3A8A)", "OBRIGATÓRIO", "Visual", "Campos essenciais para geocodificação e rotas.", "Se faltar, o sistema não consegue calcular."],
        ["0. LEGENDA DE CORES", "Azul Claro (#2563EB)", "RECOMENDADO", "Visual", "Janelas, Contactos, Pesos, Volumes.", "Aumenta a precisão de cálculo e relatórios."],
        ["0. LEGENDA DE CORES", "Cinza (#64748B)", "OPCIONAL", "Visual", "Notas, Vendedor, Valor a Cobrar.", "Informação adicional de suporte."],
        ["1. Armazém", "Morada & CP", "OBRIGATÓRIO", "Texto / XXXX-XXX", "2695-719", "Ponto de partida e chegada das carrinhas."],
        ["2. Rotas", "Cliente, Morada, CP", "OBRIGATÓRIO", "Texto / XXXX-XXX", "1750-168 Lisboa", "Dados dos destinatários."],
        ["3. Motoristas", "Motorista & PIN", "OBRIGATÓRIO", "Texto / 4 dígitos", "1111", "Código para o motorista entrar na rota na App móvel."],
        ["4. Justificações", "Motivos de Falha", "OBRIGATÓRIO", "Texto", "Cliente Fechado", "Opções que aparecem no telemóvel do motorista."]
    ]
    for r_idx, row_vals in enumerate(instructions, start=2):
        for c_idx, val in enumerate(row_vals, start=1):
            ws.cell(row=r_idx, column=c_idx, value=val)
    format_data_rows(ws, start_row=2, end_row=1 + len(instructions), num_cols=len(headers_spec), center_cols=(3, 4))
    autofit_columns(ws, len(headers_spec))

def create_unified_project_template() -> bytes:
    wb = openpyxl.Workbook()
    build_sheet_armazem(wb)
    build_sheet_rotas(wb)
    build_sheet_motoristas_carros(wb)
    build_sheet_justificacoes(wb)
    build_sheet_instrucoes(wb)
    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return buffer.getvalue()

def save_master_template_file(output_path: str = "Ficheiros EXCEL/GeoRoutePlan.xlsx"):
    data = create_unified_project_template()
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(data)
    # Also save to AppGeoRoutePlan.xlsx for backward compatibility
    with open("Ficheiros EXCEL/AppGeoRoutePlan.xlsx", "wb") as f:
        f.write(data)
    return output_path

if __name__ == "__main__":
    p = save_master_template_file()
    print(f"Generated unified template: {p}")
