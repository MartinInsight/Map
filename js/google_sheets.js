const SPREADSHEET_ID = {secrets.SPREADSHEET_ID};
const GOOGLE_CREDENTIALS = {secrets.GOOGLE_CREDENTIALS_JSON};

let gapiInitialized = false;

function initGAPI() {
    return new Promise((resolve) => {
        gapi.load('client', () => {
            gapi.client.init({
                apiKey: GOOGLE_CREDENTIALS.api_key,
                clientId: GOOGLE_CREDENTIALS.client_id,
                scope: 'https://www.googleapis.com/auth/spreadsheets.readonly'
            }).then(() => {
                gapiInitialized = true;
                resolve();
            });
        });
    });
}

export async function fetchTruckData() {
    if (!gapiInitialized) await initGAPI();

    try {
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'CONGESTION_TRUCK!A2:I51'
        });

        return response.result.values.map(row => ({
            State: row[0],
            Code: row[1],
            InboundDelay: parseFloat(row[2]),
            InboundColor: parseInt(row[3]),
            OutboundDelay: parseFloat(row[4]),
            OutboundColor: parseInt(row[5]),
            DwellInbound: parseFloat(row[6]),
            DwellInboundColor: parseInt(row[7]),
            DwellOutbound: parseFloat(row[8])
        }));
    } catch (error) {
        console.error('Google Sheets API Error:', error);
        return [];
    }
}
