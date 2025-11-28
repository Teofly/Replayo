import 'dart:convert';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:glassmorphism/glassmorphism.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import '../config/app_theme.dart';
import '../services/notification_service.dart';
import '../services/user_auth_service.dart';
import 'booking_screen.dart';
import 'login_screen.dart';
import 'match_access_screen.dart';
import 'my_bookings_screen.dart';
import 'my_videos_screen.dart';
import 'notifications_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final UserAuthService _authService = UserAuthService();
  final NotificationService _notificationService = NotificationService();
  bool _isLoggedIn = false;
  String? _userName;
  int _unreadNotificationCount = 0;

  @override
  void initState() {
    super.initState();
    _initAuth();
    _authService.addListener(_onAuthChanged);
  }

  @override
  void dispose() {
    _authService.removeListener(_onAuthChanged);
    super.dispose();
  }

  Future<void> _initAuth() async {
    await _authService.init();
    _onAuthChanged();
  }

  void _onAuthChanged() {
    setState(() {
      _isLoggedIn = _authService.isLoggedIn;
      _userName = _authService.userName;
    });
    // Fetch notifications when user logs in
    if (_isLoggedIn) {
      _fetchNotifications();
    }
  }

  Future<void> _fetchNotifications() async {
    try {
      // Use fetchNotificationsAndUpdateBadge to also update the app icon badge
      final notifications = await _notificationService.fetchNotificationsAndUpdateBadge();
      setState(() {
        _unreadNotificationCount = notifications.where((n) => n['read_at'] == null).length;
      });
    } catch (e) {
      debugPrint('Error fetching notifications: $e');
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
            stops: const [0.0, 0.5, 1.0],
          ),
        ),
        child: SafeArea(
          child: SingleChildScrollView(
            child: Padding(
              padding: const EdgeInsets.all(24.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Header
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'RePlayo',
                            style: GoogleFonts.orbitron(
                              fontSize: 32,
                              fontWeight: FontWeight.bold,
                              foreground: Paint()
                                ..shader = LinearGradient(
                                  colors: [
                                    AppTheme.neonBlue,
                                    AppTheme.neonPurple,
                                  ],
                                ).createShader(
                                  const Rect.fromLTWH(0, 0, 200, 40),
                                ),
                            ),
                          ),
                          Text(
                            'Rivivi le tue partite',
                            style: GoogleFonts.rajdhani(
                              fontSize: 16,
                              color: Colors.white60,
                              letterSpacing: 1,
                            ),
                          ),
                        ],
                      ),
                      Row(
                        children: [
                          // Admin settings button (only for logged-in admins)
                          if (_isLoggedIn && _authService.isAdmin)
                            InkWell(
                              onTap: () async {
                                final Uri url = Uri.parse('https://administrator.teofly.it');
                                await launchUrl(url);
                              },
                              borderRadius: BorderRadius.circular(15),
                              child: Container(
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: AppTheme.darkCard,
                                  borderRadius: BorderRadius.circular(15),
                                  border: Border.all(
                                    color: AppTheme.neonBlue.withOpacity(0.3),
                                  ),
                                  boxShadow: AppTheme.neonGlow(AppTheme.neonBlue),
                                ),
                                child: Icon(
                                  Icons.settings,
                                  color: AppTheme.neonBlue,
                                ),
                              ),
                            ),
                          if (_isLoggedIn && _authService.isAdmin)
                            const SizedBox(width: 12),
                          // Notifications button (only for logged-in users)
                          if (_isLoggedIn)
                            _buildNotificationButton(context),
                          if (_isLoggedIn)
                            const SizedBox(width: 12),
                          // Login/User button (top right)
                          _buildUserButtonSmall(context),
                        ],
                      ),
                    ],
                  ).animate().fadeIn(duration: 600.ms),

                  const SizedBox(height: 40),

                  // Le Mie Prenotazioni - visibile solo se loggato (PRIMO)
                  if (_isLoggedIn) ...[
                    _buildActionCard(
                      context,
                      icon: Icons.event_note,
                      title: 'Le Mie Prenotazioni',
                      subtitle: 'Visualizza le tue Prenotazioni, Video e Statistiche',
                      gradient: [AppTheme.neonPurple, AppTheme.neonGreen],
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (context) => const MyBookingsScreen()),
                      ),
                    ).animate().slideX(
                          begin: -0.3,
                          duration: 600.ms,
                          curve: Curves.easeOutBack,
                        ),
                    const SizedBox(height: 20),
                  ],

                  // Main action cards
                  _buildActionCard(
                    context,
                    icon: Icons.qr_code_scanner,
                    title: 'Scansiona QR Code',
                    subtitle: 'Accedi velocemente con il QR ricevuto',
                    gradient: [AppTheme.neonBlue, AppTheme.neonPurple],
                    onTap: () => _navigateToMatchAccess(context, true),
                  ).animate().slideX(
                        begin: _isLoggedIn ? 0.3 : -0.3,
                        delay: _isLoggedIn ? 100.ms : 0.ms,
                        duration: 600.ms,
                        curve: Curves.easeOutBack,
                      ),

                  const SizedBox(height: 20),

                  _buildActionCard(
                    context,
                    icon: Icons.keyboard,
                    title: 'Inserisci Codice',
                    subtitle: 'Accedi con codice prenotazione e password',
                    gradient: [AppTheme.neonPurple, AppTheme.neonPink],
                    onTap: () => _navigateToMatchAccess(context, false),
                  ).animate().slideX(
                        begin: -0.3,
                        delay: _isLoggedIn ? 200.ms : 200.ms,
                        duration: 600.ms,
                        curve: Curves.easeOutBack,
                      ),

                  const SizedBox(height: 20),

                  _buildActionCard(
                    context,
                    icon: Icons.calendar_month,
                    title: 'Prenota un Campo',
                    subtitle: 'Scegli data, orario e campo disponibile',
                    gradient: [AppTheme.neonGreen, AppTheme.neonBlue],
                    onTap: () => _openBookingPage(context),
                  ).animate().slideX(
                        begin: _isLoggedIn ? 0.3 : -0.3,
                        delay: _isLoggedIn ? 350.ms : 300.ms,
                        duration: 600.ms,
                        curve: Curves.easeOutBack,
                      ),

                  const SizedBox(height: 40),

                  // Info Club section (prima di Sport Disponibili)
                  Text(
                    'Info Club',
                    style: GoogleFonts.orbitron(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ).animate().fadeIn(delay: 400.ms),

                  const SizedBox(height: 20),

                  _buildClubCard(
                    context,
                    name: 'Sporty',
                    description: 'Centro sportivo con campi da padel, tennis e calcetto',
                    color: AppTheme.neonGreen,
                    onTap: () => _showClubGallery(context, 'Sporty'),
                  ).animate().slideX(begin: 0.3, delay: 450.ms),

                  const SizedBox(height: 50),

                  // Sports section
                  Text(
                    'Sport Disponibili',
                    style: GoogleFonts.orbitron(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ).animate().fadeIn(delay: 500.ms),

                  const SizedBox(height: 20),

                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      _buildSportCard(
                        context,
                        icon: Icons.sports_tennis,
                        sport: 'Padel',
                        color: AppTheme.neonBlue,
                      ),
                      _buildSportCard(
                        context,
                        icon: Icons.sports_baseball,
                        sport: 'Tennis',
                        color: AppTheme.neonPurple,
                      ),
                      _buildSportCard(
                        context,
                        icon: Icons.sports_soccer,
                        sport: 'Calcetto',
                        color: AppTheme.neonPink,
                      ),
                    ],
                  ).animate().fadeIn(delay: 600.ms),

                  const SizedBox(height: 40),

                  // Features section
                  Text(
                    'Funzionalità',
                    style: GoogleFonts.orbitron(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ).animate().fadeIn(delay: 800.ms),

                  const SizedBox(height: 20),

                  _buildFeatureCard(
                    icon: Icons.video_library,
                    title: 'Video Partite',
                    description: 'Rivedi i momenti salienti delle tue partite',
                    color: AppTheme.neonBlue,
                  ).animate().slideY(begin: 0.3, delay: 900.ms),

                  const SizedBox(height: 16),

                  _buildFeatureCard(
                    icon: Icons.download,
                    title: 'Download Illimitati',
                    description: 'Scarica i tuoi video e condividili',
                    color: AppTheme.neonPurple,
                  ).animate().slideY(begin: 0.3, delay: 1000.ms),

                  const SizedBox(height: 16),

                  _buildFeatureCard(
                    icon: Icons.analytics,
                    title: 'Statistiche',
                    description: 'Analizza le tue performance nel tempo',
                    color: AppTheme.neonPink,
                  ).animate().slideY(begin: 0.3, delay: 1100.ms),

                  const SizedBox(height: 40),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildActionCard(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String subtitle,
    required List<Color> gradient,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: GlassmorphicContainer(
        width: double.infinity,
        height: 140,
        borderRadius: 20,
        blur: 20,
        alignment: Alignment.center,
        border: 2,
        linearGradient: LinearGradient(
          colors: [
            Colors.white.withOpacity(0.1),
            Colors.white.withOpacity(0.05),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderGradient: LinearGradient(
          colors: gradient.map((c) => c.withOpacity(0.5)).toList(),
        ),
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  gradient: LinearGradient(colors: gradient),
                  borderRadius: BorderRadius.circular(15),
                  boxShadow: AppTheme.neonGlow(gradient.first),
                ),
                child: Icon(
                  icon,
                  size: 40,
                  color: Colors.white,
                ),
              ),
              const SizedBox(width: 20),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: GoogleFonts.rajdhani(
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      style: GoogleFonts.roboto(
                        fontSize: 14,
                        color: Colors.white70,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(
                Icons.arrow_forward_ios,
                color: gradient.first,
                size: 24,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSportCard(
    BuildContext context, {
    required IconData icon,
    required String sport,
    required Color color,
  }) {
    return Container(
      width: 100,
      height: 100,
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withOpacity(0.3)),
        boxShadow: [
          BoxShadow(
            color: color.withOpacity(0.3),
            blurRadius: 15,
            spreadRadius: 1,
          ),
        ],
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 40, color: color),
          const SizedBox(height: 8),
          Text(
            sport,
            style: GoogleFonts.rajdhani(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: Colors.white,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFeatureCard({
    required IconData icon,
    required String title,
    required String description,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: color.withOpacity(0.2),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: color, size: 28),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: GoogleFonts.rajdhani(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
                Text(
                  description,
                  style: GoogleFonts.roboto(
                    fontSize: 14,
                    color: Colors.white60,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildUserButtonSmall(BuildContext context) {
    if (_isLoggedIn && _userName != null) {
      final initials = _userName!.split(' ').map((n) => n.isNotEmpty ? n[0] : '').join('').toUpperCase();

      return PopupMenuButton<String>(
        onSelected: (value) {
          if (value == 'bookings') {
            Navigator.push(
              context,
              MaterialPageRoute(builder: (context) => const MyBookingsScreen()),
            );
          } else if (value == 'videos') {
            Navigator.push(
              context,
              MaterialPageRoute(builder: (context) => const MyVideosScreen()),
            );
          } else if (value == 'logout') {
            _authService.logout();
          }
        },
        offset: const Offset(0, 45),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        color: AppTheme.darkCard,
        child: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: AppTheme.darkCard,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppTheme.neonPurple.withOpacity(0.5)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 24,
                height: 24,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [AppTheme.neonBlue, AppTheme.neonPurple],
                  ),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Center(
                  child: Text(
                    initials.length > 2 ? initials.substring(0, 2) : initials,
                    style: GoogleFonts.rajdhani(
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 6),
              Icon(Icons.arrow_drop_down, color: AppTheme.neonPurple, size: 18),
            ],
          ),
        ),
        itemBuilder: (context) => [
          PopupMenuItem<String>(
            value: 'logout',
            child: Row(
              children: [
                const Icon(Icons.logout, color: Colors.redAccent, size: 18),
                const SizedBox(width: 10),
                Text('Esci', style: GoogleFonts.rajdhani(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.redAccent)),
              ],
            ),
          ),
        ],
      );
    } else {
      return InkWell(
        onTap: () => _openLoginPage(context),
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [AppTheme.neonBlue, AppTheme.neonPurple],
            ),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.person, color: Colors.white, size: 18),
              const SizedBox(width: 6),
              Text(
                'Accedi',
                style: GoogleFonts.rajdhani(
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
            ],
          ),
        ),
      );
    }
  }

  Widget _buildUserButton(BuildContext context) {
    if (_isLoggedIn && _userName != null) {
      // User is logged in - show user menu
      final initials = _userName!.split(' ').map((n) => n.isNotEmpty ? n[0] : '').join('').toUpperCase();
      final displayName = _userName!.split(' ').first;

      return Center(
        child: PopupMenuButton<String>(
          onSelected: (value) {
            if (value == 'videos') {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (context) => const MyVideosScreen()),
              );
            } else if (value == 'logout') {
              _authService.logout();
            }
          },
          offset: const Offset(0, 50),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          color: AppTheme.darkCard,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
            decoration: BoxDecoration(
              color: AppTheme.darkCard,
              borderRadius: BorderRadius.circular(25),
              border: Border.all(color: AppTheme.neonBlue.withOpacity(0.5)),
              boxShadow: [
                BoxShadow(
                  color: AppTheme.neonBlue.withOpacity(0.2),
                  blurRadius: 15,
                  spreadRadius: 1,
                ),
              ],
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [AppTheme.neonBlue, AppTheme.neonPurple],
                    ),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Center(
                    child: Text(
                      initials.length > 2 ? initials.substring(0, 2) : initials,
                      style: GoogleFonts.rajdhani(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  displayName,
                  style: GoogleFonts.rajdhani(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(width: 8),
                Icon(Icons.arrow_drop_down, color: AppTheme.neonBlue, size: 24),
              ],
            ),
          ),
          itemBuilder: (context) => [
            PopupMenuItem<String>(
              value: 'videos',
              child: Row(
                children: [
                  Icon(Icons.video_library, color: AppTheme.neonBlue, size: 20),
                  const SizedBox(width: 12),
                  Text(
                    'I Miei Video',
                    style: GoogleFonts.rajdhani(
                      fontSize: 16,
                      color: Colors.white,
                    ),
                  ),
                ],
              ),
            ),
            const PopupMenuDivider(),
            PopupMenuItem<String>(
              value: 'logout',
              child: Row(
                children: [
                  const Icon(Icons.logout, color: Colors.redAccent, size: 20),
                  const SizedBox(width: 12),
                  Text(
                    'Esci',
                    style: GoogleFonts.rajdhani(
                      fontSize: 16,
                      color: Colors.redAccent,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    } else {
      // User is not logged in - show login button
      return Center(
        child: GestureDetector(
          onTap: () => _openLoginPage(context),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 14),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [AppTheme.neonBlue, AppTheme.neonPurple],
              ),
              borderRadius: BorderRadius.circular(25),
              boxShadow: [
                BoxShadow(
                  color: AppTheme.neonBlue.withOpacity(0.4),
                  blurRadius: 15,
                  spreadRadius: 2,
                ),
              ],
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.person, color: Colors.white, size: 22),
                const SizedBox(width: 10),
                Text(
                  'Accedi',
                  style: GoogleFonts.rajdhani(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }
  }

  Future<void> _openLoginPage(BuildContext context) async {
    await Navigator.of(context).push(
      PageRouteBuilder(
        pageBuilder: (context, animation, secondaryAnimation) =>
            const LoginScreen(),
        transitionsBuilder: (context, animation, secondaryAnimation, child) {
          return SlideTransition(
            position: Tween<Offset>(
              begin: const Offset(0.0, 1.0),
              end: Offset.zero,
            ).animate(CurvedAnimation(
              parent: animation,
              curve: Curves.easeOutCubic,
            )),
            child: child,
          );
        },
        transitionDuration: const Duration(milliseconds: 400),
      ),
    );
  }

  Future<void> _openAdminDashboard(BuildContext context) async {
    final Uri url = Uri.parse('https://administrator.teofly.it');
    try {
      await launchUrl(url, mode: LaunchMode.platformDefault);
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Impossibile aprire Admin Dashboard')),
        );
      }
    }
  }

  Widget _buildNotificationButton(BuildContext context) {
    return GestureDetector(
      onTap: () => _showNotificationsSheet(context),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppTheme.darkCard,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
            ),
            child: Icon(Icons.notifications_outlined, color: AppTheme.neonBlue, size: 24),
          ),
          if (_unreadNotificationCount > 0)
            Positioned(
              right: -6,
              top: -6,
              child: Container(
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(
                  color: Colors.red,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppTheme.darkBg, width: 2),
                ),
                constraints: const BoxConstraints(minWidth: 18, minHeight: 18),
                child: Text(
                  '$_unreadNotificationCount',
                  style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
                  textAlign: TextAlign.center,
                ),
              ),
            ),
        ],
      ),
    );
  }

  void _showNotificationsSheet(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => NotificationsScreen(
          onNotificationRead: () {
            _fetchNotifications();
          },
        ),
      ),
    );
  }

  Future<void> _openBookingPage(BuildContext context) async {
    await Navigator.of(context).push(
      PageRouteBuilder(
        pageBuilder: (context, animation, secondaryAnimation) =>
            const BookingScreen(),
        transitionsBuilder: (context, animation, secondaryAnimation, child) {
          return SlideTransition(
            position: Tween<Offset>(
              begin: const Offset(1.0, 0.0),
              end: Offset.zero,
            ).animate(CurvedAnimation(
              parent: animation,
              curve: Curves.easeOutCubic,
            )),
            child: child,
          );
        },
        transitionDuration: const Duration(milliseconds: 400),
      ),
    );
  }

  void _navigateToMatchAccess(BuildContext context, bool useQR) {
    Navigator.of(context).push(
      PageRouteBuilder(
        pageBuilder: (context, animation, secondaryAnimation) =>
            MatchAccessScreen(useQRScanner: useQR),
        transitionsBuilder: (context, animation, secondaryAnimation, child) {
          return SlideTransition(
            position: Tween<Offset>(
              begin: const Offset(1.0, 0.0),
              end: Offset.zero,
            ).animate(CurvedAnimation(
              parent: animation,
              curve: Curves.easeOutCubic,
            )),
            child: child,
          );
        },
        transitionDuration: const Duration(milliseconds: 400),
      ),
    );
  }

  Widget _buildClubCard(
    BuildContext context, {
    required String name,
    required String description,
    required Color color,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: AppTheme.darkCard,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: color.withOpacity(0.5), width: 2),
          boxShadow: [
            BoxShadow(
              color: color.withOpacity(0.3),
              blurRadius: 20,
              spreadRadius: 2,
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [color, color.withOpacity(0.7)],
                ),
                borderRadius: BorderRadius.circular(15),
              ),
              child: const Icon(
                Icons.sports_tennis,
                size: 40,
                color: Colors.white,
              ),
            ),
            const SizedBox(width: 20),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    style: GoogleFonts.orbitron(
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    description,
                    style: GoogleFonts.roboto(
                      fontSize: 14,
                      color: Colors.white70,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Tocca per vedere le foto →',
                    style: GoogleFonts.rajdhani(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: color,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showClubGallery(BuildContext context, String clubName) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => ClubGalleryScreen(
          clubName: clubName,
        ),
      ),
    );
  }
}

class ClubGalleryScreen extends StatefulWidget {
  final String clubName;

  const ClubGalleryScreen({
    super.key,
    required this.clubName,
  });

  @override
  State<ClubGalleryScreen> createState() => _ClubGalleryScreenState();
}

class _ClubGalleryScreenState extends State<ClubGalleryScreen> {
  List<String> _photos = [];
  bool _isLoading = true;
  bool _useNetworkImages = true;

  // Club info
  Map<String, dynamic>? _clubInfo;

  @override
  void initState() {
    super.initState();
    _loadClubInfo();
    _loadImages();
  }

  Future<void> _loadClubInfo() async {
    try {
      final response = await http.get(
        Uri.parse('https://api.teofly.it/api/club/info'),
      ).timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['success'] == true && data['info'] != null) {
          setState(() {
            _clubInfo = data['info'];
          });
          return;
        }
      }
    } catch (e) {
      debugPrint('Error loading club info: $e');
    }

    // Fallback default info
    setState(() {
      _clubInfo = {
        'name': 'Sporty',
        'address': 'Via Roma 123, Milano',
        'phone': '+39 02 1234567',
        'email': 'info@sportyclub.it',
        'website': 'https://www.sportyclub.it',
      };
    });
  }

  Future<void> _loadImages() async {
    try {
      final response = await http.get(
        Uri.parse('https://api.teofly.it/api/club/images'),
      ).timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['success'] == true && data['images'] != null) {
          final images = data['images'] as List;
          setState(() {
            _photos = images
                .map((img) => 'https://api.teofly.it/api/club/images/${img['filename']}')
                .toList()
                .cast<String>();
            _isLoading = false;
            _useNetworkImages = true;
          });
          return;
        }
      }
    } catch (e) {
      debugPrint('Error loading club images from server: $e');
    }

    // Fallback to local assets
    setState(() {
      _photos = List.generate(
        10,
        (index) => 'assets/images/sporty/Foto${index + 1}.jpeg',
      );
      _isLoading = false;
      _useNetworkImages = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBg,
      appBar: AppBar(
        backgroundColor: AppTheme.darkCard,
        title: Text(
          widget.clubName,
          style: GoogleFonts.orbitron(
            fontSize: 20,
            fontWeight: FontWeight.bold,
            color: Colors.white,
          ),
        ),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios, color: Colors.white),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: _isLoading
          ? const Center(
              child: CircularProgressIndicator(color: AppTheme.neonGreen),
            )
          : CustomScrollView(
              slivers: [
                // Club Info Section
                SliverToBoxAdapter(
                  child: _buildClubInfoSection(),
                ),
                // Gallery Section
                if (_photos.isEmpty)
                  SliverFillRemaining(
                    child: Center(
                      child: Text(
                        'Nessuna immagine disponibile',
                        style: GoogleFonts.rajdhani(
                          color: Colors.white70,
                          fontSize: 16,
                        ),
                      ),
                    ),
                  )
                else
                  SliverPadding(
                    padding: const EdgeInsets.all(16.0),
                    sliver: SliverGrid(
                      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 2,
                        crossAxisSpacing: 12,
                        mainAxisSpacing: 12,
                        childAspectRatio: 1,
                      ),
                      delegate: SliverChildBuilderDelegate(
                        (context, index) {
                          return GestureDetector(
                            onTap: () => _showFullScreenImage(context, _photos, index),
                            child: Hero(
                              tag: 'photo_$index',
                              child: Container(
                                decoration: BoxDecoration(
                                  borderRadius: BorderRadius.circular(15),
                                  boxShadow: [
                                    BoxShadow(
                                      color: AppTheme.neonGreen.withOpacity(0.2),
                                      blurRadius: 10,
                                      spreadRadius: 1,
                                    ),
                                  ],
                                ),
                                child: ClipRRect(
                                  borderRadius: BorderRadius.circular(15),
                                  child: _useNetworkImages
                                      ? Image.network(
                                          _photos[index],
                                          fit: BoxFit.cover,
                                          loadingBuilder: (context, child, loadingProgress) {
                                            if (loadingProgress == null) return child;
                                            return Container(
                                              color: AppTheme.darkCard,
                                              child: const Center(
                                                child: CircularProgressIndicator(
                                                  color: AppTheme.neonGreen,
                                                  strokeWidth: 2,
                                                ),
                                              ),
                                            );
                                          },
                                          errorBuilder: (context, error, stackTrace) {
                                        return Container(
                                          color: AppTheme.darkCard,
                                          child: const Icon(
                                            Icons.broken_image,
                                            color: Colors.white54,
                                            size: 40,
                                          ),
                                        );
                                      },
                                    )
                                  : Image.asset(
                                      _photos[index],
                                      fit: BoxFit.cover,
                                    ),
                            ),
                          ),
                        ),
                      );
                        },
                        childCount: _photos.length,
                      ),
                    ),
                  ),
              ],
            ),
    );
  }

  Widget _buildClubInfoSection() {
    if (_clubInfo == null) {
      return const SizedBox.shrink();
    }

    return Container(
      margin: const EdgeInsets.all(16.0),
      padding: const EdgeInsets.all(20.0),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppTheme.darkCard,
            AppTheme.darkCard.withOpacity(0.8),
          ],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: AppTheme.neonGreen.withOpacity(0.3),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: AppTheme.neonGreen.withOpacity(0.1),
            blurRadius: 20,
            spreadRadius: 2,
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Club Name
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppTheme.neonGreen.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.sports_tennis,
                  color: AppTheme.neonGreen,
                  size: 24,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  _clubInfo!['name'] ?? 'Club',
                  style: GoogleFonts.orbitron(
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),

          // Address
          if (_clubInfo!['address'] != null && _clubInfo!['address'].toString().isNotEmpty)
            _buildInfoRow(
              icon: Icons.location_on,
              text: _clubInfo!['address'] ?? '',
              onTap: () => _openInGoogleMaps(_clubInfo!['address']),
              isClickable: true,
            ),

          // Phone
          if (_clubInfo!['phone'] != null && _clubInfo!['phone'].toString().isNotEmpty)
            _buildInfoRow(
              icon: Icons.phone,
              text: _clubInfo!['phone'],
              onTap: () => _launchUrl('tel:${_clubInfo!['phone']}'),
              isClickable: true,
            ),

          // Email
          if (_clubInfo!['email'] != null && _clubInfo!['email'].toString().isNotEmpty)
            _buildInfoRow(
              icon: Icons.email,
              text: _clubInfo!['email'],
              onTap: () => _launchUrl('mailto:${_clubInfo!['email']}'),
              isClickable: true,
            ),

          // Website
          if (_clubInfo!['website'] != null && _clubInfo!['website'].toString().isNotEmpty)
            _buildInfoRow(
              icon: Icons.language,
              text: _clubInfo!['website'].toString().replaceAll('https://', '').replaceAll('http://', ''),
              onTap: () => _launchUrl(_clubInfo!['website']),
              isClickable: true,
            ),

          // Hours
          if (_clubInfo!['hours'] != null && _clubInfo!['hours'].toString().isNotEmpty)
            _buildInfoRow(
              icon: Icons.access_time,
              text: _clubInfo!['hours'],
              isClickable: false,
            ),
        ],
      ),
    );
  }

  Widget _buildInfoRow({
    required IconData icon,
    required String text,
    VoidCallback? onTap,
    bool isClickable = false,
  }) {
    final content = Padding(
      padding: const EdgeInsets.symmetric(vertical: 8.0),
      child: Row(
        children: [
          Icon(
            icon,
            color: isClickable ? AppTheme.neonGreen : Colors.white54,
            size: 20,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              text,
              style: GoogleFonts.rajdhani(
                fontSize: 16,
                color: isClickable ? AppTheme.neonGreen : Colors.white70,
                decoration: isClickable ? TextDecoration.underline : null,
                decorationColor: AppTheme.neonGreen,
              ),
            ),
          ),
          if (isClickable)
            Icon(
              Icons.arrow_forward_ios,
              color: AppTheme.neonGreen.withOpacity(0.5),
              size: 14,
            ),
        ],
      ),
    );

    if (onTap != null) {
      return InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: content,
      );
    }
    return content;
  }

  Future<void> _launchUrl(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _openInGoogleMaps(String address) async {
    final encodedAddress = Uri.encodeComponent(address);
    final googleMapsUrl = 'https://www.google.com/maps/search/?api=1&query=$encodedAddress';
    final uri = Uri.parse(googleMapsUrl);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  void _showFullScreenImage(BuildContext context, List<String> photos, int initialIndex) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => FullScreenGallery(
          photos: photos,
          initialIndex: initialIndex,
          useNetworkImages: _useNetworkImages,
        ),
      ),
    );
  }
}

