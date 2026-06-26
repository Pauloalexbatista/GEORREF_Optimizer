"""
Gestor de Servidor GeoRoute Pro
Permite iniciar, parar e gerir o servidor Streamlit
"""
import os
import sys
import subprocess
import signal
import time

# Porta padrão
DEFAULT_PORT = 8503

# Ficheiros de lock
PID_FILE = 'georoute.pid'
LOG_FILE = 'georoute.log'


def get_pid():
    """Obter PID do processo"""
    if os.path.exists(PID_FILE):
        with open(PID_FILE, 'r') as f:
            return int(f.read().strip())
    return None


def save_pid(pid):
    """Guardar PID"""
    with open(PID_FILE, 'w') as f:
        f.write(str(pid))


def is_running():
    """Verificar se o servidor está a correr"""
    pid = get_pid()
    if pid:
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            # Processo não existe
            if os.path.exists(PID_FILE):
                os.remove(PID_FILE)
    return False


def start_server(port=DEFAULT_PORT, headless=True):
    """Iniciar o servidor"""
    if is_running():
        pid = get_pid()
        print(f"[ERRO] Servidor já está a correr (PID: {pid})")
        return False
    
    print(f"[INFO] A iniciar servidor na porta {port}...")
    
    # Construir comando
    cmd = [
        sys.executable, "-m", "streamlit", "run", "app.py",
        "--server.port", str(port),
        "--server.headless", "true" if headless else "false",
        "--server.enableCORS", "false"
    ]
    
    # Iniciar processo
    log = open(LOG_FILE, 'w')
    proc = subprocess.Popen(
        cmd,
        stdout=log,
        stderr=subprocess.STDOUT,
        cwd=os.path.dirname(os.path.abspath(__file__))
    )
    
    # Guardar PID
    save_pid(proc.pid)
    
    # Esperar um pouco e verificar se iniciou
    time.sleep(3)
    
    if is_running():
        print(f"[OK] Servidor iniciado com sucesso!")
        print(f"[OK] PID: {proc.pid}")
        print(f"[OK] Acesse: http://localhost:{port}")
        return True
    else:
        print("[ERRO] Falha ao iniciar servidor")
        return False


def stop_server():
    """Parar o servidor"""
    if not is_running():
        print("[INFO] Servidor não está a correr")
        return True
    
    pid = get_pid()
    print(f"[INFO] A parar servidor (PID: {pid})...")
    
    try:
        os.kill(pid, signal.SIGTERM)
        time.sleep(2)
        
        # Verificar se parou
        try:
            os.kill(pid, 0)
            # Ainda está a correr, forçar
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
        
        if os.path.exists(PID_FILE):
            os.remove(PID_FILE)
        
        print("[OK] Servidor parado com sucesso")
        return True
    except Exception as e:
        print(f"[ERRO] Erro ao parar servidor: {e}")
        return False


def restart_server(port=DEFAULT_PORT):
    """Reiniciar o servidor"""
    print("[INFO] A reiniciar servidor...")
    stop_server()
    time.sleep(2)
    return start_server(port)


def status_server():
    """Ver estado do servidor"""
    if is_running():
        pid = get_pid()
        print(f"[OK] Servidor está a correr (PID: {pid})")
        print(f"[OK] Acesse: http://localhost:{DEFAULT_PORT}")
        return True
    else:
        print("[INFO] Servidor não está a correr")
        return False


def clean_ports():
    """Limpar portas em uso"""
    print("[INFO] A verificar portas...")
    import socket
    for port in [8501, 8502, 8503, 8510, 8520]:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            result = s.connect_ex(('127.0.0.1', port))
            if result == 0:
                print(f"[WARN] Porta {port} está em uso")
            s.close()
        except:
            pass
    print("[OK] Verificação concluída")


def main():
    """Menu principal"""
    if len(sys.argv) < 2:
        print("""
╔═══════════════════════════════════════════════════════════╗
║         GeoRoute Pro - Gestor de Servidor               ║
╠═══════════════════════════════════════════════════════════╣
║  Uso: python server.py <comando>                       ║
║                                                           ║
║  Comandos:                                               ║
║    start    - Iniciar servidor                          ║
║    stop     - Parar servidor                            ║
║    restart  - Reiniciar servidor                         ║
║    status   - Ver estado do servidor                     ║
║    clean    - Limpar processos e portas                 ║
╚═══════════════════════════════════════════════════════════╝
        """)
        sys.exit(1)
    
    cmd = sys.argv[1].lower()
    
    if cmd == "start":
        port = int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_PORT
        start_server(port)
    elif cmd == "stop":
        stop_server()
    elif cmd == "restart":
        port = int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_PORT
        restart_server(port)
    elif cmd == "status":
        status_server()
    elif cmd == "clean":
        stop_server()
        clean_ports()
    else:
        print(f"[ERRO] Comando desconhecido: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
