import re

def is_in_portugal(lat, lon):
    """
    Verifies if coordinates fall within Portugal (Mainland + Islands).
    Returns True if valid, False otherwise.
    """
    try:
        lat = float(lat)
        lon = float(lon)
    except (ValueError, TypeError):
        return False

    # Mainland Portugal
    if 36.9 <= lat <= 42.2 and -9.6 <= lon <= -6.1:
        return True
    
    # Madeira (including Porto Santo which is ~33.07)
    if 32.3 <= lat <= 33.2 and -17.3 <= lon <= -16.2:
        return True
        
    # Azores (Broad box)
    if 36.5 <= lat <= 40.0 and -31.5 <= lon <= -24.5:
        return True

    return False

def is_swapped_coords(lat, lon):
    """
    Checks if coordinates might be swapped (Lat is Long, Long is Lat).
    """
    try:
        lat = float(lat)
        lon = float(lon)
    except (ValueError, TypeError):
        return False
        
    # Check if swapped matches Portugal (Lat as Lon, Lon as Lat)
    # Portugal Lon: -9.6 to -6.1 -> If this is in Lat field
    # Portugal Lat: 36.9 to 42.2 -> If this is in Lon field
    
    # Swapped Mainland
    if -9.6 <= lat <= -6.1 and 36.9 <= lon <= 42.2:
        return True
        
    return False

def validate_cp4(cp4):
    """
    Validates if CP4 is a valid 4-digit string.
    """
    if not cp4:
        return False
    cp4_str = str(cp4).strip()
    return bool(re.match(r'^\d{4}$', cp4_str))

def validate_cp7(cp7):
    """
    Validates if CP7 is a valid format (XXXX-XXX).
    """
    if not cp7:
        return False
    cp7_str = str(cp7).strip()
    return bool(re.match(r'^\d{4}-\d{3}$', cp7_str))
