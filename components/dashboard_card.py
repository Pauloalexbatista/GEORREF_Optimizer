import streamlit as st

def render_dashboard_card(module):
    """
    Renders a dashboard card.
    Since we can't easily make a whole HTML div clickable in Streamlit to trigger a python callback,
    we will use a native st.button but style it to look like a card, 
    OR we use a container with a button inside.
    
    For best visual results matching the 'Bolas Mágicas' style, we'll use a container with custom markdown 
    for the visual part, and a button below (or covering) for the action.
    
    However, to keep it simple and functional:
    We will use a st.button with a unique key, and use CSS to style that specific button 
    to look like a big card.
    """
    
    # We'll use a trick: Create a button that fills the container, 
    # and inject CSS to make that specific button look like the card.
    # But Streamlit buttons don't support HTML content inside easily.
    
    # Alternative: Use a container with a button at the bottom "Entrar".
    
    with st.container():
        # Visual Header
        badge_html = f'<div style="text-align: right;"><span style="background-color: #f0c14b; color: #0f2027; padding: 2px 8px; border-radius: 4px; font-size: 0.7em; font-weight: bold;">{module["tier"].upper()}</span></div>' if module['tier'] != 'free' else '<div style="height: 20px;"></div>'
        
        st.markdown(f"""
        <div class="dashboard-card {'inactive' if not module['active'] else ''}">
            {badge_html}
            <div class="card-icon">{module['icon']}</div>
            <div class="card-title">{module['title']}</div>
            <div class="card-desc">{module['description']}</div>
        </div>
        """, unsafe_allow_html=True)
        
        # Action Button
        disabled = not module['active']
        if st.button(f"Abrir {module['title']}", key=f"btn_{module['id']}", disabled=disabled, use_container_width=True):
            return True
            
    return False
