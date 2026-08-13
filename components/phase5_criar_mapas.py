import streamlit as st
import pandas as pd
import folium
from streamlit_folium import st_folium
import json
import requests

def render_criar_mapas():
    st.header("Criar Mapas Personalizados")
    
    st.write("Importe a sua lista de Códigos Postais (CP4 ou CP7) e defina zonas e cores.")
    
    # 1. Gestão de Zonas e Cores
    st.subheader("1. Definição de Zonas")
    if "zonas" not in st.session_state:
        st.session_state.zonas = []
        
    with st.form("form_zonas"):
        col1, col2 = st.columns(2)
        with col1:
            nova_zona = st.text_input("Nome da Zona (ex: Zona Norte)")
        with col2:
            nova_cor = st.color_picker("Cor da Zona", "#ff0000")
            
        submitted = st.form_submit_button("Adicionar Zona")
        if submitted and nova_zona:
            st.session_state.zonas.append({"nome": nova_zona, "cor": nova_cor})
            st.success(f"Zona {nova_zona} adicionada!")
            
    if st.session_state.zonas:
        st.write("Zonas atuais:")
        for z in st.session_state.zonas:
            st.markdown(f"- **{z['nome']}** (Cor: <span style='color:{z['cor']}'>{z['cor']}</span>)", unsafe_allow_html=True)
            
    # 2. Importar CPs
    st.subheader("2. Lista de Códigos Postais")
    uploaded_file = st.file_uploader("Importar CPs via Excel", type=["xlsx", "xls"])
    
    df_cps = pd.DataFrame(columns=["CP", "Zona"])
    if uploaded_file is not None:
        df_cps = pd.read_excel(uploaded_file)
        st.write("Pré-visualização dos dados importados:")
        st.dataframe(df_cps)
        
    # 3. Mapa (Placeholder for prototype)
    st.subheader("3. Mapa de Zonas")
    st.write("O mapa abaixo será preenchido com as cores das zonas atribuídas aos Códigos Postais.")
    m = folium.Map(location=[39.3999, -8.2245], zoom_start=6)
    
    # Aqui entrará a lógica futura de carregar o GeoJSON e colorir as áreas
    
    st_folium(m, width=700, height=500)
    
    # 4. Exportar
    st.subheader("4. Exportar")
    if st.button("Exportar para Excel e PDF"):
        st.info("A gerar ficheiros... (Funcionalidade em desenvolvimento)")

if __name__ == '__main__':
    render_criar_mapas()
