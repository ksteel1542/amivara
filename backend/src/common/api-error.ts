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
  | 'EMAIL_ALREADY_REGISTERED'
  | 'INVALID_EMAIL'
  | 'PHONE_SIGNIN_UNAVAILABLE'
  | 'GOOGLE_SIGNIN_UNAVAILABLE'
  | 'INVALID_GOOGLE_TOKEN'
  | 'VERIFICATION_REQUIRED'
  | 'VERIFICATION_UNAVAILABLE'
  | 'ALREADY_VERIFIED'
  | 'UNDER_REVIEW'
  | 'INVALID_SIGNATURE'
  | 'VERIFICATION_RATE_LIMITED'
  | 'ACCOUNT_SUSPENDED'
  | 'PHOTO_LIMIT'
  | 'MIN_PHOTOS'
  | 'UPLOAD_NOT_FOUND'
  | 'INVALID_IMAGE'
  | 'MEDIA_UNAVAILABLE'
  | 'LOCATION_REQUIRED'
  | 'DAILY_LIKE_LIMIT'
  | 'PLUS_REQUIRED'
  | 'MESSAGE_RATE_LIMITED'
  | 'NOT_FOUND'
  | 'INSUFFICIENT_COINS'
  | 'PAYMENTS_UNAVAILABLE'
  | 'PAYMENT_PROVIDER_ERROR'
  | 'TOPUP_RATE_LIMITED'
  | 'HOST_ONLY'
  | 'AI_UNAVAILABLE'
  | 'SPEND_LIMIT_REACHED'
  | 'SELF_EXCLUDED'
  | 'ICEBREAKER_RATE_LIMITED'
  | 'GIFT_RATE_LIMITED'
  | 'ROOM_ALREADY_LIVE'
  | 'ROOM_ENDED'
  | 'ROOM_SEATS_FULL'
  | 'NO_SEAT_REQUEST'
  | 'FOLLOWERS_ONLY'
  | 'CONTACT_SHARING_BLOCKED'
  | 'PAYOUTS_UNAVAILABLE'
  | 'PAYOUTS_DISABLED'
  | 'ACCOUNT_NOT_RESOLVED'
  | 'NO_PAYOUT_ACCOUNT'
  | 'PAYOUT_IN_PROGRESS'
  | 'BELOW_MINIMUM_WITHDRAWAL'
  | 'INSUFFICIENT_EARNINGS'
  | 'RESOLVE_RATE_LIMITED'
  | 'CALLS_UNAVAILABLE'
  | 'CALLEE_BUSY'
  | 'CALL_NOT_RINGING'
  | 'CALL_RATE_LIMITED'
  | 'FORBIDDEN'
  | 'REPORT_RATE_LIMITED'
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
