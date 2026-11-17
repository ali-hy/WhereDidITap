// F-205: a sign-in is stored only when the outbox on this phone belongs to the user signing in (A-69).
package com.budmon.app.identity

import com.budmon.app.core.outbox.OutboxDao
import com.budmon.app.core.outbox.OutboxRepository
import com.budmon.app.identity.store.TokenStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

sealed interface OwnerDecision {
    data object Proceed : OwnerDecision

    /** [count] entries belong to someone else (or to no known owner); nothing is stored yet. */
    data class AskDiscard(val count: Int) : OwnerDecision
}

/** The owner dialog's button that is running. */
enum class OwnerChoice { Delete, Cancel }

@Singleton
class OutboxOwnerGuard
    @Inject
    constructor(
        private val dao: OutboxDao,
        private val tokenStore: TokenStore,
        private val outbox: OutboxRepository,
        private val repository: AuthRepository,
    ) {
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

        /** Stores [pending] and returns Proceed when the outbox is empty or the user's own. */
        suspend fun complete(pending: PendingSignIn): OwnerDecision {
            val count = dao.countAll()
            if (count > 0 && tokenStore.outboxOwnerUserId() != pending.me.id) return OwnerDecision.AskDiscard(count)
            accept(pending)
            return OwnerDecision.Proceed
        }

        /** Deletes the other user's entries, then stores [pending]. */
        suspend fun discardAndProceed(pending: PendingSignIn) {
            dao.deleteAll()
            accept(pending)
        }

        /** Ends [pending]'s session; the entries, the owner and the stored values stay as they were. */
        suspend fun cancel(pending: PendingSignIn) {
            repository.abandonSignIn(pending)
        }

        /** Cancels [pending] on the guard's own scope, for a screen that is gone. */
        fun release(pending: PendingSignIn) {
            scope.launch { cancel(pending) }
        }

        private suspend fun accept(pending: PendingSignIn) {
            tokenStore.setOutboxOwnerUserId(pending.me.id)
            repository.commitSignIn(pending)
            outbox.kick()
        }
    }
