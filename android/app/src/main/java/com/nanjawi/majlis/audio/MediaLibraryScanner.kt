package com.nanjawi.majlis.audio

import android.content.ContentUris
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Log

/**
 * يفحص جميع ملفات MP3 والصوت على الهاتف عبر MediaStore.
 * يعمل على كل إصدارات أندرويد، مع دعم الأذونات الحديثة.
 */
data class AudioFile(
    val id: Long,
    val uri: Uri,
    val title: String,
    val displayName: String,
    val artist: String,
    val album: String,
    val durationMs: Long,
    val sizeBytes: Long,
    val dateAdded: Long,
    val mimeType: String,
    val path: String
)

object MediaLibraryScanner {

    fun scanAll(context: Context): List<AudioFile> {
        val list = ArrayList<AudioFile>()
        try {
            val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
            } else {
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
            }

            val projection = arrayOf(
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.DISPLAY_NAME,
                MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM,
                MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.SIZE,
                MediaStore.Audio.Media.DATE_ADDED,
                MediaStore.Audio.Media.MIME_TYPE,
                MediaStore.Audio.Media.DATA // قد يكون deprecated لكن مفيد
            )

            // نريد كل الملفات الصوتية، لكن نركز على mp3 وما شابه
            // لا نفلتر كثيراً هنا، نترك الفلترة في الكود
            val selection = "${MediaStore.Audio.Media.IS_MUSIC} != 0 OR ${MediaStore.Audio.Media.MIME_TYPE} LIKE ? OR ${MediaStore.Audio.Media.MIME_TYPE} LIKE ?"
            val selectionArgs = arrayOf("audio/%", "%mp3%")

            val sortOrder = "${MediaStore.Audio.Media.TITLE} ASC"

            val cursor: Cursor? = context.contentResolver.query(
                collection,
                projection,
                null, // نأخذ الكل ثم نفلتر
                null,
                sortOrder
            )

            cursor?.use {
                val idCol = it.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                val titleCol = it.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
                val displayNameCol = it.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
                val artistCol = it.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
                val albumCol = it.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
                val durationCol = it.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
                val sizeCol = it.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)
                val dateAddedCol = it.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED)
                val mimeTypeCol = it.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE)
                val dataCol = try { it.getColumnIndex(MediaStore.Audio.Media.DATA) } catch (_: Exception) { -1 }

                while (it.moveToNext()) {
                    try {
                        val id = it.getLong(idCol)
                        val title = it.getString(titleCol) ?: "غير معروف"
                        val displayName = it.getString(displayNameCol) ?: title
                        val artist = it.getString(artistCol) ?: "فنان غير معروف"
                        val album = it.getString(albumCol) ?: ""
                        val duration = try { it.getLong(durationCol) } catch (_: Exception) { 0L }
                        val size = try { it.getLong(sizeCol) } catch (_: Exception) { 0L }
                        val dateAdded = try { it.getLong(dateAddedCol) } catch (_: Exception) { 0L }
                        val mimeType = it.getString(mimeTypeCol) ?: ""
                        val path = if (dataCol >= 0) it.getString(dataCol) ?: "" else ""

                        // فلترة: تجاهل الملفات الصغيرة جداً (<10KB) أو المدة 0 و الحجم صغير
                        if (size in 1..10240) continue
                        if (duration == 0L && size < 50_000L) continue

                        // فلترة حسب الامتداد والميم
                        val lowerName = displayName.lowercase()
                        val isAudio = mimeType.startsWith("audio/") ||
                                lowerName.endsWith(".mp3") ||
                                lowerName.endsWith(".m4a") ||
                                lowerName.endsWith(".wav") ||
                                lowerName.endsWith(".flac") ||
                                lowerName.endsWith(".ogg") ||
                                lowerName.endsWith(".aac") ||
                                lowerName.endsWith(".wma") ||
                                lowerName.endsWith(".opus")

                        if (!isAudio) continue

                        val contentUri = ContentUris.withAppendedId(collection, id)

                        list.add(
                            AudioFile(
                                id = id,
                                uri = contentUri,
                                title = if (title.isBlank()) displayName else title,
                                displayName = displayName,
                                artist = artist,
                                album = album,
                                durationMs = duration,
                                sizeBytes = size,
                                dateAdded = dateAdded,
                                mimeType = mimeType,
                                path = path
                            )
                        )
                    } catch (e: Exception) {
                        Log.w("MediaLibrary", "skip row", e)
                        continue
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("MediaLibrary", "scan failed", e)
        }

        // ترتيب حسب الاسم
        return list.sortedBy { it.title.lowercase() }
    }

    fun scanMp3Only(context: Context): List<AudioFile> {
        return scanAll(context).filter {
            it.displayName.lowercase().endsWith(".mp3") || it.mimeType.contains("mp3") || it.mimeType == "audio/mpeg"
        }
    }

    fun formatDuration(ms: Long): String {
        if (ms <= 0) return "--:--"
        val totalSec = ms / 1000
        val m = totalSec / 60
        val s = totalSec % 60
        return "%d:%02d".format(m, s)
    }

    fun formatSize(bytes: Long): String {
        if (bytes <= 0) return ""
        return when {
            bytes < 1024 -> "$bytes B"
            bytes < 1024 * 1024 -> "${bytes / 1024} KB"
            else -> "%.1f MB".format(bytes / (1024f * 1024f))
        }
    }
}
