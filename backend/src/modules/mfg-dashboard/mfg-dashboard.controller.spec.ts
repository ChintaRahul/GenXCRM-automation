import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { MfgDashboardController } from './mfg-dashboard.controller';
import { MfgDashboardService } from './mfg-dashboard.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const caller: AuthUser = { id: 'u1', name: 'U', email: 'u@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

describe('MfgDashboardController', () => {
  let controller: MfgDashboardController;
  const mockService = { getMyDay: jest.fn(), getTeam: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [MfgDashboardController],
      providers: [{ provide: MfgDashboardService, useValue: mockService }],
    }).compile();
    controller = module.get(MfgDashboardController);
  });

  it('delegates getMyDay to the service with the current user', async () => {
    mockService.getMyDay.mockResolvedValue({ kpis: {} });
    await controller.getMyDay(caller);
    expect(mockService.getMyDay).toHaveBeenCalledWith(caller);
  });

  it('delegates getTeam to the service with the current user', async () => {
    mockService.getTeam.mockResolvedValue({ kpis: {} });
    await controller.getTeam(caller);
    expect(mockService.getTeam).toHaveBeenCalledWith(caller);
  });
});
