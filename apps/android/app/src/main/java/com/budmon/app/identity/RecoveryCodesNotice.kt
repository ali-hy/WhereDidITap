// J-5: how many recovery codes are left after a recovery-code sign-in, until Home shows it.
package com.budmon.app.identity

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class RecoveryCodesNotice
    @Inject
    constructor() {
        private val state = MutableStateFlow<Int?>(null)

        /** The pending count, or null when there is nothing to show. */
        val left: StateFlow<Int?> = state.asStateFlow()

        fun post(count: Int) {
            state.value = count
        }

        fun consume() {
            state.value = null
        }
    }
