import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_animate/flutter_animate.dart';
import 'package:animated_text_kit/animated_text_kit.dart';
import 'package:google_fonts/google_fonts.dart';
import '../config/app_theme.dart';
import 'home_screen.dart';
import 'db_config_screen.dart';
import '../services/database_service.dart';
import '../services/api_service.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  final DatabaseService _dbService = DatabaseService();
  String _statusMessage = 'Inizializzazione...';
  int _tapCount = 0;
  DateTime? _lastTapTime;

  @override
  void initState() {
    super.initState();
    _initializeApp();
  }

  void _handleLogoTap() {
    final now = DateTime.now();

    // Reset counter if more than 2 seconds passed since last tap
    if (_lastTapTime != null &&
        now.difference(_lastTapTime!) > const Duration(seconds: 2)) {
      _tapCount = 0;
    }

    _tapCount++;
    _lastTapTime = now;

    // Open DB config screen after 3 taps
    if (_tapCount >= 3) {
      _tapCount = 0;
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (context) => const DbConfigScreen(),
        ),
      );
    }
  }

  Future<void> _initializeApp() async {
    try {
      // Initialize API service with custom URL if set
      setState(() => _statusMessage = 'Inizializzazione...');
      await ApiService.initialize();
      await Future.delayed(const Duration(milliseconds: 300));

      // On web platform, skip database initialization (web apps use API only)
      if (kIsWeb) {
        setState(() => _statusMessage = 'Connessione all\'API...');
        await Future.delayed(const Duration(milliseconds: 800));

        setState(() => _statusMessage = 'Caricamento completato!');
        await Future.delayed(const Duration(milliseconds: 800));
      } else {
        // Native platforms use API
        setState(() => _statusMessage = 'Connessione all\'API...');
        await Future.delayed(const Duration(milliseconds: 500));

        final connected = await _dbService.connect();
        if (!connected) {
          setState(() => _statusMessage = 'Errore connessione server');
          await Future.delayed(const Duration(seconds: 2));
          return;
        }

        setState(() => _statusMessage = 'Inizializzazione...');
        await Future.delayed(const Duration(milliseconds: 500));
        await _dbService.initializeDatabase();

        setState(() => _statusMessage = 'Caricamento completato!');
        await Future.delayed(const Duration(milliseconds: 800));
      }

      if (mounted) {
        Navigator.of(context).pushReplacement(
          PageRouteBuilder(
            pageBuilder: (context, animation, secondaryAnimation) =>
                const HomeScreen(),
            transitionsBuilder:
                (context, animation, secondaryAnimation, child) {
              return FadeTransition(opacity: animation, child: child);
            },
            transitionDuration: const Duration(milliseconds: 800),
          ),
        );
      }
    } catch (e) {
      setState(() => _statusMessage = 'Errore: ${e.toString()}');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              AppTheme.darkBg,
              AppTheme.darkCard,
              AppTheme.darkBg,
            ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: Stack(
          children: [
            // Animated background particles
            ...List.generate(20, (index) {
              return Positioned(
                left: (index * 73) % MediaQuery.of(context).size.width,
                top: (index * 97) % MediaQuery.of(context).size.height,
                child: Container(
                  width: 4,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppTheme.neonBlue.withOpacity(0.3),
                    shape: BoxShape.circle,
                    boxShadow: AppTheme.neonGlow(AppTheme.neonBlue),
                  ),
                )
                    .animate(
                      onPlay: (controller) => controller.repeat(),
                    )
                    .fadeIn(duration: 1000.ms)
                    .then()
                    .fadeOut(duration: 1000.ms),
              );
            }),

            // Main content
            Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // Logo with neon effect (tap 3 times to open DB config)
                  GestureDetector(
                    onTap: _handleLogoTap,
                    child: Container(
                      padding: const EdgeInsets.all(30),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: RadialGradient(
                          colors: [
                            AppTheme.neonBlue.withOpacity(0.3),
                            Colors.transparent,
                          ],
                        ),
                        boxShadow: AppTheme.neonGlow(AppTheme.neonBlue),
                      ),
                      child: Icon(
                        Icons.play_circle_filled,
                        size: 120,
                        color: AppTheme.neonBlue,
                      ),
                    )
                        .animate()
                        .scale(
                          duration: 800.ms,
                          curve: Curves.easeOutBack,
                        )
                        .then()
                        .shimmer(
                          duration: 2000.ms,
                          color: AppTheme.neonPurple,
                        ),
                  ),

                  const SizedBox(height: 40),

                  // App name with animated text
                  SizedBox(
                    height: 80,
                    child: AnimatedTextKit(
                      animatedTexts: [
                        TypewriterAnimatedText(
                          'RePlayo',
                          textStyle: GoogleFonts.orbitron(
                            fontSize: 56,
                            fontWeight: FontWeight.bold,
                            foreground: Paint()
                              ..shader = LinearGradient(
                                colors: [
                                  AppTheme.neonBlue,
                                  AppTheme.neonPurple,
                                  AppTheme.neonPink,
                                ],
                              ).createShader(
                                const Rect.fromLTWH(0, 0, 300, 80),
                              ),
                            shadows: AppTheme.neonGlow(AppTheme.neonBlue),
                          ),
                          speed: const Duration(milliseconds: 150),
                        ),
                      ],
                      totalRepeatCount: 1,
                    ),
                  ),

                  const SizedBox(height: 16),

                  // Tagline
                  Text(
                    'Sports Video Platform',
                    style: GoogleFonts.rajdhani(
                      fontSize: 20,
                      fontWeight: FontWeight.w300,
                      color: AppTheme.neonBlue.withOpacity(0.7),
                      letterSpacing: 4,
                    ),
                  )
                      .animate()
                      .fadeIn(delay: 800.ms, duration: 600.ms)
                      .slideY(begin: 0.3, end: 0),

                  const SizedBox(height: 80),

                  // Loading indicator
                  SizedBox(
                    width: 200,
                    child: Column(
                      children: [
                        LinearProgressIndicator(
                          backgroundColor:
                              AppTheme.neonBlue.withOpacity(0.2),
                          valueColor: AlwaysStoppedAnimation<Color>(
                            AppTheme.neonBlue,
                          ),
                        )
                            .animate(
                              onPlay: (controller) => controller.repeat(),
                            )
                            .shimmer(
                              duration: 1500.ms,
                              color: AppTheme.neonPurple,
                            ),
                        const SizedBox(height: 16),
                        Text(
                          _statusMessage,
                          style: GoogleFonts.roboto(
                            fontSize: 14,
                            color: Colors.white60,
                          ),
                          textAlign: TextAlign.center,
                        ).animate().fadeIn(duration: 300.ms),
                      ],
                    ),
                  )
                      .animate()
                      .fadeIn(delay: 1200.ms, duration: 600.ms),
                ],
              ),
            ),

            // Version info
            Positioned(
              bottom: 30,
              left: 0,
              right: 0,
              child: Text(
                'Version 1.0.0',
                textAlign: TextAlign.center,
                style: GoogleFonts.roboto(
                  fontSize: 12,
                  color: Colors.white30,
                  letterSpacing: 2,
                ),
              ).animate().fadeIn(delay: 1500.ms),
            ),
          ],
        ),
      ),
    );
  }
}
