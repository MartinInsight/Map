import os
import gspread
import json
import re # Import the regular expression module
from google.oauth2 import service_account
from datetime import datetime

# Function to safely convert values to float or int, returning default (None) for invalid values
def safe_convert(val, default=None):
    if val in [None, "", " ", "N/A", "NaN"]:
        return default
    try:
        # Always try to convert to float for numerical stability, especially for lat/lng
        return float(val)
    except (ValueError, TypeError):
        return default

# Function to normalize location names for consistent deduplication.
# This version aggressively cleans and formats the string for key generation.
def normalize_location_name(location_str):
    if not isinstance(location_str, str):
        return ""
    
    # Remove all non-alphanumeric characters except spaces
    # This handles periods, commas, hyphens, etc., replacing them effectively
    normalized = re.sub(r'[^a-zA-Z0-9\s]', '', location_str)
    
    # Convert to uppercase
    normalized = normalized.upper()
    
    # Replace any sequence of one or more spaces with a single underscore
    # Then remove any leading/trailing underscores that might result from trimming
    normalized = re.sub(r'\s+', '_', normalized).strip('_')
    
    return normalized

# Function to determine congestion level based on dwell time
# This is used for CONGESTION_RAIL2 data which lacks an 'Indicator' or 'Category'
def get_congestion_level_from_dwell_time(dwell_time):
    if dwell_time is None:
        return 'Unknown'
    if dwell_time > 28:
        return 'Very High'
    if dwell_time > 23:
        return 'High'
    if dwell_time > 18:
        return 'Average'
    if dwell_time > 10:
        return 'Low'
    return 'Very Low'

