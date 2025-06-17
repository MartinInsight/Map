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
            try:
                # 필수 필드 확인
                if not all([row.get('Latitude'), row.get('Longitude'), row.get('Railroad')]):
                    continue
                    
                # 데이터 정제
                location = row.get('Location', '') or row.get('Yard', '')
                if not location:
                    continue
                    
                result.append({
                    'date': row.get('Date', '').strip(),
                    'company': row.get('Railroad', '').strip(),
                    'location': location.strip(),
                    'lat': float(row['Latitude']),
                    'lng': float(row['Longitude']),
                    'congestion_score': float(row.get('Dwell Time', 0)),
                    'congestion_level': row.get('Category', 'Average').strip()
                })
            except Exception as e:
                print(f"⚠️ 데이터 처리 오류 건너뜀 - 행: {row}, 오류: {str(e)}")
                continue
        
        # JSON 저장
        output_dir = os.path.join(os.path.dirname(__file__), '../data')
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, 'us-rail.json')
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False, default=str)
            
        print(f"✅ Rail 데이터 저장 완료: {output_path}")
        print(f"🔄 생성된 데이터 개수: {len(result)}")
        return True
        
    except Exception as e:
        print(f"❌ 심각한 오류: {str(e)}")
        return False

if __name__ == "__main__":
    if fetch_rail_data():
        print("\n🔍 생성된 데이터 샘플:")
        try:
            with open('../data/us-rail.json', 'r', encoding='utf-8') as f:
                data = json.load(f)
                print(json.dumps(data[:3], indent=2, ensure_ascii=False))  # 처음 3개 항목 출력
        except Exception as e:
            print(f"생성된 파일 확인 오류: {str(e)}")
