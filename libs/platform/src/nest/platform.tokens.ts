import { token } from './token.js';
import type { Clock, Outbox, TransactionRunner } from '../application/ports.js';

/**
 * The capabilities every context needs and none of them owns.
 *
 * Tokens rather than concrete classes. A concrete class used as a DI token —
 * which is what this application did throughout — makes the binding
 * unoverridable in a test and quietly re-introduces the dependency on the
 * implementation that the port was there to remove.
 */
export const TRANSACTION_RUNNER = token<TransactionRunner>('TransactionRunner');
export const OUTBOX = token<Outbox>('Outbox');
export const CLOCK = token<Clock>('Clock');
