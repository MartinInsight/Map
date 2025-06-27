import os
import gspread
import json
from google.oauth2 import service_account

def safe_convert(val, default=None):
    """안전한 데이터 변환 함수"""
    if val in [None, "", " ", "N/A", "NaN"]:
        return default
    try:
        if isinstance(val, str):
            val = val.replace(",", "").strip()
        # Convert to float if it has a decimal, otherwise to int
        return float(val) if "." in str(val) else int(val)
    except (ValueError, TypeError):
        return default

def fetch_truck_data():
    print("🚛 Truck 데이터 수집 시작")
    try:
        # 인증 설정 (Service Account Key from environment variable)
        creds_dict = eval(os.environ['GOOGLE_CREDENTIAL_JSON'])
        creds = service_account.Credentials.from_service_account_info(
            creds_dict,
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
        gc = gspread.authorize(creds)
        print("✅ Google 인증 성공")

        # 데이터 로드
        sheet = gc.open_by_key(os.environ['SPREADSHEET_ID'])
        worksheet = sheet.worksheet('CONGESTION_TRUCK')

        # --- IMPORTANT FIX: Specify expected headers to handle duplicate/empty header issues ---
        # Based on your row.get() calls, these seem to be your intended headers.
        # Please ensure these exactly match the headers in your Google Sheet's first row.
        expected_headers = [
            'Code', 'State', 'Inbound Delay', 'Inbound Color',
            'Outbound Delay', 'Outbound Color', 'Dwell Inbound', 'Dwell Outbound'
        ]
        records = worksheet.get_all_records(expected_headers=expected_headers)
        # ----------------------------------------------------------------------------------

        print(f"📝 레코드 개수: {len(records)}")

        # 데이터 처리
        result = {}
        for row in records:
            try:
                state_code = row.get('Code')
                if not state_code:
                    print(f"⚠️ State Code 없음 - 행 건너뜀: {row.get('State')}")
                    continue

                # 데이터 정제 및 타입 변환
                data = {
                    'name': str(row.get('State', 'Unknown')).strip(),
                    'inboundDelay': safe_convert(row.get('Inbound Delay')),
                    'inboundColor': int(safe_convert(row.get('Inbound Color'), 0)),
                    'outboundDelay': safe_convert(row.get('Outbound Delay')),
                    'outboundColor': int(safe_convert(row.get('Outbound Color'), 0)),
                    'dwellInbound': safe_convert(row.get('Dwell Inbound')),
                    'dwellOutbound': safe_convert(row.get('Dwell Outbound'))
                }

                # 색상 값 범위 제한 (-3 ~ 3)
                for color_field in ['inboundColor', 'outboundColor']:
                    # Ensure color values are within the range [-3, 3]
                    data[color_field] = max(-3, min(3, data[color_field]))

                result[state_code] = data

            except Exception as e:
                # Log errors for specific rows without stopping the entire process
                print(f"⚠️ 행 처리 오류 - {row.get('State', 'Unknown')}: {str(e)}")
                continue

        # JSON 파일 저장 (파일명: us-truck.json)
        output_dir = os.path.join(os.path.dirname(__file__), '../data')
        os.makedirs(output_dir, exist_ok=True) # Ensure the directory exists
        output_path = os.path.join(output_dir, 'us-truck.json')

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False) # Pretty print JSON

        print(f"✅ Truck 데이터 저장 완료: {output_path}")
        print(f"🔄 처리된 주(State) 개수: {len(result)}")

        # 샘플 데이터 출력 (first item in the result dictionary)
        if result:
            sample_state_code = next(iter(result))
            print("\n🔍 샘플 데이터:")
            print(json.dumps({sample_state_code: result[sample_state_code]}, indent=2, ensure_ascii=False))

        return True

    except Exception as e:
        # Catch and report any major errors during the fetch process
        print(f"❌ 심각한 오류: {str(e)}")
        return False

if __name__ == "__main__":
    fetch_truck_data()
