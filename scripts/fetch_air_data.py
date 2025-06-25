# scripts/fetch_air_data.py
import os
import gspread
import json
from google.oauth2 import service_account

def safe_convert(val, default=None):
    """Safely converts data, returning a default if conversion fails or value is empty."""
    if val in [None, "", " ", "N/A", "NaN"]:
        return default
    try:
        # Try to convert to float if it contains a decimal point, otherwise to int.
        # This handles numerical strings that might come from the spreadsheet.
        return float(val) if "." in str(val) else int(val)
    except (ValueError, TypeError):
        # Return default if conversion to float or int fails.
        return default

def fetch_air_data():
    print("🔵 Starting Air Data Collection")
    try:
        # Authentication setup for Google Sheets API
        creds_dict = eval(os.environ['GOOGLE_CREDENTIAL_JSON'])
        creds = service_account.Credentials.from_service_account_info(
            creds_dict,
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
        gc = gspread.authorize(creds)
        print("✅ Google Authentication Successful")
        
        # Load data from the specified Google Sheet
        spreadsheet_id = os.environ['SPREADSHEET_ID']
        sheet = gc.open_by_key(spreadsheet_id)
        worksheet = sheet.worksheet('CONGESTION_AIR')
        
        # --- CHANGE START ---
        # Fetch data up to column 'O' to include 'iso_region' and 'municipality'
        records = worksheet.get('A2:O61')  # Fetch data from A2 to O61
        headers = worksheet.get('A1:O1')[0] # Fetch headers from A1 to O1
        # --- CHANGE END ---

        print(f"📝 Number of records fetched: {len(records)}")
        
        # Process fetched data
        result = []
        for i, row in enumerate(records):
            # Ensure row has enough columns to match headers to avoid IndexError
            if len(row) < len(headers):
                print(f"⚠️ Skipping row {i+2} due to insufficient columns. Expected {len(headers)}, got {len(row)}.")
                continue

            try:
                # Convert row to a dictionary using headers
                row_dict = dict(zip(headers, row))
                
                # Validate essential fields: latitude, longitude, and airport code
                lat = safe_convert(row_dict.get('latitude_deg'))
                lng = safe_convert(row_dict.get('longitude_deg'))
                code = row_dict.get('Code', '').strip()
                if None in [lat, lng] or not code:
                    print(f"⚠️ Skipping row {i+2} (Code: {code}) due to missing Lat/Lng or Airport Code.")
                    continue
                
                # Refine data for output JSON
                data = {
                    'airport_code': code,
                    'scheduled': safe_convert(row_dict.get('Scheduled')),
                    'completed': safe_convert(row_dict.get('Completed')),
                    'departed': safe_convert(row_dict.get('Departed')),
                    'cancelled': safe_convert(row_dict.get('Cancelled')),
                    'completion_factor': safe_convert(row_dict.get('Completion Factor')),
                    'd15': safe_convert(row_dict.get('D15')),
                    'a14': safe_convert(row_dict.get('A14')),
                    'd0_percent': safe_convert(row_dict.get('D0 Percent')),
                    'average_txo': safe_convert(row_dict.get('Average TXO')),
                    'last_updated': row_dict.get('Last Updated', '').strip(),
                    'latitude_deg': lat, # Keep original latitude_deg name for clarity
                    'longitude_deg': lng, # Keep original longitude_deg name for clarity
                    'lat': lat, # Add 'lat' for JS compatibility
                    'lng': lng, # Add 'lng' for JS compatibility
                    # --- CHANGE START ---
                    # Add new fields for region and municipality
                    'iso_region': row_dict.get('iso_region', '').strip(),
                    'municipality': row_dict.get('municipality', '').strip()
                    # --- CHANGE END ---
                }
                
                result.append(data)
                
            except Exception as e:
                # Print error for specific row processing issues
                print(f"⚠️ Error processing row {i+2} (Code: {row_dict.get('Code', 'Unknown')}): {str(e)}")
                continue
        
        # Save processed data to a JSON file
        output_dir = os.path.join(os.path.dirname(__file__), '../data')
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, 'us-air.json')
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
            
        print(f"✅ Air data saved to: {output_path}")
        print(f"🔄 Number of data entries generated: {len(result)}")
        
        # Print a sample of the generated data
        if result:
            print("\n🔍 Sample Data:")
            print(json.dumps(result[0], indent=2))
            
        return True
        
    except Exception as e:
        # Print a critical error message for overall failures
        print(f"❌ Critical error during air data fetch: {str(e)}")
        return False

if __name__ == "__main__":
    fetch_air_data()
