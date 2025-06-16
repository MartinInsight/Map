import gspread
import json
import os
from oauth2client.service_account import ServiceAccountCredentials

def get_output_path():
    """환경에 맞는 출력 경로 결정"""
    if 'GITHUB_WORKSPACE' in os.environ:  # GitHub Actions 환경
        return os.path.join(os.environ['GITHUB_WORKSPACE'], 'data', 'states-data.json')
    else:  # 로컬 테스트 환경
        os.makedirs('../data', exist_ok=True)
        return '../data/states-data.json'

def fetch_sheet_data():
    scope = ["https://spreadsheets.google.com/feeds", 
             "https://www.googleapis.com/auth/drive"]
    
    # 서비스 계정 인증 (JSON 문자열 파싱)
    creds_dict = json.loads(os.environ['GOOGLE_CREDENTIAL_JSON'])
    creds = ServiceAccountCredentials.from_json_keyfile_dict(creds_dict, scope)
    gc = gspread.authorize(creds)
    
    # 시트 데이터 읽기
    sheet = gc.open_by_key(os.environ['SPREADSHEET_ID']).sheet1
    return sheet.get_all_records()

def process_data(records):
    """데이터 가공 및 검증"""
    processed = {}
    for row in records:
        if not row.get("Code"):
            continue
            
        processed[row["Code"]] = {
            "name": row.get("State", ""),
            "inbound": {
                "delay": float(row.get("Inbound Delay", 0)),
                "color": int(row.get("Inbound Color", 0)),
                "dwell": float(row.get("Dwell Inbound", 0))
            },
            "outbound": {
                "delay": float(row.get("Outbound Delay", 0)),
                "color": int(row.get("Outbound Color", 0)),
                "dwell": float(row.get("Dwell Outbound", 0))
            }
        }
    return processed

if __name__ == "__main__":
    try:
        # 1. 출력 디렉토리 생성
        output_file = get_output_path()
        os.makedirs(os.path.dirname(output_file), exist_ok=True)
        
        # 2. 데이터 처리
        raw_data = fetch_sheet_data()
        processed_data = process_data(raw_data)
        
        # 3. 파일 저장 (UTF-8 인코딩으로 강제 지정)
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(processed_data, f, indent=2, ensure_ascii=False)
            
        print(f"파일 생성 성공: {output_file}")
        print(f"처리된 주 개수: {len(processed_data)}")
        
    except Exception as e:
        print(f"에러 발생: {str(e)}")
        raise  # 워크플로우에서 실패로 표시되도록
