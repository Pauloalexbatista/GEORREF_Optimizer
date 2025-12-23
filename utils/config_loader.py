"""
Secure Configuration Loader for Google Maps API Key

This module loads sensitive configuration from a local file that is protected
by .gitignore and never committed to the repository.
"""

import json
import os
from pathlib import Path

# Configuration file path (protected by .gitignore)
CONFIG_FILE = 'config/google_config.json'

# Default configuration template
DEFAULT_CONFIG = {
    "google_maps_api_key": "",
    "geocoding_enabled": True,
    "max_requests_per_day": 1000,
    "cache_results": True
}


def load_config():
    """
    Loads the Google Maps API configuration from the secure config file.
    
    Returns:
        dict: Configuration dictionary with API key and settings
        
    Raises:
        FileNotFoundError: If config file doesn't exist
        ValueError: If API key is missing or empty
    """
    config_path = Path(CONFIG_FILE)
    
    if not config_path.exists():
        raise FileNotFoundError(
            f"\n❌ Configuration file not found: {CONFIG_FILE}\n\n"
            f"Please create the file with your Google Maps API key:\n"
            f"1. Copy the template from config/README.md\n"
            f"2. Replace 'SUA_CHAVE_API_AQUI' with your actual API key\n"
            f"3. Save the file as: {CONFIG_FILE}\n\n"
            f"The file is protected by .gitignore and will NOT be committed to Git."
        )
    
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
    except json.JSONDecodeError as e:
        raise ValueError(
            f"❌ Invalid JSON in configuration file: {CONFIG_FILE}\n"
            f"Error: {e}\n"
            f"Please check the file format."
        )
    
    # Validate API key
    api_key = config.get('google_maps_api_key', '').strip()
    
    if not api_key or api_key == 'SUA_CHAVE_API_AQUI':
        raise ValueError(
            f"\n❌ Google Maps API key not configured!\n\n"
            f"Please edit {CONFIG_FILE} and add your API key.\n"
            f"Get your key from: https://console.cloud.google.com/apis/credentials\n"
        )
    
    return config


def get_api_key():
    """
    Gets the Google Maps API key from the configuration.
    
    Returns:
        str: The Google Maps API key, or None if not configured
    """
    try:
        config = load_config()
        return config.get('google_maps_api_key')
    except (FileNotFoundError, ValueError) as e:
        print(f"\n⚠️  Warning: {e}")
        print("Geocoding with Google Maps will be disabled.")
        return None


def is_geocoding_enabled():
    """
    Checks if geocoding is enabled in the configuration.
    
    Returns:
        bool: True if geocoding is enabled, False otherwise
    """
    try:
        config = load_config()
        return config.get('geocoding_enabled', True)
    except (FileNotFoundError, ValueError):
        return False


def get_request_limit():
    """
    Gets the maximum number of requests per day from configuration.
    
    Returns:
        int: Maximum requests per day
    """
    try:
        config = load_config()
        return config.get('max_requests_per_day', 1000)
    except (FileNotFoundError, ValueError):
        return 1000


# Initialize configuration on module import (optional)
def validate_config():
    """
    Validates the configuration on startup.
    Prints warnings if configuration is missing or invalid.
    """
    try:
        config = load_config()
        print(f"✅ Google Maps API configuration loaded successfully")
        print(f"   - Geocoding enabled: {config.get('geocoding_enabled', True)}")
        print(f"   - Daily request limit: {config.get('max_requests_per_day', 1000)}")
        return True
    except (FileNotFoundError, ValueError) as e:
        print(f"\n⚠️  {e}\n")
        return False
