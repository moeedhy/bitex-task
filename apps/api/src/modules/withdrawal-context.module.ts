import { Module } from '@nestjs/common';
import { WithdrawalModule } from '@bitex/withdrawal/nest';
import { PersistenceModule } from './persistence.module.js';
import { WithdrawalAdaptersModule } from './withdrawal-adapters.module.js';

/**
 * Composes the Withdrawal context exactly once.
 *
 * `forRoot` is called here and held in a constant rather than being called at
 * each import site. Nest keys dynamic modules by their generated metadata, and
 * two structurally similar calls are not a guarantee of one instance — which
 * for this module would mean two `RequestWithdrawal`s, and, further down, two
 * transaction runners and therefore two `AsyncLocalStorage` scopes. Composing
 * once and re-exporting removes the question.
 *
 * The context needs both the adapters and the transaction boundary, and says so.
 */
const withdrawalContext = WithdrawalModule.forRoot({
  imports: [WithdrawalAdaptersModule, PersistenceModule],
});

@Module({
  imports: [withdrawalContext],
  exports: [withdrawalContext],
})
export class WithdrawalContextModule {}
