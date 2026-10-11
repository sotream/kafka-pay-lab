import { HttpException, HttpStatus } from '@nestjs/common';

const ERRORS = {
  'idempotency-key-malformed': {
    status: HttpStatus.BAD_REQUEST,
    code: 'IDEMPOTENCY_KEY_MALFORMED',
    detail: 'Idempotency-Key must be a quoted string of 1-255 characters, e.g. "8e03978e-40d5"',
    pointer: '#/headers/Idempotency-Key',
  },
  'idempotency-key-reused': {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    code: 'IDEMPOTENCY_KEY_REUSED',
    detail: 'This Idempotency-Key was already used with a different request body',
  },
  'payment-not-found': {
    status: HttpStatus.NOT_FOUND,
    code: 'PAYMENT_NOT_FOUND',
    detail: 'Payment not found',
  },
  'load-job-not-found': {
    status: HttpStatus.NOT_FOUND,
    code: 'LOAD_JOB_NOT_FOUND',
    detail: 'Load job not found (jobs are kept in memory, only the latest few)',
  },
} as const;

export type PaymentErrorKind = keyof typeof ERRORS;

/**
 * The lab's own errors. `ProblemDetailsFilter` turns the body into an RFC 9457 problem document: `message`
 * becomes `detail`, `code` is the problem's own code (clients branch on it, never on the text), and an
 * `errors` list names the input at fault.
 */
export function paymentError(kind: PaymentErrorKind): HttpException {
  const error = ERRORS[kind];
  const pointer = 'pointer' in error ? error.pointer : undefined;
  return new HttpException(
    {
      message: error.detail,
      code: error.code,
      ...(pointer && { errors: [{ pointer, detail: error.detail }] }),
    },
    error.status,
  );
}
