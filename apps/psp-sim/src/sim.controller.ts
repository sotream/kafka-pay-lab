import { Body, Controller, Get, Put, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { concat, defer, map, of } from 'rxjs';
import type { Observable } from 'rxjs';
import { SimService } from './sim.service.js';
import { SimStateDto } from './sim-state.js';
import type { SimState } from './sim-state.js';

@Controller('sim')
export class SimController {
  constructor(private readonly sim: SimService) {}

  @Get('state')
  getState(): SimState {
    return this.sim.getState();
  }

  @Put('state')
  setState(@Body() dto: SimStateDto): SimState {
    return this.sim.setState({ ...dto });
  }

  @Sse('events')
  events(): Observable<MessageEvent> {
    return concat(
      defer(() => of(this.sim.snapshot())),
      this.sim.events$,
    ).pipe(map((data) => ({ data })));
  }
}
