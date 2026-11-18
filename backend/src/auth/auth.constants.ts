// Shared across AuthService (password reset) and MfaService (MFA reset) —
// both flows reuse the same VerificationToken table and TTL policy.
export const RESET_TOKEN_TTL_MINUTES = Number(process.env.RESET_TOKEN_TTL_MINUTES ?? 60);
