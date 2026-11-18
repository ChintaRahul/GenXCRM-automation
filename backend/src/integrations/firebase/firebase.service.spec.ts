import { Test } from '@nestjs/testing';
import { FirebaseService, InvalidPushTokenError } from './firebase.service';

const mockSend = jest.fn();
jest.mock('firebase-admin', () => ({
  apps: [],
  credential: { cert: jest.fn((c: unknown) => c) },
  initializeApp: jest.fn(() => ({})),
  messaging: jest.fn(() => ({ send: mockSend })),
}));

describe('FirebaseService', () => {
  const payload = { leadId: 'lead-1', leadName: 'Asha', phone: '9876543210' };

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  });

  it('resolves false without throwing when FIREBASE_SERVICE_ACCOUNT_JSON is unset', async () => {
    const module = await Test.createTestingModule({ providers: [FirebaseService] }).compile();
    const service = module.get(FirebaseService);

    await expect(service.sendCallAlert('token-1', payload)).resolves.toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends a data-only FCM message and resolves true on success', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'p', client_email: 'a@b.com', private_key: 'k' });
    mockSend.mockResolvedValue('message-id');
    const module = await Test.createTestingModule({ providers: [FirebaseService] }).compile();
    const service = module.get(FirebaseService);

    await expect(service.sendCallAlert('token-1', payload)).resolves.toBe(true);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'token-1',
        data: expect.objectContaining({ type: 'CALL_ALERT', leadId: 'lead-1', leadName: 'Asha', phone: '9876543210' }),
      }),
    );
  });

  it('throws InvalidPushTokenError when FCM reports the token as unregistered', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'p', client_email: 'a@b.com', private_key: 'k' });
    mockSend.mockRejectedValue({ code: 'messaging/registration-token-not-registered' });
    const module = await Test.createTestingModule({ providers: [FirebaseService] }).compile();
    const service = module.get(FirebaseService);

    await expect(service.sendCallAlert('token-1', payload)).rejects.toBeInstanceOf(InvalidPushTokenError);
  });

  it('resolves false (does not throw) on any other send failure', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'p', client_email: 'a@b.com', private_key: 'k' });
    mockSend.mockRejectedValue(new Error('network down'));
    const module = await Test.createTestingModule({ providers: [FirebaseService] }).compile();
    const service = module.get(FirebaseService);

    await expect(service.sendCallAlert('token-1', payload)).resolves.toBe(false);
  });
});
