# -*- coding: utf-8 -*-
"""
GEORREF Optimizer - Template Manager & Standard File Engine
Single Source of Truth: GeoRoutePlan.xlsx (7 Sheets)
Universal Color Palette:
- Azul Escuro (#1E3A8A): OBRIGATÓRIO (letras brancas)
- Azul Mais Claro (#2563EB): RECOMENDADO (letras brancas)
- Cinza (#64748B): OPCIONAL (letras brancas)
"""

import os
import io
from io import BytesIO
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

# ==================== ESTILOS VISUAIS ====================

FONT_FAMILY = 'Segoe UI'

FONT_HEADER = Font(name=FONT_FAMILY, size=11, bold=True, color='FFFFFF')
FONT_DATA = Font(name=FONT_FAMILY, size=10, color='1F2937')
FONT_DATA_BOLD = Font(name=FONT_FAMILY, size=10, bold=True, color='1F2937')
FONT_MUTED = Font(name=FONT_FAMILY, size=9, italic=True, color='6B7280')

# Cores Universais Padronizadas
COLOR_REQ = '1E3A8A'  # Azul Escuro (OBRIGATÓRIO)
COLOR_REC = '2563EB'  # Azul Mais Claro (RECOMENDADO)
COLOR_OPT = '64748B'  # Cinza Ardósia (OPCIONAL)

# Manifestos e Instruções
COLOR_MANIFESTO = '5B21B6'   # Púrpura Executivo
COLOR_INSTRUCOES = '1E293B'  # Ardósia Escuro

FILL_ZEBRA = PatternFill(start_color='F8FAFC', end_color='F8FAFC', fill_type='solid')
FILL_WHITE = PatternFill(start_color='FFFFFF', end_color='FFFFFF', fill_type='solid')

# Bordas
THIN_BORDER_SIDE = Side(border_style='thin', color='E2E8F0')
BORDER_CELL = Border(left=THIN_BORDER_SIDE, right=THIN_BORDER_SIDE, top=THIN_BORDER_SIDE, bottom=THIN_BORDER_SIDE)
BORDER_HEADER = Border(
    left=Side(border_style='thin', color='CBD5E1'),
    right=Side(border_style='thin', color='CBD5E1'),
    top=Side(border_style='medium', color='0F172A'),
    bottom=Side(border_style='medium', color='0F172A')
)

# Alinhamentos
ALIGN_LEFT = Alignment(horizontal='left', vertical='center')
ALIGN_CENTER = Alignment(horizontal='center', vertical='center')
ALIGN_RIGHT = Alignment(horizontal='right', vertical='center')
ALIGN_WRAP_LEFT = Alignment(horizontal='left', vertical='center', wrap_text=True)

def apply_sheet_headers_tiered(ws, headers_spec):
    """
    Aplica cabeçalhos na Linha 1 com cores padronizadas:
    headers_spec = [(col_name, color_hex), ...]
    """
    ws.views.sheetView[0].showGridLines = True
    ws.freeze_panes = 'A2'
    ws.row_dimensions[1].height = 28
    
    for col_idx, (col_name, color_hex) in enumerate(headers_spec, start=1):
        fill = PatternFill(start_color=color_hex, end_color=color_hex, fill_type='solid')
        c = ws.cell(row=1, column=col_idx, value=col_name)
        c.font = FONT_HEADER
        c.fill = fill
        c.alignment = ALIGN_CENTER
        c.border = BORDER_HEADER

def autofit_columns(ws, max_cols=30, min_width=12):
    """Ajusta automaticamente a largura das colunas."""
    for col in ws.columns:
        col_letter = get_column_letter(col[0].column)
        if col[0].column > max_cols:
            continue
        max_len = 0
        for cell in col:
            val_str = str(cell.value or '')
            if len(val_str) > max_len:
                max_len = len(val_str)
        ws.column_dimensions[col_letter].width = max(max_len + 4, min_width)

