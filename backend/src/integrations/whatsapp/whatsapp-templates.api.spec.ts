import { WhatsappTemplatesApi } from './whatsapp-templates.api';

describe('WhatsappTemplatesApi.toPositional', () => {
  const api = new WhatsappTemplatesApi();

  it('rewrites named variables to positional {{1}}..{{n}} in first-occurrence order', () => {
    const { text, variables } = api.toPositional('Hi {{name}}, welcome to {{course}} at {{org}}');
    expect(text).toBe('Hi {{1}}, welcome to {{2}} at {{3}}');
    expect(variables).toEqual(['name', 'course', 'org']);
  });

  it('dedupes a repeated variable to the same position', () => {
    const { text, variables } = api.toPositional('{{name}}, did you know {{name}} can join {{course}}?');
    expect(text).toBe('{{1}}, did you know {{1}} can join {{2}}?');
    expect(variables).toEqual(['name', 'course']);
  });

  it('builds example values per variable (known mapped, unknown defaulted)', () => {
    const { example, variables } = api.toPositional('Hi {{name}}, ref {{ticket}}');
    expect(variables).toEqual(['name', 'ticket']);
    expect(example).toEqual(['Asha', 'Sample']);
  });

  it('returns no variables for a body without placeholders', () => {
    const { text, variables, example } = api.toPositional('Plain reminder with no variables.');
    expect(text).toBe('Plain reminder with no variables.');
    expect(variables).toEqual([]);
    expect(example).toEqual([]);
  });
});

describe('WhatsappTemplatesApi.isConfigured', () => {
  const api = new WhatsappTemplatesApi();
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('is false when the WABA id or token is missing', () => {
    delete process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    delete process.env.WHATSAPP_API_TOKEN;
    expect(api.isConfigured()).toBe(false);
  });

  it('is true when both are set', () => {
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = 'waba-1';
    process.env.WHATSAPP_API_TOKEN = 'tok-1';
    expect(api.isConfigured()).toBe(true);
  });
});
