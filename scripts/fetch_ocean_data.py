#!/usr/bin/env python3
import os
import json
import gspread
from google.oauth2 import service_account
from typing import Dict, List, Union, Optional

def safe_convert(value: Union[str, float, int], default=None) -> Union[float, int, str, None]:
    """Convert values safely with type checking and NaN handling"""
    if value in (None, "", " ", "N/A", "NaN", "null"):
        return default
    try:
        if isinstance(value, (float, int)):
            return value
        if "." in str(value):
            return float(value)
        return int(value)
    except (ValueError, TypeError):
        return default

def extract_location_info(port_name: str) -> str:
    """Extract city name from port name"""
    if not port_name:
        return ""
    return port_name.replace("Port of", "").replace("Port", "").replace("Harbor", "").strip()

def fetch_ocean_data() -> bool:
    print("🌊 Ocean 데이터 수집 시작")
    try:
        # 환경 변수 로드
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
        worksheet = gc.open_by_key(sheet_id).worksheet("CONGESTION_OCEAN")
        records = worksheet.get_all_records()
        print(f"📊 총 {len(records)}개의 레코드 발견")

        # 데이터 처리
        processed_data = []
        countries = set()
        cities = set()

        for idx, row in enumerate(records, 1):
            try:
                # 필수 필드 검증
                lat = safe_convert(row.get("Latitude"))
                lng = safe_convert(row.get("Longitude"))
                if None in (lat, lng):
                    print(f"⚠️ 행 {idx}: 위경도 데이터 없음 - 건너뜀")
                    continue

                # 데이터 정제
                port = str(row.get("Port", "")).strip()
                country = str(row.get("Country", "")).strip()
                
                data = {
                    "port": port,
                    "country": country,
                    "country_code": str(row.get("Country Code", "")).strip().lower(),
                    "port_code": str(row.get("Port Code", "")).strip(),
                    "lat": lat,
                    "lng": lng,
                    "current_delay_days": safe_convert(row.get("Current Delay (days)")),
                    "current_delay": str(row.get("Current Delay", "")).strip(),
                    "delay_level": str(row.get("Delay Level", "")).strip().lower(),
                    "weekly_median_delay": safe_convert(row.get("Weekly Median Delay")),
                    "weekly_max_delay": safe_convert(row.get("Weekly Max Delay")),
                    "monthly_median_delay": safe_convert(row.get("Monthly Median Delay")),
                    "monthly_max_delay": safe_convert(row.get("Monthly Max Delay")),
                    "updated_at": str(row.get("Date", "")).strip()
                }

                # 위치 정보 수집
                if country:
                    countries.add(country)
                if port:
                    cities.add(extract_location_info(port))

                processed_data.append(data)

            except Exception as e:
                print(f"⛔ 행 {idx} 처리 실패: {str(e)}")
                continue

        # 출력 디렉토리 생성
        os.makedirs("../data", exist_ok=True)
        output_path = "../data/global-ports.json"

        # 메타데이터 포함 저장
        result = {
            "metadata": {
                "total_ports": len(processed_data),
                "countries": sorted(countries),
                "cities": sorted(cities)
            },
            "data": processed_data
        }

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)

        print(f"✅ 성공적으로 저장됨: {output_path}")
        print(f"📌 총 {len(processed_data)}개의 항구 데이터 처리 완료")
        return True

    except Exception as e:
        print(f"💥 치명적 오류: {str(e)}")
        return False

if __name__ == "__main__":
    fetch_ocean_data()
