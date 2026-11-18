import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SessionTokenService } from './session-token.service';

// Global so any module can mint a full-session JWT via SessionTokenService
// without importing AuthModule (avoids a circular-import risk with modules
// AuthModule itself depends on, e.g. UsersModule via other paths).
@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secret',
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
    }),
  ],
  providers: [SessionTokenService],
  exports: [SessionTokenService],
})
export class SessionTokenModule {}
