// F-255: creates made offline, stored with their exact bytes until the worker sends them.
package com.budmon.app.core.outbox

import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.time.Clock
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class OutboxRepository
@Inject
constructor(private val dao: OutboxDao, private val workManager: WorkManager, private val clock: Clock) {
    /** Stores the request with a new idempotency key, then asks for a sync. */
    suspend fun enqueue(method: String, path: String, body: ByteArray, contentType: String): Long {
        val id =
            dao.insert(
                OutboxEntry(
                    id = 0,
                    idempotencyKey = UUID.randomUUID().toString(),
                    method = method,
                    path = path,
                    body = body.copyOf(),
                    contentType = contentType,
                    createdAtEpochMs = clock.millis(),
                    status = OutboxEntry.PENDING,
                    lastErrorKey = null,
                    attempts = 0,
                ),
            )
        kick()
        return id
    }

    /** One sync as soon as there's a network (kept if one is already queued). */
    fun kick() {
        workManager.enqueueUniqueWork(
            SYNC_NOW,
            ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build(),
        )
    }

    companion object {
        const val SYNC_NOW = "outbox-sync-now"
    }
}
