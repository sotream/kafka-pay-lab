import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator.js';
import { CreatePaymentDto, LoadPaymentsDto } from './dto/payment.dto.js';
import type { Payment } from './entities/payment.entity.js';
import { PaymentsService } from './payments.service.js';

/** Public and unthrottled on purpose: this is a local lab, and the dashboard drives it without logging in. */
@ApiTags('payments')
@Public()
@SkipThrottle()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  create(@Body() dto: CreatePaymentDto): Promise<Payment> {
    return this.payments.create(dto);
  }

  @Get()
  list(): Promise<Payment[]> {
    return this.payments.recent();
  }

  @Post('load')
  @HttpCode(HttpStatus.ACCEPTED)
  load(@Body() dto: LoadPaymentsDto): { accepted: number } {
    void this.payments.runLoad(dto);
    return { accepted: dto.count };
  }
}
