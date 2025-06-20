# scripts/fetch_truck_data.py
import os
import gspread
import json
from google.oauth2 import service_account

def safe_convert_number(val, default=None):
    """
    안전한 숫자 변환 함수
    Args:
        val: 변환할 값
        default: 변환 실패 시 반환할 기본값
    Returns:
        변환된 숫자 또는 기본값
    """
    if val in [None, "", " ", "N/A", "NaN", "null"]:
        return default
        
    try:
        # 문자열인 경우 전처리 (쉼표 제거 등)
        if isinstance(val, str):
            val = val.replace(",", "").strip()
        return float(val)
    except (ValueError, TypeError) as e:
        print(f"⚠️ 숫자 변환 경고: 값 '{val}'을(를) {default}로 대체합니다. 오류: {str(e)}")
        return default

def fetch_truck_data():
    print("🚛 Truck 데이터 수집 시작")
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
        print(f"📊 시트 제목: {sheet.title}")
        
        # 사용 가능한 워크시트 목록 출력
        print("📋 사용 가능한 워크시트:")
        for ws in sheet.worksheets():
            print(f"- {ws.title}")
        
        try:
            worksheet = sheet.worksheet('CONGESTION_TRUCK')
            print("✅ CONGESTION_TRUCK 시트 찾음")
        except gspread.exceptions.WorksheetNotFound:
            available_sheets = [ws.title for ws in sheet.worksheets()]
            raise Exception(f"❌ CONGESTION_TRUCK 시트를 찾을 수 없습니다. 사용 가능한 시트: {available_sheets}")
        
        records = worksheet.get_all_records()
        print(f"📝 레코드 개수: {len(records)}")
        
        # 데이터 처리
        result = {}
        skipped_rows = 0
        
        for idx, row in enumerate(records, start=2):  # 행 번호는 2부터 시작 (헤더 제외)
            try:
                state_code = row.get('Code')
                if not state_code:
                    print(f"⚠️ 행 {idx} 건너뜀: State Code 없음")
                    skipped_rows += 1
                    continue
                    
                # 데이터 정제
                inbound_color = safe_convert_number(row.get('Inbound Color'), 0)
                outbound_color = safe_convert_number(row.get('Outbound Color'), 0)
                
                # 색상 값 범위 제한 (-3 ~ 3)
                inbound_color = max(-3, min(3, inbound_color))
                outbound_color = max(-3, min(3, outbound_color))
                
                result[state_code] = {
                    'name': str(row.get('State', 'Unknown')).strip(),
                    'inboundDelay': safe_convert_number(row.get('Inbound Delay')),
                    'inboundColor': int(inbound_color),
                    'outboundDelay': safe_convert_number(row.get('Outbound Delay')),
                    'outboundColor': int(outbound_color),
                    'dwellInbound': safe_convert_number(row.get('Dwell Inbound')),
                    'dwellOutbound': safe_convert_number(row.get('Dwell Outbound'))
                }
                
            except Exception as e:
                print(f"⚠️ 행 {idx} 처리 오류 건너뜀 - 오류: {str(e)}")
                skipped_rows += 1
                continue
        
        # JSON 저장
        output_dir = os.path.join(os.path.dirname(__file__), '../data')
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, 'us-truck.json')  # 파일명 명시적으로 변경
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False, default=lambda o: None if o is None else o)
            
        print(f"✅ Truck 데이터 저장 완료: {output_path}")
        print(f"🔄 생성된 데이터 개수: {len(result)}")
        print(f"⏩ 건너뛴 행 개수: {skipped_rows}")
        
        # 샘플 데이터 출력
        if result:
            first_key = next(iter(result))
            print("\n🔍 생성된 데이터 샘플:")
            print(json.dumps({first_key: result[first_key]}, indent=2, ensure_ascii=False))
            
        return True
        
    except Exception as e:
        print(f"❌ 심각한 오류: {str(e)}")
        return False

if __name__ == "__main__":
    fetch_truck_data()
