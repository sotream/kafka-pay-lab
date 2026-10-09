import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** A domain event saved in the same transaction as the change that caused it, published later by the relay. */
@Entity('outbox_events')
@Index(['publishedAt', 'id'])
export class OutboxEvent {
  /** bigint comes back from Postgres as a string. */
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'varchar' })
  topic: string;

  /** Kafka message key: events with the same key keep their order. */
  @Column({ type: 'varchar' })
  key: string;

  @Column({ type: 'jsonb' })
  payload: object;

  /** W3C `traceparent` of the request that caused the event, so the trace survives the async gap to the relay. */
  @Column({ type: 'varchar', length: 55, nullable: true })
  traceparent: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  publishedAt: Date | null;
}
