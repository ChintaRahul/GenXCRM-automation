import 'reflect-metadata';
import { BillingController } from './billing.controller';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

describe('BillingController RBAC', () => {
  const mutationEndpoints = [
    'subscribe',
    'updateSeats',
    'initiateSeatUpdate',
    'confirmSeatUpdate',
    'confirmPayment',
    'cancelSubscription',
    'purchaseAddon',
  ] as const;

  const readEndpoints = ['getPlans', 'getSubscription', 'getActiveUserCount', 'getBillingHistory'] as const;

  it.each(mutationEndpoints)('%s requires DIRECTOR or MANAGER', (method) => {
    const roles = Reflect.getMetadata(ROLES_KEY, BillingController.prototype[method]);
    expect(roles).toEqual([Role.DIRECTOR, Role.MANAGER]);
  });

  it.each(readEndpoints)('%s has no role restriction', (method) => {
    const roles = Reflect.getMetadata(ROLES_KEY, BillingController.prototype[method]);
    expect(roles).toBeUndefined();
  });

  it('webhook has no @Roles metadata', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, BillingController.prototype.webhook);
    expect(roles).toBeUndefined();
  });
});
