// F-254 (A-344): the app's Room database, budmon.db.
package com.budmon.app.core.db

import androidx.room.Database
import androidx.room.RoomDatabase
import com.budmon.app.core.outbox.OutboxDao
import com.budmon.app.core.outbox.OutboxEntry

@Database(entities = [OutboxEntry::class], version = 1, exportSchema = true)
abstract class BudmonDatabase : RoomDatabase() {
    abstract fun outboxDao(): OutboxDao

    companion object {
        const val NAME = "budmon.db"
    }
}
