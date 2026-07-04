"""
Módulo de Autenticação
Gerencia login/logout e sessão do utilizador
"""
import streamlit as st
from core.session_state import get_state, set_state
import hashlib
from datetime import datetime
from database import (
    autenticar, criar_utilizador, criar_empresa, 
    get_utilizador_por_id, get_empresa, get_projetos, get_projeto,
    log_action
)


def hash_password(password):
    """Hash de password"""
    if password.startswith('$2b$') or password.startswith('$2a$') or password.startswith('$2y$'):
        return password
    salt = "georoute2024"
    return hashlib.sha256((password + salt).encode()).hexdigest()


def init_session_state():
    """Inicializar estados da sessão"""
    state = get_state()
    # Keep legacy keys synchronized for backward compatibility
    if 'logged_in' not in st.session_state:
        st.session_state['logged_in'] = False
    if 'utilizador_id' not in st.session_state:
        st.session_state['utilizador_id'] = None
    if 'utilizador_nome' not in st.session_state:
        st.session_state['utilizador_nome'] = None
    if 'utilizador_email' not in st.session_state:
        st.session_state['utilizador_email'] = None
    if 'empresa_id' not in st.session_state:
        st.session_state['empresa_id'] = None
    if 'empresa_nome' not in st.session_state:
        st.session_state['empresa_nome'] = None
    if 'is_admin' not in st.session_state:
        st.session_state['is_admin'] = False
    if 'projeto_atual' not in st.session_state:
        st.session_state['projeto_atual'] = None


def login(email, password):
    """Efectuar login"""
    user = autenticar(email, password)
    
    if user:
        state = get_state()
        state.logged_in = True
        state.utilizador_id = user['id']
        state.utilizador_nome = user['nome']
        state.utilizador_email = user['email']
        state.empresa_id = user['empresa_id']
        state.is_admin = bool(user['is_admin'])
        
        st.session_state['logged_in'] = True
        st.session_state['utilizador_id'] = user['id']
        st.session_state['utilizador_nome'] = user['nome']
        st.session_state['utilizador_email'] = user['email']
        st.session_state['empresa_id'] = user['empresa_id']
        st.session_state['is_admin'] = bool(user['is_admin'])
        
        # Obter nome da empresa
        empresa = get_empresa(user['empresa_id'])
        if empresa:
            state.empresa_nome = empresa['nome']
            st.session_state['empresa_nome'] = empresa['nome']
        
        set_state(state)
        # Log da ação
        log_action(user['empresa_id'], 'LOGIN', f'Utilizador {email} fez login')
        
        return True
    return False


def logout():
    """Efectuar logout"""
    state = get_state()
    
    if state.empresa_id:
        log_action(state.empresa_id, 'LOGOUT', 
                   f'Utilizador {state.utilizador_email} fez logout')
    
    # Limpar sessão
    state.logged_in = False
    state.utilizador_id = None
    state.utilizador_nome = None
    state.utilizador_email = None
    state.empresa_id = None
    state.empresa_nome = None
    state.is_admin = False
    state.projeto_atual = None
    set_state(state)
    
    st.session_state['logged_in'] = False
    st.session_state['utilizador_id'] = None
    st.session_state['utilizador_nome'] = None
    st.session_state['utilizador_email'] = None
    st.session_state['empresa_id'] = None
    st.session_state['empresa_nome'] = None
    st.session_state['is_admin'] = False
    st.session_state['projeto_atual'] = None


def require_login():
    """Verificar se utilizador está logado"""
    if not get_state().logged_in:
        st.warning("Por favor, faça login para continuar.")
        st.stop()


def require_admin():
    """Verificar se utilizador é admin"""
    require_login()
    if not get_state().is_admin:
        st.error("Acesso restrito a administradores.")
        st.stop()


