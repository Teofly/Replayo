import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../config/app_theme.dart';
import '../services/api_service.dart';
import 'splash_screen.dart';

class DbConfigScreen extends StatefulWidget {
  const DbConfigScreen({super.key});

  @override
  State<DbConfigScreen> createState() => _DbConfigScreenState();
}

class _DbConfigScreenState extends State<DbConfigScreen> {
  final TextEditingController _urlController = TextEditingController();
  bool _isLoading = true;
  String _currentUrl = '';

  @override
  void initState() {
    super.initState();
    _loadCurrentUrl();
  }

  Future<void> _loadCurrentUrl() async {
    final prefs = await SharedPreferences.getInstance();
    final customUrl = prefs.getString('custom_api_url');

    setState(() {
      _currentUrl = customUrl ?? ApiService.defaultBaseUrl;
      _urlController.text = _currentUrl;
      _isLoading = false;
    });
  }

  Future<void> _saveUrl() async {
    final newUrl = _urlController.text.trim();

    if (newUrl.isEmpty) {
      _showMessage('Inserisci un URL valido', isError: true);
      return;
    }

    try {
      print('Saving custom API URL: $newUrl');
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('custom_api_url', newUrl);

      // Verify it was saved
      final savedUrl = prefs.getString('custom_api_url');
      print('Verified saved URL: $savedUrl');

      // Update ApiService with new URL
      ApiService.setCustomBaseUrl(newUrl);
      print('ApiService updated with new URL');

      _showMessage('URL salvato! Riavvio in corso...', isError: false);

      // Wait a moment and restart app
      await Future.delayed(const Duration(seconds: 1));

      if (mounted) {
        // Navigate back to splash screen to restart connection
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (context) => const SplashScreen()),
          (route) => false,
        );
      }
    } catch (e) {
      print('Error saving URL: $e');
      _showMessage('Errore nel salvataggio: $e', isError: true);
    }
  }

  Future<void> _resetToDefault() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('custom_api_url');

    setState(() {
      _currentUrl = ApiService.defaultBaseUrl;
      _urlController.text = _currentUrl;
    });

    // Update ApiService with default URL
    ApiService.setCustomBaseUrl(null);

    _showMessage('Ripristinato URL predefinito', isError: false);
  }

  void _showMessage(String message, {required bool isError}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError ? Colors.red : AppTheme.neonBlue,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
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
        child: SafeArea(
          child: _isLoading
              ? const Center(
                  child: CircularProgressIndicator(),
                )
              : Column(
                  children: [
                    // Header
                    Padding(
                      padding: const EdgeInsets.all(20),
                      child: Row(
                        children: [
                          IconButton(
                            icon: const Icon(Icons.close, color: Colors.white),
                            onPressed: () => Navigator.of(context).pop(),
                          ),
                          const SizedBox(width: 12),
                          Text(
                            'Configurazione Database',
                            style: GoogleFonts.orbitron(
                              fontSize: 20,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.neonBlue,
                            ),
                          ),
                        ],
                      ),
                    ),

                    Expanded(
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.all(20),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Info card
                            Container(
                              padding: const EdgeInsets.all(16),
                              decoration: BoxDecoration(
                                color: AppTheme.darkCard,
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                  color: AppTheme.neonBlue.withOpacity(0.3),
                                ),
                              ),
                              child: Row(
                                children: [
                                  Icon(
                                    Icons.info_outline,
                                    color: AppTheme.neonBlue,
                                    size: 24,
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Text(
                                      'Modifica l\'URL dell\'API REST',
                                      style: GoogleFonts.roboto(
                                        fontSize: 14,
                                        color: Colors.white70,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),

                            const SizedBox(height: 30),

                            // Current URL display
                            Text(
                              'URL Attuale',
                              style: GoogleFonts.rajdhani(
                                fontSize: 16,
                                fontWeight: FontWeight.w600,
                                color: AppTheme.neonPurple,
                                letterSpacing: 1,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Container(
                              padding: const EdgeInsets.all(16),
                              decoration: BoxDecoration(
                                color: AppTheme.darkBg,
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(
                                  color: AppTheme.neonPurple.withOpacity(0.3),
                                ),
                              ),
                              child: Row(
                                children: [
                                  Icon(
                                    Icons.cloud,
                                    color: AppTheme.neonPurple,
                                    size: 20,
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Text(
                                      _currentUrl,
                                      style: GoogleFonts.sourceCodePro(
                                        fontSize: 12,
                                        color: Colors.white,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),

                            const SizedBox(height: 30),

                            // Quick switch buttons
                            Text(
                              'Selezione Rapida',
                              style: GoogleFonts.rajdhani(
                                fontSize: 16,
                                fontWeight: FontWeight.w600,
                                color: AppTheme.neonPink,
                                letterSpacing: 1,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                Expanded(
                                  child: OutlinedButton.icon(
                                    onPressed: _setLocalUrl,
                                    icon: Icon(Icons.home, size: 18),
                                    label: Text(
                                      'Locale',
                                      style: GoogleFonts.rajdhani(
                                        fontSize: 15,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    style: OutlinedButton.styleFrom(
                                      foregroundColor: AppTheme.neonPink,
                                      side: BorderSide(
                                        color: AppTheme.neonPink.withOpacity(0.5),
                                      ),
                                      padding: const EdgeInsets.symmetric(
                                        vertical: 12,
                                      ),
                                      shape: RoundedRectangleBorder(
                                        borderRadius: BorderRadius.circular(8),
                                      ),
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: OutlinedButton.icon(
                                    onPressed: _setPublicUrl,
                                    icon: Icon(Icons.public, size: 18),
                                    label: Text(
                                      'Pubblico',
                                      style: GoogleFonts.rajdhani(
                                        fontSize: 15,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    style: OutlinedButton.styleFrom(
                                      foregroundColor: AppTheme.neonPink,
                                      side: BorderSide(
                                        color: AppTheme.neonPink.withOpacity(0.5),
                                      ),
                                      padding: const EdgeInsets.symmetric(
                                        vertical: 12,
                                      ),
                                      shape: RoundedRectangleBorder(
                                        borderRadius: BorderRadius.circular(8),
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),

                            const SizedBox(height: 30),

                            // Input field
                            Text(
                              'URL Personalizzato',
                              style: GoogleFonts.rajdhani(
                                fontSize: 16,
                                fontWeight: FontWeight.w600,
                                color: AppTheme.neonBlue,
                                letterSpacing: 1,
                              ),
                            ),
                            const SizedBox(height: 8),
                            TextField(
                              controller: _urlController,
                              style: GoogleFonts.sourceCodePro(
                                color: Colors.white,
                                fontSize: 12,
                              ),
                              decoration: InputDecoration(
                                hintText: 'es. http://192.168.1.175:3000/api',
                                hintStyle: GoogleFonts.sourceCodePro(
                                  color: Colors.white30,
                                  fontSize: 12,
                                ),
                                prefixIcon: Icon(
                                  Icons.link,
                                  color: AppTheme.neonBlue,
                                ),
                                filled: true,
                                fillColor: AppTheme.darkBg,
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(8),
                                  borderSide: BorderSide(
                                    color: AppTheme.neonBlue.withOpacity(0.3),
                                  ),
                                ),
                                enabledBorder: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(8),
                                  borderSide: BorderSide(
                                    color: AppTheme.neonBlue.withOpacity(0.3),
                                  ),
                                ),
                                focusedBorder: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(8),
                                  borderSide: BorderSide(
                                    color: AppTheme.neonBlue,
                                    width: 2,
                                  ),
                                ),
                              ),
                            ),

                            const SizedBox(height: 30),

                            // Action buttons
                            Row(
                              children: [
                                Expanded(
                                  child: ElevatedButton.icon(
                                    onPressed: _resetToDefault,
                                    icon: const Icon(Icons.refresh),
                                    label: Text(
                                      'Ripristina',
                                      style: GoogleFonts.rajdhani(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: AppTheme.darkCard,
                                      foregroundColor: Colors.white,
                                      padding: const EdgeInsets.symmetric(
                                        vertical: 16,
                                      ),
                                      shape: RoundedRectangleBorder(
                                        borderRadius: BorderRadius.circular(8),
                                        side: BorderSide(
                                          color: AppTheme.neonPurple
                                              .withOpacity(0.5),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  flex: 2,
                                  child: ElevatedButton.icon(
                                    onPressed: _saveUrl,
                                    icon: const Icon(Icons.save),
                                    label: Text(
                                      'Salva',
                                      style: GoogleFonts.rajdhani(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: AppTheme.neonBlue,
                                      foregroundColor: Colors.white,
                                      padding: const EdgeInsets.symmetric(
                                        vertical: 16,
                                      ),
                                      shape: RoundedRectangleBorder(
                                        borderRadius: BorderRadius.circular(8),
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),

                            const SizedBox(height: 30),

                            // Default URLs info
                            Container(
                              padding: const EdgeInsets.all(16),
                              decoration: BoxDecoration(
                                color: AppTheme.darkCard.withOpacity(0.5),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'URL Predefiniti',
                                    style: GoogleFonts.rajdhani(
                                      fontSize: 14,
                                      fontWeight: FontWeight.w600,
                                      color: Colors.white60,
                                      letterSpacing: 1,
                                    ),
                                  ),
                                  const SizedBox(height: 8),
                                  _buildUrlInfo(
                                    'Locale',
                                    'http://192.168.1.175:3000/api',
                                  ),
                                  const SizedBox(height: 4),
                                  _buildUrlInfo(
                                    'Pubblico',
                                    'https://api.teofly.it/api',
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }

  Widget _buildUrlInfo(String label, String url) {
    return Row(
      children: [
        Container(
          width: 70,
          child: Text(
            label,
            style: GoogleFonts.roboto(
              fontSize: 12,
              color: Colors.white38,
            ),
          ),
        ),
        Expanded(
          child: Text(
            url,
            style: GoogleFonts.sourceCodePro(
              fontSize: 11,
              color: Colors.white54,
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _setLocalUrl() async {
    setState(() {
      _urlController.text = 'http://192.168.1.175:3000/api';
    });
  }

  Future<void> _setPublicUrl() async {
    setState(() {
      _urlController.text = 'https://api.teofly.it/api';
    });
  }
}
