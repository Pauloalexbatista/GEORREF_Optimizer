"""
Base de Dados - Modelos e Gestão
Suporta multi-tenant (múltiplas empresas)
"""
import sqlite3
import hashlib
import os
from datetime import datetime
from contextlib import contextmanager

DB_FILE = 'geocoding_multi.db'


def get_db_connection():
    """Criar conexão com a base de dados"""
    conn = sqlite3.connect(DB_FILE, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def get_db():
    """Context manager para base de dados"""
    conn = get_db_connection()
    try:
        yield conn
    finally:
        conn.close()


def init_database():
    """Inicializar schema da base de dados"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Tabela de Empresas
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS empresas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                plano TEXT DEFAULT 'starter',
                limite_entregas INTEGER DEFAULT 100,
                limite_utilizadores INTEGER DEFAULT 1,
                api_key_google TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT 1
            )
        """)
        
        # Tabela de Utilizadores
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS utilizadores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                empresa_id INTEGER NOT NULL,
                nome TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                is_admin BOOLEAN DEFAULT 0,
                is_active BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (empresa_id) REFERENCES empresas (id)
            )
        """)
        
        # Tabela de Projetos (cada empresa pode ter vários)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS projetos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                empresa_id INTEGER NOT NULL,
                nome TEXT NOT NULL,
                descricao TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (empresa_id) REFERENCES empresas (id)
            )
        """)
        
        # Tabela de Entregas (dados geocodificados)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS entregas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                projeto_id INTEGER NOT NULL,
                codigo_cliente TEXT,
                morada TEXT NOT NULL,
                codigo_postal TEXT,
               _concelho TEXT,
                peso_kg REAL,
                volume_m3 REAL,
                prioridade INTEGER DEFAULT 2,
                janela_inicio TEXT,
                janela_fim TEXT,
                observacoes TEXT,
                latitude REAL,
                longitude REAL,
                nivel_qualidade INTEGER,
                fonte_match TEXT,
                morada_encontrada TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (projeto_id) REFERENCES projetos (id)
            )
        """)
        
        # Tabela de Frota
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS frota (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                projeto_id INTEGER NOT NULL,
                veiculo TEXT NOT NULL,
                capacidade_kg REAL,
                capacidade_volume REAL,
                custo_km REAL,
                velocidade_media REAL,
                horario_inicio TEXT,
                horario_fim TEXT,
                is_active BOOLEAN DEFAULT 1,
                FOREIGN KEY (projeto_id) REFERENCES projetos (id)
            )
        """)
        
        # Tabela de Rotas Otimizadas
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS rotas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                projeto_id INTEGER NOT NULL,
                veiculo TEXT NOT NULL,
                ordem INTEGER NOT NULL,
                entrega_id INTEGER,
                distancia_km REAL,
                tempo_minutos REAL,
                custo_estimado REAL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (projeto_id) REFERENCES projetos (id),
                FOREIGN KEY (entrega_id) REFERENCES entregas (id)
            )
        """)
        
        # Tabela de Logs de Uso
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS usage_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                empresa_id INTEGER NOT NULL,
                acao TEXT NOT NULL,
                detalhes TEXT,
                ip_address TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (empresa_id) REFERENCES empresas (id)
            )
        """)
        
        # Tabela de Configurações Globais (do sistema)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT,
                description TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Tabela de Métricas por Projeto
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS metricas_projeto (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                projeto_id INTEGER NOT NULL,
                data DATE DEFAULT CURRENT_DATE,
                total_entregas INTEGER DEFAULT 0,
                entregas_sucesso INTEGER DEFAULT 0,
                entregas_falha INTEGER DEFAULT 0,
                distancia_total_km REAL DEFAULT 0,
                custo_total REAL DEFAULT 0,
                tempo_total_minutos REAL DEFAULT 0,
                FOREIGN KEY (projeto_id) REFERENCES projetos (id)
            )
        """)
        
        # Tabela de Snapshots de Sessão para Resumo de Planeamento
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                projeto_id INTEGER NOT NULL,
                utilizador_id INTEGER NOT NULL,
                fase_atual INTEGER DEFAULT 1,
                nome_snapshot TEXT,
                payload_json TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (projeto_id) REFERENCES projetos (id),
                FOREIGN KEY (utilizador_id) REFERENCES utilizadores (id)
            )
        """)
        
        conn.commit()
        print("[DB] Base de dados inicializada com sucesso!")


