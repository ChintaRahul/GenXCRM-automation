package com.genxcrm.app.calllog

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

// Background-scan trigger: runs whether or not the app is in the foreground, so a call is
// eventually picked up even if the rep never reopens the app. The immediate trigger (the moment
// the rep returns to the app) is CallLogPlugin.syncNow — both call the same CallLogScanner.
class CallLogSyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        CallLogScanner.scan(applicationContext)
        return Result.success()
    }

    companion object {
        private const val UNIQUE_WORK_NAME = "genx-call-log-sync"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<CallLogSyncWorker>(15, TimeUnit.MINUTES).build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(UNIQUE_WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_WORK_NAME)
        }
    }
}
