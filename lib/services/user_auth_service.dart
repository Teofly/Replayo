import 'dart:convert';
import 'dart:html' as html;
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class UserAuthService extends ChangeNotifier {
  static final UserAuthService _instance = UserAuthService._internal();
  factory UserAuthService() => _instance;
  UserAuthService._internal();

  static const String _baseUrl = 'https://api.teofly.it/api';

  String? _accessToken;
  String? _refreshToken;
  String? _userName;
  String? _userEmail;
  bool _isLoggedIn = false;

  bool get isLoggedIn => _isLoggedIn;
  String? get userName => _userName;
  String? get userEmail => _userEmail;
  String? get accessToken => _accessToken;

  Future<void> init() async {
    // First check URL hash for auth data (from login redirect)
    _checkUrlAuth();

    // Then load from storage
    await _loadFromStorage();
  }

  void _checkUrlAuth() {
    try {
      final hash = html.window.location.hash;
      if (hash.startsWith('#auth=')) {
        final authJson = Uri.decodeComponent(hash.substring(6));
        final authData = jsonDecode(authJson);

        if (authData['accessToken'] != null) {
          _accessToken = authData['accessToken'];
          _refreshToken = authData['refreshToken'];
          _userName = authData['userName'];
          _userEmail = authData['userEmail'];
          _isLoggedIn = true;

          // Save to storage
          _saveToStorage();

          // Clean URL
          html.window.history.replaceState(null, '', html.window.location.pathname);

          notifyListeners();
        }
      }
    } catch (e) {
      debugPrint('Error checking URL auth: $e');
    }
  }

  Future<void> _loadFromStorage() async {
    if (_isLoggedIn) return; // Already loaded from URL

    final prefs = await SharedPreferences.getInstance();
    _accessToken = prefs.getString('accessToken');
    _refreshToken = prefs.getString('refreshToken');
    _userName = prefs.getString('userName');
    _userEmail = prefs.getString('userEmail');
    _isLoggedIn = _accessToken != null;
    notifyListeners();
  }

  Future<void> _saveToStorage() async {
    final prefs = await SharedPreferences.getInstance();
    if (_accessToken != null) await prefs.setString('accessToken', _accessToken!);
    if (_refreshToken != null) await prefs.setString('refreshToken', _refreshToken!);
    if (_userName != null) await prefs.setString('userName', _userName!);
    if (_userEmail != null) await prefs.setString('userEmail', _userEmail!);
  }

  Future<bool> login(String email, String password) async {
    try {
      final response = await http.post(
        Uri.parse('$_baseUrl/auth/login'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'email': email, 'password': password}),
      );

      final data = jsonDecode(response.body);
      if (data['success'] == true) {
        _accessToken = data['accessToken'];
        _refreshToken = data['refreshToken'];
        _userName = data['user']['name'];
        _userEmail = data['user']['email'];
        _isLoggedIn = true;

        await _saveToStorage();

        notifyListeners();
        return true;
      }
      return false;
    } catch (e) {
      debugPrint('Login error: $e');
      return false;
    }
  }

  Future<void> logout() async {
    try {
      if (_accessToken != null) {
        await http.post(
          Uri.parse('$_baseUrl/auth/logout'),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $_accessToken',
          },
          body: jsonEncode({'refreshToken': _refreshToken}),
        );
      }
    } catch (e) {
      debugPrint('Logout error: $e');
    }

    _accessToken = null;
    _refreshToken = null;
    _userName = null;
    _userEmail = null;
    _isLoggedIn = false;

    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('accessToken');
    await prefs.remove('refreshToken');
    await prefs.remove('userName');
    await prefs.remove('userEmail');

    notifyListeners();
  }

  Future<List<Map<String, dynamic>>> getMyMatches() async {
    if (_accessToken == null) return [];

    try {
      final response = await http.get(
        Uri.parse('$_baseUrl/auth/my-matches'),
        headers: {'Authorization': 'Bearer $_accessToken'},
      );

      final data = jsonDecode(response.body);
      if (data['success'] == true) {
        return List<Map<String, dynamic>>.from(data['matches'] ?? []);
      }
    } catch (e) {
      debugPrint('Get my matches error: $e');
    }
    return [];
  }

  Future<bool> refreshAccessToken() async {
    if (_refreshToken == null) return false;

    try {
      final response = await http.post(
        Uri.parse('$_baseUrl/auth/refresh-token'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'refreshToken': _refreshToken}),
      );

      final data = jsonDecode(response.body);
      if (data['success'] == true) {
        _accessToken = data['accessToken'];

        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('accessToken', _accessToken!);

        notifyListeners();
        return true;
      }
    } catch (e) {
      debugPrint('Refresh token error: $e');
    }
    return false;
  }
}
