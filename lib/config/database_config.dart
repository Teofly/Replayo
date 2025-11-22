import 'package:shared_preferences/shared_preferences.dart';

class DatabaseConfig {
  // Dual IP configuration
  static const String localHost = '192.168.1.175';
  static const String publicHost = '2.47.34.88';
  static const int port = 5432;
  static const String databaseName = 'replayo_db';
  static const String username = 'replayo_user';
  static const String password = 'replayo_secure_pass_2024';

  // NAS Synology video storage path
  static String videoStoragePath = '/volume1/RePlayo/videos';

  // Connection timeout
  static const Duration connectionTimeout = Duration(seconds: 10);

  // Singleton instance
  static final DatabaseConfig _instance = DatabaseConfig._internal();
  factory DatabaseConfig() => _instance;
  DatabaseConfig._internal();

  bool _isLocalNetwork = true;

  bool get isLocalNetwork => _isLocalNetwork;

  String get currentHost {
    // First check if there's a custom host
    return _customHost ?? (_isLocalNetwork ? localHost : publicHost);
  }

  String? _customHost;

  // Get custom host if set
  String? get customHost => _customHost;

  // Check network and set appropriate host
  Future<void> detectNetwork() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      _isLocalNetwork = prefs.getBool('use_local_network') ?? true;
      _customHost = prefs.getString('custom_db_host');
    } catch (e) {
      _isLocalNetwork = true;
      _customHost = null;
    }
  }

  // Manually switch network
  Future<void> switchNetwork(bool useLocal) async {
    _isLocalNetwork = useLocal;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('use_local_network', useLocal);
  }

  // Set custom host
  Future<void> setCustomHost(String? host) async {
    _customHost = host;
    final prefs = await SharedPreferences.getInstance();
    if (host == null || host.isEmpty) {
      await prefs.remove('custom_db_host');
    } else {
      await prefs.setString('custom_db_host', host);
    }
  }

  // Get connection parameters
  Map<String, dynamic> getConnectionParams() {
    return {
      'host': currentHost,
      'port': port,
      'database': databaseName,
      'username': username,
      'password': password,
      'timeout': connectionTimeout.inSeconds,
    };
  }

  // Set custom video storage path
  Future<void> setVideoStoragePath(String path) async {
    videoStoragePath = path;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('video_storage_path', path);
  }

  // Get video storage path
  Future<String> getVideoStoragePath() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('video_storage_path') ?? videoStoragePath;
  }
}