def render_login_page():
    """Renderizar página de login"""
    st.set_page_config(
        page_title="GeoRoute Pro - Login",
        page_icon="🚚",
        layout="centered"
    )
    
    # CSS personalizado para login
    st.markdown("""
        <style>
        .login-container {
            max-width: 400px;
            margin: 0 auto;
            padding: 2rem;
            background: #f8f9fa;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .login-title {
            text-align: center;
            color: #1e3a5f;
            margin-bottom: 2rem;
        }
        </style>
    """, unsafe_allow_html=True)
    
    st.markdown('<h1 class="login-title">🚚 GeoRoute Pro</h1>', unsafe_allow_html=True)
    st.markdown("### Planeamento de Rotas Low-Cost")
    
    # Tabs para Login/Registo
    tab1, tab2 = st.tabs(["🔑 Login", "📝 Registar"])
    
    with tab1:
        with st.form("login_form"):
            email = st.text_input("Email", placeholder="seu@email.pt")
            password = st.text_input("Password", type="password")
            submit = st.form_submit_button("Entrar", use_container_width=True)
            
            if submit:
                if login(email, password):
                    st.success(f"Bem-vindo, {st.session_state['utilizador_nome']}!")
                    st.rerun()
                else:
                    st.error("Email ou password incorretos.")
        
        st.markdown("---")
    
    with tab2:
        with st.form("register_form"):
            st.markdown("#### Criar nova empresa")
            nome_empresa = st.text_input("Nome da Empresa", placeholder="Minha Empresa Lda.")
            nome_utilizador = st.text_input("Seu Nome", placeholder="João Silva")
            email = st.text_input("Email", placeholder="joao@empresa.pt")
            password = st.text_input("Password", type="password")
            password_confirm = st.text_input("Confirmar Password", type="password")
            
            submit = st.form_submit_button("Criar Conta", use_container_width=True)
            
            if submit:
                if password != password_confirm:
                    st.error("As passwords não coincidem.")
                elif len(password) < 6:
                    st.error("Password deve ter pelo menos 6 caracteres.")
                else:
                    # Criar empresa e utilizador
                    from database import criar_empresa, criar_utilizador, get_empresa_por_email
                    
                    # Verificar se email já existe
                    if get_empresa_por_email(email):
                        st.error("Este email já está registado.")
                    else:
                        try:
                            empresa_id = criar_empresa(nome_empresa, email, plano='starter')
                            criar_utilizador(empresa_id, nome_utilizador, email, password, is_admin=True)
                            
                            st.success("Conta criada com sucesso! Faça login.")
                        except Exception as e:
                            st.error(f"Erro ao criar conta: {e}")


