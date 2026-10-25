// F-254: one create waiting to be sent, with its exact bytes and idempotency key.
package com.budmon.app.core.outbox

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "outbox", indices = [Index(value = ["idempotencyKey"], unique = true)])
data class OutboxEntry(
    @PrimaryKey(autoGenerate = true) val id: Long,
    val idempotencyKey: String,
    val method: String,
    val path: String,
    val body: ByteArray,
    val contentType: String,
    val createdAtEpochMs: Long,
    val status: String,
    val lastErrorKey: String?,
    val attempts: Int,
) {
    // Room entities compare by id; the body array would otherwise compare by identity.
    override fun equals(other: Any?): Boolean = other is OutboxEntry && other.id == id && other.idempotencyKey == idempotencyKey

    override fun hashCode(): Int = id.hashCode() * 31 + idempotencyKey.hashCode()

    companion object {
        const val PENDING = "PENDING"
        const val SENDING = "SENDING"
        const val FAILED = "FAILED"
        const val NEEDS_CONFIRMATION = "NEEDS_CONFIRMATION"
        const val PAUSED = "PAUSED"
    }
}

/** What the platform UI shows about the outbox. */
data class OutboxCounts(val pending: Int, val failed: Int, val needsConfirmation: Int)
