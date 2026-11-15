import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { SignupBlocksService } from '../users/signup-blocks.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard, SignupTokenGuard } from './auth.guards';
import { GOOGLE_KEYS, GoogleIdentityService, HttpGoogleKeySource } from './google-identity';
import { ConsoleOtpSender, OTP_SENDER } from './otp-sender';
import { OtpService } from './otp.service';
import { SessionsService } from './sessions.service';
import { TokensService } from './tokens.service';

/**
 * Phone OTP sign-in, JWT access tokens and rotating refresh sessions (API.md "Auth").
 * JwtAuthGuard is global: every route needs a valid access token unless it is @Public().
 */
@Module({
  controllers: [AuthController],
  providers: [
    TokensService,
    OtpService,
    SessionsService,
    SignupBlocksService,
    SignupTokenGuard,
    // Only the console sender exists until the SMS/WhatsApp provider is chosen (env OTP_PROVIDER).
    { provide: OTP_SENDER, useClass: ConsoleOtpSender },
    GoogleIdentityService,
    { provide: GOOGLE_KEYS, useFactory: () => new HttpGoogleKeySource() },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [TokensService, SessionsService, SignupBlocksService, SignupTokenGuard],
})
export class AuthModule {}
