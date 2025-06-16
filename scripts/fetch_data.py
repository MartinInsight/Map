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
        # 서비스 계정 인증 (JSON 문자열 파싱)
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
        
        # JSON 변환 (명시적 컬럼 매핑)
        result = {
            row['Code']: {
                'name': row['State'],
                'inboundDelay': row.get('Inbound Delay', 0),
                'inboundColor': row.get('Inbound Color', 0),
                'outboundDelay': row.get('Outbound Delay', 0),
                'outboundColor': row.get('Outbound Color', 0),
                'dwellInbound': row.get('Dwell Inbound', 0),
                'dwellOutbound': row.get('Dwell Outbound', 0)
            } for row in records if row.get('Code')
        }
        
        # JSON 저장 전 데이터 검증 추가
        for code, values in result.items():
            for key in ['inboundDelay', 'outboundDelay', 'dwellInbound', 'dwellOutbound']:
                if not isinstance(values[key], (int, float)):
                    print(f"⚠️ {code}의 {key} 값이 숫자가 아님: {values[key]}")
                    values[key] = 0  # 기본값 설정
        
        # 수정된 저장 부분
        output_dir = os.path.join(os.path.dirname(__file__), '../data')
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, 'data.json')
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2)
        print(f"✅ 저장 경로: {os.path.abspath(output_path)}")
        print("샘플 데이터:", json.dumps({k: result[k] for k in list(result.keys())[:2]}, indent=2))
        
    except Exception as e:
        print(f"❌ 심각한 오류: {str(e)}")
        raise

if __name__ == "__main__":
    fetch_sheet()
