# scripts/fetch_ocean_data.py
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

def fetch_ocean_data():
    print("🔵 Starting Ocean Data Collection")
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
        worksheet = sheet.worksheet('CONGESTION_OCEAN') # Targeting the 'CONGESTION_OCEAN' worksheet
        records = worksheet.get_all_records() # Get all data as a list of dictionaries (header as keys)
        print(f"📝 Number of records fetched: {len(records)}")
        
        # Process fetched data
        result = []
        for row in records:
            try:
                # Validate essential fields: Latitude and Longitude
                lat = safe_convert(row.get('Latitude'))
                lng = safe_convert(row.get('Longitude'))
                if None in [lat, lng]:
                    # Skip rows without valid lat/lng as they cannot be mapped
                    print(f"⚠️ Skipping row due to missing Latitude/Longitude for Port: {row.get('Port', 'Unknown')}")
                    continue
                
                # Refine data for output JSON
                data = {
                    'date': str(row.get('Date', '')).strip(),
                    'port': str(row.get('Port', '')).strip(),
                    'country': str(row.get('Country', '')).strip(),
                    'country_code': str(row.get('Country Code', '')).strip().lower(), # Storing as lowercase for consistency
                    'port_code': str(row.get('Port Code', '')).strip(),
                    'current_delay_days': safe_convert(row.get('Current Delay (days)')),
                    'current_delay': str(row.get('Current Delay', '')).strip(), # Keep original string for display
                    'delay_level': str(row.get('Delay Level', '')).strip().lower(), # Storing as lowercase for consistency
                    'lat': lat,
                    'lng': lng,
                    'weekly_median_delay': safe_convert(row.get('Weekly Median Delay')),
                    'weekly_max_delay': safe_convert(row.get('Weekly Max Delay')),
                    'fortnightly_median_delay': safe_convert(row.get('Fortnightly Median Delay')),
                    'fortnightly_max_delay': safe_convert(row.get('Fortnightly Max Delay')),
                    'monthly_median_delay': safe_convert(row.get('Monthly Median Delay')),
                    'monthly_max_delay': safe_convert(row.get('Monthly Max Delay'))
                }
                
                result.append(data)
                
            except Exception as e:
                # Print error for specific row processing issues
                print(f"⚠️ Error processing row for Port {row.get('Port', 'Unknown')}: {str(e)}")
                continue
        
        # Save processed data to a JSON file
        output_dir = os.path.join(os.path.dirname(__file__), '../data')
        os.makedirs(output_dir, exist_ok=True)
        # Note: The output file name is 'global-ports.json', not 'us-ocean.json' as implied by the deployment script.
        output_path = os.path.join(output_dir, 'global-ports.json') 
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
            
        print(f"✅ Ocean data saved to: {output_path}")
        print(f"🔄 Number of data entries generated: {len(result)}")
        
        # Print a sample of the generated data
        if result:
            print("\n🔍 Sample Data:")
            print(json.dumps(result[0], indent=2))
            
        return True
        
    except Exception as e:
        # Print a critical error message for overall failures
        print(f"❌ Critical error during ocean data fetch: {str(e)}")
        return False

if __name__ == "__main__":
    fetch_ocean_data()
