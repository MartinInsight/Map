import os
import pandas as pd
from google.oauth2 import service_account

def fetch_sheet():
    creds = service_account.Credentials.from_service_account_file(
        os.environ['GOOGLE_CREDS_JSON'],
        scopes=['https://www.googleapis.com/auth/spreadsheets.readonly']
    )
    sheet_id = os.environ['SPREADSHEET_ID']
    df = pd.read_csv(f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv")
    df.to_csv(os.path.join(os.path.dirname(__file__), "../data/data.csv", index=False)
