import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

const STATUS_CODES: Partial<Record<number, string>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
  501: 'NOT_IMPLEMENTED',
  503: 'SERVICE_UNAVAILABLE',
};

/**
 * Renders every error as API.md's envelope: `{ "error": { "code", "message", "details" } }`.
 * Unexpected errors become a generic 500: no stack traces or internals reach clients,
 * and nothing request-specific (which may contain personal data) is logged.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const fallbackCode = STATUS_CODES[status] ?? 'ERROR';

      let code = fallbackCode;
      let message = exception.message;
      let details: unknown;

      if (typeof body === 'object' && body !== null) {
        const b = body as { code?: unknown; message?: unknown; details?: unknown };
        if (typeof b.code === 'string') code = b.code;
        if (typeof b.message === 'string') message = b.message;
        else if (Array.isArray(b.message)) message = b.message.join('; ');
        details = b.details;
      } else if (typeof body === 'string') {
        message = body;
      }

      response.status(status).json({ error: { code, message, ...(details === undefined ? {} : { details }) } });
      return;
    }

    const name = exception instanceof Error ? exception.name : typeof exception;
    this.logger.error(`Unhandled ${name}`, exception instanceof Error ? exception.stack : undefined);
    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
  }
}
