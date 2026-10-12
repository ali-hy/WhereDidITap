// F-255: sends the outbox oldest first, with each entry's stored bytes and idempotency key.
package com.budmon.app.core.outbox

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.budmon.app.core.network.ApiError
import com.budmon.app.core.network.ApiErrorParser
import com.budmon.app.core.update.UpdateRepository
import com.budmon.app.core.update.UpdateState
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.time.Clock
import java.time.Duration
import javax.inject.Named

@HiltWorker
class SyncWorker
@AssistedInject
constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val dao: OutboxDao,
    private val client: OkHttpClient,
    @Named("apiBaseUrl") private val baseUrl: HttpUrl,
    private val updates: UpdateRepository,
    private val clock: Clock,
) : CoroutineWorker(context, params) {
    /** What one send tells the loop to do next. */
    private enum class Next { Continue, StopSuccess, StopRetry }

    override suspend fun doWork(): Result {
        // A process that died mid-send left entries in SENDING; the key is unchanged, so resending is safe.
        dao.resetSending()
        while (true) {
            if (updates.state.value is UpdateState.Required) return Result.success()
            val batch = dao.pendingOldestFirst(BATCH)
            if (batch.isEmpty()) return Result.success()
            for (entry in batch) {
                if (updates.state.value is UpdateState.Required) return Result.success()
                if (clock.millis() - entry.createdAtEpochMs > MAX_AGE.toMillis()) {
                    dao.markStatus(entry.id, OutboxEntry.NEEDS_CONFIRMATION, entry.lastErrorKey)
                    continue
                }
                when (send(entry)) {
                    Next.Continue -> Unit
                    Next.StopSuccess -> return Result.success()
                    Next.StopRetry -> return Result.retry()
                }
            }
        }
    }

    private suspend fun send(entry: OutboxEntry): Next {
        dao.markStatus(entry.id, OutboxEntry.SENDING, entry.lastErrorKey)
        dao.incrementAttempts(entry.id)
        val url = baseUrl.resolve(entry.path) ?: return fail(entry, "INVALID_PATH")
        val request =
            Request
                .Builder()
                .url(url)
                .method(entry.method, entry.body.toRequestBody(entry.contentType.toMediaTypeOrNull()))
                .header("Idempotency-Key", entry.idempotencyKey)
                .build()
        val (code, body) =
            try {
                withContext(Dispatchers.IO) {
                    client.newCall(request).execute().use { it.code to it.body.bytes() }
                }
            } catch (_: IOException) {
                // Network or timeout (SocketTimeoutException is an IOException): try again later.
                return pending(entry, Next.StopRetry)
            }
        if (code in 200..299) {
            dao.delete(entry.id)
            return Next.Continue
        }
        val error = ApiErrorParser.parse(code, body)
        val key = (error as? ApiError.Defined)?.key
        return when {
            key == "CLIENT_UPDATE_REQUIRED" -> {
                val min = ((error as ApiError.Defined).data?.get("minimumVersion") as? JsonPrimitive)?.intOrNull
                updates.markRequired(min ?: Int.MAX_VALUE)
                pending(entry, Next.StopSuccess)
            }

            code == 429 || key == "RATE_LIMITED" -> {
                pending(entry, Next.StopRetry)
            }

            // An expired session isn't the entry's fault: the next sign-in kicks the sync again.
            code == 401 || key == "UNAUTHENTICATED" -> {
                pending(entry, Next.StopSuccess)
            }

            error is ApiError.Unavailable || code >= 500 -> {
                pending(entry, Next.StopRetry)
            }

            else -> {
                fail(entry, key ?: "UNKNOWN")
            }
        }
    }

    private suspend fun pending(entry: OutboxEntry, next: Next): Next {
        dao.markStatus(entry.id, OutboxEntry.PENDING, entry.lastErrorKey)
        return next
    }

    private suspend fun fail(entry: OutboxEntry, key: String): Next {
        dao.markStatus(entry.id, OutboxEntry.FAILED, key)
        return Next.Continue
    }

    private companion object {
        const val BATCH = 50
        val MAX_AGE: Duration = Duration.ofDays(60)
    }
}
