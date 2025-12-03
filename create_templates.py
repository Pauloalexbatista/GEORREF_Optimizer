import pandas as pd
import os

def create_fleet_template():
    """Create Excel template for fleet configuration."""
    
    # Sample data
    data = {
        'Veículo': ['Carrinha 1', 'Carrinha 2'],
        'Início': ['08:00', '08:00'],
        'Fim': ['20:00', '20:00'],
        'Cap. Volumes': [100, 150],
        'Cap. Peso (Kg)': [1000, 1500],
        'Custo/KM (€)': [0.50, 0.60],
        'Velocidade Média (km/h)': [40, 40]
    }
    
    df = pd.DataFrame(data)
    
    # Create templates directory if it doesn't exist
    os.makedirs('templates', exist_ok=True)
    
    # Save to Excel with formatting
    output_path = 'templates/template_frota.xlsx'
    
    with pd.ExcelWriter(output_path, engine='xlsxwriter') as writer:
        df.to_excel(writer, index=False, sheet_name='Frota')
        
        workbook = writer.book
        worksheet = writer.sheets['Frota']
        
        # Formats
        header_format = workbook.add_format({
            'bold': True,
            'bg_color': '#8DA7BE',
            'font_color': 'white',
            'border': 1,
            'align': 'center',
            'valign': 'vcenter'
        })
        
        example_format = workbook.add_format({
            'bg_color': '#CDE6F5',
            'border': 1
        })
        
        # Apply header format
        for col_num, value in enumerate(df.columns.values):
            worksheet.write(0, col_num, value, header_format)
            
        # Apply example format to first row
        for col_num in range(len(df.columns)):
            worksheet.write(1, col_num, df.iloc[0, col_num], example_format)
        
        # Set column widths
        worksheet.set_column('A:A', 15)  # Veículo
        worksheet.set_column('B:C', 10)  # Início, Fim
        worksheet.set_column('D:E', 15)  # Capacidades
        worksheet.set_column('F:F', 12)  # Custo
        worksheet.set_column('G:G', 20)  # Velocidade
        
        # Add instructions sheet
        instructions = pd.DataFrame({
            'Campo': [
                'Veículo',
                'Início',
                'Fim',
                'Cap. Volumes',
                'Cap. Peso (Kg)',
                'Custo/KM (€)',
                'Velocidade Média (km/h)'
            ],
            'Descrição': [
                'Nome do veículo (ex: Carrinha 1, Camião A)',
                'Hora de início da rota (formato HH:MM, ex: 08:00)',
                'Hora de fim da rota (formato HH:MM, ex: 20:00)',
                'Capacidade máxima de volumes/caixas',
                'Capacidade máxima de peso em quilogramas',
                'Custo por quilómetro em euros (ex: 0.50)',
                'Velocidade média esperada em km/h (ex: 40 para urbano, 60 para estrada)'
            ],
            'Obrigatório': ['Sim', 'Sim', 'Sim', 'Sim', 'Sim', 'Não', 'Não'],
            'Exemplo': ['Carrinha 1', '08:00', '20:00', '100', '1000', '0.50', '40']
        })
        
        instructions.to_excel(writer, index=False, sheet_name='Instruções')
        
        worksheet_inst = writer.sheets['Instruções']
        
        # Format instructions
        for col_num, value in enumerate(instructions.columns.values):
            worksheet_inst.write(0, col_num, value, header_format)
        
        worksheet_inst.set_column('A:A', 25)
        worksheet_inst.set_column('B:B', 60)
        worksheet_inst.set_column('C:C', 12)
        worksheet_inst.set_column('D:D', 15)
    
    print(f"Template de frota criado: {output_path}")
    return output_path

