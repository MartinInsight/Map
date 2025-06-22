#!/usr/bin/env python3
import os
import json
import gspread
from google.oauth2 import service_account
from typing import Dict, List, Union, Optional

def safe_convert(value: Union[str, float, int], default=None) -> Union[float, int, str, None]:
    """Safe value conversion with error handling"""
    if value in (None, "", " ", "N/A", "NaN", "null"):
        return default
    try:
        if isinstance(value, (float, int)):
            return value
        return float(value) if "." in str(value) else int(value)
    except (ValueError, TypeError):
        return default

def fetch_rail_data() -> bool:
    print("🚂 Rail 데이터 수집 시작")
    try:
        # 환경 변수 확인
        if not all(os.getenv(var) for var in ["GOOGLE_CREDENTIAL_JSON", "SPREADSHEET_ID"]):
            raise ValueError("필수 환경 변수가 설정되지 않았습니다")

        # Google Sheets 인증
        creds = service_account.Credentials.from_service_account_info(
            json.loads(os.getenv("GOOGLE_CREDENTIAL_JSON")),
            scopes=["https://www.googleapis.com/auth/spreadsheets"]
        )
        gc = gspread.authorize(creds)

        # 데이터 로드
        worksheet = gc.open_by_key(os.getenv("SPREADSHEET_ID")).worksheet("CONGESTION_RAIL")
        records = worksheet.get_all_records()
        print(f"📊 총 {len(records)}개의 레코드 발견")

        # 데이터 처리
        processed_data = []
        locations = set()
        railroads = set()

        for idx, row in enumerate(records, 1):
            try:
                # 필수 필드 검증
                lat = safe_convert(row.get("Latitude"))
                lng = safe_convert(row.get("Longitude"))
                location = str(row.get("Location", "")).strip() or str(row.get("Yard", "")).strip()
                
                if None in (lat, lng) or not location:
                    print(f"⚠️ 행 {idx}: 필수 데이터 없음 - 건너뜀")
                    continue

                # 데이터 정제
                data = {
                    "railroad": str(row.get("Railroad", "")).strip(),
                    "location": location,
                    "yard": str(row.get("Yard", "")).strip(),
                    "lat": lat,
                    "lng": lng,
                    "dwell_time": safe_convert(row.get("Dwell Time")),
                    "average_dwell": safe_convert(row.get("Average")),
                    "std_dev": safe_convert(row.get("Std Dev")),
                    "indicator": safe_convert(row.get("Indicator")),
                    "category": str(row.get("Category", "")).strip(),
                    "updated_at": str(row.get("Date", "")).strip()
                }

                # 메타데이터 수집
                locations.add(location.split(",")[0].strip())
                railroads.add(data["railroad"])

                processed_data.append(data)

            except Exception as e:
                print(f"⛔ 행 {idx} 처리 실패: {str(e)}")
                continue

        # 출력 디렉토리 생성
        os.makedirs("../data", exist_ok=True)
        output_path = "../data/us-rail.json"

        # 결과 저장
        result = {
            "metadata": {
                "total_yards": len(processed_data),
                "locations": sorted(locations),
                "railroads": sorted(railroads)
            },
            "data": processed_data
        }

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)

        print(f"✅ 성공적으로 저장됨: {output_path}")
        print(f"📌 총 {len(processed_data)}개의 레일야드 데이터 처리 완료")
        return True

    except Exception as e:
        print(f"💥 치명적 오류: {str(e)}")
        return False

if __name__ == "__main__":
    fetch_rail_data()
