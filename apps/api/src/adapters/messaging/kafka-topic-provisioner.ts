import { Logger } from '@nestjs/common';
import type { Admin, Kafka } from 'kafkajs';
import { errorCode, errorMessage } from '@bitex/platform';

export interface TopicSpec {
  topic: string;
  partitions: number;
  replicationFactor: number;
}

/**
 * Creates the topics this service produces to, before anything tries to use
 * them.
 *
 * Without this the application crashed at boot against a fresh broker with
 * "This server does not host this topic-partition": auto-creation is either
 * disabled or loses the race with the producer's first metadata request. When it
 * did win, it created the topic with **one** partition — which meant the
 * per-aggregate ordering guarantee this design depends on held by accident
 * rather than by configuration.
 *
 * Partition count is what makes that guarantee real *and* the throughput
 * available: messages are keyed by `withdrawalId`, so one aggregate's lifecycle
 * stays on one partition however many there are.
 *
 * Topics are created one at a time, not as a batch. `createTopics` rejects the
 * whole call when any topic in it already exists, so batching meant an existing
 * topic silently prevented a missing one from being created — which is exactly
 * the state a partially provisioned broker is in.
 *
 * Failure is logged rather than thrown, because a broker that refuses topic
 * creation (a managed cluster with restricted ACLs, say) is a deployment where
 * the topics are provisioned out of band.
 */
export class KafkaTopicProvisioner {
  private readonly logger = new Logger(KafkaTopicProvisioner.name);

  constructor(
    private readonly kafka: Kafka,
    private readonly topics: readonly TopicSpec[],
  ) {}

  async provision(): Promise<void> {
    let admin: Admin | undefined;
    try {
      admin = this.kafka.admin();
      await admin.connect();
      for (const spec of this.topics) {
        await this.create(admin, spec);
      }
    } catch (error) {
      this.logger.warn({
        operation: 'provision-topics',
        result: 'skipped',
        errorCode: errorCode(error),
        message: errorMessage(error),
      });
    } finally {
      await admin?.disconnect().catch(() => undefined);
    }
  }

  private async create(admin: Admin, spec: TopicSpec): Promise<void> {
    try {
      const created = await admin.createTopics({
        topics: [
          {
            topic: spec.topic,
            numPartitions: spec.partitions,
            replicationFactor: spec.replicationFactor,
          },
        ],
        waitForLeaders: true,
      });
      this.logger.log({
        operation: 'provision-topic',
        result: created ? 'created' : 'already-present',
        topic: spec.topic,
        partitions: spec.partitions,
      });
    } catch (error) {
      // An existing topic is the normal case after the first boot, and some
      // broker versions report it as an error rather than `false`.
      this.logger.warn({
        operation: 'provision-topic',
        result: 'skipped',
        topic: spec.topic,
        errorCode: errorCode(error),
        message: errorMessage(error),
      });
    }
  }
}
