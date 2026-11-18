import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAccountDto } from './create-account.dto';

const base = { name: 'Acme', short: 'ACM', type: 'Customer', industry: 'Steel & metals', city: 'Pune', state: 'MH', territory: 'West' };

describe('CreateAccountDto tags', () => {
  it('turns the comma-separated text from the form into an array', async () => {
    const dto = plainToInstance(CreateAccountDto, { ...base, tags: 'steel, priority ,' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.tags).toEqual(['steel', 'priority']);
  });

  it('still accepts an array', async () => {
    const dto = plainToInstance(CreateAccountDto, { ...base, tags: ['a'] });
    expect(await validate(dto)).toHaveLength(0);
  });
});