def render_sidebar():
    """Renderizar sidebar com info do utilizador"""
    if not get_state().logged_in:
        return
    
    st.sidebar.markdown("---")
    st.sidebar.markdown("### 👤 Utilizador")
    state = get_state()
    st.sidebar.write(f"**{state.utilizador_nome or 'N/A'}**")
    st.sidebar.write(f"📧 {state.utilizador_email or 'N/A'}")
    st.sidebar.write(f"🏢 {state.empresa_nome or 'N/A'}")
    
    # Seletor de projeto
    state = get_state()
    projetos = get_projetos(state.empresa_id)
    st.sidebar.markdown("---")
    st.sidebar.markdown("### 📁 Projeto")
    
    # Botão para criar novo projeto
    if st.sidebar.button("+ Novo Projeto", use_container_width=True):
        st.session_state['show_new_project'] = True
    
    # Mostrar formulário de novo projeto se necessário
    if st.session_state.get('show_new_project'):
        with st.sidebar.form("novo_projeto"):
            nome = st.text_input("Nome do Projeto")
            desc = st.text_area("Descrição")
            if st.form_submit_button("Criar"):
                from database import criar_projeto
                state = get_state()
                novo_id = criar_projeto(state.empresa_id, nome, desc)
                
                # Reset all project-specific phase data for the new project
                from core.session_state import AppState
                new_state = AppState(
                    logged_in=state.logged_in,
                    utilizador_id=state.utilizador_id,
                    utilizador_nome=state.utilizador_nome,
                    utilizador_email=state.utilizador_email,
                    empresa_id=state.empresa_id,
                    empresa_nome=state.empresa_nome,
                    is_admin=state.is_admin,
                    projeto_atual=novo_id,
                    projeto_nome=nome,
                    google_api_key=state.google_api_key
                )
                set_state(new_state)
                st.session_state['app_state'] = new_state
                st.session_state['projeto_atual'] = novo_id
                
                # Sync key legacy session state fields
                st.session_state['clients_geocoded'] = None
                st.session_state['failed_clients'] = None
                st.session_state['clients_original_df'] = None
                st.session_state['phase_1_complete'] = False
                st.session_state['phase_2_complete'] = False
                st.session_state['current_phase'] = 1
                for key in ['warehouses_geocoded', 'fleet_config', 'routes_solution', 'fleet_config_used', 'warehouses_used', 'optimization_params']:
                    if key in st.session_state:
                        st.session_state[key] = None
                        
                st.session_state['show_new_project'] = False
                st.rerun()
    
    if projetos:
        projeto_names = {p['id']: p['nome'] for p in projetos}
        projeto_ids = list(projeto_names.keys())
        
        # Usar session_state para manter seleção
        projeto_selecionado = st.sidebar.selectbox(
            "Selecionar Projeto",
            options=projeto_ids,
            format_func=lambda x: projeto_names.get(x, f"Projeto {x}"),
            index=0 if not state.projeto_atual else 
                  projeto_ids.index(state.projeto_atual) if state.projeto_atual in projeto_ids else 0
        )
        
        if projeto_selecionado:
            state = get_state()
            previous_proj = state.projeto_atual
            if projeto_selecionado != previous_proj:
                # Reset all project-specific phase data to prevent leakage
                from core.session_state import AppState
                new_state = AppState(
                    logged_in=state.logged_in,
                    utilizador_id=state.utilizador_id,
                    utilizador_nome=state.utilizador_nome,
                    utilizador_email=state.utilizador_email,
                    empresa_id=state.empresa_id,
                    empresa_nome=state.empresa_nome,
                    is_admin=state.is_admin,
                    projeto_atual=projeto_selecionado,
                    projeto_nome=projeto_names.get(projeto_selecionado),
                    google_api_key=state.google_api_key
                )
                set_state(new_state)
                st.session_state['app_state'] = new_state
                st.session_state['projeto_atual'] = projeto_selecionado
                
                # Sync key legacy session state fields
                st.session_state['clients_geocoded'] = None
                st.session_state['failed_clients'] = None
                st.session_state['clients_original_df'] = None
                st.session_state['phase_1_complete'] = False
                st.session_state['phase_2_complete'] = False
                st.session_state['current_phase'] = 1
                for key in ['warehouses_geocoded', 'fleet_config', 'routes_solution', 'fleet_config_used', 'warehouses_used', 'optimization_params']:
                    if key in st.session_state:
                        st.session_state[key] = None
                
                # Attempt to load latest snapshot for newly selected project
                from utils.persistence_manager import get_snapshots_for_project, load_snapshot_into_session
                snapshots = get_snapshots_for_project(projeto_selecionado, limit=1)
                if snapshots:
                    try:
                        load_snapshot_into_session(snapshots[0]['id'])
                    except Exception as e:
                        print(f"Error loading snapshot on switch: {e}")
                
                st.rerun()
    else:
        st.sidebar.info("Crie o seu primeiro projeto!")
    
    # Botão admin (só para admins)
    if get_state().is_admin:
        st.sidebar.markdown("---")
        st.sidebar.markdown("### ⚙️ Admin")
        if st.sidebar.button("📊 Painel Admin", use_container_width=True):
            st.switch_page("pages/admin.py")
    
    # Botão logout
    st.sidebar.markdown("---")
    if st.sidebar.button("🚪 Sair", use_container_width=True):
        logout()
        st.rerun()


def is_logged_in():
    """Verificar se está logado"""
    return bool(get_state().logged_in)


def get_current_empresa_id():
    """Obter ID da empresa atual"""
    return get_state().empresa_id


def get_current_projeto_id():
    """Obter ID do projeto atual"""
    return get_state().projeto_atual