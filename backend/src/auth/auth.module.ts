import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { MfaModule } from './mfa.module';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { FacebookStrategy } from './strategies/facebook.strategy';
import { TwitterStrategy } from './strategies/twitter.strategy';
import { GoogleOAuthGuard, FacebookOAuthGuard, TwitterOAuthGuard } from './guards/oauth.guard';
import { MailModule } from '../modules/mail/mail.module';
import { NurturingModule } from '../modules/nurturing/nurturing.module';
import { BillingModule } from '../modules/billing/billing.module';
import { LeadsModule } from '../modules/leads/leads.module';
import { ManufacturingDefaultsModule } from '../modules/manufacturing-defaults/manufacturing-defaults.module';

@Module({
  imports: [
    PassportModule,
    MailModule,
    MfaModule,
    NurturingModule,
    BillingModule,
    LeadsModule,
    ManufacturingDefaultsModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secret',
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
    }),
  ],
  providers: [
    AuthService,
    JwtStrategy,
    GoogleStrategy,
    FacebookStrategy,
    TwitterStrategy,
    GoogleOAuthGuard,
    FacebookOAuthGuard,
    TwitterOAuthGuard,
  ],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
