// Refuses to let an E2E seed run against anything but the local isolated test database (mirrors e2e/mfg/db.ts).
export const assertE2eDatabase = (): void => {
  const url = process.env.DATABASE_URL ?? '';
  if (!/^postgresql:\/\/[^@/?]+@localhost:\d+\/genxcrm_test(\?[^?]*)?$/.test(url) || /[?&]host=/.test(url)) {
    throw new Error('E2E seed refused: DATABASE_URL must point at localhost and database genxcrm_test');
  }
};
