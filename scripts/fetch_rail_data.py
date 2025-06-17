# scripts/fetch_rail_data.py
import os
import gspread
import json
from google.oauth2 import service_account

def fetch_rail_data():
    try:
        print("🔵 Rail 데이터 수집 시작")
        
        # 인증 설정
        creds_dict = eval(os.environ['GOOGLE_CREDENTIAL_JSON'])
        creds = service_account.Credentials.from_service_account_info(
            creds_dict,
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
        gc = gspread.authorize(creds)
        print("✅ Google 인증 성공")
        
        # 데이터 로드
        sheet = gc.open_by_key(os.environ['SPREADSHEET_ID'])
        print(f"📊 시트 제목: {sheet.title}")
        
        # 사용 가능한 워크시트 목록 출력
        print("📋 사용 가능한 워크시트:")
        for ws in sheet.worksheets():
            print(f"- {ws.title}")
        
        try:
            worksheet = sheet.worksheet('CONGESTION_RAIL')
            print("✅ CONGESTION_RAIL 시트 찾음")
        except gspread.exceptions.WorksheetNotFound:
            available_sheets = [ws.title for ws in sheet.worksheets()]
            raise Exception(f"❌ CONGESTION_RAIL 시트를 찾을 수 없습니다. 사용 가능한 시트: {available_sheets}")
        
        records = worksheet.get_all_records()
        print(f"📝 레코드 개수: {len(records)}")
        
        # 데이터 처리
        result = []
        for row in records:
            if not row.get('Latitude') or not row.get('Longitude'):
                continue
                
            result.append({
                'date': row.get('Date', '').strip() or 'N/A',
                'company': row.get('Railroad', '').strip() or 'Unknown',  # Railroad 열 사용
                'location': row.get('Location', '').strip() or row.get('Yard', '').strip() or 'Unknown',
                'lat': float(row.get('Latitude', 0)),
                'lng': float(row.get('Longitude', 0)),
                'congestion_score': float(row.get('Dwell Time', 0)),  # Dwell Time을 congestion_score로
                'congestion_level': row.get('Category', '').strip() or 'Average'  # Category 열 사용
            })
        
        # JSON 저장
        output_dir = os.path.join(os.path.dirname(__file__), '../data')
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, 'us-rail.json')
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2)
            
        print(f"✅ Rail 데이터 저장 완료: {output_path}")
        print(f"🔄 생성된 데이터 개수: {len(result)}")
        return True
        
    except Exception as e:
        print(f"❌ 심각한 오류: {str(e)}")
        return False

if __name__ == "__main__":
    fetch_rail_data()