def hash_password(password):
    """Hash de password com salt"""
    if password.startswith('$2b$') or password.startswith('$2a$') or password.startswith('$2y$'):
        return password
    salt = "georoute2024"  # Em produção, usar salt único por utilizador
    return hashlib.sha256((password + salt).encode()).hexdigest()


def verify_password(password, password_hash):
    """Verificar password"""
    # 1. Tenta hash legacy SHA-256
    if hash_password(password) == password_hash:
        return True
    # 2. Tenta bcrypt
    try:
        import bcrypt
        return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))
    except Exception:
        return False


# ============ EMPRESAS ============

def criar_empresa(nome, email, plano='starter'):
    """Criar nova empresa"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO empresas (nome, email, plano)
            VALUES (?, ?, ?)
        """, (nome, email, plano))
        conn.commit()
        return cursor.lastrowid


def get_empresa(empresa_id):
    """Obter empresa por ID"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM empresas WHERE id = ?", (empresa_id,))
        return cursor.fetchone()


def get_empresa_por_email(email):
    """Obter empresa por email"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM empresas WHERE email = ?", (email,))
        return cursor.fetchone()


# ============ UTILIZADORES ============

def criar_utilizador(empresa_id, nome, email, password, is_admin=False):
    """Criar novo utilizador"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO utilizadores (empresa_id, nome, email, password_hash, is_admin)
            VALUES (?, ?, ?, ?, ?)
        """, (empresa_id, nome, email, hash_password(password), is_admin))
        conn.commit()
        return cursor.lastrowid


def get_utilizador(email):
    """Obter utilizador por email"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM utilizadores WHERE email = ?", (email,))
        return cursor.fetchone()


def get_utilizador_por_id(utilizador_id):
    """Obter utilizador por ID"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM utilizadores WHERE id = ?", (utilizador_id,))
        return cursor.fetchone()


def autenticar(email, password):
    """Autenticar utilizador"""
    user = get_utilizador(email)
    if user and user['is_active']:
        if verify_password(password, user['password_hash']):
            return user
    return None


# ============ PROJETOS ============

def criar_projeto(empresa_id, nome, descricao=''):
    """Criar novo projeto"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO projetos (empresa_id, nome, descricao)
            VALUES (?, ?, ?)
        """, (empresa_id, nome, descricao))
        conn.commit()
        return cursor.lastrowid


def get_projetos(empresa_id):
    """Listar projetos da empresa"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM projetos 
            WHERE empresa_id = ? 
            ORDER BY updated_at DESC
        """, (empresa_id,))
        return cursor.fetchall()


def get_projeto(projeto_id):
    """Obter projeto por ID"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM projetos WHERE id = ?", (projeto_id,))
        return cursor.fetchone()


# ============ ENTREGAS ============

def save_entregas_projeto(projeto_id, entregas_data):
    """Guardar entregas de um projeto"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Apagar entregas existentes
        cursor.execute("DELETE FROM entregas WHERE projeto_id = ?", (projeto_id,))
        
        for e in entregas_data:
            cursor.execute("""
                INSERT INTO entregas (
                    projeto_id, codigo_cliente, morada, codigo_postal, 
                    _concelho, peso_kg, volume_m3, prioridade, janela_inicio, 
                    janela_fim, observacoes, latitude, longitude,
                    nivel_qualidade, fonte_match, morada_encontrada
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                projeto_id, e.get('codigo_cliente'), e.get('morada'),
                e.get('codigo_postal'), e.get('concelho'), e.get('peso_kg'),
                e.get('volume_m3', 0.0), e.get('prioridade'), e.get('janela_inicio'),
                e.get('janela_fim'), e.get('observacoes'), e.get('latitude'),
                e.get('longitude'), e.get('nivel_qualidade'), e.get('fonte_match'),
                e.get('morada_encontrada')
            ))
        
        # Atualizar timestamp do projeto
        cursor.execute("""
            UPDATE projetos SET updated_at = CURRENT_TIMESTAMP WHERE id = ?
        """, (projeto_id,))
        
        conn.commit()


def get_entregas_projeto(projeto_id):
    """Obter entregas de um projeto"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM entregas WHERE projeto_id = ?", (projeto_id,))
        return cursor.fetchall()


