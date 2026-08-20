import requests
import re

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7"
}

_session = requests.Session()
_session.headers.update(HEADERS)

def scrape_cp_data(cp4, cp3):
    url = f"https://www.codigo-postal.pt/?cp4={cp4}&cp3={cp3}"
    try:
        response = _session.get(url, timeout=2.5)
        if response.status_code != 200:
            return None
            
        html = response.text
        
        gps_match = re.search(r"GPS:</b>\s*([0-9.]+),\s*(-?[0-9.]+)", html)
        address_match = re.search(r"search-title[^>]*>(.*?)</a>", html, re.DOTALL | re.IGNORECASE)
        
        if gps_match and address_match:
            lat = float(gps_match.group(1))
            lon = float(gps_match.group(2))
            address = address_match.group(1).strip()
            
            if 36.0 <= lat <= 42.5 and -10.0 <= lon <= -6.0:
                return {
                    "lat": lat,
                    "lon": lon,
                    "address": address,
                    "source": "WEB_SCRAPING",
                    "quality_level": 1,
                    "match_type": "EXACT_CP_WEB"
                }
        return None
    except Exception:
        return None
