import os
import pandas as pd
import gspread
from google.oauth2 import service_account

def fetch_sheet():
    """Google Sheets 데이터를 CSV로 저장"""
    try:
        # 서비스 계정 인증 (JSON 내용 직접 사용)
        creds_json = os.environ['GOOGLE_CREDENTIAL_JSON']
        creds = service_account.Credentials.from_service_account_info(
            eval(creds_json),
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
        gc = gspread.authorize(creds)
        
        # 데이터 로드
        sheet = gc.open_by_key(os.environ['SPREADSHEET_ID'])
        worksheet = sheet.worksheet('CONGESTION_TRUCK')
        records = worksheet.get_all_records(expected_headers=[
            'State', 'Code', 'Inbound Delay', 'Inbound Color',
            'Outbound Delay', 'Outbound Color', 'Dwell Inbound',
            'Dwell Inbound Color', 'Dwell Outbound', 'Dwell Outbound Color'
        ])
        
        # CSV 저장
        df = pd.DataFrame(records)
        os.makedirs('data', exist_ok=True)
        df.to_csv('data/data.csv', index=False)
        print(f"✅ Data saved to: data/data.csv")
        print(f"Loaded {len(df)} rows")
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        raise

if __name__ == "__main__":
    fetch_sheet()
