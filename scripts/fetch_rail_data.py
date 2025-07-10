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
        # The key now includes company to allow multiple companies at the same location
        processed_rail_data = {}
        
        # --- Fetch all records from both sheets first ---
        worksheet_rail = sheet.worksheet('CONGESTION_RAIL')
        records_rail = worksheet_rail.get_all_records()
        print(f"📝 Number of records fetched from CONGESTION_RAIL: {len(records_rail)}")

        worksheet_rail2 = sheet.worksheet('CONGESTION_RAIL2')
        records_rail2 = worksheet_rail2.get_all_records()
        print(f"📝 Number of records fetched from CONGESTION_RAIL2: {len(records_rail2)}")

        # --- Processing Order based on Corrected Priority ---

        # 1. Process ALL data from CONGESTION_RAIL (Highest Priority)
        print("Processing CONGESTION_RAIL data (Priority 1/4)...")
        for row in records_rail:
            try:
                raw_lat = safe_convert(row.get('Latitude'))
                raw_lng = safe_convert(row.get('Longitude'))
                raw_location = (row.get('Location', '') or row.get('Yard', '')).strip()
                company_name = str(row.get('Railroad', '')).strip()
                
                if raw_lat is None or raw_lng is None or not raw_location:
                    print(f"Skipping CONGESTION_RAIL row due to missing essential data: {raw_location or 'Unknown Location'}")
                    continue

                normalized_location_for_key = normalize_location_name(raw_location)
                lat_for_key = round(raw_lat, 5) 
                lng_for_key = round(raw_lng, 5)
                # Key now includes company name
                key = f"{normalized_location_for_key}-{lat_for_key}-{lng_for_key}-{company_name.upper()}" 
                
                processed_rail_data[key] = {
                    'date': str(row.get('Date', '')).strip(),
                    'company': company_name, 
                    'location': raw_location, 
                    'Yard': raw_location, # Add 'Yard' field for JavaScript consistency
                    'lat': raw_lat,
                    'lng': raw_lng,
                    'dwell_time': safe_convert(row.get('Dwell Time')),
                    'Average': safe_convert(row.get('Average')), # Renamed to 'Average' to match JS
                    'indicator': safe_convert(row.get('Indicator')),
                    'congestion_level': row.get('Category', 'Unknown') 
                }
                
            except Exception as e:
                print(f"⚠️ Error processing CONGESTION_RAIL row - {raw_location or 'Unknown Location'}: {str(e)}")
                continue

        # 2. Process CPKC data from CONGESTION_RAIL2 (Second Priority)
        print("Processing CPKC data from CONGESTION_RAIL2 (Priority 2/4)...")
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
                    # Key now includes company name (CPKC)
                    key = f"{normalized_location_for_key}-{lat_for_key}-{lng_for_key}-{company.upper()}"

                    # Only add if not already covered by CONGESTION_RAIL data with the same location AND company
                    if key not in processed_rail_data:
                        processed_rail_data[key] = {
                            'date': str(row.get('Date of Rightmost Value', '')).strip(),
                            'company': company, 
                            'location': raw_location_from_g, 
                            'Yard': raw_location_from_g, # Add 'Yard' field for JavaScript consistency
                            'lat': raw_lat,
                            'lng': raw_lng,
                            'dwell_time': dwell_time_rail2,
                            'Average': None, # CONGESTION_RAIL2 doesn't have 'Average', Renamed to 'Average'
                            'indicator': None, # CONGESTION_RAIL2 doesn't have 'Indicator'
                            'congestion_level': get_congestion_level_from_dwell_time(dwell_time_rail2) 
                        }
                    else:
                        print(f"Skipping duplicate CPKC row (already covered by CONGESTION_RAIL with same location and company): {raw_location_from_g}")
                except Exception as e:
                    print(f"⚠️ Error processing CPKC row from CONGESTION_RAIL2 - {raw_location_from_g or 'Unknown Location'}: {str(e)}")
                    continue

        # 3. Process CP and KCS data from CONGESTION_RAIL2 (Third Priority - Convert to CPKC)
        print("Processing CP and KCS data from CONGESTION_RAIL2 (Priority 3/4)...")
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
                    # Key now includes company name (CPKC, as it will be displayed)
                    key = f"{normalized_location_for_key}-{lat_for_key}-{lng_for_key}-CPKC" # Use CPKC for key as it's converted for display

                    # Only add if not already covered by CONGESTION_RAIL or CPKC data
                    if key not in processed_rail_data:
                        processed_rail_data[key] = {
                            'date': str(row.get('Date of Rightmost Value', '')).strip(),
                            'company': 'CPKC', # Convert CP/KCS to CPKC for display
                            'location': raw_location_from_g, 
                            'Yard': raw_location_from_g, # Add 'Yard' field for JavaScript consistency
                            'lat': raw_lat,
                            'lng': raw_lng,
                            'dwell_time': dwell_time_rail2,
                            'Average': None, # Renamed to 'Average'
                            'indicator': None, 
                            'congestion_level': get_congestion_level_from_dwell_time(dwell_time_rail2) 
                        }
                    else:
                        print(f"Skipping duplicate {company} row (already covered by higher priority data): {raw_location_from_g}")
                except Exception as e:
                    print(f"⚠️ Error processing {company} row from CONGESTION_RAIL2 - {raw_location_from_g or 'Unknown Location'}: {str(e)}")
                    continue

        # 4. Process Remaining non-CPKC/CP/KCS data from CONGESTION_RAIL2 (Lowest Priority)
        print("Processing remaining CONGESTION_RAIL2 data (Priority 4/4)...")
        for row in records_rail2:
            company = str(row.get('Railroad Company', '')).strip()
            # Only process if not CPKC, CP, or KCS (already handled by higher priorities)
            if company not in ['CPKC', 'CP', 'KCS']:
                try:
                    raw_lat = safe_convert(row.get('Latitude'))
                    raw_lng = safe_convert(row.get('Longitude'))
                    raw_location_from_g = row.get('Location', '').strip() 
                    dwell_time_rail2 = safe_convert(row.get('Rightmost Dwell Time')) 
                    
                    if raw_lat is None or raw_lng is None or dwell_time_rail2 is None or not raw_location_from_g:
                        print(f"Skipping remaining CONGESTION_RAIL2 row due to missing essential data: {raw_location_from_g or 'Unknown Location'}")
                        continue

                    normalized_location_for_key = normalize_location_name(raw_location_from_g)
                    lat_for_key = round(raw_lat, 5) 
                    lng_for_key = round(raw_lng, 5)
                    # Key now includes company name
                    key = f"{normalized_location_for_key}-{lat_for_key}-{lng_for_key}-{company.upper()}"

                    # Only add if not already covered by higher priority data
                    if key not in processed_rail_data:
                        processed_rail_data[key] = {
                            'date': str(row.get('Date of Rightmost Value', '')).strip(),
                            'company': company, # Keep original company name for other RAIL2 data
                            'location': raw_location_from_g, 
                            'Yard': raw_location_from_g, # Add 'Yard' field for JavaScript consistency
                            'lat': raw_lat,
                            'lng': raw_lng,
                            'dwell_time': dwell_time_rail2,
                            'Average': None, # Renamed to 'Average'
                            'indicator': None, 
                            'congestion_level': get_congestion_level_from_dwell_time(dwell_time_rail2) 
                        }
                    else:
                        print(f"Skipping duplicate remaining CONGESTION_RAIL2 row (already covered by higher priority data): {raw_location_from_g}")
                except Exception as e:
                    print(f"⚠️ Error processing remaining CONGESTION_RAIL2 row - {raw_location_from_g or 'Unknown Location'}: {str(e)}")
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
