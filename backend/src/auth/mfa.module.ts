import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MfaService } from './mfa.service';
import { MailModule } from '../modules/mail/mail.module';

@Module({
  imports: [
    MailModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secret',
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
    }),
  ],
  providers: [MfaService],
  exports: [MfaService],
})
export class MfaModule {}
