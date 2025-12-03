"""
Manual Correction UI Component

Streamlit component for manually correcting failed geocoding addresses.
Provides fuzzy matching suggestions from the database.
"""

import streamlit as st
import pandas as pd
from typing import List, Dict, Tuple
from rapidfuzz import process, fuzz


class ManualCorrectionUI:
    """UI component for manual address correction"""
    
    def __init__(self, geocoder):
        """
        Initialize the manual correction UI.
        
        Args:
            geocoder: WaterfallGeocoder instance for re-geocoding
        """
        self.geocoder = geocoder
    
    def show_correction_interface(self, failed_clients: pd.DataFrame) -> Tuple[bool, List[Dict]]:
        """
        Displays the manual correction interface for failed clients.
        
        Args:
            failed_clients: DataFrame with clients that failed geocoding
            
        Returns:
            Tuple of (corrections_complete: bool, corrected_results: List[Dict])
        """
        st.markdown("### 🔧 Correção Manual de Endereços")
        st.info(f"**{len(failed_clients)} cliente(s)** necessitam de correção manual.")
        
        # Initialize session state for corrections
        if 'corrections' not in st.session_state:
            st.session_state.corrections = {}
            st.session_state.current_correction_index = 0
            st.session_state.corrected_results = []
        
        # Progress indicator
        total = len(failed_clients)
        current = st.session_state.current_correction_index
        
        if current >= total:
            st.success("✅ Todas as correções foram processadas!")
            
            # Show summary
            st.markdown("#### Resumo das Correções")
            success_count = sum(1 for r in st.session_state.corrected_results if r.get('nivel', 8) < 8)
            st.metric("Corrigidos com sucesso", f"{success_count}/{total}")
            
            # Buttons to proceed or retry
            col1, col2 = st.columns(2)
            with col1:
                if st.button("✅ Continuar para Otimização"):
                    return True, st.session_state.corrected_results
            with col2:
                if st.button("🔄 Revisar Correções"):
                    st.session_state.current_correction_index = 0
                    st.rerun()
            
            return False, []
        
        # Show progress
        progress = current / total
        st.progress(progress, text=f"Cliente {current + 1} de {total}")
        
        # Get current client
        client_row = failed_clients.iloc[current]
        
        # Display client info
        st.markdown(f"#### Cliente: {client_row.get('Codigo_Cliente', 'N/A')}")
        
        # Create form for correction
        with st.form(key=f"correction_form_{current}"):
            col1, col2 = st.columns([2, 1])
            
            with col1:
                st.markdown("**Dados Originais:**")
                original_morada = str(client_row.get('Morada', ''))
                original_cp = str(client_row.get('Codigo_Postal', ''))
                original_concelho = str(client_row.get('Concelho', ''))
                
                st.text(f"Morada: {original_morada}")
                st.text(f"CP: {original_cp}")
                st.text(f"Concelho: {original_concelho}")
            
            with col2:
                # Show failure reason
                st.markdown("**Motivo da Falha:**")
                from .failure_handler import GeocodingFailureHandler
                reason = GeocodingFailureHandler._get_failure_reason(client_row)
                st.warning(reason)
            
            st.markdown("---")
            st.markdown("**Correção:**")
            
            # Input fields for correction
            col1, col2 = st.columns(2)
            
            with col1:
                new_morada = st.text_input(
                    "Morada",
                    value=original_morada if original_morada not in ['nan', 'None', ''] else '',
                    key=f"morada_{current}"
                )
                
                new_cp = st.text_input(
                    "Código Postal (CP4 ou CP7)",
                    value=original_cp if original_cp not in ['nan', 'None', ''] else '',
                    placeholder="1000-001",
                    key=f"cp_{current}"
                )
            
            with col2:
                new_concelho = st.text_input(
                    "Concelho",
                    value=original_concelho if original_concelho not in ['nan', 'None', ''] else '',
                    key=f"concelho_{current}"
                )
            
            # Show suggestions from database
            if new_morada or new_cp:
                suggestions = self._get_suggestions(new_morada, new_cp, new_concelho)
                if suggestions:
                    st.markdown("**💡 Sugestões da Base de Dados:**")
                    
                    selected_suggestion = st.radio(
                        "Selecione uma sugestão ou continue com os dados inseridos:",
                        options=['Usar dados inseridos'] + [s['display'] for s in suggestions],
                        key=f"suggestion_{current}"
                    )
                    
                    # If a suggestion is selected, update the fields
                    if selected_suggestion != 'Usar dados inseridos':
                        for s in suggestions:
                            if s['display'] == selected_suggestion:
                                new_morada = s['morada']
                                new_cp = s['cp']
                                new_concelho = s['concelho']
                                st.info(f"✓ Usando sugestão: {selected_suggestion}")
                                break
            
            # Form buttons
            col1, col2, col3 = st.columns(3)
            
            with col1:
                test_button = st.form_submit_button("🧪 Testar Geocoding", use_container_width=True)
            
            with col2:
                save_button = st.form_submit_button("💾 Guardar e Próximo", use_container_width=True, type="primary")
            
            with col3:
                skip_button = st.form_submit_button("⏭️ Saltar", use_container_width=True)
        
        # Handle form actions
        if test_button:
            self._test_geocoding(new_morada, new_cp, new_concelho)
        
        if save_button:
            result = self._save_and_geocode(client_row, new_morada, new_cp, new_concelho)
            st.session_state.corrected_results.append(result)
            st.session_state.current_correction_index += 1
            st.rerun()
        
        if skip_button:
            # Keep original failed result
            result = {
                'codigo_cliente': client_row.get('Codigo_Cliente', 'N/A'),
                'lat': None,
                'lon': None,
                'morada_encontrada': '',
                'nivel': 8,
                'fonte': 'SKIPPED',
                'score': 0
            }
            st.session_state.corrected_results.append(result)
            st.session_state.current_correction_index += 1
            st.rerun()
        
        return False, []
    
    def _get_suggestions(self, morada: str, cp: str, concelho: str, limit: int = 5) -> List[Dict]:
        """
        Gets address suggestions from the database using fuzzy matching.
        
        Args:
            morada: Address string
            cp: Postal code
            concelho: Municipality
            limit: Maximum number of suggestions
            
        Returns:
            List of suggestion dictionaries
        """
        try:
            conn = self.geocoder._get_db_connection()
            cursor = conn.cursor()
            
            # Build query based on available data
            query_parts = []
            params = []
            
            if cp and len(cp.replace('-', '')) >= 4:
                cp4 = cp.replace('-', '')[:4]
                query_parts.append("cp4 = ?")
                params.append(cp4)
            
            if concelho:
                query_parts.append("LOWER(concelho) LIKE ?")
                params.append(f"%{concelho.lower()}%")
            
            if not query_parts:
                return []
            
            query = f"""
                SELECT DISTINCT morada, cp4, cp7, concelho, lat, lon
                FROM geocoding_cache
                WHERE {' AND '.join(query_parts)}
                AND lat IS NOT NULL
                LIMIT 50
            """
            
            cursor.execute(query, params)
            results = cursor.fetchall()
            conn.close()
            
            if not results:
                return []
            
            # If we have a morada, use fuzzy matching to rank results
            suggestions = []
            for row in results:
                db_morada, db_cp4, db_cp7, db_concelho, db_lat, db_lon = row
                
                # Calculate similarity score if morada is provided
                if morada:
                    score = fuzz.ratio(morada.lower(), db_morada.lower())
                else:
                    score = 50  # Default score if no morada
                
                cp_display = db_cp7 if db_cp7 else db_cp4
                
                suggestions.append({
                    'morada': db_morada,
                    'cp': cp_display,
                    'concelho': db_concelho,
                    'lat': db_lat,
                    'lon': db_lon,
                    'score': score,
                    'display': f"{db_morada}, {cp_display} {db_concelho}"
                })
            
            # Sort by score and return top results
            suggestions.sort(key=lambda x: x['score'], reverse=True)
            return suggestions[:limit]
            
        except Exception as e:
            st.error(f"Erro ao buscar sugestões: {str(e)}")
            return []
    
    def _test_geocoding(self, morada: str, cp: str, concelho: str):
        """Tests geocoding with the provided data."""
        with st.spinner("Testando geocoding..."):
            try:
                cp4 = cp.replace('-', '')[:4] if cp else None
                result, _ = self.geocoder.resolve_address(morada, cp4, concelho)
                
                if result['nivel'] < 8:
                    st.success(f"✅ Geocoding bem-sucedido! Nível {result['nivel']}")
                    st.info(f"📍 Morada encontrada: {result['morada_encontrada']}")
                    st.info(f"🌍 Coordenadas: {result['lat']:.6f}, {result['lon']:.6f}")
                    st.info(f"📊 Fonte: {result['fonte']} | Score: {result['score']}")
                else:
                    st.error("❌ Geocoding falhou. Verifique os dados e tente novamente.")
                    
            except Exception as e:
                st.error(f"Erro ao testar geocoding: {str(e)}")
    
    def _save_and_geocode(self, original_row: pd.Series, morada: str, 
                         cp: str, concelho: str) -> Dict:
        """Saves the correction and performs geocoding."""
        try:
            cp4 = cp.replace('-', '')[:4] if cp else None
            result, learned = self.geocoder.resolve_address(morada, cp4, concelho)
            
            # Add original client code to result
            result['codigo_cliente'] = original_row.get('Codigo_Cliente', 'N/A')
            
            # Save learned data if available
            if learned:
                self.geocoder.save_learned_batch([learned])
            
            return result
            
        except Exception as e:
            st.error(f"Erro ao guardar correção: {str(e)}")
            return {
                'codigo_cliente': original_row.get('Codigo_Cliente', 'N/A'),
                'lat': None,
                'lon': None,
                'morada_encontrada': '',
                'nivel': 8,
                'fonte': 'ERROR',
                'score': 0
            }
    
    @staticmethod
    def reset_correction_state():
        """Resets the correction session state."""
        if 'corrections' in st.session_state:
            del st.session_state.corrections
        if 'current_correction_index' in st.session_state:
            del st.session_state.current_correction_index
        if 'corrected_results' in st.session_state:
            del st.session_state.corrected_results
