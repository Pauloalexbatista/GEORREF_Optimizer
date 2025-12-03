from utils.geocoder_engine import WaterfallGeocoder
import time

def test_integration():
    print("Initializing Geocoder...")
    geocoder = WaterfallGeocoder('geocoding.db')
    
    # Test Case: Known CP7 that should be found by scraper
    # 7600-401 is the one we tested earlier
    address = "Rua Teste" # Dummy address, we expect the scraper to find the real one from CP
    cp4 = "7600-401"
    concelho = "Aljustrel"
    
    print(f"\nTesting resolution for CP: {cp4}...")
    start = time.time()
    result, learned = geocoder.resolve_address(address, cp4, concelho)
    dur = time.time() - start
    
    print(f"Duration: {dur:.2f}s")
    print("Result:", result)
    
    if result['source'] == 'WEB_SCRAPING':
        print("SUCCESS: Resolved via Web Scraper!")
    elif result['source'] == 'LOCAL':
        print("NOTE: Resolved via LOCAL DB (It might have been learned already or existed).")
        if result['match_type'] == 'EXACT_CP_WEB':
             print("SUCCESS: It seems it was learned from Web Scraper!")
    else:
        print(f"FAILURE: Source was {result['source']}")

    if learned:
        print("Learned Data:", learned)
    else:
        print("No new data learned (maybe already in DB).")

if __name__ == "__main__":
    test_integration()