def format_data_rows(ws, start_row, end_row, num_cols, center_cols=(), right_cols=(), currency_cols=()):
    """Aplica fontes, bordas e zebra striping nas linhas de dados."""
    for r_idx in range(start_row, end_row + 1):
        ws.row_dimensions[r_idx].height = 20
        is_even = (r_idx % 2 == 0)
        row_fill = FILL_ZEBRA if is_even else FILL_WHITE
        
        for c_idx in range(1, num_cols + 1):
            cell = ws.cell(row=r_idx, column=c_idx)
            cell.font = FONT_DATA
            cell.fill = row_fill
            cell.border = BORDER_CELL
            
            if c_idx in currency_cols:
                cell.number_format = '#,##0.00 €'
                cell.alignment = ALIGN_RIGHT
            elif c_idx in center_cols:
                cell.alignment = ALIGN_CENTER
            elif c_idx in right_cols:
                cell.alignment = ALIGN_RIGHT
            else:
                cell.alignment = ALIGN_LEFT

# ==================== CONSTRUÇÃO DAS 7 ABAS ====================

def build_sheet_armazens(wb):
    ws = wb.active
    ws.title = 'Armazéns'
    
    headers_spec = [
        ('Nome_Armazem', COLOR_REQ),
        ('Morada', COLOR_REQ),
        ('CP', COLOR_REQ),
        ('Localidade', COLOR_OPT),
        ('Latitude', COLOR_OPT),
        ('Longitude', COLOR_OPT),
        ('Hora_Abertura', COLOR_REC),
        ('Hora_Fecho', COLOR_REC),
        ('Tempo_Carga_Min', COLOR_REC),
        ('Contacto_Responsavel', COLOR_REC)
    ]
    num_cols = len(headers_spec)
    apply_sheet_headers_tiered(ws, headers_spec)
    
    data = [
        ['Armazém Lisboa Central', 'Avenida Severiano Falcão 16A', '2685-379', 'Prior Velho', 38.78420, -9.12380, '06:00:00', '22:00:00', 30, '912345678'],
        ['Armazém Norte Maia', 'R. de Manuel Sousa Moreira Cruz 240', '4470-396', 'Maia', 41.22910, -8.66200, '06:30:00', '21:30:00', 25, '923456789'],
        ['Armazém Coimbra', 'Rua de Entre-Muros 12', '3000-150', 'Coimbra', 40.20330, -8.41020, '07:00:00', '20:00:00', 20, '934567890']
    ]
    
    for r_idx, row_vals in enumerate(data, start=2):
        for c_idx, val in enumerate(row_vals, start=1):
            ws.cell(row=r_idx, column=c_idx, value=val)
    
    format_data_rows(ws, start_row=2, end_row=1 + len(data), num_cols=num_cols,
                     center_cols=(3, 7, 8, 9, 10), right_cols=(5, 6))
    autofit_columns(ws, num_cols)

def build_sheet_frota(wb):
    ws = wb.create_sheet('Frota')
    
    headers_spec = [
        ('Armazem', COLOR_REQ),
        ('Veiculo', COLOR_REQ),
        ('Capacidade_KG', COLOR_REQ),
        ('Capacidade_Vol', COLOR_REC),
        ('Velocidade_Media', COLOR_REC),
        ('Hora_Inicio_Turno', COLOR_REQ),
        ('Hora_Fim_Turno', COLOR_REQ),
        ('Custo_KM', COLOR_REC),
        ('Custo_Hora', COLOR_REC),
        ('Max_Entregas', COLOR_REC),
        ('Regras', COLOR_OPT),
        ('Motorista_Nome', COLOR_REC),
        ('Motorista_Telemovel', COLOR_REC)
    ]
    num_cols = len(headers_spec)
    apply_sheet_headers_tiered(ws, headers_spec)
    
    data = [
        ['Armazém Lisboa Central', 'Carrinha Pequena 01', 800, 6.0, 45, '08:00:00', '18:00:00', 0.65, 12.50, 30, '[PEQUENO]', 'Manuel Silva', '910000001'],
        ['Armazém Lisboa Central', 'Carrinha Longo Curso 02', 1200, 12.0, 55, '07:00:00', '19:30:00', 0.75, 14.00, 35, '[ALARGADO]', 'António Santos', '910000002'],
        ['Armazém Lisboa Central', 'Moto Expresso 01', 50, 0.5, 50, '09:00:00', '18:00:00', 0.30, 10.00, 15, '[EXPRESSO]', 'Rui Pedro', '910000003'],
        ['Armazém Norte Maia', 'Carrinha Norte 01', 1000, 10.0, 50, '08:00:00', '18:00:00', 0.70, 13.00, 30, '', 'João Ferreira', '920000001'],
        ['Armazém Norte Maia', 'Carrinha Norte 02', 1500, 15.0, 45, '07:30:00', '18:30:00', 0.85, 15.00, 40, '', 'Pedro Miguel', '920000002'],
        ['Armazém Coimbra', 'Carrinha Coimbra 01', 900, 8.0, 45, '08:00:00', '18:00:00', 0.68, 12.50, 25, '', 'Carlos Bento', '930000001']
    ]
    
    for r_idx, row_vals in enumerate(data, start=2):
        for c_idx, val in enumerate(row_vals, start=1):
            ws.cell(row=r_idx, column=c_idx, value=val)
    
    format_data_rows(ws, start_row=2, end_row=1 + len(data), num_cols=num_cols,
                     center_cols=(6, 7, 10, 11, 13), right_cols=(3, 4, 5, 8, 9))
    autofit_columns(ws, num_cols)

