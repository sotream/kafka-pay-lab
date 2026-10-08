import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min, ValidateIf } from 'class-validator';

export const CURRENCIES = ['USD', 'EUR', 'UAH'] as const;
const MAX_AMOUNT = 99_999_999;

export class CreatePaymentDto {
  /** Minor units, e.g. 1050 is 10.50. */
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT)
  amount: number;

  @IsIn(CURRENCIES)
  currency: string;

  // Not @IsOptional(): that also lets an explicit `null` through, which would overwrite the default.
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, 64)
  cardToken: string = 'tok_test';
}

export class LoadPaymentsDto {
  @IsInt()
  @Min(1)
  @Max(500)
  count: number;

  /** Pause between payments. 0 sends them as fast as the API can insert. */
  @IsInt()
  @Min(0)
  @Max(5000)
  intervalMs: number;

  /** Fixed amount for every payment; omit for random amounts. Use a magic amount to force a provider outcome. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT)
  amount?: number;
}
