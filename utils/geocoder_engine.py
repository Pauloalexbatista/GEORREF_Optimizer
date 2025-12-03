import sqlite3
import time
from rapidfuzz import process, fuzz
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut
import googlemaps
from datetime import datetime
from .validation import is_in_portugal, validate_cp4
from .cp_scraper import scrape_cp_data
from .cp_scraper import scrape_cp_data
import re
import json
import os

USAGE_FILE = 'config/usage.json'
LOG_FILE = 'config/google_api_log.csv'

class GoogleGeoHandler:
    def __init__(self, api_key):
        self.api_key = api_key
        self.client = googlemaps.Client(key=api_key) if api_key else None

    def check_budget(self):
        """Checks if we are within the budget limit."""
        if not os.path.exists(USAGE_FILE):
            return True # No file, assume safe or create one
        
        try:
            with open(USAGE_FILE, 'r') as f:
                data = json.load(f)
            
            # Reset if new month (Simple check)
            current_month = datetime.now().strftime("%Y-%m")
            if data.get('current_month') != current_month:
                data['current_month'] = current_month
                data['count'] = 0
                with open(USAGE_FILE, 'w') as f:
                    json.dump(data, f, indent=4)
                return True

            if data['count'] >= data['limit']:
                print(f"[AVISO] Google Budget Limit Reached: {data['count']}/{data['limit']}")
                return False
            
            return True
        except Exception as e:
            print(f"Error checking budget: {e}")
            return True # Fail open or closed? Let's fail open but log.

    def update_usage(self):
        """Increments the usage counter."""
        if not os.path.exists(USAGE_FILE): return
        
        try:
            with open(USAGE_FILE, 'r') as f:
                data = json.load(f)
            
            data['count'] += 1
            data['total_all_time'] = data.get('total_all_time', 0) + 1
            
            with open(USAGE_FILE, 'w') as f:
                json.dump(data, f, indent=4)
        except Exception as e:
            print(f"Error updating usage: {e}")

    def log_transaction(self, address, status, cost=1):
        """Logs a transaction to the CSV file."""
        try:
            # Create file with header if it doesn't exist
            if not os.path.exists(LOG_FILE):
                with open(LOG_FILE, 'w', encoding='utf-8') as f:
                    f.write("Timestamp,Address,Status,Cost\n")
            
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            # Escape commas in address to avoid breaking CSV
            safe_address = f'"{address}"' if ',' in address else address
            
            with open(LOG_FILE, 'a', encoding='utf-8') as f:
                f.write(f"{timestamp},{safe_address},{status},{cost}\n")
                
        except Exception as e:
            print(f"Error logging transaction: {e}")

    def geocode(self, address, components=None):
        if not self.client: return None
        if not self.check_budget(): return None
        
        try:
            results = self.client.geocode(address, components=components)
            
            if results:
                self.update_usage() # Only count if request was made and successful (or at least returned something)
                self.log_transaction(address, "SUCCESS", 1)
                return results
            else:
                # Even if no results, Google might charge? Usually Zero Results is free or cheap, 
                # but let's log it as ZERO_RESULTS.
                self.log_transaction(address, "ZERO_RESULTS", 1) # Assuming it counts towards quota
                self.update_usage()
                return None
                
        except Exception as e:
            print(f"Google API Error: {e}")
            self.log_transaction(address, f"ERROR: {str(e)}", 0)
            return None

