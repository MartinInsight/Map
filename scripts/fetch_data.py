import os
import gspread
import json
from google.oauth2 import service_account

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
        
        # JSON 저장 (절대 경로 사용)
        os.makedirs('data', exist_ok=True)
        output_path = os.path.abspath('data/data.json')
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        
        print(f"✅ JSON 저장 완료: {output_path}")
        print("샘플 데이터:", json.dumps({k: result[k] for k in list(result.keys())[:2]}, indent=2))
        
    except Exception as e:
        print(f"❌ 심각한 오류: {str(e)}")
        raise

if __name__ == "__main__":
    fetch_sheet()
