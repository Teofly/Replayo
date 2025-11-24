import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_animate/flutter_animate.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:qr_code_scanner/qr_code_scanner.dart';
import 'dart:io' show Platform;
import '../config/app_theme.dart';
import '../services/auth_service.dart';
import 'match_videos_screen.dart';
import 'home_screen.dart';

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
  final GlobalKey qrKey = GlobalKey(debugLabel: 'QR');

  bool _isLoading = false;
  bool _obscurePassword = true;
  bool _showScanner = false;
  QRViewController? _qrController;
  bool _isProcessingQR = false;
  bool _isClosing = false;

  @override
  void initState() {
    super.initState();
    // Su web mostra sempre il form manuale
    if (kIsWeb && widget.useQRScanner) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _showWebQRNotSupported();
      });
    } else if (widget.useQRScanner && !kIsWeb) {
      _showScanner = true;
    }
  }

  @override
  void reassemble() {
    super.reassemble();
    if (!kIsWeb && _qrController != null) {
      if (Platform.isAndroid) {
        _qrController!.pauseCamera();
      } else if (Platform.isIOS) {
        _qrController!.resumeCamera();
      }
    }
  }

  @override
  void dispose() {
    _qrController?.dispose();
    _bookingCodeController.dispose();
    _passwordController.dispose();
    _playerNameController.dispose();
    super.dispose();
  }

  // Torna alla home
  void _goBack() {
    if (_isClosing) return;
    _isClosing = true;

    // Pausa la camera immediatamente
    _qrController?.pauseCamera();

    // Pop semplice
    Navigator.of(context).pop();
  }

  void _onQRViewCreated(QRViewController controller) {
    _qrController = controller;
    controller.scannedDataStream.listen((scanData) {
      if (_isProcessingQR) return;
      _processQRCode(scanData.code);
    });
  }

  Future<void> _processQRCode(String? code) async {
    if (code == null || code.isEmpty) return;

    setState(() => _isProcessingQR = true);
    _qrController?.pauseCamera();

    // Formato QR: booking_code|password|nome
    final parts = code.split('|');
    if (parts.length >= 2) {
      _bookingCodeController.text = parts[0];
      _passwordController.text = parts[1];

      // Se il nome è presente nel QR, usa quello e fai auto-login
      if (parts.length >= 3 && parts[2].isNotEmpty) {
        _playerNameController.text = parts[2];
        setState(() => _showScanner = false);
        // Auto-login diretto senza passare dalla schermata form
        _autoLogin();
      } else {
        // Chiedi nome giocatore solo se non presente nel QR
        final playerName = await _showPlayerNameDialog();
        if (playerName != null && playerName.isNotEmpty) {
          _playerNameController.text = playerName;
          setState(() => _showScanner = false);
          _autoLogin();
        } else {
          _qrController?.resumeCamera();
          setState(() => _isProcessingQR = false);
        }
      }
    } else {
      _showErrorDialog('QR Code non valido');
      _qrController?.resumeCamera();
      setState(() => _isProcessingQR = false);
    }
  }

  Future<void> _autoLogin() async {
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
      setState(() => _isProcessingQR = false);
    }
  }

  Future<String?> _showPlayerNameDialog() async {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.darkCard,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(color: AppTheme.neonBlue.withAlpha(76)),
        ),
        title: Text(
          'Inserisci il tuo nome',
          style: GoogleFonts.orbitron(color: AppTheme.neonBlue),
        ),
        content: TextField(
          controller: controller,
          style: const TextStyle(color: Colors.white),
          decoration: InputDecoration(
            hintText: 'Nome Giocatore',
            hintStyle: TextStyle(color: Colors.white38),
          ),
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, null),
            child: Text('Annulla', style: TextStyle(color: Colors.white54)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, controller.text),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.neonBlue,
              foregroundColor: AppTheme.darkBg,
            ),
            child: const Text('Conferma'),
          ),
        ],
      ),
    );
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
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: _goBack,
        ),
        title: Text(
          _showScanner ? 'Scansiona QR Code' : 'Inserisci Codice',
          style: GoogleFonts.orbitron(),
        ),
        actions: [
          if (!kIsWeb)
            IconButton(
              icon: Icon(_showScanner ? Icons.edit : Icons.qr_code_scanner),
              onPressed: () {
                // Pausa camera prima di cambiare vista
                if (_showScanner) {
                  _qrController?.pauseCamera();
                }
                setState(() => _showScanner = !_showScanner);
                // Riprendi camera se torniamo allo scanner
                if (_showScanner) {
                  _qrController?.resumeCamera();
                }
              },
              tooltip: _showScanner ? 'Inserimento manuale' : 'Scansiona QR',
            ),
        ],
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
          : _showScanner ? _buildQRScanner() : _buildManualForm(),
    );
  }

  Widget _buildQRScanner() {
    return Column(
      children: [
        Expanded(
          flex: 4,
          child: QRView(
            key: qrKey,
            onQRViewCreated: _onQRViewCreated,
            overlay: QrScannerOverlayShape(
              borderColor: AppTheme.neonBlue,
              borderRadius: 10,
              borderLength: 30,
              borderWidth: 10,
              cutOutSize: 300,
            ),
          ),
        ),
        Expanded(
          flex: 1,
          child: Container(
            color: AppTheme.darkBg,
            child: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    'Inquadra il QR Code della prenotazione',
                    style: GoogleFonts.roboto(
                      color: Colors.white70,
                      fontSize: 16,
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextButton.icon(
                    onPressed: () => setState(() => _showScanner = false),
                    icon: Icon(Icons.edit, color: AppTheme.neonBlue),
                    label: Text(
                      'Inserimento manuale',
                      style: TextStyle(color: AppTheme.neonBlue),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
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
