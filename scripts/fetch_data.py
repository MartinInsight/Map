import gspread
import json
import os
import sys
from pathlib import Path
from tempfile import NamedTemporaryFile
from oauth2client.service_account import ServiceAccountCredentials

def ensure_data_dir():
    """데이터 디렉토리 강제 생성"""
    data_dir = Path(os.getenv('GITHUB_WORKSPACE', '.')) / 'data'
    data_dir.mkdir(exist_ok=True, mode=0o755)
    return data_dir

def secure_cleanup(file_path):
    """파일을 안전하게 삭제"""
    try:
        if file_path and os.path.exists(file_path):
            os.unlink(file_path)
    except Exception as e:
        print(f"파일 삭제 실패: {str(e)}", file=sys.stderr)

def load_credentials(credential_json):
    """보안 강화된 인증 처리"""
    temp_path = None
    try:
        # 임시 파일 생성 (600 권한)
        with NamedTemporaryFile(mode='w', delete=False) as temp_file:
            temp_file.write(credential_json)
            temp_path = temp_file.name
        os.chmod(temp_path, 0o600)
        
        scope = [
            "https://www.googleapis.com/auth/spreadsheets.readonly",
            "https://www.googleapis.com/auth/drive.metadata.readonly"
        ]
        return ServiceAccountCredentials.from_json_keyfile_name(temp_path, scope)
    finally:
        if temp_path:
            secure_cleanup(temp_path)

def fetch_sheet_data(credential_json, spreadsheet_id):
    """시트 데이터 가져오기"""
    try:
        creds = load_credentials(credential_json)
        gc = gspread.authorize(creds)
        return gc.open_by_key(spreadsheet_id).sheet1.get_all_records()
    except Exception as e:
        print(f"Google Sheets 접근 오류: {str(e)}", file=sys.stderr)
        raise

def sanitize_input(value, default=0, type_cast=float):
    """데이터 검증 및 변환"""
    try:
        return type_cast(value) if value not in ('', None) else default
    except (ValueError, TypeError):
        return default

def process_data(records):
    """데이터 가공"""
    processed = {}
    required_fields = {'State', 'Code', 'Inbound Delay', 'Outbound Delay'}
    
    for row in records:
        if not all(field in row for field in required_fields):
            continue
            
        processed[row['Code']] = {
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

# scripts/fetch_data.py
def save_json(data, file_path):
    """JSON 저장을 보장하는 함수"""
    temp_path = f"{file_path}.tmp"
    try:
        with open(temp_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        # 파일 존재 여부 확인
        if not os.path.exists(temp_path):
            raise IOError("임시 파일 생성 실패")
            
        os.replace(temp_path, file_path)
        print(f"파일 생성 확인: {os.path.abspath(file_path)}")
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise

if __name__ == "__main__":
    try:
        # 1. 환경 변수 검증
        cred_json = os.environ.get('GOOGLE_CREDENTIAL_JSON')
        sheet_id = os.environ.get('SPREADSHEET_ID')
        if not cred_json or not sheet_id:
            raise EnvironmentError("필수 환경 변수가 설정되지 않았습니다")

        # 2. 출력 디렉토리 준비
        output_dir = ensure_data_dir()
        output_file = output_dir / 'states-data.json'

        # 3. 데이터 처리
        raw_data = fetch_sheet_data(cred_json, sheet_id)
        processed_data = process_data(raw_data)
        
        if not processed_data:
            raise ValueError("처리된 데이터가 없습니다")

        # 4. 파일 저장
        save_json(processed_data, output_file)
        print(f"처리 완료: {len(processed_data)}개의 주 데이터")

    except Exception as e:
        print(f"오류 발생: {str(e)}", file=sys.stderr)
        sys.exit(1)
