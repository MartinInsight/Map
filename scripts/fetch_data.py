import os
import pandas as pd
from google.oauth2 import service_account

def fetch_sheet():
    """Google Sheets 특정 시트와 범위에서 데이터를 CSV로 저장"""
    try:
        # 1. 서비스 계정 인증
        creds = service_account.Credentials.from_service_account_file(
            os.environ['GOOGLE_CREDENTIAL_JSON'],
            scopes=['https://www.googleapis.com/auth/spreadsheets.readonly']
        )
        
        # 2. 파라미터 설정
        sheet_id = os.environ['SPREADSHEET_ID']
        sheet_name = 'CONGESTION_TRUCK'  # 시트 이름 명시
        range_name = 'A1:J51'            # 데이터 범위 지정
        
        # 3. API URL 구성 (시트 이름과 범위 포함)
        url = (
            f"https://docs.google.com/spreadsheets/d/{sheet_id}/"
            f"gviz/tq?tqx=out:csv&sheet={sheet_name}&range={range_name}"
        )
        
        # 4. 데이터 로드
        df = pd.read_csv(url, storage_options={"token": creds})
        
        # 5. CSV 저장
        output_dir = os.path.join(os.path.dirname(__file__), '../data')
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, 'data.csv')
        df.to_csv(output_path, index=False)
        print(f"✅ Data saved to: {output_path}")
        print(f"Loaded {len(df)} rows from {sheet_name}!{range_name}")
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        raise

if __name__ == "__main__":
    fetch_sheet()
