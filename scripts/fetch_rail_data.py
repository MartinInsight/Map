import os
import gspread
import json
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
                location = (row.get('Location', '') or row.get('Yard', '')).strip()
                
                # Skip rows if essential geographical data or location is missing
                if None in [lat, lng] or not location:
                    print(f"Skipping row from CONGESTION_RAIL due to missing essential data: {row.get('Location', 'Unknown')}")
                    continue

                # Create a unique key for deduplication based on location and coordinates
                key = f"{location}-{lat}-{lng}" 
                
                data = {
                    'date': str(row.get('Date', '')).strip(),
                    'company': str(row.get('Railroad', '')).strip(),
                    'location': location,
                    'lat': lat,
                    'lng': lng,
                    'dwell_time': safe_convert(row.get('Dwell Time')),
                    'average_value': safe_convert(row.get('Average')), # Renamed to avoid conflict with JS variable names
                    'indicator': safe_convert(row.get('Indicator')),
                    'congestion_level': row.get('Category', 'Unknown') # Use 'Category' from RAIL for congestion level
                }
                processed_rail_data[key] = data # Add to dictionary (will overwrite if key exists within this sheet, but unlikely)
                
            except Exception as e:
                print(f"⚠️ Error processing row from CONGESTION_RAIL - {row.get('Location', 'Unknown')}: {str(e)}")
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
                location = (row.get('City/Region', '') or row.get('Yard', '')).strip()
                dwell_time_rail2 = safe_convert(row.get('Rightmost Dwell Time')) # Get dwell time first
                
                # Skip rows if essential geographical data, location, OR dwell time is missing/invalid
                if None in [lat, lng, dwell_time_rail2] or not location:
                    print(f"Skipping row from CONGESTION_RAIL2 due to missing essential data (Location, Lat, Lng, or Dwell Time): {row.get('City/Region', 'Unknown')}")
                    continue

                key = f"{location}-{lat}-{lng}"

                # Only add data from CONGESTION_RAIL2 if a record with the same key
                # (location + lat + lng) does NOT already exist from CONGESTION_RAIL.
                # This ensures CONGESTION_RAIL data takes precedence.
                if key not in processed_rail_data:
                    
                    data = {
                        'date': str(row.get('Date of Rightmost Value', '')).strip(),
                        'company': str(row.get('Railroad Company', '')).strip(),
                        'location': location,
                        'lat': lat,
                        'lng': lng,
                        'dwell_time': dwell_time_rail2,
                        'average_value': None, # CONGESTION_RAIL2 does not have 'Average'
                        'indicator': None, # CONGESTION_RAIL2 does not have 'Indicator'
                        # Assign congestion level based on dwell time for RAIL2 data
                        'congestion_level': get_congestion_level_from_dwell_time(dwell_time_rail2) 
                    }
                    processed_rail_data[key] = data
                
            except Exception as e:
                print(f"⚠️ Error processing row from CONGESTION_RAIL2 - {row.get('City/Region', 'Unknown')}: {str(e)}")
                continue

        # Convert the dictionary values (deduplicated records) to a list
        result = list(processed_rail_data.values()) 
        
        # Define output directory and path
        output_dir = os.path.join(os.path.dirname(__file__), '../data')
        os.makedirs(output_dir, exist_ok=True) # Create directory if it doesn't exist
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