class FullScreenGallery extends StatefulWidget {
  final List<String> photos;
  final int initialIndex;
  final bool useNetworkImages;

  const FullScreenGallery({
    super.key,
    required this.photos,
    required this.initialIndex,
    this.useNetworkImages = false,
  });

  @override
  State<FullScreenGallery> createState() => _FullScreenGalleryState();
}

class _FullScreenGalleryState extends State<FullScreenGallery> {
  late PageController _pageController;
  late int _currentIndex;

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialIndex;
    _pageController = PageController(initialPage: widget.initialIndex);
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        leading: IconButton(
          icon: const Icon(Icons.close, color: Colors.white),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          '${_currentIndex + 1} / ${widget.photos.length}',
          style: GoogleFonts.rajdhani(
            color: Colors.white,
            fontSize: 18,
          ),
        ),
        centerTitle: true,
      ),
      body: PageView.builder(
        controller: _pageController,
        itemCount: widget.photos.length,
        onPageChanged: (index) {
          setState(() {
            _currentIndex = index;
          });
        },
        itemBuilder: (context, index) {
          return InteractiveViewer(
            minScale: 0.5,
            maxScale: 4.0,
            child: Center(
              child: Hero(
                tag: 'photo_$index',
                child: widget.useNetworkImages
                    ? Image.network(
                        widget.photos[index],
                        fit: BoxFit.contain,
                        loadingBuilder: (context, child, loadingProgress) {
                          if (loadingProgress == null) return child;
                          return const Center(
                            child: CircularProgressIndicator(
                              color: AppTheme.neonGreen,
                            ),
                          );
                        },
                        errorBuilder: (context, error, stackTrace) {
                          return const Icon(
                            Icons.broken_image,
                            color: Colors.white54,
                            size: 60,
                          );
                        },
                      )
                    : Image.asset(
                        widget.photos[index],
                        fit: BoxFit.contain,
                      ),
              ),
            ),
          );
        },
      ),
    );
  }
}
