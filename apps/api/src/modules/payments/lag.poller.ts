import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka } from 'kafkajs';
import type { Admin } from 'kafkajs';
import type { EnvironmentVariables } from '../../infrastructure/config/env.validation.js';
import { KAFKA_CLIENT } from '../../infrastructure/messaging/messaging.constants.js';
import { PAYMENT_REQUESTED_TOPIC } from './payment-events.js';

export interface LagSample {
  total: number;
  partitions: { partition: number; lag: number }[];
}

/** Lag = newest offset in the partition minus the offset the group has committed. */
export function computeLag(
  latest: { partition: number; high: string; low: string }[],
  committed: { partition: number; offset: string }[],
): LagSample {
  const partitions = latest.map(({ partition, high, low }) => {
    const offset = Number(committed.find((c) => c.partition === partition)?.offset ?? -1);
    // -1 means "nothing committed yet": the group still has everything since the earliest offset to read.
    const consumed = offset >= 0 ? offset : Number(low);
    return { partition, lag: Math.max(0, Number(high) - consumed) };
  });
  return { total: partitions.reduce((sum, p) => sum + p.lag, 0), partitions };
}

@Injectable()
export class LagPoller implements OnApplicationShutdown {
  private admin?: Admin;
  private connecting?: Promise<Admin>;

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: Kafka,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** Null when Kafka is disabled. Throws when the broker or topic is not reachable yet. */
  async sample(): Promise<LagSample | null> {
    if (!this.config.get('KAFKA_ENABLED', { infer: true })) return null;
    const admin = await this.connectedAdmin();
    const [latest, groups] = await Promise.all([
      admin.fetchTopicOffsets(PAYMENT_REQUESTED_TOPIC),
      admin.fetchOffsets({
        groupId: this.config.get('PAYMENTS_GROUP_ID', { infer: true }),
        topics: [PAYMENT_REQUESTED_TOPIC],
      }),
    ]);
    return computeLag(latest, groups[0]?.partitions ?? []);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.admin?.disconnect();
  }

  /** The pending connect is cached, not only the finished one: scrapes during a broker outage must not each open a new hanging connection. */
  private connectedAdmin(): Promise<Admin> {
    this.connecting ??= this.connect().catch((error: unknown) => {
      this.connecting = undefined;
      throw error;
    });
    return this.connecting;
  }

  private async connect(): Promise<Admin> {
    const admin = this.kafka.admin();
    await admin.connect();
    this.admin = admin;
    return admin;
  }
}
