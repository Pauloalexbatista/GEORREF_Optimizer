import requests
import re
import time
import random

# Headers to mimic a real browser
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7'
}

def scrape_cp_data(cp4, cp3):
    """
    Scrapes data from codigo-postal.pt for a given CP4-CP3.
    Returns a dict with {lat, lon, address, localidade, concelho, distrito} or None.
    """
    url = f"https://www.codigo-postal.pt/?cp4={cp4}&cp3={cp3}"
    
    try:
        # Random delay to be polite (1.5 to 3 seconds)
        time.sleep(random.uniform(1.5, 3.0))
        
        response = requests.get(url, headers=HEADERS, timeout=10)
        
        if response.status_code != 200:
            print(f"Web Scraper Error: Status {response.status_code} for {url}")
            return None
            
        html = response.text
        with open("debug_scraper.html", "w", encoding="utf-8") as f:
            f.write(html)
        print("Saved HTML to debug_scraper.html")
        
        # Regex to find GPS coordinates (Format: 37.953458,-8.187872)
        # Looking for pattern: digits.digits, -digits.digits
        # They appear before <a class='search-title'
        
        # This regex looks for the GPS pattern specifically
        # Regex to find GPS coordinates (Format: 37.953458,-8.187872)
        # The HTML has: <span class='pull-right gps'> <b>GPS:</b> 37.953458,-8.187872 </span>
        gps_match = re.search(r'GPS:</b>\s*(\d+\.\d+),\s*(-?\d+\.\d+)', html)
        
        # Extract Address (Title of the search result)
        # <a href='...' class='search-title'>ADDRESS</a>
        # We use a flexible regex to handle attribute order and newlines
        address_match = re.search(r"<a\s+[^>]*class=['\"]search-title['\"][^>]*>(.*?)</a>", html, re.DOTALL | re.IGNORECASE)
        
        if gps_match:
            print(f"DEBUG: Found GPS: {gps_match.group(1)}, {gps_match.group(2)}")
        else:
            print("DEBUG: GPS not found")

        if address_match:
            print(f"DEBUG: Found Address: {address_match.group(1).strip()}")
        else:
            print("DEBUG: Address not found")

        if gps_match and address_match:
            lat = float(gps_match.group(1))
            lon = float(gps_match.group(2))
            address = address_match.group(1).strip()
            
            # Basic validation of coordinates (Portugal bounds)
            if 36.0 <= lat <= 42.5 and -10.0 <= lon <= -6.0:
                return {
                    'lat': lat,
                    'lon': lon,
                    'address': address,
                    'source': 'WEB_SCRAPING',
                    'quality_level': 1, # High confidence if we found the exact CP page
                    'match_type': 'EXACT_CP_WEB'
                }
                
        return None
        
    except Exception as e:
        print(f"Web Scraper Exception: {e}")
        return None

# Test block
if __name__ == "__main__":
    print("Testing Scraper for 7600-401...")
    result = scrape_cp_data("7600", "401")
    print(result)
