import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:glassmorphism/glassmorphism.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config/app_theme.dart';
import 'match_access_screen.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

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
                    ],
                  ).animate().fadeIn(duration: 600.ms),

                  const SizedBox(height: 40),

                  // Main action cards
                  _buildActionCard(
                    context,
                    icon: Icons.qr_code_scanner,
                    title: 'Scansiona QR Code',
                    subtitle: 'Accedi velocemente con il QR ricevuto',
                    gradient: [AppTheme.neonBlue, AppTheme.neonPurple],
                    onTap: () => _navigateToMatchAccess(context, true),
                  ).animate().slideX(
                        begin: -0.3,
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
                        begin: 0.3,
                        delay: 200.ms,
                        duration: 600.ms,
                        curve: Curves.easeOutBack,
                      ),

                  const SizedBox(height: 40),

                  // Sports section
                  Text(
                    'Sport Disponibili',
                    style: GoogleFonts.orbitron(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ).animate().fadeIn(delay: 400.ms),

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
}
