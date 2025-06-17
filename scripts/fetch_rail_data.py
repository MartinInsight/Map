# scripts/fetch_rail_data.py
import os
import gspread
import json
from google.oauth2 import service_account

def fetch_rail_data():
    try:
        # 인증 설정
        creds_dict = eval(os.environ['GOOGLE_CREDENTIAL_JSON'])
        creds = service_account.Credentials.from_service_account_info(
            creds_dict,
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
        gc = gspread.authorize(creds)
        
        # 데이터 로드
        sheet = gc.open_by_key(os.environ['SPREADSHEET_ID'])
        worksheet = sheet.worksheet('CONGESTION_RAILD')
        records = worksheet.get_all_records()
        
        # 데이터 처리
        result = []
        for row in records:
            if not row.get('Latitude') or not row.get('Longitude'):
                continue
                
            result.append({
                'date': row.get('Timestamp', ''),
                'company': row.get('Company', 'Unknown'),
                'location': row.get('Location', 'Unknown'),
                'lat': float(row['Latitude']),
                'lng': float(row['Longitude']),
                'congestion_score': float(row.get('Congestion Score', 0)),
                'congestion_level': row.get('Congestion Level', 'Average')
            })
        
        # JSON 저장
        output_dir = os.path.join(os.path.dirname(__file__), '../data')
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, 'us-rail.json')
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2)
            
        print("✅ Rail data saved:", output_path)
        return True
        
    except Exception as e:
        print(f"❌ Rail data error: {str(e)}")
        return False

if __name__ == "__main__":
    fetch_rail_data()
