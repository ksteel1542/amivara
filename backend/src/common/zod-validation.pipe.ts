import { HttpStatus, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

import { ApiError } from './api-error';

/** Validates and parses a request body with a zod schema: `@Body(new ZodValidationPipe(schema))`. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Some fields are missing or invalid.', {
        fields: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}
