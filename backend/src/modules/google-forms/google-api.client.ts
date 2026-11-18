import { Injectable } from '@nestjs/common';
import axios from 'axios';

const FORMS_URL = 'https://forms.googleapis.com/v1/forms';
const SHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const RESPONSES_PAGE_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RESPONSE_PAGES = 30;

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly reason: string | null,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

export interface GoogleFormItem {
  itemId?: string;
  title?: string;
  questionItem?: { question: { questionId: string } };
}

export interface GoogleFormDoc {
  formId: string;
  info: { title: string; documentTitle?: string };
  responderUri: string;
  items?: GoogleFormItem[];
}

export interface GoogleFormAnswer {
  questionId: string;
  textAnswers?: { answers: { value: string }[] };
}

export interface GoogleFormResponse {
  responseId: string;
  createTime: string;
  lastSubmittedTime?: string;
  answers?: Record<string, GoogleFormAnswer>;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const quoteTab = (tab: string) => `'${tab.replace(/'/g, "''")}'`;
const rfc3339 = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const cell = (tab: string) => encodeURIComponent(`${quoteTab(tab)}!A1`);

@Injectable()
export class GoogleApiClient {
  private async call<T>(request: () => Promise<{ data: T }>): Promise<T> {
    try {
      const { data } = await request();
      return data;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const body = err.response?.data as {
          error?: { message?: string; status?: string; errors?: { reason?: string }[] };
        } | undefined;
        const reason = body?.error?.status ?? body?.error?.errors?.[0]?.reason ?? null;
        throw new GoogleApiError(
          body?.error?.message ?? err.message,
          err.response?.status ?? null,
          reason,
        );
      }
      throw err;
    }
  }

  getForm(token: string, formId: string): Promise<GoogleFormDoc> {
    return this.call(() =>
      axios.get<GoogleFormDoc>(`${FORMS_URL}/${encodeURIComponent(formId)}`, {
        headers: bearer(token),
        timeout: REQUEST_TIMEOUT_MS,
      }),
    );
  }

  async addShortAnswerQuestion(
    token: string,
    formId: string,
    title: string,
    index: number,
  ): Promise<{ questionId: string }> {
    const data = await this.call(() =>
      axios.post<{ replies?: { createItem?: { itemId?: string; questionId?: string[] } }[] }>(
        `${FORMS_URL}/${encodeURIComponent(formId)}:batchUpdate`,
        {
          requests: [
            {
              createItem: {
                item: {
                  title,
                  questionItem: { question: { required: false, textQuestion: { paragraph: false } } },
                },
                location: { index },
              },
            },
          ],
        },
        { headers: bearer(token), timeout: REQUEST_TIMEOUT_MS },
      ),
    );
    const questionId = data.replies?.[0]?.createItem?.questionId?.[0];
    if (!questionId) throw new GoogleApiError('Google did not return the new question id', null, null);
    return { questionId };
  }

  async listResponses(token: string, formId: string, since?: Date): Promise<GoogleFormResponse[]> {
    const all: GoogleFormResponse[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;
    do {
      const previousToken = pageToken;
      const params = {
        pageSize: RESPONSES_PAGE_SIZE,
        ...(pageToken && { pageToken }),
        ...(since && { filter: `timestamp >= ${rfc3339(since)}` }),
      };
      const page = await this.call(() =>
        axios.get<{ responses?: GoogleFormResponse[]; nextPageToken?: string }>(
          `${FORMS_URL}/${encodeURIComponent(formId)}/responses`,
          { headers: bearer(token), params, timeout: REQUEST_TIMEOUT_MS },
        ),
      );
      all.push(...(page.responses ?? []));
      pageToken = page.nextPageToken;
      pageCount += 1;

      // A partial list would let the caller's cursor skip responses, so never return one.
      if (pageToken && pageToken === previousToken) {
        throw new GoogleApiError('Google returned a repeated page token', null, null);
      }
      if (pageToken && pageCount >= MAX_RESPONSE_PAGES) {
        throw new GoogleApiError('Too many new responses to fetch at once', null, null);
      }
    } while (pageToken);
    return all;
  }

  async createSpreadsheet(token: string, title: string): Promise<{ spreadsheetId: string; tab: string }> {
    const data = await this.call(() =>
      axios.post<{ spreadsheetId: string; sheets?: { properties?: { title?: string } }[] }>(
        SHEETS_URL,
        { properties: { title } },
        { headers: bearer(token), timeout: REQUEST_TIMEOUT_MS },
      ),
    );
    return { spreadsheetId: data.spreadsheetId, tab: data.sheets?.[0]?.properties?.title ?? 'Sheet1' };
  }

  async getFirstTab(token: string, spreadsheetId: string): Promise<string> {
    const data = await this.call(() =>
      axios.get<{ sheets?: { properties?: { title?: string } }[] }>(
        `${SHEETS_URL}/${encodeURIComponent(spreadsheetId)}`,
        { headers: bearer(token), params: { fields: 'sheets.properties.title' }, timeout: REQUEST_TIMEOUT_MS },
      ),
    );
    return data.sheets?.[0]?.properties?.title ?? 'Sheet1';
  }

  async writeHeader(token: string, spreadsheetId: string, tab: string, header: string[]): Promise<void> {
    await this.call(() =>
      axios.put(
        `${SHEETS_URL}/${encodeURIComponent(spreadsheetId)}/values/${cell(tab)}`,
        { values: [header] },
        { headers: bearer(token), params: { valueInputOption: 'RAW' }, timeout: REQUEST_TIMEOUT_MS },
      ),
    );
  }

  async appendRows(token: string, spreadsheetId: string, tab: string, rows: string[][]): Promise<void> {
    await this.call(() =>
      axios.post(
        `${SHEETS_URL}/${encodeURIComponent(spreadsheetId)}/values/${cell(tab)}:append`,
        { values: rows },
        {
          headers: bearer(token),
          params: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
          timeout: REQUEST_TIMEOUT_MS,
        },
      ),
    );
  }

  async getPublicFormHtml(url: string): Promise<string> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new GoogleApiError(`Invalid URL: ${url}`, null, null);
    }

    if (parsedUrl.protocol !== 'https:') {
      throw new GoogleApiError('Refusing to fetch a non-Google form URL', null, null);
    }

    const hostname = parsedUrl.hostname;
    if (hostname !== 'docs.google.com' && hostname !== 'forms.gle') {
      throw new GoogleApiError('Refusing to fetch a non-Google form URL', null, null);
    }

    const beforeRedirect = (options: { hostname?: string; host?: string }) => {
      const redirectHost = options.hostname ?? options.host;
      if (redirectHost !== 'docs.google.com' && redirectHost !== 'forms.gle') {
        throw new GoogleApiError('Refusing to follow redirect to non-Google host', null, null);
      }
    };

    return this.call(() =>
      axios.get<string>(url, {
        responseType: 'text',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: REQUEST_TIMEOUT_MS,
        maxRedirects: 3,
        maxContentLength: 5 * 1024 * 1024,
        beforeRedirect,
      }),
    );
  }
}
