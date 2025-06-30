# scripts/fetch_rail_data.py
import os
import gspread
import json
from google.oauth2 import service_account

def safe_convert(val, default=None):
    if val in [None, "", " ", "N/A", "NaN"]:
        return default
    try:
        return float(val) if "." in str(val) else int(val)
    except (ValueError, TypeError):
        return default

def fetch_rail_data():
    print("🔵 Starting Rail Data Collection")
    try:
        creds_dict = eval(os.environ['GOOGLE_CREDENTIAL_JSON'])
        creds = service_account.Credentials.from_service_account_info(
            creds_dict,
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
        gc = gspread.authorize(creds)
        print("✅ Google Authentication Successful")
        
        spreadsheet_id = os.environ['SPREADSHEET_ID']
        sheet = gc.open_by_key(spreadsheet_id)
        worksheet = sheet.worksheet('CONGESTION_RAIL')
        records = worksheet.get_all_records()
        print(f"📝 Number of records fetched: {len(records)}")
        
        result = []
        for row in records:
            try:
                lat = safe_convert(row.get('Latitude'))
                lng = safe_convert(row.get('Longitude'))
                if None in [lat, lng]:
                    continue
                    
                location = row.get('Location', '') or row.get('Yard', '')
                if not location:
                    continue
                
                data = {
                    'date': str(row.get('Date', '')).strip(),
                    'company': str(row.get('Railroad', '')).strip(),
                    'location': location.strip(),
                    'lat': lat,
                    'lng': lng,
                    'dwell_time': safe_convert(row.get('Dwell Time')),
                    'Average': safe_convert(row.get('Average')),
                    'indicator': safe_convert(row.get('Indicator')),
                    'congestion_level': row.get('Category', 'Unknown')
                }
                
                result.append(data)
                
            except Exception as e:
                print(f"⚠️ Error processing row - {row.get('Location', 'Unknown')}: {str(e)}")
                continue
        
        output_dir = os.path.join(os.path.dirname(__file__), '../data')
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, 'us-rail.json')
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
            
        print(f"✅ Rail data saved to: {output_path}")
        print(f"🔄 Number of data entries generated: {len(result)}")
        
        if result:
            print("\n🔍 Sample Data:")
            print(json.dumps(result[0], indent=2))
            
        return True
        
    except Exception as e:
        print(f"❌ Critical error: {str(e)}")
        return False

if __name__ == "__main__":
    fetch_rail_data()
