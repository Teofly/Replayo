import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import '../config/app_theme.dart';
import '../models/match.dart';
import '../services/user_auth_service.dart';
import 'match_videos_screen.dart';

class MyBookingsScreen extends StatefulWidget {
  const MyBookingsScreen({super.key});

  @override
  State<MyBookingsScreen> createState() => _MyBookingsScreenState();
}

class _MyBookingsScreenState extends State<MyBookingsScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final UserAuthService _authService = UserAuthService();

  List<Map<String, dynamic>> _upcomingBookings = [];
  List<Map<String, dynamic>> _pastBookings = [];
  bool _isLoading = true;
  String? _errorMessage;
  int _bookingCancelHours = 24; // default, loaded from API
  bool _isCancelling = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadPublicConfig();
    _loadBookings();
  }

  Future<void> _loadPublicConfig() async {
    try {
      final response = await http.get(
        Uri.parse('https://api.teofly.it/api/public/config'),
      ).timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true && data['config'] != null) {
          setState(() {
            _bookingCancelHours = int.tryParse(data['config']['booking_cancel_hours']?.toString() ?? '24') ?? 24;
          });
        }
      }
    } catch (e) {
      debugPrint('[MyBookingsScreen] Error loading config: $e');
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadBookings() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final token = _authService.accessToken;
      debugPrint('Token available: ${token != null}');
      debugPrint('Token value: ${token?.substring(0, 20)}...');

      if (token == null) {
        setState(() {
          _errorMessage = 'Devi effettuare il login per vedere le prenotazioni';
          _isLoading = false;
        });
        return;
      }

      final response = await http.get(
        Uri.parse('https://api.teofly.it/api/bookings/my-bookings'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      ).timeout(const Duration(seconds: 10));

      debugPrint('My bookings response status: ${response.statusCode}');
      debugPrint('My bookings response body: ${response.body}');

      if (response.statusCode == 401) {
        // Token scaduto - prova a fare refresh
        debugPrint('API my-bookings returns 401 - trying token refresh');
        final refreshed = await _authService.refreshAccessToken();
        if (refreshed) {
          debugPrint('Token refreshed successfully - retrying request');
          // Riprova la richiesta con il nuovo token
          final newToken = _authService.accessToken;
          final retryResponse = await http.get(
            Uri.parse('https://api.teofly.it/api/bookings/my-bookings'),
            headers: {
              'Authorization': 'Bearer $newToken',
              'Content-Type': 'application/json',
            },
          ).timeout(const Duration(seconds: 10));

          if (retryResponse.statusCode == 200) {
            final retryData = jsonDecode(retryResponse.body);
            if (retryData['success'] == true || retryData['bookings'] != null) {
              final bookings = List<Map<String, dynamic>>.from(retryData['bookings'] ?? []);
              _categorizeBookings(bookings);
              return;
            }
          }
        }
        // Se il refresh fallisce, mostra lista vuota
        debugPrint('Token refresh failed - showing empty list');
        setState(() {
          _upcomingBookings = [];
          _pastBookings = [];
          _isLoading = false;
        });
        return;
      }

      if (response.statusCode == 404) {
        // Endpoint non esiste ancora - mostra lista vuota
        setState(() {
          _upcomingBookings = [];
          _pastBookings = [];
          _isLoading = false;
        });
        return;
      }

      final data = jsonDecode(response.body);

      // Check for error response format
      if (data['error'] != null) {
        setState(() {
          _errorMessage = data['error'];
          _isLoading = false;
        });
        return;
      }

      if (response.statusCode == 200 && (data['success'] == true || data['bookings'] != null)) {
        final bookings = List<Map<String, dynamic>>.from(data['bookings'] ?? []);
        _categorizeBookings(bookings);
      } else {
        setState(() {
          _errorMessage = data['message'] ?? 'Errore nel caricamento prenotazioni';
          _isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        _errorMessage = 'Errore di connessione. Riprova.';
        _isLoading = false;
      });
    }
  }

  void _categorizeBookings(List<Map<String, dynamic>> bookings) {
    final now = DateTime.now();

    setState(() {
      _upcomingBookings = bookings.where((b) {
        final dateStr = (b['booking_date'] ?? b['date'])?.toString().split('T')[0] ?? '';
        final timeStr = b['start_time']?.toString() ?? '00:00';
        try {
          final bookingDateTime = DateTime.parse('$dateStr $timeStr');
          return bookingDateTime.isAfter(now);
        } catch (e) {
          return false;
        }
      }).toList();

      _pastBookings = bookings.where((b) {
        final dateStr = (b['booking_date'] ?? b['date'])?.toString().split('T')[0] ?? '';
        final timeStr = b['start_time']?.toString() ?? '00:00';
        try {
          final bookingDateTime = DateTime.parse('$dateStr $timeStr');
          return bookingDateTime.isBefore(now);
        } catch (e) {
          return true;
        }
      }).toList();

      // Sort upcoming by date ascending
      _upcomingBookings.sort((a, b) {
        final dateStrA = (a['booking_date'] ?? a['date'])?.toString().split('T')[0] ?? '';
        final dateStrB = (b['booking_date'] ?? b['date'])?.toString().split('T')[0] ?? '';
        final dateA = DateTime.tryParse('$dateStrA ${a['start_time']}') ?? DateTime.now();
        final dateB = DateTime.tryParse('$dateStrB ${b['start_time']}') ?? DateTime.now();
        return dateA.compareTo(dateB);
      });

      // Sort past by date descending
      _pastBookings.sort((a, b) {
        final dateStrA = (a['booking_date'] ?? a['date'])?.toString().split('T')[0] ?? '';
        final dateStrB = (b['booking_date'] ?? b['date'])?.toString().split('T')[0] ?? '';
        final dateA = DateTime.tryParse('$dateStrA ${a['start_time']}') ?? DateTime.now();
        final dateB = DateTime.tryParse('$dateStrB ${b['start_time']}') ?? DateTime.now();
        return dateB.compareTo(dateA);
      });

      _isLoading = false;
    });
  }

  SportType _getSportType(String? sport) {
    switch (sport?.toLowerCase()) {
      case 'padel':
        return SportType.padel;
      case 'tennis':
        return SportType.tennis;
      case 'calcetto':
        return SportType.calcetto;
      default:
        return SportType.soccer;
    }
  }

  void _navigateToMatchVideos(Map<String, dynamic> booking) {
    // Use match_id from the API if available (for videos lookup), fallback to booking_code
    final matchId = booking['match_id']?.toString();
    final bookingCode = booking['booking_code']?.toString() ?? '';
    final sport = (booking['sport_type'] ?? booking['sport'])?.toString() ?? 'Sport';
    final dateStr = (booking['booking_date'] ?? booking['date'])?.toString().split('T')[0] ?? '';
    final courtName = booking['court_name']?.toString() ?? 'Campo';

    DateTime matchDate;
    try {
      matchDate = DateTime.parse(dateStr);
    } catch (e) {
      matchDate = DateTime.now();
    }

    // The Match id should be the match_id from matches table (for video lookup)
    // If match_id is not available, fallback to booking_code which might match
    final match = Match(
      id: matchId ?? bookingCode,
      bookingCode: bookingCode.isNotEmpty ? bookingCode : (matchId ?? ''),
      sportType: _getSportType(sport),
      matchDate: matchDate,
      location: courtName,
      playerIds: [],
      createdAt: matchDate,
    );

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => MatchVideosScreen(match: match),
      ),
    );
  }

  bool _canCancelBooking(Map<String, dynamic> booking) {
    final status = booking['status']?.toString().toLowerCase() ?? '';
    if (status == 'cancelled' || status == 'completed') return false;

    final dateStr = (booking['booking_date'] ?? booking['date'])?.toString().split('T')[0] ?? '';
    final timeStr = booking['start_time']?.toString() ?? '00:00';

    try {
      final bookingDateTime = DateTime.parse('$dateStr $timeStr');
      final now = DateTime.now();
      final hoursUntilBooking = bookingDateTime.difference(now).inHours;
      return hoursUntilBooking >= _bookingCancelHours;
    } catch (e) {
      return false;
    }
  }

  String _getCancelBlockedReason(Map<String, dynamic> booking) {
    final dateStr = (booking['booking_date'] ?? booking['date'])?.toString().split('T')[0] ?? '';
    final timeStr = booking['start_time']?.toString() ?? '00:00';

    try {
      final bookingDateTime = DateTime.parse('$dateStr $timeStr');
      final now = DateTime.now();
      final hoursUntilBooking = bookingDateTime.difference(now).inHours;
      return 'Non puoi cancellare a meno di $_bookingCancelHours ore (mancano $hoursUntilBooking ore)';
    } catch (e) {
      return 'Impossibile cancellare';
    }
  }

  Future<void> _cancelBooking(Map<String, dynamic> booking) async {
    final bookingId = booking['id']?.toString() ?? '';
    if (bookingId.isEmpty) return;

    // Show confirmation dialog
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.darkCard,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(color: Colors.redAccent.withOpacity(0.5)),
        ),
        title: Text(
          'Annulla Prenotazione',
          style: GoogleFonts.orbitron(color: Colors.redAccent, fontSize: 18),
        ),
        content: Text(
          'Sei sicuro di voler annullare questa prenotazione?',
          style: GoogleFonts.rajdhani(color: Colors.white70, fontSize: 16),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text('No', style: GoogleFonts.rajdhani(color: Colors.white54)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.redAccent,
              foregroundColor: Colors.white,
            ),
            child: Text('Sì, Annulla', style: GoogleFonts.rajdhani(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    setState(() => _isCancelling = true);

    try {
      final token = _authService.accessToken;
      if (token == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Devi effettuare il login'), backgroundColor: Colors.redAccent),
        );
        return;
      }

      final response = await http.put(
        Uri.parse('https://api.teofly.it/api/bookings/$bookingId/user-cancel'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      ).timeout(const Duration(seconds: 10));

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Prenotazione annullata con successo'),
            backgroundColor: AppTheme.neonGreen,
          ),
        );
        // Reload bookings
        _loadBookings();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(data['error'] ?? 'Errore nella cancellazione'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Errore di connessione'), backgroundColor: Colors.redAccent),
      );
    } finally {
      setState(() => _isCancelling = false);
    }
  }

  Color _getSportColor(String? sport) {
    switch (sport?.toLowerCase()) {
      case 'padel':
        return AppTheme.neonBlue;
      case 'tennis':
        return AppTheme.neonPurple;
      case 'calcetto':
        return AppTheme.neonPink;
      default:
        return AppTheme.neonGreen;
    }
  }

  IconData _getSportIcon(String? sport) {
    switch (sport?.toLowerCase()) {
      case 'padel':
        return Icons.sports_tennis;
      case 'tennis':
        return Icons.sports_baseball;
      case 'calcetto':
        return Icons.sports_soccer;
      default:
        return Icons.sports;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBg,
      appBar: AppBar(
        backgroundColor: AppTheme.darkCard,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_ios, color: AppTheme.neonBlue),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          'Le Mie Prenotazioni',
          style: GoogleFonts.orbitron(
            fontSize: 20,
            fontWeight: FontWeight.bold,
            color: Colors.white,
          ),
        ),
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: AppTheme.neonBlue,
          indicatorWeight: 3,
          labelColor: AppTheme.neonBlue,
          unselectedLabelColor: Colors.white60,
          labelStyle: GoogleFonts.rajdhani(
            fontSize: 16,
            fontWeight: FontWeight.bold,
          ),
          tabs: [
            Tab(
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.upcoming, size: 20),
                  const SizedBox(width: 8),
                  const Text('Prossime'),
                  if (_upcomingBookings.isNotEmpty) ...[
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppTheme.neonBlue,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        '${_upcomingBookings.length}',
                        style: GoogleFonts.rajdhani(
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            Tab(
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.history, size: 20),
                  const SizedBox(width: 8),
                  const Text('Passate'),
                  if (_pastBookings.isNotEmpty) ...[
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: Colors.white24,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        '${_pastBookings.length}',
                        style: GoogleFonts.rajdhani(
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                          color: Colors.white70,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
      body: _isLoading
          ? Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  CircularProgressIndicator(color: AppTheme.neonBlue),
                  const SizedBox(height: 16),
                  Text(
                    'Caricamento prenotazioni...',
                    style: GoogleFonts.rajdhani(
                      color: Colors.white60,
                      fontSize: 16,
                    ),
                  ),
                ],
              ),
            )
          : _errorMessage != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.error_outline,
                          color: Colors.redAccent,
                          size: 64,
                        ),
                        const SizedBox(height: 16),
                        Text(
                          _errorMessage!,
                          style: GoogleFonts.rajdhani(
                            color: Colors.white70,
                            fontSize: 16,
                          ),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 24),
                        ElevatedButton.icon(
                          onPressed: _loadBookings,
                          icon: const Icon(Icons.refresh),
                          label: Text(
                            'Riprova',
                            style: GoogleFonts.rajdhani(
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppTheme.neonBlue,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(
                              horizontal: 24,
                              vertical: 12,
                            ),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                )
              : TabBarView(
                  controller: _tabController,
                  children: [
                    _buildBookingsList(_upcomingBookings, isUpcoming: true),
                    _buildBookingsList(_pastBookings, isUpcoming: false),
                  ],
                ),
    );
  }

  Widget _buildBookingsList(List<Map<String, dynamic>> bookings,
      {required bool isUpcoming}) {
    if (bookings.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              isUpcoming ? Icons.calendar_today : Icons.history,
              color: Colors.white24,
              size: 80,
            ),
            const SizedBox(height: 16),
            Text(
              isUpcoming
                  ? 'Nessuna prenotazione in programma'
                  : 'Nessuna prenotazione passata',
              style: GoogleFonts.rajdhani(
                color: Colors.white60,
                fontSize: 18,
              ),
            ),
            if (isUpcoming) ...[
              const SizedBox(height: 24),
              Text(
                'Prenota un campo dalla home!',
                style: GoogleFonts.rajdhani(
                  color: Colors.white38,
                  fontSize: 14,
                ),
              ),
            ],
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadBookings,
      color: AppTheme.neonBlue,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: bookings.length,
        itemBuilder: (context, index) {
          final booking = bookings[index];
          return _buildBookingCard(booking, isUpcoming: isUpcoming, index: index);
        },
      ),
    );
  }

  Widget _buildBookingCard(Map<String, dynamic> booking,
      {required bool isUpcoming, required int index}) {
    // API returns sport_type not sport
    final sport = (booking['sport_type'] ?? booking['sport'])?.toString() ?? 'Sport';
    final sportColor = _getSportColor(sport);
    final courtName = booking['court_name']?.toString() ?? 'Campo';
    // API returns booking_date not date
    final dateStr = (booking['booking_date'] ?? booking['date'])?.toString().split('T')[0] ?? '';
    final startTime = booking['start_time']?.toString() ?? '';
    final endTime = booking['end_time']?.toString() ?? '';
    final status = booking['status']?.toString() ?? '';
    final bookingCode = booking['booking_code']?.toString() ?? booking['id']?.toString() ?? '';
    final customerName = booking['customer_name']?.toString() ?? '';

    String formattedDate = dateStr;
    try {
      final date = DateTime.parse(dateStr);
      formattedDate = DateFormat('EEEE d MMMM yyyy', 'it').format(date);
      formattedDate = formattedDate[0].toUpperCase() + formattedDate.substring(1);
    } catch (e) {
      // Keep original string
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isUpcoming ? sportColor.withOpacity(0.5) : Colors.white12,
          width: isUpcoming ? 2 : 1,
        ),
        boxShadow: isUpcoming
            ? [
                BoxShadow(
                  color: sportColor.withOpacity(0.2),
                  blurRadius: 15,
                  spreadRadius: 1,
                ),
              ]
            : null,
      ),
      child: Column(
        children: [
          // Header with sport and status
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              gradient: isUpcoming
                  ? LinearGradient(
                      colors: [sportColor.withOpacity(0.3), Colors.transparent],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    )
                  : null,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: sportColor.withOpacity(isUpcoming ? 0.3 : 0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    _getSportIcon(sport),
                    color: isUpcoming ? sportColor : Colors.white54,
                    size: 24,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        sport.toUpperCase(),
                        style: GoogleFonts.orbitron(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: isUpcoming ? sportColor : Colors.white54,
                        ),
                      ),
                      Text(
                        courtName,
                        style: GoogleFonts.rajdhani(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                      ),
                    ],
                  ),
                ),
                _buildStatusBadge(status, isUpcoming),
              ],
            ),
          ),

          // Date and time info
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                Row(
                  children: [
                    Icon(
                      Icons.calendar_today,
                      color: isUpcoming ? Colors.white70 : Colors.white38,
                      size: 18,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        formattedDate,
                        style: GoogleFonts.rajdhani(
                          fontSize: 16,
                          color: isUpcoming ? Colors.white : Colors.white54,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Icon(
                      Icons.access_time,
                      color: isUpcoming ? Colors.white70 : Colors.white38,
                      size: 18,
                    ),
                    const SizedBox(width: 10),
                    Text(
                      '$startTime - $endTime',
                      style: GoogleFonts.rajdhani(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                        color: isUpcoming ? Colors.white : Colors.white54,
                      ),
                    ),
                  ],
                ),
                if (customerName.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Icon(
                        Icons.person,
                        color: isUpcoming ? sportColor : Colors.white38,
                        size: 18,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          customerName,
                          style: GoogleFonts.rajdhani(
                            fontSize: 14,
                            color: isUpcoming ? sportColor : Colors.white38,
                            fontWeight: FontWeight.w600,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ],
                // Video button - show for all bookings with a booking code
                if (bookingCode.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: () => _navigateToMatchVideos(booking),
                      icon: const Icon(Icons.videocam, size: 20),
                      label: Text(
                        'Guarda Video',
                        style: GoogleFonts.rajdhani(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppTheme.neonPurple.withOpacity(0.3),
                        foregroundColor: AppTheme.neonPurple,
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                          side: BorderSide(color: AppTheme.neonPurple.withOpacity(0.5)),
                        ),
                      ),
                    ),
                  ),
                ],
                // Cancel button - show only for upcoming bookings that can be cancelled
                if (isUpcoming && status.toLowerCase() != 'cancelled') ...[
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: _canCancelBooking(booking)
                        ? ElevatedButton.icon(
                            onPressed: _isCancelling ? null : () => _cancelBooking(booking),
                            icon: _isCancelling
                                ? const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                  )
                                : const Icon(Icons.cancel_outlined, size: 20),
                            label: Text(
                              _isCancelling ? 'Annullamento...' : 'Annulla Prenotazione',
                              style: GoogleFonts.rajdhani(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.redAccent.withOpacity(0.2),
                              foregroundColor: Colors.redAccent,
                              padding: const EdgeInsets.symmetric(vertical: 12),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                                side: BorderSide(color: Colors.redAccent.withOpacity(0.5)),
                              ),
                            ),
                          )
                        : Tooltip(
                            message: _getCancelBlockedReason(booking),
                            child: ElevatedButton.icon(
                              onPressed: null,
                              icon: const Icon(Icons.lock_clock, size: 20),
                              label: Text(
                                'Annulla Prenotazione',
                                style: GoogleFonts.rajdhani(
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: Colors.grey.withOpacity(0.2),
                                foregroundColor: Colors.grey,
                                disabledBackgroundColor: Colors.grey.withOpacity(0.1),
                                disabledForegroundColor: Colors.grey.shade600,
                                padding: const EdgeInsets.symmetric(vertical: 12),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  side: BorderSide(color: Colors.grey.withOpacity(0.3)),
                                ),
                              ),
                            ),
                          ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    ).animate().fadeIn(delay: (index * 100).ms).slideX(begin: 0.1);
  }

  Widget _buildStatusBadge(String status, bool isUpcoming) {
    Color badgeColor;
    String displayStatus;
    IconData statusIcon;

    switch (status.toLowerCase()) {
      case 'confirmed':
      case 'confermata':
        badgeColor = AppTheme.neonGreen;
        displayStatus = 'Confermata';
        statusIcon = Icons.check_circle;
        break;
      case 'pending':
      case 'in attesa':
        badgeColor = Colors.orange;
        displayStatus = 'In attesa';
        statusIcon = Icons.hourglass_top;
        break;
      case 'cancelled':
      case 'annullata':
        badgeColor = Colors.redAccent;
        displayStatus = 'Annullata';
        statusIcon = Icons.cancel;
        break;
      case 'completed':
      case 'completata':
        badgeColor = Colors.white54;
        displayStatus = 'Completata';
        statusIcon = Icons.done_all;
        break;
      default:
        badgeColor = Colors.white38;
        displayStatus = status.isNotEmpty ? status : 'N/D';
        statusIcon = Icons.info_outline;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: badgeColor.withOpacity(0.2),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: badgeColor.withOpacity(0.5)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(statusIcon, color: badgeColor, size: 14),
          const SizedBox(width: 4),
          Text(
            displayStatus,
            style: GoogleFonts.rajdhani(
              fontSize: 12,
              fontWeight: FontWeight.bold,
              color: badgeColor,
            ),
          ),
        ],
      ),
    );
  }
}