def build_sheet_entregas(wb):
    ws = wb.create_sheet('Entregas')
    
    headers_spec = [
        ('Armazem', COLOR_REQ),
        ('Doc_ID', COLOR_REQ),
        ('Cliente', COLOR_REQ),
        ('Morada', COLOR_REQ),
        ('CP', COLOR_REQ),
        ('Localidade', COLOR_OPT),
        ('Latitude', COLOR_OPT),
        ('Longitude', COLOR_OPT),
        ('Telefone_Cliente', COLOR_REC),
        ('Peso_KG', COLOR_REC),
        ('Volume_M3', COLOR_REC),
        ('Janela1_Inicio', COLOR_REQ),
        ('Janela1_Fim', COLOR_REQ),
        ('Janela2_Inicio', COLOR_OPT),
        ('Janela2_Fim', COLOR_OPT),
        ('Janela3_Inicio', COLOR_OPT),
        ('Janela3_Fim', COLOR_OPT),
        ('Tempo_Descarga_Min', COLOR_REC),
        ('Tipo_Operacao', COLOR_REC),
        ('Regras', COLOR_OPT),
        ('Notas_Motorista', COLOR_OPT),
        ('Prioridade', COLOR_REC)
    ]
    num_cols = len(headers_spec)
    apply_sheet_headers_tiered(ws, headers_spec)
    
    data = [
        [
            'Armazém Lisboa Central', 'FT 2026/101', 'Restaurante Alfama Antiga',
            'Rua de São Tomé 14', '1100-563', 'Lisboa',
            38.71350, -9.13010, '919111222', 45.0, 0.4,
            '09:00:00', '12:00:00', '15:00:00', '17:30:00', '', '',
            15, 'Entrega', '[PEQUENO]', 'Rua muito estreita - entrar pela Sé', 'Alta'
        ],
        [
            'Armazém Lisboa Central', 'FT 2026/102', 'Supermercado Vila Franca',
            'Estrada Nacional 1, Km 28', '2600-012', 'Vila Franca de Xira',
            38.95510, -8.99120, '918222333', 320.0, 3.2,
            '08:30:00', '18:00:00', '', '', '', '',
            25, 'Entrega', '[ALARGADO]', 'Cais traseiro de descargas', 'Normal'
        ],
        [
            'Armazém Lisboa Central', 'EXP 2026/01', 'Clínica Saldanha Urgente',
            'Avenida da República 45', '1050-187', 'Lisboa',
            38.73890, -9.14470, '917333444', 8.5, 0.08,
            '10:00:00', '12:00:00', '14:00:00', '16:00:00', '18:00:00', '20:00:00',
            10, 'Entrega', '[EXPRESSO]', 'Entrega urgente ao balcão 2º andar', 'Urgente'
        ],
        [
            'Armazém Lisboa Central', 'FT 2026/104', 'Hotel Chiado Lux',
            'Rua Garrett 108', '1200-273', 'Lisboa',
            38.71080, -9.14150, '916444555', 85.0, 0.8,
            '09:00:00', '13:00:00', '14:30:00', '18:00:00', '', '',
            15, 'Entrega', '[PEQUENO]', 'Entregar pela porta de serviço', 'Normal'
        ],
        [
            'Armazém Norte Maia', 'FT 2026/201', 'Confeitaria Maia Centro',
            'Avenida António Santos Leite 120', '4470-142', 'Maia',
            41.23350, -8.62140, '929555666', 60.0, 0.6,
            '08:30:00', '12:30:00', '14:00:00', '17:00:00', '', '',
            12, 'Entrega', '', 'Recebe até às 17h impreterivelmente', 'Normal'
        ],
        [
            'Armazém Coimbra', 'FT 2026/301', 'Livraria Universitária Coimbra',
            'Praça da República 15', '3000-343', 'Coimbra',
            40.20910, -8.41990, '939666777', 110.0, 1.1,
            '10:00:00', '18:30:00', '', '', '', '',
            15, 'Entrega', '', 'Parque de cargas em frente', 'Normal'
        ]
    ]
    
    for r_idx, row_vals in enumerate(data, start=2):
        for c_idx, val in enumerate(row_vals, start=1):
            ws.cell(row=r_idx, column=c_idx, value=val)
    
    format_data_rows(ws, start_row=2, end_row=1 + len(data), num_cols=num_cols,
                     center_cols=(2, 5, 9, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22),
                     right_cols=(7, 8, 10, 11))
    autofit_columns(ws, num_cols)

