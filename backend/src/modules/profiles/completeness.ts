import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Profile completeness (0–100), used later by discovery ranking (PRD §6).
 * Plain function, not a provider, so both the profiles and media modules can
 * call it without a dependency cycle.
 */
export async function recomputeCompleteness(prisma: PrismaService, userId: string): Promise<number> {
  const [profile, photos] = await Promise.all([
    prisma.profile.findUnique({
      where: { userId },
      select: {
        bio: true,
        prompts: true,
        interests: true,
        languages: true,
        heightCm: true,
        jobTitle: true,
        education: true,
      },
    }),
    prisma.profilePhoto.count({ where: { userId, status: 'UPLOADED' } }),
  ]);
  if (!profile) return 0;

  const prompts = Array.isArray(profile.prompts) ? profile.prompts.length : 0;
  let score = 0;
  score += Math.min(photos, 4) * 10; // up to 40: photos matter most
  score += profile.bio ? 15 : 0;
  score += Math.min(prompts, 3) * 7; // up to 21
  score += profile.interests.length >= 3 ? 10 : profile.interests.length * 3;
  score += profile.languages.length > 0 ? 5 : 0;
  score += profile.heightCm ? 3 : 0;
  score += profile.jobTitle ? 3 : 0;
  score += profile.education ? 3 : 0;
  score = Math.min(100, score);

  await prisma.profile.update({ where: { userId }, data: { completenessScore: score } });
  return score;
}
