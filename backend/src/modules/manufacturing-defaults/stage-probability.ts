import type { PrismaService } from '../../prisma/prisma.service';
import { STAGES } from './manufacturing-defaults.data';

// Stage -> win probability (%) as configured in Administration > Masters > Stages for this org.
// A stage the org has not configured (or an org with no stages master) falls back to the seeded default.
export const loadStageProbabilities = async (prisma: PrismaService, orgId: string): Promise<Map<string, number>> => {
  const probabilities = new Map(STAGES);
  const rows = await prisma.masterValue.findMany({
    where: { orgId, category: 'stages', isDeleted: false, isActive: true },
    select: { value: true, numericValue: true },
  });
  for (const { value, numericValue } of rows) {
    if (numericValue != null) probabilities.set(value, numericValue);
  }
  return probabilities;
};
