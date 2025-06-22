# scripts/fetch_ocean_data.py
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

def get_country_city_data(records):
    countries = set()
    cities = set()
    
    for row in records:
        country = str(row.get('Country', '')).strip()
        port = str(row.get('Port', '')).strip()
        
        if country:
            countries.add(country)
        
        # 포트 이름에서 도시 추출 (예: "Port of Los Angeles" -> "Los Angeles")
        city = port.replace('Port of', '').replace('Port', '').strip()
        if city:
            cities.add(city)
    
    return {
        'countries': sorted(list(countries)),
        'cities': sorted(list(cities))
    }

def fetch_ocean_data():
    print("🔵 Ocean 데이터 수집 시작")
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
        worksheet = sheet.worksheet('CONGESTION_OCEAN')
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
                
                # 데이터 정제
                data = {
                    'date': str(row.get('Date', '')).strip(),
                    'port': str(row.get('Port', '')).strip(),
                    'country': str(row.get('Country', '')).strip(),
                    'country_code': str(row.get('Country Code', '')).strip().lower(),
                    'port_code': str(row.get('Port Code', '')).strip(),
                    'current_delay_days': safe_convert(row.get('Current Delay (days)')),
                    'current_delay': str(row.get('Current Delay', '')).strip(),
                    'delay_level': str(row.get('Delay Level', '')).strip().lower(),
                    'lat': lat,
                    'lng': lng,
                    'weekly_median_delay': safe_convert(row.get('Weekly Median Delay')),
                    'weekly_max_delay': safe_convert(row.get('Weekly Max Delay')),
                    'fortnightly_median_delay': safe_convert(row.get('Fortnightly Median Delay')),
                    'fortnightly_max_delay': safe_convert(row.get('Fortnightly Max Delay')),
                    'monthly_median_delay': safe_convert(row.get('Monthly Median Delay')),
                    'monthly_max_delay': safe_convert(row.get('Monthly Max Delay'))
                }
                
                result.append(data)
                
            except Exception as e:
                print(f"⚠️ 행 처리 오류 - {row.get('Port')}: {str(e)}")
                continue
        
        # JSON 저장
        output_dir = os.path.join(os.path.dirname(__file__), '../data')
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, 'global-ports.json')
        
        # 메타데이터 생성
        metadata = {
            'data': result,
            'metadata': {
                'countries_cities': get_country_city_data(records)
            }
        }
        
        # JSON 저장 부분 수정
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)
            
        print(f"✅ Ocean 데이터 저장 완료: {output_path}")
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
    fetch_ocean_data()
