import gspread
import json
import os
from oauth2client.service_account import ServiceAccountCredentials

def main():
    # 1. 서비스 계정 인증 (편집 권한 필요)
    scope = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive"
    ]
    creds = ServiceAccountCredentials.from_json_keyfile_dict(
        json.loads(os.environ['GOOGLE_CREDENTIAL_JSON']),
        scope
    )
    gc = gspread.authorize(creds)

    # 2. 시트 데이터 읽기
    sheet = gc.open_by_key(os.environ['SPREADSHEET_ID']).sheet1
    records = sheet.get_all_records()

    # 3. JSON으로 변환
    data = {
        row['Code']: {
            'name': row['State'],
            'inbound': row['Inbound Delay'],
            'outbound': row['Outbound Delay']
        } for row in records if row.get('Code')
    }

    # 4. 파일 저장 (GitHub Actions 경로)
    os.makedirs('./data', exist_ok=True)
    with open('./data/states-data.json', 'w') as f:
        json.dump(data, f, indent=2)
    print("JSON 생성 완료")

if __name__ == "__main__":
    main()