def build_sheet_regras(wb):
    ws = wb.create_sheet('Regras')
    
    headers_spec = [
        ('Tag_Veiculo', COLOR_REQ),
        ('Permissao', COLOR_REQ),
        ('Tag_Entrega', COLOR_REQ),
        ('Descricao', COLOR_OPT)
    ]
    num_cols = len(headers_spec)
    apply_sheet_headers_tiered(ws, headers_spec)
    
    data = [
        ['PEQUENO', 'SIM', 'PEQUENO', 'Apenas viaturas pequenas podem realizar entregas em centros históricos e ruas estreitas'],
        ['GRANDE', 'NAO', 'PEQUENO', 'Proíbe camiões e viaturas pesadas de entrar em zonas com tag [PEQUENO]'],
        ['ALARGADO', 'SIM', 'ALARGADO', 'Viaturas com turno alargado são direcionadas para entregas distantes / longo curso'],
        ['EXPRESSO', 'SIM', 'EXPRESSO', 'Viaturas expresso dedicadas a encomendas urgentes com janelas horárias curtas']
    ]
    
    for r_idx, row_vals in enumerate(data, start=2):
        for c_idx, val in enumerate(row_vals, start=1):
            ws.cell(row=r_idx, column=c_idx, value=val)
    
    format_data_rows(ws, start_row=2, end_row=1 + len(data), num_cols=num_cols,
                     center_cols=(1, 2, 3), right_cols=())
    autofit_columns(ws, num_cols)

