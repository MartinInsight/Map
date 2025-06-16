import os
import pandas as pd
import gspread
from google.oauth2 import service_account

def fetch_sheet():
    try:
        # 서비스 계정 인증
        creds = service_account.Credentials.from_service_account_info(
            eval(os.environ['GOOGLE_CREDENTIAL_JSON']),
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
        gc = gspread.authorize(creds)
        
        # 데이터 로드 (정확한 시트 이름과 범위 지정)
        sheet = gc.open_by_key(os.environ['SPREADSHEET_ID'])
        worksheet = sheet.worksheet('CONGESTION_TRUCK')
        data = worksheet.get_all_values()
        
        # CSV 저장 (헤더 포함)
        df = pd.DataFrame(data[1:], columns=data[0])
        os.makedirs('data', exist_ok=True)
        df.to_csv('data/data.csv', index=False, encoding='utf-8-sig')  # UTF-8 BOM 추가
        print("✅ 데이터 저장 완료:", df.head(2))
        
    except Exception as e:
        print(f"❌ 오류 발생: {str(e)}")
        raise

if __name__ == "__main__":
    fetch_sheet()
