import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'config/app_theme.dart';
import 'screens/splash_screen.dart';
import 'screens/reset_password_screen.dart';
import 'services/notification_service.dart';

// Initialize notifications in background (non-blocking)
void _initNotifications() {
  Future.microtask(() async {
    try {
      final notificationService = NotificationService();
      await notificationService.initialize();
      debugPrint('Notifications initialized successfully');
    } catch (e) {
      debugPrint('Failed to initialize notifications: $e');
    }
  });
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('it', null);

  // Initialize notifications in background (non-blocking)
  _initNotifications();

  // Set system UI overlay style
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF0A0A0F),
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );

  runApp(const RePlayoApp());
}

class RePlayoApp extends StatefulWidget {
  const RePlayoApp({super.key});

  @override
  State<RePlayoApp> createState() => _RePlayoAppState();
}

class _RePlayoAppState extends State<RePlayoApp> {
  final _navigatorKey = GlobalKey<NavigatorState>();
  late AppLinks _appLinks;

  @override
  void initState() {
    super.initState();
    _initDeepLinks();
  }

  Future<void> _initDeepLinks() async {
    _appLinks = AppLinks();

    // Handle link when app is started from a link
    final initialLink = await _appLinks.getInitialLink();
    if (initialLink != null) {
      _handleDeepLink(initialLink);
    }

    // Handle links when app is already running
    _appLinks.uriLinkStream.listen((uri) {
      _handleDeepLink(uri);
    });
  }

  void _handleDeepLink(Uri uri) {
    debugPrint('Deep link received: $uri');

    // Handle reset-password link: replayo://reset-password?token=xxx
    if (uri.host == 'reset-password' || uri.path == '/reset-password') {
      final token = uri.queryParameters['token'];
      if (token != null && token.isNotEmpty) {
        // Wait for navigator to be ready
        WidgetsBinding.instance.addPostFrameCallback((_) {
          _navigatorKey.currentState?.push(
            MaterialPageRoute(
              builder: (context) => ResetPasswordScreen(token: token),
            ),
          );
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: _navigatorKey,
      title: 'RePlayo',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.darkTheme,
      home: const SplashScreen(),
    );
  }
}
