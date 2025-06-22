# scripts/fetch_rail_data.py
import os
import gspread
import json
from google.oauth2 import service_account

def safe_convert(val, default=None):
    """안전한 데이터 변환 함수"""
    if val in [None, "", " ", "N/A", "NaN"]:
        return default
    try:
        return float(val) if "." in str(val) else int(val)
    except (ValueError, TypeError):
        return default

def get_rail_locations(records):
    locations = set()
    for row in records:
        location = str(row.get('Location', '') or row.get('Yard', '')).strip()
        if location:
            # "Chicago, IL" -> "Chicago"
            city = location.split(',')[0].strip()
            locations.add(city)
    return sorted(list(locations))

def fetch_rail_data():
    print("🔵 Rail 데이터 수집 시작")
    try:
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
        worksheet = sheet.worksheet('CONGESTION_RAIL')
        records = worksheet.get_all_records()
        print(f"📝 레코드 개수: {len(records)}")
        
        # 데이터 처리
        result = []
        for row in records:
            try:
                # 필수 필드 확인
                lat = safe_convert(row.get('Latitude'))
                lng = safe_convert(row.get('Longitude'))
                if None in [lat, lng]:
                    continue
                    
                # 위치 정보 결정
                location = row.get('Location', '') or row.get('Yard', '')
                if not location:
                    continue
                
                # 데이터 정제
                data = {
                    'date': str(row.get('Date', '')).strip(),
                    'company': str(row.get('Railroad', '')).strip(),
                    'location': location.strip(),
                    'lat': lat,
                    'lng': lng,
                    'congestion_score': safe_convert(row.get('Dwell Time')),
                    'indicator': safe_convert(row.get('Indicator')),
                    'congestion_level': row.get('Category', 'Unknown')
                }
                
                result.append(data)
                
            except Exception as e:
                print(f"⚠️ 행 처리 오류 - {row.get('Location')}: {str(e)}")
                continue
        
        # JSON 저장
        output_dir = os.path.join(os.path.dirname(__file__), '../data')
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, 'us-rail.json')
        
        metadata = {
            'data': result,
            'metadata': {
                'cities': get_rail_locations(records)
            }
        }
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)
            
        print(f"✅ Rail 데이터 저장 완료: {output_path}")
        print(f"🔄 생성된 데이터 개수: {len(result)}")
        
        # 샘플 데이터 출력
        if result:
            print("\n🔍 샘플 데이터:")
            print(json.dumps(result[0], indent=2))
            
        return True
        
    except Exception as e:
        print(f"❌ 심각한 오류: {str(e)}")
        return False

if __name__ == "__main__":
    fetch_rail_data()
