import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { EVENT_PUBLISHER } from '../messaging/event-publisher.port.js';
import type { EventPublisher } from '../messaging/event-publisher.port.js';
import { OutboxEvent } from './entities/outbox-event.entity.js';
import { OutboxCleanupService } from './outbox-cleanup.service.js';
import { OutboxRelay } from './outbox-relay.js';
import { OutboxService } from './outbox.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([OutboxEvent])],
  providers: [
    OutboxService,
    OutboxCleanupService,
    {
      provide: OutboxRelay,
      inject: [DataSource, EVENT_PUBLISHER, ConfigService],
      useFactory: (
        dataSource: DataSource,
        events: EventPublisher,
        config: ConfigService<EnvironmentVariables, true>,
      ) =>
        new OutboxRelay(
          dataSource,
          events,
          config.get('KAFKA_ENABLED', { infer: true })
            ? config.get('OUTBOX_POLL_MS', { infer: true })
            : null,
        ),
    },
  ],
  exports: [OutboxService],
})
export class OutboxModule {}
