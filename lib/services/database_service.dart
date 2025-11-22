import '../models/video.dart';
import 'api_service.dart';

class DatabaseService {
  static final DatabaseService _instance = DatabaseService._internal();
  factory DatabaseService() => _instance;
  DatabaseService._internal();

  final ApiService _apiService = ApiService();

  // Connect to database - usa sempre API REST
  Future<bool> connect() async {
    print('Using REST API for all platforms');
    return await _apiService.healthCheck();
  }

  // Disconnect from database
  Future<void> disconnect() async {
    // Nothing to disconnect (API REST stateless)
    return;
  }

  // Initialize database schema
  Future<void> initializeDatabase() async {
    // Schema gestito dal backend API
    print('Schema initialization skipped (managed by backend)');
    return;
  }

  // Video operations - SEMPRE usa API REST
  Future<List<Video>> getVideosByMatchId(String matchId) async {
    return await _apiService.getVideosByMatchId(matchId);
  }

  Future<void> incrementVideoViewCount(String videoId) async {
    return await _apiService.incrementVideoViewCount(videoId);
  }

  Future<void> incrementVideoDownloadCount(String videoId) async {
    return await _apiService.incrementVideoDownloadCount(videoId);
  }
}
