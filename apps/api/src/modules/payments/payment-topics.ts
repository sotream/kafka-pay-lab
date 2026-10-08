import type { Kafka } from 'kafkajs';
import {
  PAYMENT_COMPLETED_TOPIC,
  PAYMENT_DLQ_TOPIC,
  PAYMENT_REQUESTED_TOPIC,
} from './payment-events.js';

export const PAYMENT_PARTITIONS = 3;

/** Creates the lab topics with several partitions (so lag shows per partition). Safe to call repeatedly. */
export async function ensurePaymentTopics(kafka: Kafka): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();
  try {
    await admin.createTopics({
      topics: [PAYMENT_REQUESTED_TOPIC, PAYMENT_COMPLETED_TOPIC, PAYMENT_DLQ_TOPIC].map(
        (topic) => ({ topic, numPartitions: PAYMENT_PARTITIONS }),
      ),
      waitForLeaders: true,
    });
  } finally {
    await admin.disconnect();
  }
}
