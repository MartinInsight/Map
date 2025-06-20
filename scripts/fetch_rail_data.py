# scripts/fetch_rail_data.py
import os
import gspread
import json
from google.oauth2 import service_account

def safe_convert_float(val, default=0.0):
    """안전한 float 변환 함수"""
    if val in [None, "", " "]:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default

def determine_congestion_level(indicator):
    """Indicator 값에 따라 혼잡도 레벨 결정"""
    if indicator > 2:
        return 'Very High'
    elif indicator > 1:
        return 'High'
    elif indicator > -1:
        return 'Average'
    elif indicator > -2:
        return 'Low'
    else:
        return 'Very Low'

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
                # 필수 필드 확인 (위도/경도/회사명)
                if not all([row.get('Latitude'), row.get('Longitude'), row.get('Railroad')]):
                    print(f"⚠️ 필수 데이터 누락 - 행 건너뜀: {row}")
                    continue
                    
                # 위치 정보 결정
                location = row.get('Location', '') or row.get('Yard', '')
                if not location:
                    print(f"⚠️ 위치 정보 없음 - 행 건너뜀: {row}")
                    continue
                
                # 숫자 데이터 변환 (공란 대체값 적용)
                indicator = safe_convert_float(row.get('Indicator', 0))
                dwell_time = safe_convert_float(row.get('Dwell Time', 0))
                
                result.append({
                    'date': str(row.get('Date', '')).strip(),
                    'company': str(row.get('Railroad', '')).strip(),
                    'location': location.strip(),
                    'lat': safe_convert_float(row['Latitude']),
                    'lng': safe_convert_float(row['Longitude']),
                    'congestion_score': dwell_time,
                    'indicator': indicator,
                    'congestion_level': determine_congestion_level(indicator)
                })
            except Exception as e:
                print(f"⚠️ 데이터 처리 오류 건너뜀 - 행: {row}, 오류: {str(e)}")
                continue
        
        # JSON 저장
        output_dir = os.path.join(os.path.dirname(__file__), '../data')
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, 'us-rail.json')
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
            
        print(f"✅ Rail 데이터 저장 완료: {output_path}")
        print(f"🔄 생성된 데이터 개수: {len(result)}")
        
        # 샘플 데이터 출력
        if result:
            print("\n🔍 생성된 데이터 샘플:")
            print(json.dumps(result[0], indent=2, ensure_ascii=False))
        return True
        
    except Exception as e:
        print(f"❌ 심각한 오류: {str(e)}")
        return False

if __name__ == "__main__":
    fetch_rail_data()
