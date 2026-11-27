import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const getAuthClient = () => {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set.');
  }
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
};

export const readSheet = async (spreadsheetId: string, range: string) => {
  try {
    const auth = getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    return response.data.values;
  } catch (e: any) {
    console.error("Sheets Proxy Read Error:", e.message);
    throw e;
  }
};

export const getMetadata = async (spreadsheetId: string) => {
  try {
    const auth = getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'spreadsheetId,properties.title,sheets.properties',
    });
    return response.data;
  } catch (e: any) {
    console.error("Sheets Proxy Metadata Error:", e.message);
    throw e;
  }
};

export const writeSheet = async (spreadsheetId: string, range: string, values: any[][]) => {
  try {
    const auth = getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  } catch (e: any) {
    console.error("Sheets Proxy Write Error:", e.message);
    throw e;
  }
};
