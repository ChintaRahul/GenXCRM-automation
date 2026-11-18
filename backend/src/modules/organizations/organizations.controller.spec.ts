import { Role } from '@prisma/client';
import { OrganizationsController } from './organizations.controller';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

const rolesFor = (method: keyof OrganizationsController): Role[] =>
  Reflect.getMetadata(ROLES_KEY, OrganizationsController.prototype[method] as object) as Role[];

describe('OrganizationsController role gates', () => {
  it('lets only Directors read or regenerate the org API key', () => {
    expect(rolesFor('getApiKey')).toEqual([Role.DIRECTOR]);
    expect(rolesFor('regenerateApiKey')).toEqual([Role.DIRECTOR]);
  });

  it('keeps Managers able to read the profile, settings and audit log', () => {
    expect(rolesFor('getMine')).toEqual(expect.arrayContaining([Role.DIRECTOR, Role.MANAGER]));
    expect(rolesFor('getSettings')).toEqual(expect.arrayContaining([Role.DIRECTOR, Role.MANAGER]));
    expect(rolesFor('getAuditLog')).toEqual(expect.arrayContaining([Role.DIRECTOR, Role.MANAGER]));
  });
});
