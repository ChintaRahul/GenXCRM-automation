import {
  clampSessionTimeoutMinutes,
  mergeSecuritySettings,
  SESSION_TIMEOUT_MIN_MINUTES,
  SESSION_TIMEOUT_MAX_MINUTES,
} from './org-defaults';

describe('clampSessionTimeoutMinutes', () => {
  it('leaves an in-range value untouched', () => {
    expect(clampSessionTimeoutMinutes(60)).toBe(60);
  });

  it('raises a value below the 5-minute floor', () => {
    expect(clampSessionTimeoutMinutes(0)).toBe(SESSION_TIMEOUT_MIN_MINUTES);
    expect(clampSessionTimeoutMinutes(-100)).toBe(SESSION_TIMEOUT_MIN_MINUTES);
  });

  it('caps a value above the 7-day ceiling', () => {
    expect(clampSessionTimeoutMinutes(999999)).toBe(SESSION_TIMEOUT_MAX_MINUTES);
  });
});

describe('mergeSecuritySettings', () => {
  it('clamps sessionTimeoutMinutes from stored data', () => {
    expect(mergeSecuritySettings({ sessionTimeoutMinutes: 1 }).sessionTimeoutMinutes).toBe(
      SESSION_TIMEOUT_MIN_MINUTES,
    );
    expect(mergeSecuritySettings({ sessionTimeoutMinutes: 50000 }).sessionTimeoutMinutes).toBe(
      SESSION_TIMEOUT_MAX_MINUTES,
    );
  });

  it('defaults to 60 minutes (already in range) when nothing is stored', () => {
    expect(mergeSecuritySettings(null).sessionTimeoutMinutes).toBe(60);
  });
});
