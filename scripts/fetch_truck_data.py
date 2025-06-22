#!/usr/bin/env python3
import os
import json
import gspread
from google.oauth2 import service_account
from typing import Dict, List, Union, Optional

def safe_convert(value: Union[str, float, int], default=None) -> Union[float, int, None]:
    """Enhanced safe conversion with comma handling"""
    if value in (None, "", " ", "N/A", "NaN", "null"):
        return default
    try:
        if isinstance(value, str):
            value = value.replace(",", "").strip()
        return float(value) if "." in str(value) else int(value)
    except (ValueError, TypeError):
        return default

def fetch_truck_data() -> bool:
    print("🚛 Truck 데이터 수집 시작")
    try:
        # 환경 변수 확인
        creds_json = os.getenv("GOOGLE_CREDENTIAL_JSON")
        sheet_id = os.getenv("SPREADSHEET_ID")
        
        if not creds_json or not sheet_id:
            raise ValueError("필수 환경 변수가 설정되지 않았습니다")

        # Google Sheets 인증
        creds = service_account.Credentials.from_service_account_info(
            json.loads(creds_json),
            scopes=["https://www.googleapis.com/auth/spreadsheets"]
        )
        gc = gspread.authorize(creds)

        # 데이터 로드
        worksheet = gc.open_by_key(sheet_id).worksheet("CONGESTION_TRUCK")
        records = worksheet.get_all_records()
        print(f"📊 총 {len(records)}개의 레코드 발견")

        # 데이터 처리
        result = {}
        states = set()

        for idx, row in enumerate(records, 1):
            try:
                state_code = str(row.get("Code", "")).strip()
                if not state_code or len(state_code) != 2:
                    print(f"⚠️ 행 {idx}: 유효하지 않은 주 코드 - 건너뜀")
                    continue

                # 데이터 정제
                data = {
                    "state": str(row.get("State", "")).strip(),
                    "inbound_delay": safe_convert(row.get("Inbound Delay")),
                    "inbound_color": max(-3, min(3, safe_convert(row.get("Inbound Color"), 0))),
                    "outbound_delay": safe_convert(row.get("Outbound Delay")),
                    "outbound_color": max(-3, min(3, safe_convert(row.get("Outbound Color"), 0))),
                    "dwell_inbound": safe_convert(row.get("Dwell Inbound")),
                    "dwell_outbound": safe_convert(row.get("Dwell Outbound")),
                    "updated_at": str(row.get("Date", "")).strip()
                }

                # 메타데이터 수집
                states.add(state_code)
                result[state_code] = data

            except Exception as e:
                print(f"⛔ 행 {idx} 처리 실패: {str(e)}")
                continue

        # 출력 디렉토리 생성
        os.makedirs("../data", exist_ok=True)
        output_path = "../data/us-truck.json"

        # 결과 저장
        final_data = {
            "metadata": {
                "total_states": len(result),
                "state_codes": sorted(states)
            },
            "data": result
        }

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(final_data, f, indent=2, ensure_ascii=False)

        print(f"✅ 성공적으로 저장됨: {output_path}")
        print(f"📌 총 {len(result)}개의 주 데이터 처리 완료")
        return True

    except Exception as e:
        print(f"💥 치명적 오류: {str(e)}")
        return False

if __name__ == "__main__":
    fetch_truck_data()
