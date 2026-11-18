package com.genxcrm.app.dialer

import java.io.File
import java.net.HttpURLConnection
import java.net.URL

// Streams the file to the presigned S3 URL from native code: no base64 round-trip through the
// WebView and no CORS (the bucket only allows the web origins, not https://localhost).
// Content-Type must equal the value the URL was signed with (backend getPresignedUploadUrl).
object RecordingUploader {
    fun put(path: String, url: String, mimeType: String): Long {
        val file = File(path)
        require(file.exists() && file.length() > 0) { "Recording file is missing or empty" }
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "PUT"
            connection.doOutput = true
            connection.connectTimeout = 15_000
            connection.readTimeout = 60_000
            connection.setRequestProperty("Content-Type", mimeType)
            connection.setFixedLengthStreamingMode(file.length())
            file.inputStream().use { input -> connection.outputStream.use { input.copyTo(it) } }
            check(connection.responseCode in 200..299) { "S3 upload failed: ${connection.responseCode}" }
            return file.length()
        } finally {
            connection.disconnect()
        }
    }
}
