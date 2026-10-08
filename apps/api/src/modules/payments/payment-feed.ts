import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { BreakerSnapshot } from './circuit-breaker.js';
import type { PaymentView } from './payment.view.js';

/** In-process fan-out: producers of changes push here, the SSE stream subscribes. */
@Injectable()
export class PaymentFeed {
  readonly payment$ = new Subject<PaymentView>();
  readonly breaker$ = new Subject<BreakerSnapshot>();
}
