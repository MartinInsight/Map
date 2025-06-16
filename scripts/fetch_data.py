import os
import pandas as pd
import gspread
from google.oauth2 import service_account

def fetch_sheet():
    """Google Sheets 데이터를 CSV로 저장 (gspread 버전)"""
    try:
        # 1. 서비스 계정 인증
        creds = service_account.Credentials.from_service_account_file(
            os.environ['GOOGLE_CREDENTIAL_JSON'],
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
        gc = gspread.authorize(creds)
        
        # 2. 시트 열기
        sheet = gc.open_by_key(os.environ['SPREADSHEET_ID'])
        worksheet = sheet.worksheet('CONGESTION_TRUCK')
        
        # 3. 데이터 읽기 (A1:J51 범위)
        data = worksheet.get('A1:J51')
        
        # 4. DataFrame으로 변환
        df = pd.DataFrame(data[1:], columns=data[0])
        
        # 5. CSV 저장
        output_dir = os.path.join(os.path.dirname(__file__), '../data')
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, 'data.csv')
        df.to_csv(output_path, index=False)
        print(f"✅ Data saved to: {output_path}")
        print(f"Loaded {len(df)} rows from CONGESTION_TRUCK!A1:J51")
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        raise

if __name__ == "__main__":
    fetch_sheet()
