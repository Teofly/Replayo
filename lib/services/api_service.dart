import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import '../models/match.dart';
import '../models/video.dart';
import '../models/user.dart';

// Forward declaration per evitare import circolare
class MatchAccessResult {
  final bool success;
  final String message;
  final Match? match;

  MatchAccessResult({
    required this.success,
    required this.message,
    this.match,
  });
}

class ApiService {
  // Use public domain through Cloudflare Tunnel
  // Note: Cloudflare tunnel maps api.teofly.it -> localhost:3000
  // Backend routes are under /api/*, so we include /api in baseUrl
  static const String defaultBaseUrl = 'https://api.teofly.it/api';
  static const String webLocalBaseUrl = 'http://192.168.1.175:3000/api';

  static String? _customBaseUrl;

  static String get baseUrl {
    // If custom URL is set, use it
    if (_customBaseUrl != null && _customBaseUrl!.isNotEmpty) {
      return _customBaseUrl!;
    }

    // On web, check if we're running locally
    if (kIsWeb) {
      // If accessing from localhost or 192.168.x.x, use local API
      final currentUrl = Uri.base.toString();
      print('Current web URL: $currentUrl');

      if (currentUrl.contains('localhost') ||
          currentUrl.contains('127.0.0.1') ||
          currentUrl.contains('192.168.')) {
        print('Detected local web access, using local API');
        return webLocalBaseUrl;
      }
    }

    // Default to public URL
    return defaultBaseUrl;
  }

  static void setCustomBaseUrl(String? url) {
    _customBaseUrl = url;
  }

  // Initialize API service with saved custom URL
  static Future<void> initialize() async {
    final prefs = await SharedPreferences.getInstance();
    _customBaseUrl = prefs.getString('custom_api_url');
    print('ApiService initialized with URL: $baseUrl');
  }

  // Health check
  Future<bool> healthCheck() async {
    try {
      print('Attempting health check at: $baseUrl/health');
      final response = await http.get(
        Uri.parse('$baseUrl/health'),
        headers: {'Accept': 'application/json'},
      ).timeout(const Duration(seconds: 5));

      print('Health check response: ${response.statusCode}');
      print('Response body: ${response.body}');

      return response.statusCode == 200;
    } catch (e) {
      print('Health check error: $e');
      return false;
    }
  }

  // Verify match access
  Future<MatchAccessResult> verifyMatchAccess({
    required String bookingCode,
    required String password,
    required String playerName,
  }) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/matches/verify'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'bookingCode': bookingCode,
          'password': password,
          'playerName': playerName,
        }),
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success'] == true) {
        return MatchAccessResult(
          success: true,
          message: data['message'],
          match: Match.fromMap(data['match']),
        );
      } else {
        return MatchAccessResult(
          success: false,
          message: data['message'] ?? 'Errore sconosciuto',
        );
      }
    } catch (e) {
      return MatchAccessResult(
        success: false,
        message: 'Errore di connessione: ${e.toString()}',
      );
    }
  }

  // Get videos by match ID
  Future<List<Video>> getVideosByMatchId(String matchId) async {
    try {
      final response = await http.get(
        Uri.parse('$baseUrl/videos/match/$matchId'),
      );

      if (response.statusCode == 200) {
        final List<dynamic> data = jsonDecode(response.body);
        return data.map((json) => Video.fromMap(json)).toList();
      }
      return [];
    } catch (e) {
      print('Error getting videos: $e');
      return [];
    }
  }

  // Get user by ID
  Future<User?> getUserById(String userId) async {
    try {
      final response = await http.get(
        Uri.parse('$baseUrl/users/$userId'),
      );

      if (response.statusCode == 200) {
        return User.fromMap(jsonDecode(response.body));
      }
      return null;
    } catch (e) {
      print('Error getting user: $e');
      return null;
    }
  }

  // Increment video view count
  Future<void> incrementVideoViewCount(String videoId) async {
    try {
      await http.post(Uri.parse('$baseUrl/videos/$videoId/view'));
    } catch (e) {
      print('Error incrementing view count: $e');
    }
  }

  // Increment video download count
  Future<void> incrementVideoDownloadCount(String videoId) async {
    try {
      await http.post(Uri.parse('$baseUrl/videos/$videoId/download'));
    } catch (e) {
      print('Error incrementing download count: $e');
    }
  }
}
