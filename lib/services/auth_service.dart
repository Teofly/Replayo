import 'dart:math';
import 'api_service.dart';

class AuthService {
  static final AuthService _instance = AuthService._internal();
  factory AuthService() => _instance;
  AuthService._internal();

  final ApiService _apiService = ApiService();

  // Generate a unique session password (monouso)
  String generateSessionPassword() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    final random = Random.secure();
    return List.generate(8, (index) => chars[random.nextInt(chars.length)])
        .join();
  }

  // Verify access to match using booking code and password - SEMPRE usa API REST
  Future<MatchAccessResult> verifyMatchAccess({
    required String bookingCode,
    required String password,
    required String playerName,
  }) async {
    return await _apiService.verifyMatchAccess(
      bookingCode: bookingCode,
      password: password,
      playerName: playerName,
    );
  }

  // Verify access using QR code (contains booking code and password)
  Future<MatchAccessResult> verifyQRAccess({
    required String qrData,
    required String playerName,
  }) async {
    try {
      // QR format: "REPLAYO:booking_code:password"
      final parts = qrData.split(':');
      if (parts.length != 3 || parts[0] != 'REPLAYO') {
        return MatchAccessResult(
          success: false,
          message: 'QR Code non valido',
        );
      }

      final bookingCode = parts[1];
      final password = parts[2];

      return await verifyMatchAccess(
        bookingCode: bookingCode,
        password: password,
        playerName: playerName,
      );
    } catch (e) {
      return MatchAccessResult(
        success: false,
        message: 'Errore lettura QR Code: ${e.toString()}',
      );
    }
  }

  // Generate QR code data for a match
  String generateQRData(String bookingCode, String password) {
    return 'REPLAYO:$bookingCode:$password';
  }
}