class WaterfallGeocoder:
    def __init__(self, db_path, google_api_key=None):
        self.db_path = db_path
        self.google_api_key = google_api_key
        # self.gmaps = googlemaps.Client(key=google_api_key) if google_api_key else None
        self.google_handler = GoogleGeoHandler(google_api_key)
        self.nominatim = Nominatim(user_agent="antigravity_geo_app_v4")

    def _get_db_connection(self):
        return sqlite3.connect(self.db_path)

    def resolve_address(self, address, cp4=None, concelho=None):
        """
        Main entry point for geocoding.
        Returns a tuple: (result_dict, learned_data_dict_or_None)
        """
        result = None
        learned_data = None
        
        # 0. Smart Cleaning
        address = self._clean_address(address)
        
        # --- LEVEL 1: LOCAL DATABASE ---
        result = self._try_local(address, cp4, concelho)
        
        # If Local is perfect (Level 1 or 2), we stop here.
        if result and result['quality_level'] <= 2:
            return result, None
            
        # Initialize best_result with what we have (even if None)
        best_result = result
        current_quality = result['quality_level'] if result else 8 # 8 is worst
        
        # --- LEVEL 1.5: WEB SCRAPER (CP7) ---
        # Try this if we have a full CP7 (xxxx-xxx) and local failed or is poor quality
        # This is slow, so we only do it if we really have a CP7 candidate
        if current_quality > 2 and cp4 and re.match(r'^\d{4}-\d{3}$', str(cp4)):
            cp4_part, cp3_part = str(cp4).split('-')
            result_web = self._try_web_scraper(cp4_part, cp3_part)
            
            if result_web:
                web_quality = result_web['quality_level']
                if web_quality < current_quality:
                    best_result = result_web
                    current_quality = web_quality
                    # Queue for saving
                    learned_data = {
                        'address': result_web['address'], # Use the address from web
                        'result': result_web,
                        'cp4': cp4,
                        'concelho': concelho
                    }

        # --- LEVEL 2: OPENSTREETMAP (OSM) ---
        # Only try if current quality is not good enough (e.g. > 2)
        if current_quality > 2:
            result_osm = self._try_nominatim(address, cp4, concelho)
            
            if result_osm:
                osm_quality = result_osm['quality_level']
                # ONLY UPDATE IF BETTER (Lower Level is Better)
                if osm_quality < current_quality:
                    best_result = result_osm
                    current_quality = osm_quality
                    # Queue for saving
                    learned_data = {
                        'address': address,
                        'result': result_osm,
                        'cp4': cp4,
                        'concelho': concelho
                    }

        # --- LEVEL 3: GOOGLE MAPS ---
        # Only try if we still don't have a good result (e.g. > 2) AND we have a key
        if self.google_handler.client and current_quality > 2:
            result_google = self._try_google(address, cp4, concelho)
            
            if result_google:
                google_quality = result_google['quality_level']
                # ONLY UPDATE IF BETTER
                if google_quality < current_quality:
                    best_result = result_google
                    current_quality = google_quality
                    # Overwrite learned data with better Google result
                    learned_data = {
                        'address': address,
                        'result': result_google,
                        'cp4': cp4,
                        'concelho': concelho
                    }

        final_result = best_result if best_result else {'quality_level': 8, 'source': 'FAILED', 'score': 0, 'lat': None, 'lon': None, 'address': None}
        return final_result, learned_data

    def save_learned_batch(self, learned_list):
        """
        Saves a list of learned addresses to the database in a single transaction.
        """
        if not learned_list: return
        
        conn = self._get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("BEGIN TRANSACTION")
            query = """
                INSERT INTO pt_addresses 
                (full_street, LATITUDE, LONGITUDE, CP4, cc_desig, quality_score, match_type, source, google_place_id, last_validated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """
            data_to_insert = []
            for item in learned_list:
                res = item['result']
                data_to_insert.append((
                    res['address'], 
                    res['lat'], 
                    res['lon'], 
                    str(item['cp4']).split('-')[0] if item['cp4'] else '', 
                    item['concelho'] if item['concelho'] else '',
                    res['quality_level'],
                    res['match_type'],
                    res['source'],
                    res.get('google_place_id'),
                    datetime.now()
                ))
            
            cursor.executemany(query, data_to_insert)
            conn.commit()
            print(f"Batch saved {len(learned_list)} new addresses.")
        except Exception as e:
            conn.rollback()
            print(f"Error saving batch to DB: {e}")
        finally:
            conn.close()

    def _try_local(self, address, cp4, concelho):
        conn = self._get_db_connection()
        cursor = conn.cursor()
        
        candidates = []
        
        # Strategy: Filter by CP4 first (very fast)
        # Strategy: Filter by CP4 first (very fast)
        if cp4 and validate_cp4(cp4):
            # 1. Try Strict Match (CP4 + Concelho)
            query = "SELECT full_street, LATITUDE, LONGITUDE, CP4, quality_score FROM pt_addresses WHERE CP4 = ?"
            params = [str(cp4).split('-')[0]]
            
            if concelho:
                # Use LIKE for case-insensitivity and % for trailing spaces
                # Or better: UPPER(TRIM(cc_desig))
                query_strict = query + " AND UPPER(TRIM(cc_desig)) = ?"
                params_strict = params + [concelho.upper().strip()]
                
                cursor.execute(query_strict, params_strict)
                candidates = cursor.fetchall()
                
                # FALLBACK: If strict match fails, try ignoring Concelho (trust CP4)
                if not candidates:
                    # print(f"Strict match failed for {concelho}. Retrying with CP4 only...")
                    cursor.execute(query, params)
                    candidates = cursor.fetchall()
            else:
                cursor.execute(query, params)
                candidates = cursor.fetchall()
            
        if not candidates:
            conn.close()
            return None

        # Fuzzy Match
        choices = [c[0] for c in candidates]
        match = process.extractOne(address, choices, scorer=fuzz.token_set_ratio)
        
        conn.close()
        
        if match:
            best_address, score, idx = match
            row = candidates[idx]
            
            # Determine Quality Level (1-8 Scale)
            quality = 8 # Default Fail
            
            if score >= 95: quality = 1
            elif score >= 85: quality = 2
            elif score >= 70: quality = 4 # CP4 level confidence
            elif score >= 50: quality = 5 # Locality/Approx
            else: quality = 8
            
            if quality == 8: 
                # FALLBACK: We found the CP4, so even if the street name doesn't match well,
                # we can return a Level 4 (CP4 Centroid/Approx) result.
                return {
                    'lat': row[1],
                    'lon': row[2],
                    'address': row[0], # Return the DB address as reference
                    'score': score,
                    'quality_level': 4, # Force Level 4 because CP4 is valid
                    'source': 'LOCAL',
                    'match_type': 'CP4_FALLBACK'
                }
            
            return {
                'lat': row[1],
                'lon': row[2],
                'address': row[0],
                'score': score,
                'quality_level': quality,
                'source': 'LOCAL',
                'match_type': 'FUZZY'
            }
        return None

    def _try_nominatim(self, address, cp4, concelho):
        try:
            query = f"{address}, Portugal"
            if cp4: query = f"{address}, {cp4}, Portugal"
            
            location = self.nominatim.geocode(query, timeout=5, addressdetails=True)
            if location:
                # Validate bounds
                if not is_in_portugal(location.latitude, location.longitude):
                    return None
                
                # Determine Level based on OSM 'type' or 'class'
                raw = location.raw
                add_details = raw.get('address', {})
                
                quality = 5 # Default Locality
                
                if 'house_number' in add_details: quality = 1
                elif 'road' in add_details and 'postcode' in add_details: quality = 2
                elif 'road' in add_details: quality = 2
                elif 'postcode' in add_details: quality = 4
                elif 'city' in add_details or 'town' in add_details or 'village' in add_details: quality = 5
                elif 'county' in add_details or 'municipality' in add_details: quality = 6
                elif 'state' in add_details or 'region' in add_details: quality = 7
                
                return {
                    'lat': location.latitude,
                    'lon': location.longitude,
                    'address': location.address,
                    'score': 100, 
                    'quality_level': quality,
                    'source': 'OSM',
                    'match_type': raw.get('type', 'unknown')
                }
            time.sleep(1.1) # Respect rate limit
        except Exception as e:
            print(f"Nominatim error: {e}")
        return None

    def _try_google(self, address, cp4, concelho):
        try:
            components = {'country': 'PT'}
            if cp4: components['postal_code'] = cp4
            if concelho: components['administrative_area'] = concelho
            
            # Google Geocoding
            # results = self.gmaps.geocode(address, components=components)
            results = self.google_handler.geocode(address, components=components)
            
            if results:
                res = results[0]
                loc = res['geometry']['location']
                match_type = res['geometry']['location_type']
                types = res.get('types', [])
                
                # Map Google types to 1-8 Scale
                quality = 5
                
                if match_type == 'ROOFTOP': quality = 1
                elif match_type == 'RANGE_INTERPOLATED': quality = 1
                elif 'street_address' in types or 'route' in types: quality = 2
                elif 'postal_code' in types:
                    quality = 4 
                elif 'locality' in types or 'neighborhood' in types: quality = 5
                elif 'administrative_area_level_2' in types: quality = 6 # Concelho
                elif 'administrative_area_level_1' in types: quality = 7 # Distrito
                
                return {
                    'lat': loc['lat'],
                    'lon': loc['lng'],
                    'address': res['formatted_address'],
                    'score': 100,
                    'quality_level': quality,
                    'source': 'GOOGLE',
                    'match_type': match_type,
                    'google_place_id': res.get('place_id')
                }
        except Exception as e:
            print(f"Google API error: {e}")
        return None

    def _try_web_scraper(self, cp4, cp3):
        """
        Wrapper for the web scraper.
        """
        try:
            return scrape_cp_data(cp4, cp3)
        except Exception as e:
            print(f"Web Scraper error: {e}")
            return None

    def _save_to_db(self, original_address, result, cp4, concelho):
        conn = self._get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                INSERT INTO pt_addresses 
                (full_street, LATITUDE, LONGITUDE, CP4, cc_desig, quality_score, match_type, source, google_place_id, last_validated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    result['address'], 
                    result['lat'], 
                    result['lon'], 
                    str(cp4).split('-')[0] if cp4 else '', 
                    concelho if concelho else '',
                    result['quality_level'],
                    result['match_type'],
                    result['source'],
                    result.get('google_place_id'),
                    datetime.now()
                )
            )
            conn.commit()
            print(f"Learned new address: {result['address']} from {result['source']}")
        except Exception as e:
            print(f"Error saving to DB: {e}")
        finally:
            conn.close()

    def _clean_address(self, address):
        """
        Expands common Portuguese abbreviations to improve geocoding matching.
        """
        if not address: return ""
        
        import re
        
        # Dictionary of replacements (Order matters for overlapping terms)
        replacements = {
            r'\bR\.\s': 'Rua ',
            r'\bAv\.\s': 'Avenida ',
            r'\bTv\.\s': 'Travessa ',
            r'\bPc\.\s': 'Praça ',
            r'\bPç\.\s': 'Praça ',
            r'\bLg\.\s': 'Largo ',
            r'\bQta\.\s': 'Quinta ',
            r'\bEstr\.\s': 'Estrada ',
            r'\bAz\.\s': 'Azinhaga ',
            r'\bAl\.\s': 'Alameda ',
            r'\bLt\.\s': 'Lote ',
            r'\bLt\s': 'Lote ', # 'Lt 10' -> 'Lote 10'
            r'\bCv\.\s': 'Cave ',
            r'\bR/C\b': 'Rés-do-chão',
            r'\bEsq\.\s': 'Esquerdo ',
            r'\bDir\.\s': 'Direito ',
            r'\bDr\.\s': 'Doutor ',
            r'\bEng\.\s': 'Engenheiro ',
            r'\bSto\.\s': 'Santo ',
            r'\bSta\.\s': 'Santa ',
            r'\bN\.º\s': 'nº ',
            r'\bNº\s': 'nº '
        }
        
        clean_addr = address.strip()
        
        for pattern, replacement in replacements.items():
            clean_addr = re.sub(pattern, replacement, clean_addr, flags=re.IGNORECASE)
            
        return clean_addr
