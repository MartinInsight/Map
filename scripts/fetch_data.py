import gspread
import json
import os
import sys
from tempfile import NamedTemporaryFile
from oauth2client.service_account import ServiceAccountCredentials

def secure_cleanup(file_path):
    """파일을 안전하게 삭제"""
    try:
        if os.path.exists(file_path):
            os.unlink(file_path)
    except Exception as e:
        print(f"파일 삭제 실패: {str(e)}")

def get_output_path():
    """출력 경로 결정 (권한 설정 포함)"""
    if 'GITHUB_WORKSPACE' in os.environ:
        path = os.path.join(os.environ['GITHUB_WORKSPACE'], 'data')
        os.makedirs(path, exist_ok=True, mode=0o700)  # 소유자만 접근 가능
        return os.path.join(path, 'states-data.json')
    else:
        local_path = '../data'
        os.makedirs(local_path, exist_ok=True, mode=0o700)
        return os.path.join(local_path, 'states-data.json')

def load_credentials(credential_json):
    """보안 강화된 인증 처리"""
    try:
        # 임시 파일에 쓰기 (600 권한으로 생성)
        with NamedTemporaryFile(mode='w', delete=False) as temp_file:
            temp_file.write(credential_json)
            temp_path = temp_file.name
        os.chmod(temp_path, 0o600)  # 명시적 권한 설정
        
        scope = [
            "https://www.googleapis.com/auth/spreadsheets.readonly",  # 읽기 전용
            "https://www.googleapis.com/auth/drive.metadata.readonly"  # 메타데이터만
        ]
        creds = ServiceAccountCredentials.from_json_keyfile_name(temp_path, scope)
        return creds
    finally:
        secure_cleanup(temp_path)  # 임시 파일 즉시 삭제

def fetch_sheet_data(credential_json):
    """시트 데이터 가져오기 (보안 버전)"""
    try:
        creds = load_credentials(credential_json)
        gc = gspread.authorize(creds)
        
        sheet = gc.open_by_key(os.environ['SPREADSHEET_ID']).sheet1
        return sheet.get_all_records()
    except Exception as e:
        print(f"Google Sheets 접근 오류: {str(e)}")
        raise

def sanitize_input(value, default=0, type_cast=float):
    """데이터 무결성 검증"""
    try:
        return type_cast(value) if value not in ('', None) else default
    except (ValueError, TypeError):
        return default

def process_data(records):
    """데이터 가공 (보안 강화)"""
    processed = {}
    required_fields = {'State', 'Code', 'Inbound Delay', 'Outbound Delay'}
    
    for row in records:
        if not all(field in row for field in required_fields):
            continue
            
        code = row['Code']
        processed[code] = {
            "name": str(row.get('State', '')),
            "inbound": {
                "delay": sanitize_input(row.get('Inbound Delay')),
                "color": sanitize_input(row.get('Inbound Color'), type_cast=int),
                "dwell": sanitize_input(row.get('Dwell Inbound'))
            },
            "outbound": {
                "delay": sanitize_input(row.get('Outbound Delay')),
                "color": sanitize_input(row.get('Outbound Color'), type_cast=int),
                "dwell": sanitize_input(row.get('Dwell Outbound'))
            }
        }
    return processed

def validate_output(data):
    """출력 데이터 검증"""
    if not isinstance(data, dict) or len(data) < 1:
        raise ValueError("유효하지 않은 출력 데이터")
    return True

if __name__ == "__main__":
    try:
        # 0. 환경 변수 검증
        if 'GOOGLE_CREDENTIAL_JSON' not in os.environ:
            raise EnvironmentError("GOOGLE_CREDENTIAL_JSON 환경 변수 없음")
        
        # 1. 출력 경로 설정
        output_file = get_output_path()
        
        # 2. 데이터 처리
        raw_data = fetch_sheet_data(os.environ['GOOGLE_CREDENTIAL_JSON'])
        processed_data = process_data(raw_data)
        validate_output(processed_data)
        
        # 3. 파일 저장 (Atomic write)
        temp_output = f"{output_file}.tmp"
        with open(temp_output, 'w', encoding='utf-8') as f:
            json.dump(processed_data, f, indent=2, ensure_ascii=False)
        os.replace(temp_output, output_file)  # 원자적 교체
        
        print(f"파일 생성 성공: {output_file}")
        print(f"처리된 주 개수: {len(processed_data)}")
        print("보안 검증 통과")
        
    except Exception as e:
        print(f"심각한 오류: {str(e)}", file=sys.stderr)
        secure_cleanup(getattr(locals(), 'temp_output', ''))  # 임시 파일 정리
        sys.exit(1)
