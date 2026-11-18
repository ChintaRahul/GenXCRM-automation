import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const hex = process.env.INTEGRATION_SECRET_KEY;
  if (!hex) throw new Error('INTEGRATION_SECRET_KEY env var is not set');
  return Buffer.from(hex, 'hex');
}

// Returns iv:authTag:ciphertext (all base64)
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptToken(ciphertext: string): string {
  const key = getKey();
  const [ivB64, authTagB64, encryptedB64] = ciphertext.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}

// One-way helpers for email-verification / password-reset tokens.
// The raw token is emailed to the user; only its SHA-256 hash is stored and
// looked up — so a DB leak never exposes a usable token.
export const generateRawToken = (): string => crypto.randomBytes(32).toString('base64url');

export const hashToken = (raw: string): string =>
  crypto.createHash('sha256').update(raw).digest('hex');
