import type { Clock, TransactionRunner } from '@bitex/platform';
import { WithdrawalExecutionUnresolvedError } from '../withdrawal.errors.js';
import type { WithdrawalRepository } from '../ports/withdrawal.repository.js';
import type {
  ExecutionRequest,
  ExecutionResult,
  WithdrawalProvider,
} from './withdrawal.provider.js';

export interface ProcessedEventPort {
  has(eventId: string): Promise<boolean>;
  record(eventId: string): Promise<void>;
}

export interface WalletSettlementPort {
  finalize(reservationId: string): Promise<void>;
  release(reservationId: string): Promise<void>;
}

export interface ExecuteWithdrawalDependencies {
  transactionRunner: TransactionRunner;
  withdrawals: WithdrawalRepository;
  processedEvents: ProcessedEventPort;
  walletSettlement: WalletSettlementPort;
  provider: WithdrawalProvider;
  clock: Clock;
}

export interface ExecuteWithdrawalCommand {
  eventId: string;
  withdrawalId: string;
}

export class ExecuteWithdrawal {
  constructor(private readonly dependencies: ExecuteWithdrawalDependencies) {}

  async execute(command: ExecuteWithdrawalCommand): Promise<void> {
    const request = await this.prepare(command);
    if (!request) {
      return;
    }

    let result: ExecutionResult;
    try {
      result = await this.dependencies.provider.execute(request);
    } catch (cause) {
      // A transport failure is not a provider rejection: the transfer may have
      // happened. Leave the Withdrawal PROCESSING and the reservation ACTIVE so
      // redelivery re-drives the idempotent provider instead of releasing funds
      // that may already be gone.
      throw new WithdrawalExecutionUnresolvedError(command.withdrawalId, {
        cause,
      });
    }
    await this.settle(command, result);
  }

  private prepare(
    command: ExecuteWithdrawalCommand,
  ): Promise<ExecutionRequest | null> {
    return this.dependencies.transactionRunner.run(async () => {
      if (await this.dependencies.processedEvents.has(command.eventId)) {
        return null;
      }

      const withdrawal = await this.dependencies.withdrawals.getForUpdate(
        command.withdrawalId,
      );
      if (withdrawal.status === 'COMPLETED' || withdrawal.status === 'FAILED') {
        await this.dependencies.processedEvents.record(command.eventId);
        return null;
      }
      if (withdrawal.status === 'PENDING') {
        withdrawal.startProcessing(this.dependencies.clock.now());
        await this.dependencies.withdrawals.save(withdrawal);
      }

      return {
        withdrawalId: withdrawal.id,
        amount: withdrawal.amount.toDecimalString(),
        asset: withdrawal.asset.code,
        destinationAddress: withdrawal.destinationAddress.value,
      };
    });
  }

  private settle(
    command: ExecuteWithdrawalCommand,
    result: ExecutionResult,
  ): Promise<void> {
    return this.dependencies.transactionRunner.run(async () => {
      if (await this.dependencies.processedEvents.has(command.eventId)) {
        return;
      }
      const withdrawal = await this.dependencies.withdrawals.getForUpdate(
        command.withdrawalId,
      );
      if (withdrawal.status === 'COMPLETED' || withdrawal.status === 'FAILED') {
        await this.dependencies.processedEvents.record(command.eventId);
        return;
      }

      if (result.status === 'SUCCESS') {
        withdrawal.complete(
          result.transactionReference,
          this.dependencies.clock.now(),
        );
        await this.dependencies.walletSettlement.finalize(
          withdrawal.reservationId,
        );
      } else {
        withdrawal.fail(result.reason, this.dependencies.clock.now());
        await this.dependencies.walletSettlement.release(
          withdrawal.reservationId,
        );
      }
      await this.dependencies.withdrawals.save(withdrawal);
      await this.dependencies.processedEvents.record(command.eventId);
    });
  }
}
