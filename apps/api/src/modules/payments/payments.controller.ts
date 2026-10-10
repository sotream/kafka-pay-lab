import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { CreatePaymentDto, LoadPaymentsDto } from './dto/payment.dto.js';
import { parseIdempotencyKey } from './idempotency-key.js';
import type { LoadJob } from './load-jobs.js';
import { paymentError } from './payment-errors.js';
import { PaymentsService } from './payments.service.js';
import { toPaymentView } from './payment.view.js';
import type { PaymentView } from './payment.view.js';

const PAYMENTS_PATH = '/api/v1/payments';

/** Public and unthrottled on purpose: this is a local lab, and the dashboard drives it without logging in. */
@ApiTags('payments')
@Public()
@SkipThrottle()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a payment',
    description:
      'Optional `Idempotency-Key` (a quoted string, draft-ietf-httpapi-idempotency-key-header): the same key ' +
      'with the same body returns the stored payment, with another body it is a 422.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false, example: '"8e03978e-40d5-43e8-bc93"' })
  async create(
    @Body() dto: CreatePaymentDto,
    @Headers('idempotency-key') rawKey: string | string[] | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaymentView> {
    const { payment } = await this.payments.create(dto, parseIdempotencyKey(rawKey));
    res.location(`${PAYMENTS_PATH}/${payment.id}`);
    return toPaymentView(payment);
  }

  @Get()
  async list(): Promise<PaymentView[]> {
    return (await this.payments.recent()).map(toPaymentView);
  }

  @Post('load')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Create payments in the background; Location points at the job status' })
  load(
    @Body() dto: LoadPaymentsDto,
    @Res({ passthrough: true }) res: Response,
  ): { accepted: number; jobId: string } {
    const job = this.payments.startLoad(dto);
    res.location(`${PAYMENTS_PATH}/load/${job.id}`);
    return { accepted: dto.count, jobId: job.id };
  }

  @Get('load/:jobId')
  @ApiOperation({
    summary: 'Progress of a load job (kept in memory: lost on restart, latest 20 only)',
  })
  loadStatus(@Param('jobId') jobId: string): LoadJob {
    const job = this.payments.loadJob(jobId);
    if (!job) throw paymentError('load-job-not-found');
    return job;
  }

  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe()) id: string): Promise<PaymentView> {
    const payment = await this.payments.findById(id);
    if (!payment) throw paymentError('payment-not-found');
    return toPaymentView(payment);
  }
}
