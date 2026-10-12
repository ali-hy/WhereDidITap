// The app-wide bindings (§4.19: Hilt provides every dependency).
package com.budmon.app.core.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import androidx.room.Room
import androidx.work.WorkManager
import com.budmon.api.apis.MetaApi
import com.budmon.app.BuildConfig
import com.budmon.app.core.db.BudmonDatabase
import com.budmon.app.core.network.ClientHeaderInterceptor
import com.budmon.app.core.network.IdempotencyKeyInterceptor
import com.budmon.app.core.network.TraceparentInterceptor
import com.budmon.app.core.outbox.OutboxDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.time.Clock
import javax.inject.Named
import javax.inject.Singleton

/** F-257 (A-352): datastore/budmon_update.preferences_pb. */
private val Context.updateDataStore: DataStore<Preferences> by preferencesDataStore(name = "budmon_update")

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    @Singleton
    @Named("versionCode")
    fun versionCode(): Int = BuildConfig.VERSION_CODE

    @Provides
    @Singleton
    fun clock(): Clock = Clock.systemUTC()

    @Provides
    @Singleton
    fun okHttpClient(@Named("versionCode") versionCode: Int): OkHttpClient = OkHttpClient
        .Builder()
        .addInterceptor(ClientHeaderInterceptor(versionCode))
        .addInterceptor(TraceparentInterceptor())
        .addInterceptor(IdempotencyKeyInterceptor())
        .build()

    @Provides
    @Singleton
    fun retrofit(client: OkHttpClient, @Named("apiBaseUrl") baseUrl: HttpUrl): Retrofit = Retrofit
        .Builder()
        .baseUrl(baseUrl.resolve("api/v1/") ?: baseUrl)
        .client(client)
        .addConverterFactory(Json { ignoreUnknownKeys = true }.asConverterFactory("application/json".toMediaType()))
        .build()

    @Provides
    @Singleton
    fun metaApi(retrofit: Retrofit): MetaApi = retrofit.create(MetaApi::class.java)

    @Provides
    @Singleton
    fun database(@ApplicationContext context: Context): BudmonDatabase =
        Room.databaseBuilder(context, BudmonDatabase::class.java, BudmonDatabase.NAME).build()

    @Provides
    fun outboxDao(database: BudmonDatabase): OutboxDao = database.outboxDao()

    @Provides
    @Singleton
    fun updateDataStore(@ApplicationContext context: Context): DataStore<Preferences> = context.updateDataStore

    @Provides
    @Singleton
    fun workManager(@ApplicationContext context: Context): WorkManager = WorkManager.getInstance(context)
}