# ============ FROTA ============

def save_frota_projeto(projeto_id, frota_data):
    """Guardar frota de um projeto"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Apagar frota existente
        cursor.execute("DELETE FROM frota WHERE projeto_id = ?", (projeto_id,))
        
        for f in frota_data:
            cursor.execute("""
                INSERT INTO frota (
                    projeto_id, veiculo, capacidade_kg, capacidade_volume, custo_km,
                    velocidade_media, horario_inicio, horario_fim
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                projeto_id, f.get('veiculo'), f.get('capacidade_kg'),
                f.get('capacidade_volume', 0.0), f.get('custo_km'),
                f.get('velocidade_media'), f.get('horario_inicio'), f.get('horario_fim')
            ))
        
        conn.commit()


def get_frota_projeto(projeto_id):
    """Obter frota de um projeto"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM frota WHERE projeto_id = ? AND is_active = 1", (projeto_id,))
        return cursor.fetchall()


# ============ LOGS ============

def log_action(empresa_id, acao, detalhes=''):
    """Registar ação do utilizador"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO usage_logs (empresa_id, acao, detalhes)
            VALUES (?, ?, ?)
        """, (empresa_id, acao, detalhes))
        conn.commit()


def get_usage_stats(empresa_id):
    """Obter estatísticas de uso"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Total de entregas processadas
        cursor.execute("""
            SELECT COUNT(*) as total FROM entregas e
            JOIN projetos p ON e.projeto_id = p.id
            WHERE p.empresa_id = ?
        """, (empresa_id,))
        total_entregas = cursor.fetchone()['total']
        
        # Total de projetos
        cursor.execute("""
            SELECT COUNT(*) as total FROM projetos WHERE empresa_id = ?
        """, (empresa_id,))
        total_projetos = cursor.fetchone()['total']
        
        # Atividade recente
        cursor.execute("""
            SELECT * FROM usage_logs 
            WHERE empresa_id = ?
            ORDER BY created_at DESC LIMIT 10
        """, (empresa_id,))
        atividade = cursor.fetchall()
        
        return {
            'total_entregas': total_entregas,
            'total_projetos': total_projetos,
            'atividade': atividade
        }


# ============ MÉTRICAS ============

def save_metricas_projeto(projeto_id, total_entregas, sucesso, falha, distancia_km, custo, tempo_min):
    """Guardar métricas de um projeto"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Verificar se já existem métricas hoje
        cursor.execute("""
            SELECT id FROM metricas_projeto 
            WHERE projeto_id = ? AND data = date('now')
        """, (projeto_id,))
        
        existing = cursor.fetchone()
        
        if existing:
            # Atualizar
            cursor.execute("""
                UPDATE metricas_projeto SET
                    total_entregas = ?,
                    entregas_sucesso = ?,
                    entregas_falha = ?,
                    distancia_total_km = ?,
                    custo_total = ?,
                    tempo_total_minutos = ?
                WHERE id = ?
            """, (total_entregas, sucesso, falha, distancia_km, custo, tempo_min, existing['id']))
        else:
            # Inserir
            cursor.execute("""
                INSERT INTO metricas_projeto (
                    projeto_id, total_entregas, entregas_sucesso, entregas_falha,
                    distancia_total_km, custo_total, tempo_total_minutos
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (projeto_id, total_entregas, sucesso, falha, distancia_km, custo, tempo_min))
        
        conn.commit()


def get_metricas_projeto(projeto_id, dias=30):
    """Obter métricas de um projeto"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM metricas_projeto
            WHERE projeto_id = ?
            ORDER BY data DESC
            LIMIT ?
        """, (projeto_id, dias))
        return cursor.fetchall()


def get_metricas_empresa(empresa_id, dias=30):
    """Obter métricas agregadas de uma empresa"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                SUM(m.total_entregas) as total_entregas,
                SUM(m.entregas_sucesso) as entregas_sucesso,
                SUM(m.entregas_falha) as entregas_falha,
                SUM(m.distancia_total_km) as distancia_total,
                SUM(m.custo_total) as custo_total,
                SUM(m.tempo_total_minutos) as tempo_total
            FROM metricas_projeto m
            JOIN projetos p ON m.projeto_id = p.id
            WHERE p.empresa_id = ?
            AND m.data >= date('now', '-' || ? || ' days')
        """, (empresa_id, dias))
        return cursor.fetchone()


