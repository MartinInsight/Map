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
        # Try converting to float first for decimal numbers, then int
        return float(val) if isinstance(val, str) and "." in val else int(val)
    except (ValueError, TypeError):
        return default

# Function to normalize location names for consistent deduplication
def normalize_location_name(location_str):
    if not isinstance(location_str, str):
        return ""
    
    # Convert to uppercase
    normalized = location_str.upper()
    
    # Remove periods and commas
    normalized = normalized.replace('.', '').replace(',', '')
    
    # Remove common US state abbreviations at the end of the string.
    # This is a heuristic to handle cases like "Stevens Point, WI" vs "STEVENS POINT".
    # This list covers all US state abbreviations.
    state_abbrs = [
        "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
    ]
    # Create a regex pattern to match these abbreviations at the end, preceded by a space
    state_pattern = r'\s(?:' + '|'.join(state_abbrs) + r')$'
    normalized = re.sub(state_pattern, '', normalized).strip()

    # Replace multiple spaces with a single space and trim leading/trailing spaces
    normalized = re.sub(r'\s+', ' ', normalized).strip()
    
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

        # --- Fetch and process data from CONGESTION_RAIL (primary source) ---
        worksheet_rail = sheet.worksheet('CONGESTION_RAIL')
        records_rail = worksheet_rail.get_all_records()
        print(f"📝 Number of records fetched from CONGESTION_RAIL: {len(records_rail)}")
        
        # Dictionary to store processed data, using a unique key for deduplication
        # Data from CONGESTION_RAIL will take precedence
        processed_rail_data = {}
        for row in records_rail:
            try:
                lat = safe_convert(row.get('Latitude'))
                lng = safe_convert(row.get('Longitude'))
                # Prefer 'Location' then 'Yard' for the location name
                raw_location = (row.get('Location', '') or row.get('Yard', '')).strip()
                
                # Skip rows if essential geographical data or location is missing
                if None in [lat, lng] or not raw_location:
                    print(f"Skipping row from CONGESTION_RAIL due to missing essential data: {raw_location or 'Unknown Location'}")
                    continue

                # Normalize the location name for consistent key generation
                normalized_location = normalize_location_name(raw_location)
                key = f"{normalized_location}-{lat}-{lng}" 
                
                data = {
                    'date': str(row.get('Date', '')).strip(),
                    'company': str(row.get('Railroad', '')).strip(),
                    'location': raw_location, # Store original location for display
                    'lat': lat,
                    'lng': lng,
                    'dwell_time': safe_convert(row.get('Dwell Time')),
                    'average_value': safe_convert(row.get('Average')), 
                    'indicator': safe_convert(row.get('Indicator')),
                    'congestion_level': row.get('Category', 'Unknown') 
                }
                processed_rail_data[key] = data 
                
            except Exception as e:
                print(f"⚠️ Error processing row from CONGESTION_RAIL - {raw_location or 'Unknown Location'}: {str(e)}")
                continue

        # --- Fetch and process data from CONGESTION_RAIL2 (supplementary source) ---
        worksheet_rail2 = sheet.worksheet('CONGESTION_RAIL2')
        records_rail2 = worksheet_rail2.get_all_records()
        print(f"📝 Number of records fetched from CONGESTION_RAIL2: {len(records_rail2)}")

        # Process and deduplicate data from CONGESTION_RAIL2
        for row in records_rail2:
            try:
                lat = safe_convert(row.get('Latitude'))
                lng = safe_convert(row.get('Longitude'))
                # Prefer 'City/Region' then 'Yard' for the location name in RAIL2
                raw_location = (row.get('City/Region', '') or row.get('Yard', '')).strip()
                dwell_time_rail2 = safe_convert(row.get('Rightmost Dwell Time')) 
                
                # Skip rows if essential geographical data, location, OR dwell time is missing/invalid
                if None in [lat, lng, dwell_time_rail2] or not raw_location:
                    print(f"Skipping row from CONGESTION_RAIL2 due to missing essential data (Location, Lat, Lng, or Dwell Time): {raw_location or 'Unknown Location'}")
                    continue

                # Normalize the location name for consistent key generation
                normalized_location = normalize_location_name(raw_location)
                key = f"{normalized_location}-{lat}-{lng}"

                # Only add data from CONGESTION_RAIL2 if a record with the same normalized key
                # (normalized location + lat + lng) does NOT already exist from CONGESTION_RAIL.
                # This ensures CONGESTION_RAIL data takes precedence.
                if key not in processed_rail_data:
                    
                    data = {
                        'date': str(row.get('Date of Rightmost Value', '')).strip(),
                        'company': str(row.get('Railroad Company', '')).strip(),
                        'location': raw_location, # Store original location for display
                        'lat': lat,
                        'lng': lng,
                        'dwell_time': dwell_time_rail2,
                        'average_value': None, 
                        'indicator': None, 
                        'congestion_level': get_congestion_level_from_dwell_time(dwell_time_rail2) 
                    }
                    processed_rail_data[key] = data
                
            except Exception as e:
                print(f"⚠️ Error processing row from CONGESTION_RAIL2 - {raw_location or 'Unknown Location'}: {str(e)}")
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
