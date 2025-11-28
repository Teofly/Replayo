import 'dart:convert';
import 'dart:io' show Platform;
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

class UserAuthService extends ChangeNotifier {
  static final UserAuthService _instance = UserAuthService._internal();
  factory UserAuthService() => _instance;
  UserAuthService._internal();

  static const String _baseUrl = 'https://api.teofly.it/api';

  String? _accessToken;
  String? _refreshToken;
  String? _userName;
  String? _userEmail;
  String? _userPhone;
  bool _isLoggedIn = false;
  bool _isAdmin = false;

  bool get isLoggedIn => _isLoggedIn;
  String? get userName => _userName;
  String? get userEmail => _userEmail;
  String? get userPhone => _userPhone;
  String? get accessToken => _accessToken;
  bool get isAdmin => _isAdmin;

  Future<void> init() async {
    // Load from storage
    await _loadFromStorage();
  }

  Future<void> _loadFromStorage() async {
    final prefs = await SharedPreferences.getInstance();
    _accessToken = prefs.getString('accessToken');
    _refreshToken = prefs.getString('refreshToken');
    _userName = prefs.getString('userName');
    _userEmail = prefs.getString('userEmail');
    _userPhone = prefs.getString('userPhone');
    _isAdmin = prefs.getBool('isAdmin') ?? false;
    _isLoggedIn = _accessToken != null;
    notifyListeners();
  }

  Future<void> _saveToStorage() async {
    final prefs = await SharedPreferences.getInstance();
    if (_accessToken != null) await prefs.setString('accessToken', _accessToken!);
    if (_refreshToken != null) await prefs.setString('refreshToken', _refreshToken!);
    if (_userName != null) await prefs.setString('userName', _userName!);
    if (_userEmail != null) await prefs.setString('userEmail', _userEmail!);
    if (_userPhone != null) await prefs.setString('userPhone', _userPhone!);
    await prefs.setBool('isAdmin', _isAdmin);
  }

  Future<Map<String, dynamic>> register({
    required String name,
    required String surname,
    required String email,
    required String password,
    String? phone,
  }) async {
    try {
      final response = await http.post(
        Uri.parse('$_baseUrl/auth/register'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'name': name,
          'surname': surname,
          'email': email,
          'password': password,
          if (phone != null && phone.isNotEmpty) 'phone': phone,
        }),
      );

      final data = jsonDecode(response.body);
      if (data['success'] == true) {
        return {
          'success': true,
          'message': data['message'] ?? 'Registrazione completata!',
        };
      }
      return {
        'success': false,
        'error': data['error'] ?? 'Errore durante la registrazione',
      };
    } catch (e) {
      debugPrint('Register error: $e');
      return {
        'success': false,
        'error': 'Errore di connessione. Riprova.',
      };
    }
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
        _userPhone = data['user']['phone'];
        _isAdmin = data['user']['isAdmin'] == true;
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
    _userPhone = null;
    _isLoggedIn = false;
    _isAdmin = false;

    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('accessToken');
    await prefs.remove('refreshToken');
    await prefs.remove('userName');
    await prefs.remove('userEmail');
    await prefs.remove('userPhone');
    await prefs.remove('isAdmin');

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
        Uri.parse('$_baseUrl/auth/refresh'),
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

  Future<bool> loginWithGoogle() async {
    try {
      // iOS requires a client ID from Google Cloud Console
      // Create one at: https://console.cloud.google.com/apis/credentials
      // For iOS: Create OAuth 2.0 Client ID -> iOS -> use bundle ID: com.replayo.replayo

      // Check if Google Sign-In is properly configured on iOS
      if (!kIsWeb && (Platform.isIOS || Platform.isMacOS)) {
        // On iOS, if no client ID is configured, signIn will crash
        // Return false to show user-friendly error instead
        debugPrint('Google Sign-In: iOS client ID not configured');
        return false;
      }

      final GoogleSignIn googleSignIn = GoogleSignIn(
        scopes: ['email', 'profile'],
      );

      final GoogleSignInAccount? googleUser = await googleSignIn.signIn();
      if (googleUser == null) return false;

      final GoogleSignInAuthentication googleAuth = await googleUser.authentication;

      // Send token to backend for verification
      final response = await http.post(
        Uri.parse('$_baseUrl/auth/google'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'idToken': googleAuth.idToken,
          'accessToken': googleAuth.accessToken,
        }),
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
      debugPrint('Google login error: $e');
      return false;
    }
  }

  Future<Map<String, dynamic>> recoverPassword(String email) async {
    try {
      final response = await http.post(
        Uri.parse('$_baseUrl/auth/recover-password'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'email': email}),
      );

      final data = jsonDecode(response.body);
      return {
        'success': data['success'] == true,
        'message': data['message'] ?? (data['success'] == true
            ? 'Email inviata con successo'
            : 'Errore durante il recupero password'),
      };
    } catch (e) {
      debugPrint('Recover password error: $e');
      return {
        'success': false,
        'message': 'Errore di connessione. Riprova.',
      };
    }
  }

  Future<bool> loginWithApple() async {
    try {
      // Check if Apple Sign In is available
      if (!kIsWeb) {
        try {
          if (!Platform.isIOS && !Platform.isMacOS) {
            return false;
          }
        } catch (e) {
          return false;
        }
      }

      final credential = await SignInWithApple.getAppleIDCredential(
        scopes: [
          AppleIDAuthorizationScopes.email,
          AppleIDAuthorizationScopes.fullName,
        ],
      );

      // Send credential to backend for verification
      final response = await http.post(
        Uri.parse('$_baseUrl/auth/apple'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'identityToken': credential.identityToken,
          'authorizationCode': credential.authorizationCode,
          'email': credential.email,
          'givenName': credential.givenName,
          'familyName': credential.familyName,
        }),
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
      debugPrint('Apple login error: $e');
      return false;
    }
  }
}
