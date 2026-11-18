import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LeadSource } from '@prisma/client';
import { CreateLeadDto } from './create-lead.dto';

// Mirrors main.ts's global `new ValidationPipe({ whitelist: true, transform: true })`
// pipeline, since that's what actually validates incoming requests.
async function validatePayload(payload: Record<string, unknown>) {
  const instance = plainToInstance(CreateLeadDto, payload);
  return validate(instance);
}

describe('CreateLeadDto', () => {
  const basePayload = { name: 'John', phone: '9999999999', source: LeadSource.OTHER };

  it('passes validation when email is omitted entirely', async () => {
    const errors = await validatePayload({ ...basePayload });
    expect(errors).toHaveLength(0);
  });

  it('passes validation when email is an empty string (form field left blank)', async () => {
    const errors = await validatePayload({ ...basePayload, email: '' });
    expect(errors).toHaveLength(0);
  });

  it('fails validation with a genuinely malformed email', async () => {
    const errors = await validatePayload({ ...basePayload, email: 'not-an-email' });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('email');
    expect(errors[0].constraints).toHaveProperty('isEmail');
  });

  it('passes validation with a well-formed email', async () => {
    const errors = await validatePayload({ ...basePayload, email: 'jane@example.com' });
    expect(errors).toHaveLength(0);
  });

  it('fails validation when the email domain repeats a segment (e.g. .com.com)', async () => {
    const errors = await validatePayload({ ...basePayload, email: 'sklsd@sdf.com.com.com' });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('email');
    expect(errors[0].constraints).toHaveProperty('noRepeatedDomainLabel');
  });

  it('passes validation for a domain with distinct, non-adjacent repeated words', async () => {
    const errors = await validatePayload({ ...basePayload, email: 'jane@mail.google.com' });
    expect(errors).toHaveLength(0);
  });

  it.each(['Jane Doe', 'John 2nd', "O'Brien & Co.", 'Lead-123', '@#$$'])(
    'passes validation with name %j (letters, numbers and symbols are allowed)',
    async (name) => {
      const errors = await validatePayload({ ...basePayload, name });
      expect(errors).toHaveLength(0);
    },
  );

  it('fails validation when name is empty', async () => {
    const errors = await validatePayload({ ...basePayload, name: '' });
    expect(errors[0].property).toBe('name');
  });

  it('fails validation when the email is longer than 254 characters', async () => {
    const errors = await validatePayload({ ...basePayload, email: `${'a'.repeat(250)}@example.com` });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('email');
  });
});
