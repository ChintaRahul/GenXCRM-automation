import axios from 'axios';
import { GoogleApiClient, GoogleApiError } from './google-api.client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const axiosError = (
  status: number,
  error: { message?: string; status?: string; errors?: { reason?: string }[] },
) => ({
  isAxiosError: true,
  message: 'Request failed',
  response: { status, data: { error } },
});

describe('GoogleApiClient', () => {
  let client: GoogleApiClient;

  beforeEach(() => {
    jest.resetAllMocks();
    (axios.isAxiosError as unknown as jest.Mock).mockImplementation((e: unknown) =>
      Boolean((e as { isAxiosError?: boolean } | null)?.isAxiosError),
    );
    client = new GoogleApiClient();
  });

  it('getForm sends the bearer token and returns the form', async () => {
    mockedAxios.get.mockResolvedValue({ data: { formId: 'f1', info: { title: 'T' }, responderUri: 'https://x' } });
    const doc = await client.getForm('tok', 'f1');
    expect(doc.formId).toBe('f1');
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://forms.googleapis.com/v1/forms/f1',
      expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }),
    );
  });

  it('addShortAnswerQuestion sends a createItem at the given index and returns the new questionId', async () => {
    mockedAxios.post.mockResolvedValue({ data: { replies: [{ createItem: { itemId: 'i1', questionId: ['0000002a'] } }] } });
    const result = await client.addShortAnswerQuestion('tok', 'f1', 'Lead ID', 3);
    expect(result).toEqual({ questionId: '0000002a' });
    const [url, body] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('https://forms.googleapis.com/v1/forms/f1:batchUpdate');
    expect(JSON.stringify(body)).toContain('"index":3');
    expect(JSON.stringify(body)).toContain('"title":"Lead ID"');
  });

  it('addShortAnswerQuestion throws when Google returns no question id', async () => {
    mockedAxios.post.mockResolvedValue({ data: { replies: [{}] } });
    await expect(client.addShortAnswerQuestion('tok', 'f1', 'Lead ID', 0)).rejects.toBeInstanceOf(GoogleApiError);
  });

  it('listResponses follows nextPageToken and applies the timestamp filter', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { responses: [{ responseId: 'a', createTime: 't' }], nextPageToken: 'p2' } })
      .mockResolvedValueOnce({ data: { responses: [{ responseId: 'b', createTime: 't' }] } });
    const out = await client.listResponses('tok', 'f1', new Date('2026-09-24T10:00:00.123Z'));
    expect(out.map((r) => r.responseId)).toEqual(['a', 'b']);
    const first = mockedAxios.get.mock.calls[0][1] as { params: Record<string, unknown> };
    const second = mockedAxios.get.mock.calls[1][1] as { params: Record<string, unknown> };
    expect(first.params.filter).toBe('timestamp >= 2026-09-24T10:00:00Z');
    expect(first.params.pageToken).toBeUndefined();
    expect(second.params.pageToken).toBe('p2');
  });

  it('listResponses returns [] when there are no responses', async () => {
    mockedAxios.get.mockResolvedValue({ data: {} });
    await expect(client.listResponses('tok', 'f1')).resolves.toEqual([]);
  });

  it('createSpreadsheet returns the id and the first tab title', async () => {
    mockedAxios.post.mockResolvedValue({ data: { spreadsheetId: 's1', sheets: [{ properties: { title: 'Sheet1' } }] } });
    await expect(client.createSpreadsheet('tok', 'My sheet')).resolves.toEqual({ spreadsheetId: 's1', tab: 'Sheet1' });
  });

  it('appendRows quotes the tab name, uses RAW input and inserts rows', async () => {
    mockedAxios.post.mockResolvedValue({ data: {} });
    await client.appendRows('tok', 's1', "Tom's tab", [['a', 'b']]);
    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toBe(`https://sheets.googleapis.com/v4/spreadsheets/s1/values/${encodeURIComponent("'Tom''s tab'!A1")}:append`);
    expect(body).toEqual({ values: [['a', 'b']] });
    expect((config as { params: Record<string, string> }).params).toEqual({ valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' });
  });

  it('writeHeader puts the header in row 1 with RAW input', async () => {
    mockedAxios.put.mockResolvedValue({ data: {} });
    await client.writeHeader('tok', 's1', 'Sheet1', ['A', 'B']);
    const [url, body, config] = mockedAxios.put.mock.calls[0];
    expect(url).toBe(`https://sheets.googleapis.com/v4/spreadsheets/s1/values/${encodeURIComponent("'Sheet1'!A1")}`);
    expect(body).toEqual({ values: [['A', 'B']] });
    expect((config as { params: Record<string, string> }).params).toEqual({ valueInputOption: 'RAW' });
  });

  it('maps a Google API error to GoogleApiError with status and reason', async () => {
    mockedAxios.get.mockRejectedValue(axiosError(404, { message: 'Requested entity was not found.', status: 'NOT_FOUND' }));
    await expect(client.getForm('tok', 'nope')).rejects.toMatchObject({
      name: 'GoogleApiError',
      status: 404,
      reason: 'NOT_FOUND',
      message: 'Requested entity was not found.',
    });
  });

  it('getPublicFormHtml fetches the page as text', async () => {
    mockedAxios.get.mockResolvedValue({ data: '<html></html>' });
    await expect(client.getPublicFormHtml('https://docs.google.com/forms/d/e/x/viewform')).resolves.toBe('<html></html>');
  });

  it('sets timeout on Forms API calls', async () => {
    mockedAxios.get.mockResolvedValue({ data: { formId: 'f1', info: { title: 'T' }, responderUri: 'https://x' } });
    await client.getForm('tok', 'f1');
    const config = mockedAxios.get.mock.calls[0][1] as Record<string, unknown>;
    expect(config.timeout).toBe(15000);
  });

  it('sets timeout on Sheets API calls', async () => {
    mockedAxios.post.mockResolvedValue({ data: { spreadsheetId: 's1', sheets: [{ properties: { title: 'Sheet1' } }] } });
    await client.createSpreadsheet('tok', 'My sheet');
    const config = mockedAxios.post.mock.calls[0][2] as Record<string, unknown>;
    expect(config.timeout).toBe(15000);
  });

  it('sets timeout and security options on getPublicFormHtml', async () => {
    mockedAxios.get.mockResolvedValue({ data: '<html></html>' });
    await client.getPublicFormHtml('https://docs.google.com/forms/d/e/x/viewform');
    const config = mockedAxios.get.mock.calls[0][1] as Record<string, unknown>;
    expect(config.timeout).toBe(15000);
    expect(config.maxRedirects).toBe(3);
    expect(config.maxContentLength).toBe(5 * 1024 * 1024);
    expect((config.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('rejects http:// protocol in getPublicFormHtml', async () => {
    await expect(client.getPublicFormHtml('http://docs.google.com/forms/d/e/x/viewform')).rejects.toMatchObject({
      name: 'GoogleApiError',
      status: null,
      reason: null,
      message: 'Refusing to fetch a non-Google form URL',
    });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('rejects non-Google domains in getPublicFormHtml', async () => {
    await expect(client.getPublicFormHtml('https://evil.example.com/forms')).rejects.toMatchObject({
      name: 'GoogleApiError',
      status: null,
      message: 'Refusing to fetch a non-Google form URL',
    });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('rejects spoofed Google domains in getPublicFormHtml', async () => {
    await expect(client.getPublicFormHtml('https://docs.google.com.evil.example/forms')).rejects.toMatchObject({
      name: 'GoogleApiError',
      status: null,
      message: 'Refusing to fetch a non-Google form URL',
    });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('rejects unparsable URLs in getPublicFormHtml', async () => {
    await expect(client.getPublicFormHtml('not a url')).rejects.toMatchObject({
      name: 'GoogleApiError',
      status: null,
    });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('accepts https://forms.gle URLs in getPublicFormHtml', async () => {
    mockedAxios.get.mockResolvedValue({ data: '<html></html>' });
    await expect(client.getPublicFormHtml('https://forms.gle/abc')).resolves.toBe('<html></html>');
  });

  it('rejects instead of returning partial data when nextPageToken repeats', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { responses: [{ responseId: 'a', createTime: 't' }], nextPageToken: 'p1' } })
      .mockResolvedValueOnce({ data: { responses: [{ responseId: 'b', createTime: 't' }], nextPageToken: 'p1' } });
    await expect(client.listResponses('tok', 'f1')).rejects.toBeInstanceOf(GoogleApiError);
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it('rejects when the page cap is reached and more pages remain', async () => {
    let n = 0;
    mockedAxios.get.mockImplementation(() => Promise.resolve({
      data: { responses: [{ responseId: `r${n}`, createTime: 't' }], nextPageToken: `p${++n}` },
    }));
    await expect(client.listResponses('tok', 'f1')).rejects.toMatchObject({
      name: 'GoogleApiError', status: null, message: 'Too many new responses to fetch at once',
    });
    expect(mockedAxios.get).toHaveBeenCalledTimes(30);
  });

  it('extracts reason from errors[] when error.status is absent', async () => {
    mockedAxios.get.mockRejectedValue(
      axiosError(400, { message: 'Bad request', errors: [{ reason: 'INVALID_ARGUMENT' }] }),
    );
    await expect(client.getForm('tok', 'f1')).rejects.toMatchObject({
      name: 'GoogleApiError',
      status: 400,
      reason: 'INVALID_ARGUMENT',
      message: 'Bad request',
    });
  });

  it('maps axios timeout on getPublicFormHtml to GoogleApiError with status null', async () => {
    mockedAxios.get.mockRejectedValue({
      isAxiosError: true,
      code: 'ECONNABORTED',
      message: 'timeout of 15000ms exceeded',
    });
    await expect(client.getPublicFormHtml('https://docs.google.com/forms/d/e/x/viewform')).rejects.toMatchObject({
      name: 'GoogleApiError',
      status: null,
      message: 'timeout of 15000ms exceeded',
    });
  });

  it('maps axios 404 on getPublicFormHtml to GoogleApiError with status 404', async () => {
    mockedAxios.get.mockRejectedValue(
      axiosError(404, { message: 'Form not found', status: 'NOT_FOUND' }),
    );
    await expect(client.getPublicFormHtml('https://docs.google.com/forms/d/e/x/viewform')).rejects.toMatchObject({
      name: 'GoogleApiError',
      status: 404,
      reason: 'NOT_FOUND',
      message: 'Form not found',
    });
  });

  it('maps axios timeout on a routed call (getForm) to GoogleApiError with status null', async () => {
    mockedAxios.get.mockRejectedValue({
      isAxiosError: true,
      code: 'ECONNABORTED',
      message: 'timeout of 15000ms exceeded',
    });
    await expect(client.getForm('tok', 'f1')).rejects.toMatchObject({
      name: 'GoogleApiError',
      status: null,
      message: 'timeout of 15000ms exceeded',
    });
  });

  it('passes beforeRedirect function to axios on getPublicFormHtml', async () => {
    mockedAxios.get.mockResolvedValue({ data: '<html></html>' });
    await client.getPublicFormHtml('https://docs.google.com/forms/d/e/x/viewform');
    const config = mockedAxios.get.mock.calls[0][1] as Record<string, unknown>;
    expect(typeof config.beforeRedirect).toBe('function');
  });

  it('beforeRedirect rejects non-Google hosts', async () => {
    mockedAxios.get.mockResolvedValue({ data: '<html></html>' });
    await client.getPublicFormHtml('https://docs.google.com/forms/d/e/x/viewform');
    const config = mockedAxios.get.mock.calls[0][1] as { beforeRedirect?: (options: Record<string, string>) => void };
    const beforeRedirect = config.beforeRedirect;
    expect(() => beforeRedirect?.({ hostname: 'evil.com' })).toThrow(GoogleApiError);
    expect(() => beforeRedirect?.({ hostname: 'docs.google.com' })).not.toThrow();
    expect(() => beforeRedirect?.({ hostname: 'forms.gle' })).not.toThrow();
  });
});
