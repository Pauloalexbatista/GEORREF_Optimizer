"""
Módulo de Autenticação
Gerencia login/logout e sessão do utilizador
"""
import streamlit as st
import hashlib
from datetime import datetime
from database import (
    autenticar, criar_utilizador, criar_empresa, 
    get_utilizador_por_id, get_empresa, get_projetos,
    log_action
)


def hash_password(password):
    """Hash de password"""
    salt = "georoute2024"
    return hashlib.sha256((password + salt).encode()).hexdigest()


def init_session_state():
    """Inicializar estados da sessão"""
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
        st.session_state['logged_in'] = True
        st.session_state['utilizador_id'] = user['id']
        st.session_state['utilizador_nome'] = user['nome']
        st.session_state['utilizador_email'] = user['email']
        st.session_state['empresa_id'] = user['empresa_id']
        st.session_state['is_admin'] = user['is_admin']
        
        # Obter nome da empresa
        empresa = get_empresa(user['empresa_id'])
        if empresa:
            st.session_state['empresa_nome'] = empresa['nome']
        
        # Log da ação
        log_action(user['empresa_id'], 'LOGIN', f'Utilizador {email} fez login')
        
        return True
    return False


def logout():
    """Efectuar logout"""
    if st.session_state.get('empresa_id'):
        log_action(st.session_state['empresa_id'], 'LOGOUT', 
                   f'Utilizador {st.session_state.get("utilizador_email")} fez logout')
    
    # Limpar sessão
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
    if not st.session_state.get('logged_in'):
        st.warning("Por favor, faça login para continuar.")
        st.stop()


def require_admin():
    """Verificar se utilizador é admin"""
    require_login()
    if not st.session_state.get('is_admin'):
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
        st.info("**Conta Demo:** demo@georoute.pt / demo123")
    
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
    if not st.session_state.get('logged_in'):
        return
    
    st.sidebar.markdown("---")
    st.sidebar.markdown("### 👤 Utilizador")
    st.sidebar.write(f"**{st.session_state.get('utilizador_nome', 'N/A')}**")
    st.sidebar.write(f"📧 {st.session_state.get('utilizador_email', 'N/A')}")
    st.sidebar.write(f"🏢 {st.session_state.get('empresa_nome', 'N/A')}")
    
    # Seletor de projeto
    projetos = get_projetos(st.session_state.get('empresa_id'))
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
                novo_id = criar_projeto(st.session_state.get('empresa_id'), nome, desc)
                st.session_state['projeto_atual'] = novo_id
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
            index=0 if not st.session_state.get('projeto_atual') else 
                  projeto_ids.index(st.session_state.get('projeto_atual')) if st.session_state.get('projeto_atual') in projeto_ids else 0
        )
        
        if projeto_selecionado:
            st.session_state['projeto_atual'] = projeto_selecionado
    else:
        st.sidebar.info("Crie o seu primeiro projeto!")
    
    # Botão admin (só para admins)
    if st.session_state.get('is_admin'):
        st.sidebar.markdown("---")
        st.sidebar.markdown("### ⚙️ Admin")
        if st.sidebar.button("📊 Painel Admin", use_container_width=True):
            st.switch_page("admin.py")
    
    # Botão logout
    st.sidebar.markdown("---")
    if st.sidebar.button("🚪 Sair", use_container_width=True):
        logout()
        st.rerun()


def is_logged_in():
    """Verificar se está logado"""
    return st.session_state.get('logged_in', False)


def get_current_empresa_id():
    """Obter ID da empresa atual"""
    return st.session_state.get('empresa_id')


def get_current_projeto_id():
    """Obter ID do projeto atual"""
    return st.session_state.get('projeto_atual')