def build_sheet_rotas(wb):
    ws = wb.create_sheet('Rotas')
    
    headers_spec = [
        ('Armazem', COLOR_REQ),
        ('Veiculo', COLOR_REQ),
        ('Ordem_Paragem', COLOR_REQ),
        ('Doc_ID', COLOR_REC),
        ('Cliente', COLOR_REQ),
        ('Morada', COLOR_REQ),
        ('CP', COLOR_REQ),
        ('Localidade', COLOR_OPT),
        ('Telefone_Cliente', COLOR_REC),
        ('Janela_Horaria', COLOR_REC),
        ('Hora_Chegada_Prevista', COLOR_REC),
        ('Hora_Saida_Prevista', COLOR_REC),
        ('Distancia_KM', COLOR_REC),
        ('Distancia_Acumulada_KM', COLOR_REC),
        ('Tempo_Viagem_Min', COLOR_REC),
        ('Tempo_Espera_Min', COLOR_REC),
        ('Carga_Restante_KG', COLOR_REC),
        ('Carga_Restante_Vol', COLOR_REC),
        ('Status', COLOR_REC)
    ]
    num_cols = len(headers_spec)
    apply_sheet_headers_tiered(ws, headers_spec)
    
    sample_data = [
        [
            'Armazém Lisboa Central', 'Carrinha Pequena 01', 0, 'PARTIDA',
            'Armazém Lisboa Central (Partida)', 'Avenida Severiano Falcão 16A', '2685-379', 'Prior Velho',
            '912345678', '08:00 - 18:00', '08:00:00', '08:30:00',
            0.0, 0.0, 0, 0, 130.0, 1.2, 'Partida'
        ],
        [
            'Armazém Lisboa Central', 'Carrinha Pequena 01', 1, 'FT 2026/101',
            'Restaurante Alfama Antiga', 'Rua de São Tomé 14', '1100-563', 'Lisboa',
            '919111222', '09:00 - 12:00', '09:05:00', '09:20:00',
            12.4, 12.4, 35, 0, 85.0, 0.8, 'Pendente'
        ],
        [
            'Armazém Lisboa Central', 'Carrinha Pequena 01', 2, 'FT 2026/104',
            'Hotel Chiado Lux', 'Rua Garrett 108', '1200-273', 'Lisboa',
            '916444555', '09:00 - 13:00', '09:32:00', '09:47:00',
            2.1, 14.5, 12, 0, 0.0, 0.0, 'Pendente'
        ],
        [
            'Armazém Lisboa Central', 'Carrinha Pequena 01', 3, 'RETORNO',
            'Armazém Lisboa Central (Fim de Turno)', 'Avenida Severiano Falcão 16A', '2685-379', 'Prior Velho',
            '912345678', '08:00 - 18:00', '10:25:00', '10:25:00',
            13.2, 27.7, 38, 0, 0.0, 0.0, 'Retorno'
        ]
    ]
    
    for r_idx, row_vals in enumerate(sample_data, start=2):
        for c_idx, val in enumerate(row_vals, start=1):
            ws.cell(row=r_idx, column=c_idx, value=val)
    
    format_data_rows(ws, start_row=2, end_row=1 + len(sample_data), num_cols=num_cols,
                     center_cols=(3, 4, 7, 9, 10, 11, 12, 19),
                     right_cols=(13, 14, 15, 16, 17, 18))
    autofit_columns(ws, num_cols)

def build_sheet_manifestos(wb):
    ws = wb.create_sheet('Manifestos')
    
    headers_spec = [
        ('Armazem', COLOR_MANIFESTO),
        ('Veiculo', COLOR_MANIFESTO),
        ('Motorista', COLOR_MANIFESTO),
        ('Total_Clientes', COLOR_MANIFESTO),
        ('Total_Volumes', COLOR_MANIFESTO),
        ('Total_Peso_KG', COLOR_MANIFESTO),
        ('%_Ocupacao_Capacidade', COLOR_MANIFESTO),
        ('Total_KM_Estimados', COLOR_MANIFESTO),
        ('Total_Tempo_Turno', COLOR_MANIFESTO),
        ('Custo_Estimado_Total', COLOR_MANIFESTO),
        ('Lista_Documentos_Transporte', COLOR_MANIFESTO)
    ]
    num_cols = len(headers_spec)
    apply_sheet_headers_tiered(ws, headers_spec)
    
    sample_data = [
        [
            'Armazém Lisboa Central', 'Carrinha Pequena 01', 'Manuel Silva',
            2, 1.2, 130.0, '16.2%', 27.7, '02h 25m', 18.00, 'FT 2026/101, FT 2026/104'
        ],
        [
            'Armazém Lisboa Central', 'Carrinha Longo Curso 02', 'António Santos',
            1, 3.2, 320.0, '26.7%', 58.4, '02h 10m', 43.80, 'FT 2026/102'
        ]
    ]
    
    for r_idx, row_vals in enumerate(sample_data, start=2):
        for c_idx, val in enumerate(row_vals, start=1):
            ws.cell(row=r_idx, column=c_idx, value=val)
    
    format_data_rows(ws, start_row=2, end_row=1 + len(sample_data), num_cols=num_cols,
                     center_cols=(4, 7, 9),
                     right_cols=(5, 6, 8),
                     currency_cols=(10,))
    autofit_columns(ws, num_cols)

