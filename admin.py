"""
Página de Admin - Gestão do Sistema
Apenas acessível a administradores
"""
import streamlit as st
from database import (
    get_all_empresas, get_all_utilizadores, get_usage_stats,
    update_empresa_plano, criar_projeto, get_projetos
)
import auth

auth.require_admin()


def render_admin_page():
    st.set_page_config(
        page_title="GeoRoute Pro - Admin",
        page_icon="⚙️",
        layout="wide"
    )
    
    # Inicializar sessão de auth
    auth.init_session_state()
    if not auth.is_logged_in():
        auth.render_login_page()
        st.stop()
    
    auth.require_admin()
    auth.render_sidebar()
    
    st.title("⚙️ Painel de Administração")
    
    # Tabs
    tab1, tab2, tab3, tab4 = st.tabs(["🏢 Empresas", "👥 Utilizadores", "📊 Estatísticas", "⚙️ Sistema"])
    
    # --- TAB 4: Configurações do Sistema ---
    with tab4:
        st.markdown("### Configurações Globais")
        
        # Google API Key
        st.markdown("#### Google Maps API")
        st.info("Configure a API key do Google Maps aqui. Esta chave será usada por todas as empresas.")
        
        from database import get_google_api_key, set_google_api_key
        
        api_key_atual = get_google_api_key()
        
        with st.form("google_api_form"):
            nova_api_key = st.text_input(
                "Google Maps API Key", 
                value=api_key_atual if api_key_atual else "",
                type="password",
                help="API Key do Google Cloud Console com Geocoding API ativada"
            )
            
            if st.form_submit_button("💾 Guardar API Key"):
                set_google_api_key(nova_api_key)
                st.success("API Key guardada com sucesso!")
                st.rerun()
        
        if api_key_atual:
            st.success("✅ API Key configurada")
        else:
            st.warning("⚠️ API Key não configurada - o geocoding não funcionará!")
        
        st.markdown("---")
        
        # Planos
        st.markdown("#### Planos Disponíveis")
        from database import PLANOS
        
        for plano, info in PLANOS.items():
            with st.expander(f"📦 {info['nome']} ({info['preco']}€/mês)"):
                st.write(f"**Entregas/mês:** {info['limite_entregas_mes']}")
                st.write(f"**Utilizadores:** {info['limite_utilizadores']}")
                st.write(f"**Projetos:** {info['limite_projetos']}")
                st.write("**Funcionalidades:**")
                for func in info['funcionalidades']:
                    st.caption(f"- {func}")
    
    with tab1:
        st.markdown("### Empresas Registadas")
        
        empresas = get_all_empresas()
        
        if empresas:
            # Tabela de empresas
            import pandas as pd
            df_empresas = pd.DataFrame([
                {
                    'ID': e['id'],
                    'Nome': e['nome'],
                    'Email': e['email'],
                    'Plano': e['plano'],
                    'Ativo': '✅' if e['is_active'] else '❌',
                    'Criado': e['created_at'][:10]
                }
                for e in empresas
            ])
            st.dataframe(df_empresas, use_container_width=True)
            
            # Gestão de planos
            st.markdown("---")
            st.markdown("#### Alterar Plano")
            
            col1, col2 = st.columns(2)
            with col1:
                empresa_id = st.selectbox(
                    "Selecionar Empresa",
                    options=[e['id'] for e in empresas],
                    format_func=lambda x: next(e['nome'] for e in empresas if e['id'] == x)
                )
            with col2:
                novo_plano = st.selectbox(
                    "Novo Plano",
                    options=['starter', 'pro', 'enterprise']
                )
            
            if st.button("Atualizar Plano"):
                update_empresa_plano(empresa_id, novo_plano)
                st.success("Plano atualizado!")
                st.rerun()
        else:
            st.info("Não existem empresas registadas.")
    
    with tab2:
        st.markdown("### Utilizadores Registados")
        
        utilizadores = get_all_utilizadores()
        
        if utilizadores:
            df_users = pd.DataFrame([
                {
                    'ID': u['id'],
                    'Nome': u['nome'],
                    'Email': u['email'],
                    'Empresa': u['empresa_nome'],
                    'Admin': '✅' if u['is_admin'] else '❌',
                    'Ativo': '✅' if u['is_active'] else '❌'
                }
                for u in utilizadores
            ])
            st.dataframe(df_users, use_container_width=True)
        else:
            st.info("Não existem utilizadores registados.")
    
    with tab3:
        st.markdown("### Estatísticas Globais")
        
        empresas = get_all_empresas()
        total_empresas = len(empresas)
        total_utilizadores = len(get_all_utilizadores())
        
        col1, col2, col3 = st.columns(3)
        col1.metric("Empresas", total_empresas)
        col2.metric("Utilizadores", total_utilizadores)
        col3.metric("Planos Starter", sum(1 for e in empresas if e['plano'] == 'starter'))
        
        st.markdown("---")
        
        # Listar empresas com estatísticas
        st.markdown("#### Detalhes por Empresa")
        
        for empresa in empresas[:10]:
            stats = get_usage_stats(empresa['id'])
            
            with st.expander(f"{empresa['nome']} ({empresa['plano']})"):
                st.write(f"**Email:** {empresa['email']}")
                st.write(f"**Projetos:** {stats['total_projetos']}")
                st.write(f"**Entregas processadas:** {stats['total_entregas']}")
                
                if stats['atividade']:
                    st.markdown("**Atividade recente:**")
                    for log in stats['atividade'][:5]:
                        st.caption(f"- {log['acao']}: {log['detalhes']} ({log['created_at'][:16]})")


if __name__ == "__main__":
    render_admin_page()
