import { WithdrawalExecutionConsumer } from './withdrawal-execution-consumer.js';
import type { DeadLetterSink } from './withdrawal-execution-consumer.js';
import { EventId, UserId, WithdrawalId } from '@bitex/platform';
import {
  WithdrawalExecutionUnresolvedError,
  WithdrawalNotFoundError,
} from '@bitex/withdrawal';

// Fixed identities. Parsed rather than cast, so the fixtures are
// exactly what the production edges accept.
const WITHDRAWAL_ID = WithdrawalId.parse('11111111-1111-4111-8111-111111111111');
const USER_ID = UserId.parse('22222222-2222-4222-8222-222222222222');
const EVENT_ID = EventId.parse('55555555-5555-4555-8555-555555555555');

describe('WithdrawalExecutionConsumer', () => {
  const event = {
    eventId: EVENT_ID,
    eventType: 'WithdrawalExecutionRequested',
    schemaVersion: 1,
    withdrawalId: WITHDRAWAL_ID,
    userId: USER_ID,
    asset: 'USDT',
    amount: '100',
    occurredAt: '2026-08-15T10:00:00.000Z',
  };

  const createHarness = (execute: jest.Mock) => {
    const deadLettered: Parameters<DeadLetterSink['send']>[0][] = [];
    const consumer = new WithdrawalExecutionConsumer(
      {} as never,
      'withdrawal-execution-requested',
      { execute },
      {
        async send(record) {
          deadLettered.push(record);
        },
      },
      { maxAttempts: 3, backoffMs: 0, sleep: async () => undefined },
    );
    return { consumer, deadLettered, execute };
  };

  /**
   * Real errors, not stand-ins carrying a `code` property.
   *
   * Retryability is now a fact each error class declares, so a fabricated
   * failure would only prove that the fabrication matches the assertion. These
   * are the exact types the workflow throws.
   */
  const unresolved = () =>
    new WithdrawalExecutionUnresolvedError(WITHDRAWAL_ID, {
      cause: new Error('socket hang up'),
    });
  const notFound = () => new WithdrawalNotFoundError(WITHDRAWAL_ID);

  it('executes a well-formed event once', async () => {
    const harness = createHarness(jest.fn().mockResolvedValue(undefined));

    await harness.consumer.handle(WITHDRAWAL_ID, JSON.stringify(event));

    expect(harness.execute).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      withdrawalId: WITHDRAWAL_ID,
    });
    expect(harness.deadLettered).toHaveLength(0);
  });

  it('dead-letters a message that is not valid JSON instead of blocking the partition', async () => {
    const harness = createHarness(jest.fn());

    await harness.consumer.handle(WITHDRAWAL_ID, 'not-json');

    expect(harness.execute).not.toHaveBeenCalled();
    expect(harness.deadLettered).toHaveLength(1);
    expect(harness.deadLettered[0]?.reason).toBe('UNPARSEABLE_MESSAGE');
  });

  it('dead-letters a message that does not match the event contract', async () => {
    const harness = createHarness(jest.fn());

    await harness.consumer.handle(
      WITHDRAWAL_ID,
      JSON.stringify({ ...event, withdrawalId: '' }),
    );

    expect(harness.execute).not.toHaveBeenCalled();
    expect(harness.deadLettered[0]?.reason).toBe('UNPARSEABLE_MESSAGE');
  });

  it('retries a transient failure and succeeds without dead-lettering', async () => {
    const harness = createHarness(
      jest
        .fn()
        .mockRejectedValueOnce(unresolved())
        .mockResolvedValueOnce(undefined),
    );

    await harness.consumer.handle(WITHDRAWAL_ID, JSON.stringify(event));

    expect(harness.execute).toHaveBeenCalledTimes(2);
    expect(harness.deadLettered).toHaveLength(0);
  });

  it('dead-letters after exhausting retries so the offset can advance', async () => {
    const harness = createHarness(
      jest.fn().mockRejectedValue(unresolved()),
    );

    await harness.consumer.handle(WITHDRAWAL_ID, JSON.stringify(event));

    expect(harness.execute).toHaveBeenCalledTimes(3);
    expect(harness.deadLettered[0]?.reason).toBe('RETRIES_EXHAUSTED');
  });

  it('does not retry a failure that cannot become a success', async () => {
    const harness = createHarness(jest.fn().mockRejectedValue(notFound()));

    await harness.consumer.handle(WITHDRAWAL_ID, JSON.stringify(event));

    expect(harness.execute).toHaveBeenCalledTimes(1);
    expect(harness.deadLettered[0]?.reason).toBe('NON_RETRYABLE_FAILURE');
    expect(harness.deadLettered[0]?.error).toBe('WITHDRAWAL_NOT_FOUND');
  });

  /**
   * The inverse of the case above, and the one the old hand-maintained code set
   * got wrong by omission: a driver or broker failure is not one of ours and
   * carries no verdict, so it must be assumed transient.
   */
  it('retries a failure that did not come from this system', async () => {
    const harness = createHarness(
      jest.fn().mockRejectedValue(new Error('connection terminated')),
    );

    await harness.consumer.handle(WITHDRAWAL_ID, JSON.stringify(event));

    expect(harness.execute).toHaveBeenCalledTimes(3);
    expect(harness.deadLettered[0]?.reason).toBe('RETRIES_EXHAUSTED');
  });

  it('dead-letters a message whose identity is not a UUID before spending a retry', async () => {
    const harness = createHarness(jest.fn());

    await harness.consumer.handle(
      WITHDRAWAL_ID,
      JSON.stringify({ ...event, withdrawalId: 'withdrawal-1' }),
    );

    expect(harness.execute).not.toHaveBeenCalled();
    expect(harness.deadLettered[0]?.reason).toBe('UNPARSEABLE_MESSAGE');
  });

  /**
   * The reason the contract's schema is `z.object` and not `z.strictObject`.
   * An additive producer change is routine; under strict parsing it
   * dead-letters 100% of traffic on every consumer not yet redeployed, which
   * makes deployment order load-bearing for the whole withdrawal pipeline.
   */
  it('tolerates a field a newer producer added', async () => {
    const harness = createHarness(jest.fn().mockResolvedValue(undefined));

    await harness.consumer.handle(
      WITHDRAWAL_ID,
      JSON.stringify({ ...event, feeAmount: '0.5' }),
    );

    expect(harness.execute).toHaveBeenCalledTimes(1);
    expect(harness.deadLettered).toEqual([]);
  });

  /**
   * The inverse: a version this consumer cannot understand is refused rather
   * than half-read. That is what carrying schemaVersion buys.
   */
  it('dead-letters a schema version it does not understand', async () => {
    const harness = createHarness(jest.fn());

    await harness.consumer.handle(
      WITHDRAWAL_ID,
      JSON.stringify({ ...event, schemaVersion: 2 }),
    );

    expect(harness.execute).not.toHaveBeenCalled();
    expect(harness.deadLettered[0]?.reason).toBe('UNPARSEABLE_MESSAGE');
  });

  /**
   * Messages produced before versioning existed carry no schemaVersion and are
   * v1 by definition, so a rolling deploy does not strand the backlog.
   */
  it('reads an unversioned message as version 1', async () => {
    const harness = createHarness(jest.fn().mockResolvedValue(undefined));
    const unversioned = { ...event, schemaVersion: undefined };

    await harness.consumer.handle(WITHDRAWAL_ID, JSON.stringify(unversioned));

    expect(harness.execute).toHaveBeenCalledTimes(1);
    expect(harness.deadLettered).toEqual([]);
  });
});
