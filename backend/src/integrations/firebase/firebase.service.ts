import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';

export interface CallAlertPayload {
  leadId: string;
  leadName: string;
  phone: string;
}

// Thrown only when FCM confirms the token is dead (uninstalled app, cleared data,
// etc.) — the caller (CommunicationsService) uses this to know when to clear the
// stored token, as opposed to a transient failure worth retrying next time.
export class InvalidPushTokenError extends Error {}

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

@Injectable()
export class FirebaseService {
  private readonly logger = new Logger(FirebaseService.name);
  private app: admin.app.App | undefined;

  constructor() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) {
      this.logger.warn('FIREBASE_SERVICE_ACCOUNT_JSON not set — desktop call alerts will not be delivered.');
      return;
    }
    try {
      const credentials = JSON.parse(raw) as admin.ServiceAccount;
      this.app = admin.initializeApp({ credential: admin.credential.cert(credentials) }, 'genxcrm-call-alerts');
    } catch (err) {
      this.logger.warn(`Failed to initialize Firebase Admin SDK: ${(err as Error).message}`);
    }
  }

  async sendCallAlert(pushToken: string, payload: CallAlertPayload): Promise<boolean> {
    if (!this.app) return false;

    try {
      // Data-only message (no `notification` block) — the Android side builds its
      // own full-screen intent from this; a plain notification message would just
      // show a normal banner instead.
      await admin.messaging(this.app).send({
        token: pushToken,
        data: {
          type: 'CALL_ALERT',
          leadId: payload.leadId,
          leadName: payload.leadName,
          phone: payload.phone,
        },
        android: { priority: 'high' },
      });
      return true;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code && INVALID_TOKEN_CODES.has(code)) throw new InvalidPushTokenError(code);
      this.logger.warn(`Failed to send call alert: ${(err as Error).message}`);
      return false;
    }
  }
}
