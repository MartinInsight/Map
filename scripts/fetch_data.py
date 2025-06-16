import gspread
import json
import os
from oauth2client.service_account import ServiceAccountCredentials

def fetch_sheet_data():
    scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
    creds = ServiceAccountCredentials.from_json_keyfile_dict(
        json.loads(os.environ['GOOGLE_CREDENTIAL_JSON']), scope
    )
    gc = gspread.authorize(creds)
    
    sheet = gc.open_by_key(os.environ['SPREADSHEET_ID']).sheet1
    return sheet.get_all_records()

def process_data(records):
    return {
        row["Code"]: {
            "name": row["State"],
            "inbound": {
                "delay": row.get("Inbound Delay", 0),
                "color": row.get("Inbound Color", 0),
                "dwell": row.get("Dwell Inbound", 0)
            },
            "outbound": {
                "delay": row.get("Outbound Delay", 0),
                "color": row.get("Outbound Color", 0),
                "dwell": row.get("Dwell Outbound", 0)
            }
        }
        for row in records if row.get("Code")
    }

if __name__ == "__main__":
    data = fetch_sheet_data()
    processed = process_data(data)
    with open("../data/states-data.json", "w") as f:
        json.dump(processed, f, indent=2)
