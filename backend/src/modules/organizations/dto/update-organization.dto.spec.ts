import { ValidationPipe } from '@nestjs/common';
import { UpdateOrganizationDto } from './update-organization.dto';

describe('UpdateOrganizationDto immutability', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });

  it('strips workspaceType from the payload before it reaches the DTO instance', async () => {
    const result = await pipe.transform(
      { name: 'Acme Renamed', workspaceType: 'MANUFACTURING' },
      { type: 'body', metatype: UpdateOrganizationDto },
    );
    expect(result).not.toHaveProperty('workspaceType');
    expect(result.name).toBe('Acme Renamed');
  });

  it("strips workspaceType even when it matches the org's current value", async () => {
    const result = await pipe.transform({ workspaceType: 'EDTECH' }, { type: 'body', metatype: UpdateOrganizationDto });
    expect(result).not.toHaveProperty('workspaceType');
  });
});
