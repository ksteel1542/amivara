import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Error codes from docs/API.md. Clients switch on `code`, never on `message`.
 */
export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'INVALID_TOKEN'
  | 'INVALID_PHONE'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'OTP_LOCKED'
  | 'OTP_RATE_LIMITED'
  | 'OTP_DELIVERY_FAILED'
  | 'INVALID_REFRESH_TOKEN'
  | 'REFRESH_TOKEN_REUSED'
  | 'SIGNUP_BLOCKED'
  | 'UNDERAGE'
  | 'PHONE_ALREADY_REGISTERED'
  | 'NOT_AGE_VERIFIED'
  | 'ACCOUNT_SUSPENDED'
  | 'PHOTO_LIMIT'
  | 'MIN_PHOTOS'
  | 'UPLOAD_NOT_FOUND'
  | 'INVALID_IMAGE'
  | 'MEDIA_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL';

/** Throw this from services: the exception filter renders `{ error: { code, message, details } }`. */
export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}
