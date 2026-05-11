"""
Dashboard de Métricas e Analytics
Mostra estatísticas do projeto e empresa
"""
import streamlit as st
import pandas as pd
from datetime import datetime, timedelta
from database import (
    get_metricas_projeto, get_metricas_empresa, get_projetos,
    get_entregas_projeto, PLANOS, get_empresa
)
import auth


def render_dashboard():
    """Renderizar dashboard de métricas"""
    
    # Verificar projeto
    projeto_id = st.session_state.get('projeto_atual')
    if not projeto_id:
        st.info("Selecione um projeto para ver as métricas.")
        return
    
    empresa_id = st.session_state.get('empresa_id')
    
    # Obter dados
    empresa = get_empresa(empresa_id)
    plano_info = get_plano_info(empresa['plano'])
    metricas = get_metricas_projeto(projeto_id, dias=30)
    metricas_empresa = get_metricas_empresa(empresa_id, dias=30)
    
    st.markdown("## 📊 Dashboard")
    
    # Info do plano
    with st.expander("ℹ️ Info do Plano", expanded=False):
        col1, col2, col3 = st.columns(3)
        col1.metric("Plano", plano_info['nome'])
        col2.metric("Preço", f"{plano_info['preco']}€/mês")
        col3.metric("Limite Entregas", f"{plano_info['limite_entregas_mes']}/mês")
        
        st.write("**Funcionalidades:**")
        for func in plano_info['funcionalidades']:
            st.caption(f"✅ {func}")
    
    # Métricas do projeto
    st.markdown("### Este Projeto (Últimos 30 dias)")
    
    if metricas:
        # Converter para DataFrame
        df = pd.DataFrame([
            {
                'Data': m['data'],
                'Entregas': m['total_entregas'],
                'Sucesso': m['entregas_sucesso'],
                'Falha': m['entregas_falha'],
                'Distância (km)': round(m['distancia_total_km'], 1),
                'Custo (€)': round(m['custo_total'], 2),
                'Tempo (min)': round(m['tempo_total_minutos'], 0)
            }
            for m in metricas
        ])
        
        # Totais
        total_entregas = df['Entregas'].sum()
        total_sucesso = df['Sucesso'].sum()
        total_falha = df['Falha'].sum()
        total_distancia = df['Distância (km)'].sum()
        total_custo = df['Custo (€)'].sum()
        
        col1, col2, col3, col4 = st.columns(4)
        col1.metric("Total Entregas", total_entregas)
        col2.metric("Taxa Sucesso", f"{(total_sucesso/total_entregas*100):.1f}%" if total_entregas > 0 else "0%")
        col3.metric("Distância Total", f"{total_distancia:.1f} km")
        col4.metric("Custo Total", f"{total_custo:.2f} €")
        
        # Gráfico de entregas por dia
        if len(df) > 1:
            st.markdown("#### Entregas por Dia")
            st.line_chart(df.set_index('Data')[['Entregas', 'Sucesso', 'Falha']])
        
        # Tabela de dados
        st.markdown("#### Detalhes Diários")
        st.dataframe(df, use_container_width=True)
    else:
        st.info("Ainda não há métricas para este projeto. Execute uma otimização para gerar dados.")
    
    st.markdown("---")
    
    # Métricas da empresa
    st.markdown("### Toda a Empresa (Últimos 30 dias)")
    
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Entregas", metricas_empresa['total_entregas'] or 0)
    col2.metric("Sucesso", metricas_empresa['entregas_sucesso'] or 0)
    col3.metric("Distância", f"{metricas_empresa['distancia_total'] or 0:.1f} km")
    col4.metric("Custo", f"{metricas_empresa['custo_total'] or 0:.2f} €")
    
    # Uso vs limite
    limite = plano_info['limite_entregas_mes']
    usado = metricas_empresa['total_entregas'] or 0
    percent = min(usado / limite * 100, 100)
    
    st.markdown("#### Uso do Plano")
    st.progress(percent / 100)
    st.caption(f"{usado} / {limite} entregas este mês ({percent:.1f}%)")
    
    if percent >= 80:
        st.warning(f"⚠️ Está a usar {percent:.1f}% do seu plano. Considere fazer upgrade!")
    elif percent >= 100:
        st.error("❌ Limite atingido! Faça upgrade do seu plano.")
    
    # Listar projetos com métricas
    st.markdown("---")
    st.markdown("### 📁 Projetos")
    
    projetos = get_projetos(empresa_id)
    for p in projetos:
        m = get_metricas_projeto(p['id'], dias=30)
        total = sum(x['total_entregas'] for x in m) if m else 0
        
        with st.expander(f"{p['nome']} - {total} entregas"):
            st.write(f"**Descrição:** {p['descricao'] or 'Sem descrição'}")
            st.write(f"**Última atualização:** {p['updated_at'][:16] if p['updated_at'] else 'N/A'}")
            
            if m:
                st.write("**Métricas:**")
                st.write(f"- Total: {sum(x['total_entregas'] for x in m)} entregas")
                st.write(f"- Distância: {sum(x['distancia_total_km'] for x in m):.1f} km")
                st.write(f"- Custo: {sum(x['custo_total'] for x in m):.2f} €")


if __name__ == "__main__":
    import streamlit as st
    st.set_page_config(page_title="Dashboard", layout="wide")
    
    # Simular sessão
    if 'logged_in' not in st.session_state:
        st.warning("Faça login primeiro!")
        st.stop()
    
    render_dashboard()
