import os
import pandas as pd
import json
from google.oauth2 import service_account

def fetch_sheet():
    try:
        # 서비스 계정 인증
        creds = service_account.Credentials.from_service_account_info(
            eval(os.environ['GOOGLE_CREDENTIAL_JSON']),
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
        
        # 데이터 로드
        sheet_id = os.environ['SPREADSHEET_ID']
        url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:json"
        response = pd.read_json(url, storage_options={"token": creds})
        data = [r['c'] for r in response['table']['rows']]
        
        # JSON으로 변환
        result = {}
        for row in data:
            if len(row) >= 9:  # 컬럼 수 확인
                code = row[1]['v']
                result[code] = {
                    'name': row[0]['v'],
                    'inboundDelay': row[2]['v'],
                    'inboundColor': row[3]['v'],
                    'outboundDelay': row[4]['v'],
                    'outboundColor': row[5]['v'],
                    'dwellInbound': row[6]['v'],
                    'dwellOutbound': row[8]['v']
                }
        
        # JSON 저장
        os.makedirs('data', exist_ok=True)
        with open('data/data.json', 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        
        print("✅ JSON 저장 완료")
        
    except Exception as e:
        print(f"❌ 오류 발생: {str(e)}")
        raise

if __name__ == "__main__":
    fetch_sheet()
