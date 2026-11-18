import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET || 'secret',
    });
  }

  async validate(payload: {
    sub: string;
    email: string;
    impersonatedBy?: string;
    iat?: number;
    purpose?: string;
  }) {
    // MFA challenge/setup tokens carry a `purpose` and must never be usable as a
    // normal session — reject them here so a leaked one can't reach real endpoints.
    if (payload.purpose) throw new UnauthorizedException();
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { org: { select: { workspaceType: true } } },
    });
    if (!user || !user.isActive) throw new UnauthorizedException();
    if (user.passwordChangedAt && payload.iat && payload.iat * 1000 < user.passwordChangedAt.getTime()) {
      throw new UnauthorizedException();
    }
    const { org, ...rest } = user;
    return { ...rest, workspaceType: org?.workspaceType, impersonatedBy: payload.impersonatedBy };
  }
}
