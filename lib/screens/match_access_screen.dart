import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_animate/flutter_animate.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config/app_theme.dart';
import '../services/auth_service.dart';
import 'match_videos_screen.dart';

class MatchAccessScreen extends StatefulWidget {
  final bool useQRScanner;

  const MatchAccessScreen({super.key, required this.useQRScanner});

  @override
  State<MatchAccessScreen> createState() => _MatchAccessScreenState();
}

class _MatchAccessScreenState extends State<MatchAccessScreen> {
  final _formKey = GlobalKey<FormState>();
  final _bookingCodeController = TextEditingController();
  final _passwordController = TextEditingController();
  final _playerNameController = TextEditingController();
  final AuthService _authService = AuthService();

  bool _isLoading = false;
  bool _obscurePassword = true;

  @override
  void initState() {
    super.initState();
    // Su web mostra sempre il form manuale
    if (kIsWeb && widget.useQRScanner) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _showWebQRNotSupported();
      });
    }
  }

  @override
  void dispose() {
    _bookingCodeController.dispose();
    _passwordController.dispose();
    _playerNameController.dispose();
    super.dispose();
  }

  void _showWebQRNotSupported() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.darkCard,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(color: AppTheme.neonBlue.withAlpha(76)),
        ),
        title: Text(
          'QR Scanner non disponibile',
          style: GoogleFonts.orbitron(color: AppTheme.neonBlue),
        ),
        content: Text(
          'Il QR scanner non è supportato su web. Usa l\'inserimento manuale del codice.',
          style: GoogleFonts.roboto(color: Colors.white70),
        ),
        actions: [
          ElevatedButton(
            onPressed: () => Navigator.pop(context),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.neonBlue,
              foregroundColor: AppTheme.darkBg,
            ),
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }

  Future<void> _handleManualAccess() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);

    final result = await _authService.verifyMatchAccess(
      bookingCode: _bookingCodeController.text.trim(),
      password: _passwordController.text.trim(),
      playerName: _playerNameController.text.trim(),
    );

    setState(() => _isLoading = false);

    if (!mounted) return;

    if (result.success && result.match != null) {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (context) => MatchVideosScreen(match: result.match!),
        ),
      );
    } else {
      _showErrorDialog(result.message);
    }
  }

  void _showErrorDialog(String message) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.darkCard,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(color: AppTheme.neonPink.withAlpha(76)),
        ),
        title: Row(
          children: [
            Icon(Icons.error_outline, color: AppTheme.neonPink),
            const SizedBox(width: 12),
            Text(
              'Errore',
              style: GoogleFonts.orbitron(color: AppTheme.neonPink),
            ),
          ],
        ),
        content: Text(
          message,
          style: GoogleFonts.roboto(color: Colors.white70),
        ),
        actions: [
          ElevatedButton(
            onPressed: () => Navigator.pop(context),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.neonPink,
              foregroundColor: Colors.white,
            ),
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }

  Future<void> _openAdminDashboard() async {
    final Uri url = Uri.parse('https://administrator.teofly.it');
    if (!await launchUrl(url, mode: LaunchMode.externalApplication)) {
      if (mounted) {
        _showErrorDialog('Impossibile aprire l\'Admin Dashboard');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Inserisci Codice',
          style: GoogleFonts.orbitron(),
        ),
      ),
      body: _isLoading
          ? Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  CircularProgressIndicator(color: AppTheme.neonBlue),
                  const SizedBox(height: 20),
                  Text(
                    'Verifica in corso...',
                    style: GoogleFonts.roboto(color: Colors.white70),
                  ),
                ],
              ),
            )
          : _buildManualForm(),
    );
  }

  Widget _buildManualForm() {
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [AppTheme.darkBg, AppTheme.darkCard],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        ),
      ),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 20),
                Icon(
                  Icons.lock_outline,
                  size: 80,
                  color: AppTheme.neonBlue,
                ).animate().scale(duration: 600.ms, curve: Curves.easeOutBack),

                const SizedBox(height: 30),

                Text(
                  'Accedi alla partita',
                  textAlign: TextAlign.center,
                  style: GoogleFonts.orbitron(
                    fontSize: 28,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.neonBlue,
                  ),
                ).animate().fadeIn(delay: 200.ms),

                const SizedBox(height: 40),

                TextFormField(
                  controller: _bookingCodeController,
                  style: const TextStyle(color: Colors.white),
                  enableInteractiveSelection: true,
                  enableSuggestions: true,
                  autocorrect: false,
                  readOnly: false,
                  keyboardType: TextInputType.text,
                  textInputAction: TextInputAction.next,
                  decoration: InputDecoration(
                    labelText: 'Codice Prenotazione',
                    prefixIcon: Icon(Icons.confirmation_number,
                        color: AppTheme.neonBlue),
                  ),
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'Inserisci il codice prenotazione';
                    }
                    return null;
                  },
                ).animate().fadeIn(delay: 300.ms),

                const SizedBox(height: 20),

                TextFormField(
                  controller: _passwordController,
                  style: const TextStyle(color: Colors.white),
                  obscureText: _obscurePassword,
                  enableInteractiveSelection: true,
                  enableSuggestions: false,
                  autocorrect: false,
                  decoration: InputDecoration(
                    labelText: 'Password',
                    prefixIcon: Icon(Icons.key, color: AppTheme.neonBlue),
                    suffixIcon: IconButton(
                      icon: Icon(
                        _obscurePassword ? Icons.visibility_off : Icons.visibility,
                        color: AppTheme.neonBlue.withAlpha(180),
                      ),
                      onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                    ),
                  ),
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'Inserisci la password';
                    }
                    return null;
                  },
                ).animate().fadeIn(delay: 400.ms),

                const SizedBox(height: 20),

                TextFormField(
                  controller: _playerNameController,
                  style: const TextStyle(color: Colors.white),
                  enableInteractiveSelection: true,
                  keyboardType: TextInputType.name,
                  textInputAction: TextInputAction.done,
                  decoration: InputDecoration(
                    labelText: 'Nome Giocatore',
                    prefixIcon: Icon(Icons.person, color: AppTheme.neonBlue),
                  ),
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'Inserisci il tuo nome';
                    }
                    return null;
                  },
                ).animate().fadeIn(delay: 500.ms),

                const SizedBox(height: 40),

                ElevatedButton(
                  onPressed: _handleManualAccess,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.neonBlue,
                    foregroundColor: AppTheme.darkBg,
                    padding: const EdgeInsets.symmetric(vertical: 18),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(30),
                    ),
                  ),
                  child: Text(
                    'ACCEDI',
                    style: GoogleFonts.rajdhani(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 2,
                    ),
                  ),
                ).animate().scale(delay: 600.ms),

                if (kIsWeb) ...[
                  const SizedBox(height: 30),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: AppTheme.neonBlue.withAlpha(25),
                      borderRadius: BorderRadius.circular(15),
                      border: Border.all(color: AppTheme.neonBlue.withAlpha(76)),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.info_outline, color: AppTheme.neonBlue),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            'QR scanner disponibile solo su app mobile',
                            style: GoogleFonts.roboto(
                              fontSize: 12,
                              color: Colors.white70,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ).animate().fadeIn(delay: 700.ms),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