def build_sheet_instrucoes(wb):
    ws = wb.create_sheet('Instruções')
    
    headers_spec = [
        ('Secção', COLOR_INSTRUCOES),
        ('Campo_ou_Regra', COLOR_INSTRUCOES),
        ('Obrigatorio', COLOR_INSTRUCOES),
        ('Formato_Aceite', COLOR_INSTRUCOES),
        ('Exemplo', COLOR_INSTRUCOES),
        ('Descricao_e_Recomendacoes', COLOR_INSTRUCOES)
    ]
    num_cols = len(headers_spec)
    apply_sheet_headers_tiered(ws, headers_spec)
    
    instructions = [
        # Legenda das Cores Padronizadas
        ['0. LEGENDA DE CORES', 'Azul Escuro (#1E3A8A)', 'OBRIGATÓRIO', 'Visual', 'Ex: Nome_Armazem, Veiculo, Morada, CP', 'Campos essenciais para a identificação, morada e cálculo da rota.'],
        ['0. LEGENDA DE CORES', 'Azul Mais Claro (#2563EB)', 'RECOMENDADO', 'Visual', 'Ex: Janelas, Custos, Capacidade, Velocidade', 'Aumenta a precisão de cálculo de tempos, custos e indicadores.'],
        ['0. LEGENDA DE CORES', 'Cinza Ardósia (#64748B)', 'OPCIONAL', 'Visual', 'Ex: Localidade, Latitude, Longitude, Regras, Notas', 'Informação complementar. Não bloqueia o processamento se estiver vazia.'],
        
        # Armazéns
        ['1. Armazéns', 'Nome_Armazem', 'SIM (Coluna A)', 'Texto', 'Armazém Lisboa Central', 'Identificador único do armazém/polo. Utilizado na ligação da Frota e Entregas.'],
        ['1. Armazéns', 'Morada', 'SIM', 'Rua e Número', 'Avenida Severiano Falcão 16A', 'Morada física da base logística.'],
        ['1. Armazéns', 'CP', 'SIM (Obrigatório)', 'XXXX-XXX', '2685-379', 'Código postal completo obrigatório para georreferenciação exata.'],
        ['1. Armazéns', 'Localidade', 'Opcional', 'Cidade / Concelho', 'Prior Velho', 'Localidade ou concelho (opcional se o CP estiver preenchido).'],
        ['1. Armazéns', 'Latitude / Longitude', 'Opcional', 'Decimal (graus)', '38.78420 / -9.12380', 'Se vazio, o sistema georreferencia automaticamente pela morada e CP.'],
        ['1. Armazéns', 'Hora_Abertura / Fecho', 'Recomendado', 'HH:MM:SS ou HH:MM', '06:00:00 / 22:00:00', 'Horário de funcionamento do polo para limites operacionais.'],
        ['1. Armazéns', 'Tempo_Carga_Min', 'Recomendado', 'Número (Minutos)', '30', 'Tempo padrão de carregamento da mercadoria antes de a viatura partir.'],
        
        # Frota
        ['2. Frota', 'Armazem', 'SIM (Coluna A)', 'Texto', 'Armazém Lisboa Central', 'Armazém base ao qual o veículo está afeto.'],
        ['2. Frota', 'Veiculo', 'SIM', 'Texto / Matrícula', 'Carrinha 01 ou 45-AB-67', 'Nome identificador da viatura ou recurso.'],
        ['2. Frota', 'Capacidade_KG', 'SIM', 'Número Decimal', '800 ou 1500.5', 'Capacidade máxima de peso transportável em quilogramas.'],
        ['2. Frota', 'Capacidade_Vol', 'Recomendado', 'Número Decimal', '6.0 ou 15.0', 'Capacidade volumétrica (m³) ou número máximo de caixas/paletes.'],
        ['2. Frota', 'Velocidade_Media', 'Recomendado', 'Número (km/h)', '50', 'Velocidade média operacional de cálculo.'],
        ['2. Frota', 'Hora_Inicio / Fim_Turno', 'SIM', 'HH:MM:SS ou HH:MM', '08:00:00 / 18:00:00', 'Janela horária de trabalho do motorista.'],
        ['2. Frota', 'Regras', 'Opcional', 'Tags entre colchetes', '[PEQUENO] ou [ALARGADO]', 'Tags associadas à viatura para cruzamento na matriz de Regras.'],
        ['2. Frota', 'Motorista_Nome / Telemovel', 'Recomendado', 'Texto / Telefone', 'Manuel Silva / 910000001', 'Dados do motorista para manifestos e envio de rotas para a WebApp PWA.'],
        
        # Entregas
        ['3. Entregas', 'Armazem', 'SIM (Coluna A)', 'Texto', 'Armazém Lisboa Central', 'Armazém de onde sai a mercadoria desta paragem.'],
        ['3. Entregas', 'Doc_ID', 'SIM', 'Texto', 'FT 2026/101', 'Número da fatura, guia de remessa ou pedido.'],
        ['3. Entregas', 'Cliente', 'SIM', 'Texto', 'Restaurante Alfama', 'Nome do destinatário ou estabelecimento.'],
        ['3. Entregas', 'Morada', 'SIM', 'Rua e Número', 'Rua de São Tomé 14', 'Nome da rua, número de polícia ou cais.'],
        ['3. Entregas', 'CP', 'SIM (Obrigatório)', 'XXXX-XXX', '1100-563', 'Código postal completo obrigatório para geocodificação.'],
        ['3. Entregas', 'Localidade', 'Opcional', 'Cidade / Concelho', 'Lisboa', 'Localidade ou concelho (opcional).'],
        ['3. Entregas', 'Janelas Horárias (1, 2 e 3)', 'SIM (Janela 1)', 'HH:MM:SS ou HH:MM', '09:00:00 - 13:00:00', 'Janela 1 é obrigatória. Janelas 2 e 3 são opcionais.'],
        ['3. Entregas', 'Tempo_Descarga_Min', 'Recomendado', 'Número (Minutos)', '15', 'Tempo médio previsto de paragem no cliente.'],
        ['3. Entregas', 'Regras', 'Opcional', 'Tags entre colchetes', '[PEQUENO] ou [EXPRESSO]', 'Restrições operacionais da paragem (ex: rua estreita, longo curso).'],
        
        # Regras
        ['4. Regras', 'Tag_Veiculo', 'SIM', 'Texto (sem colchetes)', 'PEQUENO', 'Tag associada à viatura na folha Frota.'],
        ['4. Regras', 'Permissao', 'SIM', 'SIM ou NAO', 'SIM ou NAO', 'Define se a viatura pode (SIM) ou está proibida (NAO) de realizar a paragem.'],
        ['4. Regras', 'Tag_Entrega', 'SIM', 'Texto (sem colchetes)', 'PEQUENO', 'Tag associada à entrega na folha Entregas.'],
        ['4. Regras', 'Descricao', 'Opcional', 'Texto Livre', 'Observações / Motivo', 'Descrição ou observações da regra operacional.']
    ]
    
    for r_idx, row_vals in enumerate(instructions, start=2):
        for c_idx, val in enumerate(row_vals, start=1):
            ws.cell(row=r_idx, column=c_idx, value=val)
    
    format_data_rows(ws, start_row=2, end_row=1 + len(instructions), num_cols=num_cols,
                     center_cols=(3,), right_cols=())
    
    fill_legend_header = PatternFill(start_color='F1F5F9', end_color='F1F5F9', fill_type='solid')
    for r_idx in range(2, 5):
        for c_idx in range(1, num_cols + 1):
            cell = ws.cell(row=r_idx, column=c_idx)
            cell.font = FONT_DATA_BOLD
            cell.fill = fill_legend_header
    
    for r_idx in range(2, 2 + len(instructions)):
        ws.cell(row=r_idx, column=6).alignment = ALIGN_WRAP_LEFT
    
    autofit_columns(ws, num_cols)
    ws.column_dimensions['F'].width = 50

# ==================== FUNÇÕES PÚBLICAS ====================

def create_georoute_plan_template() -> bytes:
    """Gera o ficheiro mestre oficial GeoRoutePlan.xlsx com as 7 abas formatadas."""
    wb = openpyxl.Workbook()
    
    build_sheet_armazens(wb)
    build_sheet_frota(wb)
    build_sheet_entregas(wb)
    build_sheet_regras(wb)
    build_sheet_rotas(wb)
    build_sheet_manifestos(wb)
    build_sheet_instrucoes(wb)
    
    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return buffer.getvalue()

def create_unified_project_template() -> bytes:
    return create_georoute_plan_template()

def save_master_template_file(output_path: str = 'Ficheiros EXCEL/GeoRoutePlan.xlsx'):
    data = create_georoute_plan_template()
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'wb') as f:
        f.write(data)
    return output_path

if __name__ == '__main__':
    path = save_master_template_file()
    print(f'Ficheiro mestre gerado com sucesso em: {path}')
