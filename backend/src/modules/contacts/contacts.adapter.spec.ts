import { BadRequestException } from '@nestjs/common';
import { ContactsAdapter } from './contacts.adapter';
import type { AuthUser } from '../../common/types/auth-user.type';
import { Role } from '@prisma/client';

const mockRegistry = { register: jest.fn() } as never;
const mockContacts = { create: jest.fn(), update: jest.fn() };
const mockActivities = {};

const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

const validBody = {
  accountId: 'A-1',
  name: 'Jane',
  phone: '9999999999',
  role: 'Procurement',
};

describe('ContactsAdapter', () => {
  let adapter: ContactsAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new ContactsAdapter(mockContacts as never, mockActivities as never, mockRegistry);
  });

  it('create rejects a body with a disallowed field (e.g. orgId) with BadRequestException', async () => {
    await expect(adapter.create({ ...validBody, orgId: 'evil-org' }, directorUser)).rejects.toThrow(BadRequestException);
    expect(mockContacts.create).not.toHaveBeenCalled();
  });

  it('create passes a valid body through to the service', async () => {
    mockContacts.create.mockResolvedValue({ id: 'C-1' });
    await adapter.create(validBody, directorUser);
    expect(mockContacts.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Jane' }), directorUser);
  });
});
