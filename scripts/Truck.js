const { google } = require('googleapis');

export default async function handler(req, res) {
  // 환경 변수 검증
  if (!process.env.GOOGLE_CREDENTIALS_JSON) {
    return res.status(500).json({ error: 'GOOGLE_CREDENTIALS_JSON 환경 변수가 필요합니다' });
  }
  if (!process.env.SPREADSHEET_ID) {
    return res.status(500).json({ error: 'SPREADSHEET_ID 환경 변수가 필요합니다' });
  }

  try {
    // Google Sheets 인증
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
    
    // 데이터 가져오기
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'CONGESTION_TRUCK!A1:I51',
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: '데이터가 없습니다' });
    }

    // 데이터 포맷팅
    const headers = rows[0];
    const data = rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index];
      });
      return obj;
    });

    res.status(200).json(data);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: '데이터를 가져오는 데 실패했습니다' });
  }
}
