# scripts/fetch_air_data.py
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

def fetch_air_data():
    print("🔵 Air 데이터 수집 시작")
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
        worksheet = sheet.worksheet('CONGESTION_AIR')
        records = worksheet.get('A2:M61')  # A2:M61 범위 데이터 가져오기
        headers = worksheet.get('A1:M1')[0]  # 헤더 행 가져오기
        print(f"📝 레코드 개수: {len(records)}")
        
        # 데이터 처리
        result = []
        for row in records:
            try:
                # 행을 딕셔너리로 변환
                row_dict = dict(zip(headers, row))
                
                # 필수 필드 확인
                lat = safe_convert(row_dict.get('latitude_deg'))
                lng = safe_convert(row_dict.get('longitude_deg'))
                code = row_dict.get('Code', '').strip()
                if None in [lat, lng] or not code:
                    continue
                
                # 데이터 정제
                data = {
                    'airport_code': code,
                    'scheduled': safe_convert(row_dict.get('Scheduled')),
                    'completed': safe_convert(row_dict.get('Completed')),
                    'departed': safe_convert(row_dict.get('Departed')),
                    'cancelled': safe_convert(row_dict.get('Cancelled')),
                    'completion_factor': safe_convert(row_dict.get('Completion Factor')),
                    'd15': safe_convert(row_dict.get('D15')),
                    'a14': safe_convert(row_dict.get('A14')),
                    'd0_percent': safe_convert(row_dict.get('D0 Percent')),
                    'average_txo': safe_convert(row_dict.get('Average TXO')),
                    'last_updated': row_dict.get('Last Updated', '').strip(),
                    'lat': lat,
                    'lng': lng
                }
                
                result.append(data)
                
            except Exception as e:
                print(f"⚠️ 행 처리 오류 - {row_dict.get('Code', 'Unknown')}: {str(e)}")
                continue
        
        # JSON 저장
        output_dir = os.path.join(os.path.dirname(__file__), '../data')
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, 'us-air.json')
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
            
        print(f"✅ Air 데이터 저장 완료: {output_path}")
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
    fetch_air_data()
