import gspread
import json
import os
from oauth2client.service_account import ServiceAccountCredentials

def main():
    # 1. Google Sheets 인증
    creds = ServiceAccountCredentials.from_json_keyfile_dict(
        json.loads(os.environ['GOOGLE_CREDENTIAL_JSON']),
        ["https://www.googleapis.com/auth/spreadsheets"]
    )
    gc = gspread.authorize(creds)
    
    # 2. 데이터 추출
    sheet = gc.open_by_key(os.environ['SPREADSHEET_ID']).sheet1
    records = sheet.get_all_records()
    
    # 3. JSON 변환
    data = {
        row['Code']: {
            'name': row['State'],
            'inbound': row.get('Inbound Delay', 0),
            'outbound': row.get('Outbound Delay', 0)
        } for row in records if 'Code' in row
    }
    
    # 4. 파일 저장 (기존 data 폴더에)
    with open('data/states-data.json', 'w') as f:
        json.dump(data, f, indent=2)
    print(f"{len(data)}개 주 데이터 저장 완료")

if __name__ == "__main__":
    main()
