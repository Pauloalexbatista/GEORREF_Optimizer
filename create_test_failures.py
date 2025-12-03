import pandas as pd

# Criar dataset de teste com FALHAS GARANTIDAS
data = {
    'Codigo_Cliente': ['CL001', 'CL002', 'CL003', 'CL004', 'CL005'],
    'Morada': ['', '', 'XYZABC123 Rua Inexistente', '', 'Avenida da Liberdade, 50'],
    'Codigo_Postal': ['', '99999-999', '', '0000-000', '1250-096'],  # CPs invalidos
    'Concelho': ['', '', 'ConcelhoQueNaoExiste', '', 'Lisboa'],
    'Peso_KG': [10, 20, 30, 40, 50],
    'Prioridade': [1, 2, 1, 3, 2]
}

df = pd.DataFrame(data)
df.to_excel('test_failures_real.xlsx', index=False)

print('Ficheiro criado: test_failures_real.xlsx')
print('')
print('FALHAS GARANTIDAS (dados invalidos):')
print('CL001: Tudo vazio -> FALHA')
print('CL002: CP invalido (99999-999) -> FALHA GARANTIDA')
print('CL003: Morada + Concelho inexistentes -> FALHA GARANTIDA')
print('CL004: CP invalido (0000-000) -> FALHA GARANTIDA')
print('CL005: Dados corretos -> SUCESSO')
