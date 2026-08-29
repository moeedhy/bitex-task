import { assertNever } from '@bitex/platform';
import type {
  Clock,
  IdGenerator,
  Outbox,
  TransactionRunner,
} from '@bitex/platform';
import { Withdrawal } from '../../domain/withdrawal.js';
import { withdrawalExecutionRequested } from '../../contracts/withdrawal-execution-requested.js';
import { IdempotencyKeyConflictError } from '../withdrawal.errors.js';
import type { WalletReservationPort } from '../ports/wallet-reservation.port.js';
import type { WithdrawalAppender } from '../ports/withdrawal.repository.js';
import type { WithdrawalIdempotencyPort } from '../ports/withdrawal-idempotency.port.js';
import { createRequestFingerprint } from './request-fingerprint.js';
import type {
  RequestWithdrawalCommand,
  RequestWithdrawalResult,
} from './request-withdrawal.contract.js';

export interface RequestWithdrawalDependencies {
  transactionRunner: TransactionRunner;
  idempotency: WithdrawalIdempotencyPort;
  walletReservation: WalletReservationPort;
  withdrawals: WithdrawalAppender;
  outbox: Outbox;
  withdrawalIdGenerator: IdGenerator<'WithdrawalId'>;
  eventIdGenerator: IdGenerator<'EventId'>;
  clock: Clock;
}

/**
 * One transaction: claim the key, hold the funds, record the Withdrawal, and
 * enqueue the execution intent. Either all of it commits or none of it does,
 * which is what makes "money is reserved but nothing will ever spend it"
 * unrepresentable.
 */
export class RequestWithdrawal {
  constructor(private readonly dependencies: RequestWithdrawalDependencies) {}

  execute(command: RequestWithdrawalCommand): Promise<RequestWithdrawalResult> {
    return this.dependencies.transactionRunner.run(async () => {
      const replay = await this.claimIdempotencyKey(command);
      if (replay) {
        return replay;
      }

      const withdrawal = await this.openWithdrawal(command);
      const result = toResult(withdrawal);

      await this.dependencies.idempotency.complete(
        command.idempotencyKey,
        result,
      );
      return result;
    });
  }

  /**
   * Returns the recorded result when this key has already been answered, and
   * `null` when this caller now owns the operation.
   */
  private async claimIdempotencyKey(
    command: RequestWithdrawalCommand,
  ): Promise<RequestWithdrawalResult | null> {
    const claim = await this.dependencies.idempotency.claim({
      operation: 'REQUEST_WITHDRAWAL',
      key: command.idempotencyKey,
      fingerprint: createRequestFingerprint(command),
    });

    switch (claim.kind) {
      case 'REPLAY':
        return claim.result;
      case 'CONFLICT':
        throw new IdempotencyKeyConflictError(command.idempotencyKey);
      case 'CLAIMED':
        return null;
      default:
        return assertNever(claim);
    }
  }

  /**
   * The order here is deliberate: the withdrawal's own rules are checked
   * *before* a customer's funds are held, so a non-positive amount or a
   * malformed address is rejected by the aggregate the caller addressed rather
   * than surfacing as `INVALID_WALLET_AMOUNT` from a module they never named.
   */
  private async openWithdrawal(
    command: RequestWithdrawalCommand,
  ): Promise<Withdrawal> {
    Withdrawal.assertRequestable(command);

    const withdrawalId = this.dependencies.withdrawalIdGenerator.next();
    const { reservationId } = await this.dependencies.walletReservation.reserve({
      withdrawalId,
      userId: command.userId,
      amount: command.amount,
    });
    const withdrawal = Withdrawal.request({
      id: withdrawalId,
      userId: command.userId,
      amount: command.amount,
      destinationAddress: command.destinationAddress,
      reservationId,
      createdAt: this.dependencies.clock.now(),
    });

    await this.dependencies.withdrawals.add(withdrawal);
    await this.publish(withdrawal);
    return withdrawal;
  }

  /**
   * Publishes through the shared contract rather than hand-building a payload,
   * and derives it from what the aggregate said happened.
   */
  private async publish(withdrawal: Withdrawal): Promise<void> {
    for (const event of withdrawal.pullDomainEvents()) {
      if (event.type !== 'WithdrawalExecutionRequested') {
        continue;
      }
      await this.dependencies.outbox.append(
        withdrawalExecutionRequested(
          event,
          this.dependencies.eventIdGenerator.next(),
        ),
      );
    }
  }
}

function toResult(withdrawal: Withdrawal): RequestWithdrawalResult {
  return {
    withdrawalId: withdrawal.id,
    status: withdrawal.status,
    asset: withdrawal.asset.code,
    amount: withdrawal.amount.toDecimalString(),
  };
}
