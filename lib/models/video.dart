class Video {
  final String id;
  final String matchId;
  final String title;
  final String filePath;
  final String? thumbnailPath;
  final int durationSeconds;
  final int fileSizeBytes;
  final DateTime recordedAt;
  final int viewCount;
  final int downloadCount;
  final bool isHighlight;
  final DateTime createdAt;

  Video({
    required this.id,
    required this.matchId,
    required this.title,
    required this.filePath,
    this.thumbnailPath,
    required this.durationSeconds,
    required this.fileSizeBytes,
    required this.recordedAt,
    this.viewCount = 0,
    this.downloadCount = 0,
    this.isHighlight = false,
    required this.createdAt,
  });

  factory Video.fromMap(Map<String, dynamic> map) {
    return Video(
      id: map['id'] as String,
      matchId: map['match_id'] as String,
      title: map['title'] as String,
      filePath: map['file_path'] as String,
      thumbnailPath: map['thumbnail_path'] as String?,
      durationSeconds: map['duration_seconds'] as int,
      fileSizeBytes: map['file_size_bytes'] as int,
      recordedAt: DateTime.parse(map['recorded_at'] as String),
      viewCount: map['view_count'] as int? ?? 0,
      downloadCount: map['download_count'] as int? ?? 0,
      isHighlight: map['is_highlight'] as bool? ?? false,
      createdAt: DateTime.parse(map['created_at'] as String),
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'match_id': matchId,
      'title': title,
      'file_path': filePath,
      'thumbnail_path': thumbnailPath,
      'duration_seconds': durationSeconds,
      'file_size_bytes': fileSizeBytes,
      'recorded_at': recordedAt.toIso8601String(),
      'view_count': viewCount,
      'download_count': downloadCount,
      'is_highlight': isHighlight,
      'created_at': createdAt.toIso8601String(),
    };
  }

  String get formattedDuration {
    final hours = durationSeconds ~/ 3600;
    final minutes = (durationSeconds % 3600) ~/ 60;
    final seconds = durationSeconds % 60;

    if (hours > 0) {
      return '${hours.toString().padLeft(2, '0')}:${minutes.toString().padLeft(2, '0')}:${seconds.toString().padLeft(2, '0')}';
    }
    return '${minutes.toString().padLeft(2, '0')}:${seconds.toString().padLeft(2, '0')}';
  }

  String get formattedFileSize {
    const units = ['B', 'KB', 'MB', 'GB'];
    double size = fileSizeBytes.toDouble();
    int unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return '${size.toStringAsFixed(2)} ${units[unitIndex]}';
  }

  Video copyWith({
    int? viewCount,
    int? downloadCount,
    bool? isHighlight,
  }) {
    return Video(
      id: id,
      matchId: matchId,
      title: title,
      filePath: filePath,
      thumbnailPath: thumbnailPath,
      durationSeconds: durationSeconds,
      fileSizeBytes: fileSizeBytes,
      recordedAt: recordedAt,
      viewCount: viewCount ?? this.viewCount,
      downloadCount: downloadCount ?? this.downloadCount,
      isHighlight: isHighlight ?? this.isHighlight,
      createdAt: createdAt,
    );
  }
}
