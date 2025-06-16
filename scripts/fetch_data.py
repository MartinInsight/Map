import os
import pandas as pd
from google.oauth2 import service_account

def fetch_sheet():
    # Google Sheets 인증
    creds = service_account.Credentials.from_service_account_file(
        os.environ['GOOGLE_CREDS_JSON'],
        scopes=['https://www.googleapis.com/auth/spreadsheets.readonly']
    )
    
    # 데이터 로드
    sheet_id = os.environ['SPREADSHEET_ID']
    df = pd.read_csv(
        f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv",
        storage_options={"token": creds}  # 인증 정보 추가
    )
    
    # CSV 저장 (상대 경로 정확히 지정)
    output_path = os.path.join(os.path.dirname(__file__), "../data/data.csv")
    df.to_csv(output_path, index=False)  # 괄호 주의!
    print(f"Data saved to: {output_path}")

if __name__ == "__main__":
    fetch_sheet()
