"""
Compatibilidade: fonte única de verdade consolidada em `database.py` na raiz do projeto.
Este módulo redireciona todas as importações para evitar divergência entre cópias.
"""
from database import *  # noqa: F401, F403
