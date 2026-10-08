import { Controller, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { map } from 'rxjs';
import type { Observable } from 'rxjs';
import { Public } from '../../common/decorators/public.decorator.js';
import { StreamService } from './stream.service.js';

/** Public on purpose: the browser's EventSource cannot send an Authorization header. Lab only. */
@ApiTags('stream')
@Public()
@SkipThrottle()
@Controller()
export class StreamController {
  constructor(private readonly stream: StreamService) {}

  @Sse('stream')
  open(): Observable<MessageEvent> {
    return this.stream.open().pipe(map((data) => ({ data })));
  }
}