def fetch_rail_data():
    print("🔵 Starting Rail Data Collection")
    try:
        # Load Google service account credentials from environment variable
        creds_dict = eval(os.environ['GOOGLE_CREDENTIAL_JSON'])
        creds = service_account.Credentials.from_service_account_info(
            creds_dict,
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
        gc = gspread.authorize(creds)
        print("✅ Google Authentication Successful")
        
        # Get the spreadsheet ID from environment variable
        spreadsheet_id = os.environ['SPREADSHEET_ID']
        sheet = gc.open_by_key(spreadsheet_id)

        # Dictionary to store processed data, using a unique key for deduplication
        # This will be populated based on priority: CPKC > CP/KCS > CONGESTION_RAIL
        processed_rail_data = {}

        # --- Fetch and process data from CONGESTION_RAIL2 (supplementary source) ---
        # Process CONGESTION_RAIL2 first to establish CPKC priority
        worksheet_rail2 = sheet.worksheet('CONGESTION_RAIL2')
        records_rail2 = worksheet_rail2.get_all_records()
        print(f"📝 Number of records fetched from CONGESTION_RAIL2: {len(records_rail2)}")

        # 1. Process CPKC data from CONGESTION_RAIL2 (highest priority)
        print("Processing CPKC data from CONGESTION_RAIL2...")
        for row in records_rail2:
            company = str(row.get('Railroad Company', '')).strip()
            if company == 'CPKC':
                try:
                    raw_lat = safe_convert(row.get('Latitude'))
                    raw_lng = safe_convert(row.get('Longitude'))
                    raw_location_from_g = row.get('Location', '').strip() 
                    dwell_time_rail2 = safe_convert(row.get('Rightmost Dwell Time')) 
                    
                    if raw_lat is None or raw_lng is None or dwell_time_rail2 is None or not raw_location_from_g:
                        print(f"Skipping CPKC row due to missing essential data: {raw_location_from_g or 'Unknown Location'}")
                        continue

                    normalized_location_for_key = normalize_location_name(raw_location_from_g)
                    lat_for_key = round(raw_lat, 5) 
                    lng_for_key = round(raw_lng, 5)
                    key = f"{normalized_location_for_key}-{lat_for_key}-{lng_for_key}"

                    # Add CPKC data directly, it has highest priority
                    processed_rail_data[key] = {
                        'date': str(row.get('Date of Rightmost Value', '')).strip(),
                        'company': company, # Keep as CPKC
                        'location': raw_location_from_g, 
                        'lat': raw_lat,
                        'lng': raw_lng,
                        'dwell_time': dwell_time_rail2,
                        'average_value': None, 
                        'indicator': None, 
                        'congestion_level': get_congestion_level_from_dwell_time(dwell_time_rail2) 
                    }
                except Exception as e:
                    print(f"⚠️ Error processing CPKC row from CONGESTION_RAIL2 - {raw_location_from_g or 'Unknown Location'}: {str(e)}")
                    continue

        # 2. Process CP and KCS data from CONGESTION_RAIL2 (second priority, convert to CPKC)
        print("Processing CP and KCS data from CONGESTION_RAIL2...")
        for row in records_rail2:
            company = str(row.get('Railroad Company', '')).strip()
            if company in ['CP', 'KCS']:
                try:
                    raw_lat = safe_convert(row.get('Latitude'))
                    raw_lng = safe_convert(row.get('Longitude'))
                    raw_location_from_g = row.get('Location', '').strip() 
                    dwell_time_rail2 = safe_convert(row.get('Rightmost Dwell Time')) 
                    
                    if raw_lat is None or raw_lng is None or dwell_time_rail2 is None or not raw_location_from_g:
                        print(f"Skipping {company} row due to missing essential data: {raw_location_from_g or 'Unknown Location'}")
                        continue

                    normalized_location_for_key = normalize_location_name(raw_location_from_g)
                    lat_for_key = round(raw_lat, 5) 
                    lng_for_key = round(raw_lng, 5)
                    key = f"{normalized_location_for_key}-{lat_for_key}-{lng_for_key}"

                    # Only add if CPKC hasn't already added this location
                    if key not in processed_rail_data:
                        processed_rail_data[key] = {
                            'date': str(row.get('Date of Rightmost Value', '')).strip(),
                            'company': 'CPKC', # Convert CP/KCS to CPKC
                            'location': raw_location_from_g, 
                            'lat': raw_lat,
                            'lng': raw_lng,
                            'dwell_time': dwell_time_rail2,
                            'average_value': None, 
                            'indicator': None, 
                            'congestion_level': get_congestion_level_from_dwell_time(dwell_time_rail2) 
                        }
                    else:
                        print(f"Skipping duplicate {company} row (already covered by CPKC): {raw_location_from_g}")
                except Exception as e:
                    print(f"⚠️ Error processing {company} row from CONGESTION_RAIL2 - {raw_location_from_g or 'Unknown Location'}: {str(e)}")
                    continue

        # --- Fetch and process data from CONGESTION_RAIL (lowest priority) ---
        worksheet_rail = sheet.worksheet('CONGESTION_RAIL')
        records_rail = worksheet_rail.get_all_records()
        print(f"📝 Number of records fetched from CONGESTION_RAIL: {len(records_rail)}")
        
        print("Processing CONGESTION_RAIL data...")
        for row in records_rail:
            try:
                raw_lat = safe_convert(row.get('Latitude'))
                raw_lng = safe_convert(row.get('Longitude'))
                raw_location = (row.get('Location', '') or row.get('Yard', '')).strip()
                
                if raw_lat is None or raw_lng is None or not raw_location:
                    print(f"Skipping CONGESTION_RAIL row due to missing essential data: {raw_location or 'Unknown Location'}")
                    continue

                normalized_location_for_key = normalize_location_name(raw_location)
                lat_for_key = round(raw_lat, 5) 
                lng_for_key = round(raw_lng, 5)
                key = f"{normalized_location_for_key}-{lat_for_key}-{lng_for_key}" 
                
                # Only add if not already in processed_rail_data (covered by CPKC, CP, or KCS)
                if key not in processed_rail_data:
                    processed_rail_data[key] = {
                        'date': str(row.get('Date', '')).strip(),
                        'company': str(row.get('Railroad', '')).strip(), # Keep original company name for CONGESTION_RAIL
                        'location': raw_location, 
                        'lat': raw_lat,
                        'lng': raw_lng,
                        'dwell_time': safe_convert(row.get('Dwell Time')),
                        'average_value': safe_convert(row.get('Average')), 
                        'indicator': safe_convert(row.get('Indicator')),
                        'congestion_level': row.get('Category', 'Unknown') 
                    }
                else:
                    print(f"Skipping duplicate CONGESTION_RAIL row (already covered by CONGESTION_RAIL2 data): {raw_location}")
                
            except Exception as e:
                print(f"⚠️ Error processing CONGESTION_RAIL row - {raw_location or 'Unknown Location'}: {str(e)}")
                continue

        # Convert the dictionary values (deduplicated records) to a list
        result = list(processed_rail_data.values()) 
        
        # Define output directory and path
        output_dir = os.path.join(os.path.dirname(__file__), '../data')
        os.makedirs(output_dir, exist_ok=True) 
        output_path = os.path.join(output_dir, 'us-rail.json')
        
        # Write the processed data to a JSON file
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
            
        print(f"✅ Rail data saved to: {output_path}")
        print(f"🔄 Total number of data entries generated (deduplicated): {len(result)}")
        
        # Print a sample of the generated data for verification
        if result:
            print("\n🔍 Sample Data:")
            print(json.dumps(result[0], indent=2))
            
        return True
        
    except Exception as e:
        print(f"❌ Critical error: {str(e)}")
        return False

# Entry point for the script
if __name__ == "__main__":
    fetch_rail_data()
