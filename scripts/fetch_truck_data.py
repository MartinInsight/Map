import os
import gspread
import json
from google.oauth2 import service_account

def safe_convert(val, default=None):
    if val in [None, "", " ", "N/A", "NaN"]:
        return default
    try:
        if isinstance(val, str):
            val = val.replace(",", "").strip()
        return float(val) if "." in str(val) else int(val)
    except (ValueError, TypeError):
        return default

def fetch_truck_data():
    print("🔵 Starting Truck Data Collection")
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
        worksheet = sheet.worksheet('CONGESTION_TRUCK')

        expected_headers = [
            'Code', 'State', 'Inbound Delay', 'Inbound Color',
            'Outbound Delay', 'Outbound Color', 'Dwell Inbound', 'Dwell Outbound'
        ]
        records = worksheet.get_all_records(expected_headers=expected_headers)

        print(f"📝 Number of records fetched: {len(records)}")

        result = {}
        for row in records:
            try:
                state_code = row.get('Code')
                if not state_code:
                    print(f"⚠️ Skipping row due to missing State Code: {row.get('State')}")
                    continue

                data = {
                    'name': str(row.get('State', 'Unknown')).strip(),
                    'inboundDelay': safe_convert(row.get('Inbound Delay')),
                    'inboundColor': int(safe_convert(row.get('Inbound Color'), 0)),
                    'outboundDelay': safe_convert(row.get('Outbound Delay')),
                    'outboundColor': int(safe_convert(row.get('Outbound Color'), 0)),
                    'dwellInbound': safe_convert(row.get('Dwell Inbound')),
                    'dwellOutbound': safe_convert(row.get('Dwell Outbound'))
                }

                for color_field in ['inboundColor', 'outboundColor']:
                    data[color_field] = max(-3, min(3, data[color_field]))

                result[state_code] = data

            except Exception as e:
                print(f"⚠️ Error processing row for State {row.get('State', 'Unknown')}: {str(e)}")
                continue

        output_dir = os.path.join(os.path.dirname(__file__), '../data')
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, 'us-truck.json')

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)

        print(f"✅ Truck data saved to: {output_path}")
        print(f"🔄 Number of States processed: {len(result)}")

        if result:
            sample_state_code = next(iter(result))
            print("\n🔍 Sample Data:")
            print(json.dumps({sample_state_code: result[sample_state_code]}, indent=2, ensure_ascii=False))

        return True

    except Exception as e:
        print(f"❌ Critical error: {str(e)}")
        return False

if __name__ == "__main__":
    fetch_truck_data()
