import { randomUUID } from 'node:crypto';
import { trace } from '@opentelemetry/api';
import { Body, Controller, Headers, Post, Req, Res } from '@nestjs/common';
import { IsIn, IsInt, IsString, Length, Max, Min } from 'class-validator';
import type { Request, Response } from 'express';
import { logLine } from './json-log.js';
import { resolveScenario } from './scenario.js';
import { SimService } from './sim.service.js';
import type { LogEntry } from './sim.service.js';

export class ChargeDto {
  @IsInt() @Min(1) @Max(99_999_999) amount: number;
  @IsIn(['USD', 'EUR', 'UAH']) currency: string;
  @IsString() @Length(1, 64) cardToken: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

@Controller('charges')
export class ChargesController {
  constructor(private readonly sim: SimService) {}

  @Post()
  async charge(
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: ChargeDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!key) {
      res.status(400).json({ error: 'Idempotency-Key header is required' });
      return;
    }
    const entry = (outcome: string, latencyMs: number, source: LogEntry['source']): void => {
      this.sim.record({
        at: new Date().toISOString(),
        key,
        amount: dto.amount,
        latencyMs,
        outcome,
        source,
      });
      const span = trace.getActiveSpan()?.spanContext();
      // The card token and amount stay out of the log; the key is the payment id.
      logLine(process.env.LOG_DIR, {
        msg: 'charge',
        level: 'info',
        idempotency_key: key,
        outcome,
        latency_ms: latencyMs,
        ...(span && { trace_id: span.traceId, span_id: span.spanId }),
      });
    };

    // A retry that arrives while the first call is still running waits for it, then gets its result.
    await this.sim.settled(key);
    const stored = this.sim.replay(key);
    if (stored) {
      entry('replayed', 0, 'idempotent-replay');
      res.status(stored.status).json(stored.body);
      return;
    }

    const release = this.sim.claim(key);
    try {
      await this.answer(key, dto, req, res, entry);
    } finally {
      release();
    }
  }

  private async answer(
    key: string,
    dto: ChargeDto,
    req: Request,
    res: Response,
    entry: (outcome: string, latencyMs: number, source: LogEntry['source']) => void,
  ): Promise<void> {
    const { latencyMs, outcome, source } = resolveScenario(this.sim.getState(), dto.amount);
    trace.getActiveSpan()?.setAttributes({ 'psp.outcome': outcome.kind, 'psp.source': source });
    await sleep(latencyMs);

    switch (outcome.kind) {
      case 'approve': {
        const body = { chargeId: `ch_${randomUUID()}`, status: 'approved' };
        this.sim.store(key, { status: 200, body });
        entry('approved', latencyMs, source);
        res.status(200).json(body);
        return;
      }
      case 'decline': {
        const body = { code: outcome.code };
        this.sim.store(key, { status: 402, body });
        entry(`declined:${outcome.code}`, latencyMs, source);
        res.status(402).json(body);
        return;
      }
      case 'http503':
        entry('http503', latencyMs, source);
        res.status(503).json({ error: 'service_unavailable' });
        return;
      case 'reset':
        entry('reset', latencyMs, source);
        req.socket.destroy();
        return;
      case 'hang':
        entry('hang', latencyMs, source);
        // Never answer: the client gives up on its own timeout. Wait for the response (not the request, whose
        // 'close' already fired once the body was read) to close, so nothing leaks.
        this.sim.hanging += 1;
        try {
          await new Promise<void>((resolve) => res.on('close', resolve));
        } finally {
          this.sim.hanging -= 1;
        }
        return;
    }
  }
}
