import os
import gspread
import json
from google.oauth2 import service_account

def safe_convert_number(val):
    """빈 셀/문자열을 안전하게 숫자로 변환"""
    if val in [None, "", " ", "N/A", "NaN"]:
        return None  # 명시적으로 None 반환
    try:
        return float(val)
    except:
        return None

def fetch_sheet():
    try:
        # 인증 설정
        creds_dict = eval(os.environ['GOOGLE_CREDENTIAL_JSON'])
        creds = service_account.Credentials.from_service_account_info(
            creds_dict,
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
        gc = gspread.authorize(creds)
        
        # 데이터 로드
        sheet = gc.open_by_key(os.environ['SPREADSHEET_ID'])
        worksheet = sheet.worksheet('CONGESTION_TRUCK')
        records = worksheet.get_all_records()
        
        # 데이터 처리
        result = {}
        for row in records:
            if not row.get('Code'):
                continue
                
            result[row['Code']] = {
                'name': row.get('State', 'Unknown'),
                'inboundDelay': safe_convert_number(row.get('Inbound Delay')),
                'inboundColor': int(safe_convert_number(row.get('Inbound Color')) or 0),
                'outboundDelay': safe_convert_number(row.get('Outbound Delay')),
                'outboundColor': int(safe_convert_number(row.get('Outbound Color')) or 0),
                'dwellInbound': safe_convert_number(row.get('Dwell Inbound')),
                'dwellOutbound': safe_convert_number(row.get('Dwell Outbound'))
            }
        
        # JSON 저장
        output_dir = os.path.join(os.path.dirname(__file__), '../data')
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, 'data.json')
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, default=lambda o: None if o is None else o)
            
        print("✅ 데이터 저장 완료:", output_path)
        return True
        
    except Exception as e:
        print(f"❌ 심각한 오류: {str(e)}")
        return False

if __name__ == "__main__":
    fetch_sheet()
