// F-207 (S-3): events about the session that come from outside the view model.
package com.budmon.app.identity

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject
import javax.inject.Singleton

sealed interface SessionEvent {
    /** The refresh token was refused: the session is over. */
    data object Ended : SessionEvent
}

@Singleton
class SessionEvents
    @Inject
    constructor() {
        private val shared = MutableSharedFlow<SessionEvent>(replay = 0, extraBufferCapacity = BUFFER, onBufferOverflow = BufferOverflow.DROP_OLDEST)
        val events: SharedFlow<SessionEvent> = shared.asSharedFlow()

        /** Never suspends; callers run on OkHttp threads. */
        fun emit(event: SessionEvent) {
            shared.tryEmit(event)
        }

        private companion object {
            const val BUFFER = 8
        }
    }