def create_orders_template():
    """Create Excel template for orders/deliveries."""
    
    # Sample data with all columns (including future ones)
    data = {
        'Morada': [
            'Rua dos Bombeiros Voluntários 123',
            'Avenida da República 456'
        ],
        'CP': ['2750-123', '1050-123'],
        'Concelho': ['Cascais', 'Lisboa'],
        'Peso_Kg': [25.5, 15.0],
        'Num_Volumes': [3, 2],
        'Tempo_Servico_Min': [15, 15],
        'Janela_Inicio': ['09:00', '14:00'],
        'Janela_Fim': ['12:00', '18:00'],
        'Prioridade': [1, 2],
        'Notas': ['Tocar campainha 2x', 'Deixar na receção']
    }
    
    df = pd.DataFrame(data)
    
    # Create templates directory if it doesn't exist
    os.makedirs('templates', exist_ok=True)
    
    # Save to Excel with formatting
    output_path = 'templates/template_encomendas.xlsx'
    
    with pd.ExcelWriter(output_path, engine='xlsxwriter') as writer:
        df.to_excel(writer, index=False, sheet_name='Encomendas')
        
        workbook = writer.book
        worksheet = writer.sheets['Encomendas']
        
        # Formats
        header_format = workbook.add_format({
            'bold': True,
            'bg_color': '#554640',
            'font_color': 'white',
            'border': 1,
            'align': 'center',
            'valign': 'vcenter'
        })
        
        required_format = workbook.add_format({
            'bg_color': '#FFE6E6',
            'border': 1
        })
        
        optional_format = workbook.add_format({
            'bg_color': '#E6F3FF',
            'border': 1
        })
        
        # Apply header format
        for col_num, value in enumerate(df.columns.values):
            worksheet.write(0, col_num, value, header_format)
        
        # Apply conditional formatting (required vs optional)
        required_cols = [0, 1, 2]  # Morada, CP, Concelho
        
        for row_num in range(1, len(df) + 1):
            for col_num in range(len(df.columns)):
                cell_format = required_format if col_num in required_cols else optional_format
                worksheet.write(row_num, col_num, df.iloc[row_num-1, col_num], cell_format)
        
        # Set column widths
        worksheet.set_column('A:A', 40)  # Morada
        worksheet.set_column('B:B', 12)  # CP
        worksheet.set_column('C:C', 15)  # Concelho
        worksheet.set_column('D:E', 12)  # Peso, Volumes
        worksheet.set_column('F:F', 18)  # Tempo Serviço
        worksheet.set_column('G:H', 12)  # Janelas
        worksheet.set_column('I:I', 10)  # Prioridade
        worksheet.set_column('J:J', 30)  # Notas
        
        # Add instructions sheet
        instructions = pd.DataFrame({
            'Campo': [
                'Morada',
                'CP',
                'Concelho',
                'Peso_Kg',
                'Num_Volumes',
                'Tempo_Servico_Min',
                'Janela_Inicio',
                'Janela_Fim',
                'Prioridade',
                'Notas'
            ],
            'Descrição': [
                'Morada completa do cliente (rua e número)',
                'Código postal (formato: xxxx-xxx)',
                'Concelho ou cidade',
                'Peso total da encomenda em quilogramas',
                'Número de volumes/caixas/paletes',
                'Tempo estimado de serviço no local (minutos)',
                'Início da janela temporal de entrega (HH:MM)',
                'Fim da janela temporal de entrega (HH:MM)',
                'Prioridade: 1=Alta, 2=Média, 3=Baixa',
                'Observações ou instruções especiais'
            ],
            'Obrigatório': ['Sim', 'Sim', 'Sim', 'Não*', 'Não*', 'Não', 'Não', 'Não', 'Não', 'Não'],
            'Exemplo': [
                'Rua dos Bombeiros Voluntários 123',
                '2750-123',
                'Cascais',
                '25.5',
                '3',
                '15',
                '09:00',
                '12:00',
                '1',
                'Tocar campainha 2x'
            ]
        })
        
        instructions.to_excel(writer, index=False, sheet_name='Instruções')
        
        worksheet_inst = writer.sheets['Instruções']
        
        # Format instructions
        for col_num, value in enumerate(instructions.columns.values):
            worksheet_inst.write(0, col_num, value, header_format)
        
        worksheet_inst.set_column('A:A', 20)
        worksheet_inst.set_column('B:B', 60)
        worksheet_inst.set_column('C:C', 12)
        worksheet_inst.set_column('D:D', 40)
        
        # Add note about future features
        note_format = workbook.add_format({
            'italic': True,
            'font_color': '#666666'
        })
        
        worksheet_inst.write(len(instructions) + 2, 0, 
            '* Campos marcados com "Não*" serão obrigatórios em versões futuras quando a funcionalidade for ativada.',
            note_format)
    
    print(f"Template de encomendas criado: {output_path}")
    return output_path

if __name__ == "__main__":
    print("Criando templates Excel...")
    create_fleet_template()
    create_orders_template()
    print("\nTemplates criados com sucesso!")
    print("\nLocalizacao: ./templates/")
    print("  - template_frota.xlsx")
    print("  - template_encomendas.xlsx")
