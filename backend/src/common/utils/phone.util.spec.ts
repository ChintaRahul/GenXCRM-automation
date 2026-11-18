import { toWhatsAppRecipient, toE164 } from './phone.util';

describe('phone.util', () => {
  describe('toWhatsAppRecipient', () => {
    it('prepends the India country code to a bare 10-digit number', () => {
      expect(toWhatsAppRecipient('7058942237')).toBe('917058942237');
    });

    it('leaves an already-prefixed number untouched', () => {
      expect(toWhatsAppRecipient('917058942237')).toBe('917058942237');
    });

    it('strips formatting characters before prefixing', () => {
      expect(toWhatsAppRecipient('+91 70589 42237')).toBe('917058942237');
    });

    it('passes through numbers that are already a different country/length unmodified', () => {
      expect(toWhatsAppRecipient('12025550123')).toBe('12025550123');
    });
  });

  describe('toE164', () => {
    it('formats a bare 10-digit number as +91XXXXXXXXXX for Twilio', () => {
      expect(toE164('7058942237')).toBe('+917058942237');
    });

    it('adds a leading + to an already-prefixed number', () => {
      expect(toE164('917058942237')).toBe('+917058942237');
    });
  });
});