# ============ GOOGLE API CENTRALIZADA ============

def get_google_api_key():
    """Obter API key do Google (configuração global)"""
    return get_config('google_api_key', '')


def set_google_api_key(api_key):
    """Definir API key do Google (só admin)"""
    set_config('google_api_key', api_key, 'API Key do Google Maps para geocoding')


# ============ CONFIGURAÇÕES ============

def get_config(key, default=None):
    """Obter configuração global"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM config WHERE key = ?", (key,))
        row = cursor.fetchone()
        return row['value'] if row else default


def set_config(key, value, description=''):
    """Definir configuração global"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO config (key, value, description, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        """, (key, value, description))
        conn.commit()


# ============ PLANOS E LIMITES ============

PLANOS = {
    'starter': {
        'nome': 'Starter',
        'limite_entregas_mes': 100,
        'limite_utilizadores': 1,
        'limite_projetos': 3,
        'preco': 29,
        'funcionalidades': ['geocoding', 'otimizacao', 'export_excel']
    },
    'pro': {
        'nome': 'Pro',
        'limite_entregas_mes': 1000,
        'limite_utilizadores': 5,
        'limite_projetos': 20,
        'preco': 79,
        'funcionalidades': ['geocoding', 'otimizacao', 'export_excel', 'export_pdf', 'mapas_interativos']
    },
    'enterprise': {
        'nome': 'Enterprise',
        'limite_entregas_mes': 10000,
        'limite_utilizadores': 999,
        'limite_projetos': 999,
        'preco': 199,
        'funcionalidades': ['geocoding', 'otimizacao', 'export_excel', 'export_pdf', 'mapas_interativos', 'api', 'suporte']
    }
}


def check_plano_limites(empresa_id, acao='entregas'):
    """Verificar se a empresa pode executar a ação (dentro dos limites)"""
    empresa = get_empresa(empresa_id)
    if not empresa:
        return False, "Empresa não encontrada"
    
    plano = empresa['plano']
    config = PLANOS.get(plano, PLANOS['starter'])
    
    # Obter uso atual no mês
    metricas = get_metricas_empresa(empresa_id, dias=30)
    entregas_usadas = metricas['total_entregas'] or 0
    
    if acao == 'entregas':
        limite = config['limite_entregas_mes']
        if entregas_usadas >= limite:
            return False, f"Limite de {limite} entregas/mês atingido no plano {config['nome']}"
    
    return True, "OK"


def get_plano_info(plano):
    """Obter informações de um plano"""
    return PLANOS.get(plano, PLANOS['starter'])


# ============ ADMIN ============

def get_all_empresas():
    """Listar todas as empresas (admin)"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM empresas ORDER BY created_at DESC")
        return cursor.fetchall()


def get_all_utilizadores():
    """Listar todos os utilizadores (admin)"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT u.*, e.nome as empresa_nome 
            FROM utilizadores u
            JOIN empresas e ON u.empresa_id = e.id
            ORDER BY u.created_at DESC
        """)
        return cursor.fetchall()


def update_empresa_plano(empresa_id, plano):
    """Atualizar plano da empresa"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE empresas SET plano = ? WHERE id = ?", (plano, empresa_id))
        conn.commit()


# ============ SEED DATA ============

def create_demo_account():
    """Criar conta demonstração"""
    # Criar empresa demo
    empresa_id = criar_empresa("Empresa Demo", "demo@georoute.pt", "starter")
    
    # Criar utilizador admin
    criar_utilizador(empresa_id, "Admin Demo", "demo@georoute.pt", "demo123", is_admin=True)
    
    # Criar projeto demo
    projeto_id = criar_projeto(empresa_id, "Projeto Demo", "Projeto de demonstração")
    
    print(f"[DEMO] Empresa criada: demo@georoute.pt / demo123")
    return empresa_id, projeto_id


if __name__ == "__main__":
    # Inicializar base de dados
    init_database()
    
    # Criar conta demo se não existir
    empresa = get_empresa_por_email("demo@georoute.pt")
    if not empresa:
        create_demo_account()
    else:
        print("[DEMO] Conta demo já existe")
