import type { PoolClient } from 'pg';

/**
 * The transaction-bound client an adapter needs to enlist in the caller's
 * transaction.
 *
 * Eight adapters previously declared `TransactionalClient`
 * — a dependency on the *shape of a concrete class*, which is precisely the
 * coupling the ports exist to remove. Naming the capability separates "I need
 * the current transaction's client" from "I need that particular class", and
 * lets the runner be published under two tokens: the neutral `TransactionRunner`
 * that the libraries depend on, and this one, which never leaves the adapter
 * layer.
 */
export interface TransactionalClient {
  client(): PoolClient;
}
