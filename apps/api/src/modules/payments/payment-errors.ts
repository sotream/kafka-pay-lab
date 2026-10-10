import { HttpException, HttpStatus } from '@nestjs/common';

const ERRORS = {
  'idempotency-key-malformed': {
    status: HttpStatus.BAD_REQUEST,
    title: 'Bad Request',
    detail: 'Idempotency-Key must be a quoted string of 1-255 characters, e.g. "8e03978e-40d5"',
  },
  'idempotency-key-reused': {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    title: 'Unprocessable Entity',
    detail: 'This Idempotency-Key was already used with a different request body',
  },
  'payment-not-found': {
    status: HttpStatus.NOT_FOUND,
    title: 'Not Found',
    detail: 'Payment not found',
  },
  'load-job-not-found': {
    status: HttpStatus.NOT_FOUND,
    title: 'Not Found',
    detail: 'Load job not found (jobs are kept in memory, only the latest few)',
  },
} as const;

export type PaymentErrorKind = keyof typeof ERRORS;

/**
 * The lab's own errors in the current NestJS shape, built in one place so that switching to RFC 9457
 * problem details later (type, title, status, detail and `errors: [{ pointer, detail }]`) is a change
 * to this function and nothing else.
 */
export function paymentError(kind: PaymentErrorKind): HttpException {
  const { status, title, detail } = ERRORS[kind];
  return new HttpException({ statusCode: status, error: title, message: detail }, status);
}
