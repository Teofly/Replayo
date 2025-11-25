import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import '../config/app_theme.dart';
import '../models/match.dart';
import '../services/user_auth_service.dart';
import 'match_videos_screen.dart';

class MyVideosScreen extends StatefulWidget {
  const MyVideosScreen({super.key});

  @override
  State<MyVideosScreen> createState() => _MyVideosScreenState();
}

class _MyVideosScreenState extends State<MyVideosScreen> {
  final UserAuthService _authService = UserAuthService();
  List<Map<String, dynamic>> _matches = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadMatches();
  }

  Future<void> _loadMatches() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final matches = await _authService.getMyMatches();
      setState(() {
        _matches = matches;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = 'Errore nel caricamento delle partite';
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBg,
      appBar: AppBar(
        backgroundColor: AppTheme.darkCard,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios, color: Colors.white),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          'I Miei Video',
          style: GoogleFonts.orbitron(
            fontSize: 20,
            fontWeight: FontWeight.bold,
            color: Colors.white,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: AppTheme.neonBlue),
            onPressed: _loadMatches,
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(
        child: CircularProgressIndicator(color: AppTheme.neonBlue),
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.error_outline, color: AppTheme.neonPink, size: 60),
            const SizedBox(height: 16),
            Text(
              _error!,
              style: GoogleFonts.rajdhani(
                color: Colors.white70,
                fontSize: 16,
              ),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _loadMatches,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.neonBlue,
              ),
              child: const Text('Riprova'),
            ),
          ],
        ),
      );
    }

    if (_matches.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.videocam_off,
              color: AppTheme.neonPurple.withOpacity(0.5),
              size: 80,
            ),
            const SizedBox(height: 24),
            Text(
              'Nessun video disponibile',
              style: GoogleFonts.rajdhani(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 32),
              child: Text(
                'I video delle tue partite appariranno qui dopo aver giocato',
                textAlign: TextAlign.center,
                style: GoogleFonts.roboto(
                  fontSize: 14,
                  color: Colors.white60,
                ),
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadMatches,
      color: AppTheme.neonBlue,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _matches.length,
        itemBuilder: (context, index) {
          final match = _matches[index];
          return _buildMatchCard(match, index);
        },
      ),
    );
  }

  Widget _buildMatchCard(Map<String, dynamic> match, int index) {
    final sportType = match['sport_type'] ?? 'Sport';
    final matchDate = match['match_date'] ?? '';
    final courtName = match['court_name'] ?? 'Campo';
    final startTime = match['start_time'] ?? '';
    final endTime = match['end_time'] ?? '';
    final videoCount = match['video_count'] ?? 0;
    final bookingCode = match['booking_code'] ?? '';

    // Format date
    String formattedDate = matchDate;
    try {
      if (matchDate.isNotEmpty) {
        final date = DateTime.parse(matchDate);
        formattedDate = '${date.day}/${date.month}/${date.year}';
      }
    } catch (e) {
      // Keep original
    }

    // Sport icon and color
    IconData sportIcon;
    Color sportColor;
    switch (sportType.toLowerCase()) {
      case 'padel':
        sportIcon = Icons.sports_tennis;
        sportColor = AppTheme.neonBlue;
        break;
      case 'tennis':
        sportIcon = Icons.sports_tennis;
        sportColor = AppTheme.neonPurple;
        break;
      case 'calcetto':
        sportIcon = Icons.sports_soccer;
        sportColor = AppTheme.neonGreen;
        break;
      default:
        sportIcon = Icons.sports;
        sportColor = AppTheme.neonPink;
    }

    return GestureDetector(
      onTap: () {
        if (videoCount > 0) {
          // Create Match object from API data
          final matchObj = Match(
            id: match['id']?.toString() ?? '',
            bookingCode: bookingCode,
            sportType: _parseSportType(sportType),
            matchDate: DateTime.tryParse(matchDate) ?? DateTime.now(),
            location: courtName,
            playerIds: [],
            isActive: true,
            createdAt: DateTime.now(),
          );
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (context) => MatchVideosScreen(match: matchObj),
            ),
          );
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Nessun video disponibile per questa partita'),
              backgroundColor: AppTheme.neonPink,
            ),
          );
        }
      },
      child: Container(
        margin: const EdgeInsets.only(bottom: 16),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppTheme.darkCard,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: sportColor.withOpacity(0.3),
            width: 1,
          ),
          boxShadow: [
            BoxShadow(
              color: sportColor.withOpacity(0.1),
              blurRadius: 10,
              spreadRadius: 1,
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: sportColor.withOpacity(0.2),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(sportIcon, color: sportColor, size: 32),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    sportType.toUpperCase(),
                    style: GoogleFonts.orbitron(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: sportColor,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    courtName,
                    style: GoogleFonts.rajdhani(
                      fontSize: 14,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '$formattedDate${startTime.isNotEmpty ? " - $startTime" : ""}',
                    style: GoogleFonts.roboto(
                      fontSize: 13,
                      color: Colors.white60,
                    ),
                  ),
                ],
              ),
            ),
            Column(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: videoCount > 0
                        ? AppTheme.neonGreen.withOpacity(0.2)
                        : Colors.grey.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.videocam,
                        size: 16,
                        color: videoCount > 0 ? AppTheme.neonGreen : Colors.grey,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        '$videoCount',
                        style: GoogleFonts.rajdhani(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: videoCount > 0 ? AppTheme.neonGreen : Colors.grey,
                        ),
                      ),
                    ],
                  ),
                ),
                if (videoCount > 0) ...[
                  const SizedBox(height: 8),
                  Icon(
                    Icons.arrow_forward_ios,
                    size: 16,
                    color: sportColor,
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    ).animate().slideX(
          begin: 0.3,
          delay: Duration(milliseconds: 100 * index),
          duration: 400.ms,
          curve: Curves.easeOutBack,
        );
  }

  SportType _parseSportType(String sportType) {
    switch (sportType.toLowerCase()) {
      case 'padel':
        return SportType.padel;
      case 'tennis':
        return SportType.tennis;
      case 'calcetto':
        return SportType.calcetto;
      case 'soccer':
        return SportType.soccer;
      default:
        return SportType.padel;
    }
  }
}
