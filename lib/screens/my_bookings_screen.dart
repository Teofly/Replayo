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

  // Stats from API
  Map<String, dynamic>? _apiStats;
  bool _isLoadingStats = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _tabController.addListener(_onTabChanged);
    _loadPublicConfig();
    _loadBookings();
  }

  void _onTabChanged() {
    // Load stats when switching to Stats tab (index 2)
    if (_tabController.index == 2 && _apiStats == null && !_isLoadingStats) {
      _loadStats();
    }
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

  Future<void> _loadStats() async {
    if (_isLoadingStats) return;

    setState(() => _isLoadingStats = true);

    try {
      final token = _authService.accessToken;
      if (token == null) {
        setState(() => _isLoadingStats = false);
        return;
      }

      final response = await http.get(
        Uri.parse('https://api.teofly.it/api/user/stats'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true && data['stats'] != null) {
          setState(() {
            _apiStats = Map<String, dynamic>.from(data['stats']);
            _isLoadingStats = false;
          });
          debugPrint('[MyBookingsScreen] Stats loaded from API');
          return;
        }
      } else if (response.statusCode == 401) {
        // Try refresh token
        final refreshed = await _authService.refreshAccessToken();
        if (refreshed) {
          final newToken = _authService.accessToken;
          final retryResponse = await http.get(
            Uri.parse('https://api.teofly.it/api/user/stats'),
            headers: {
              'Authorization': 'Bearer $newToken',
              'Content-Type': 'application/json',
            },
          ).timeout(const Duration(seconds: 10));

          if (retryResponse.statusCode == 200) {
            final retryData = jsonDecode(retryResponse.body);
            if (retryData['success'] == true && retryData['stats'] != null) {
              setState(() {
                _apiStats = Map<String, dynamic>.from(retryData['stats']);
                _isLoadingStats = false;
              });
              return;
            }
          }
        }
      }

      // Fallback to null - will use local calculation
      setState(() {
        _apiStats = null;
        _isLoadingStats = false;
      });
    } catch (e) {
      debugPrint('[MyBookingsScreen] Error loading stats: $e');
      setState(() {
        _apiStats = null;
        _isLoadingStats = false;
      });
    }
  }

  @override
  void dispose() {
    _tabController.removeListener(_onTabChanged);
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
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.upcoming, size: 18),
                  const SizedBox(width: 4),
                  const Text('Prossime'),
                  if (_upcomingBookings.isNotEmpty) ...[
                    const SizedBox(width: 4),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                      decoration: BoxDecoration(
                        color: AppTheme.neonBlue,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        '${_upcomingBookings.length}',
                        style: GoogleFonts.rajdhani(
                          fontSize: 11,
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
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.history, size: 18),
                  const SizedBox(width: 4),
                  const Text('Passate'),
                  if (_pastBookings.isNotEmpty) ...[
                    const SizedBox(width: 4),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                      decoration: BoxDecoration(
                        color: Colors.white24,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        '${_pastBookings.length}',
                        style: GoogleFonts.rajdhani(
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          color: Colors.white70,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const Tab(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.bar_chart, size: 18),
                  SizedBox(width: 4),
                  Text('Stats'),
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
                    _buildStatisticsTab(),
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

  // Calculate statistics from bookings
  Map<String, dynamic> _calculateStats() {
    final allBookings = [..._upcomingBookings, ..._pastBookings];

    // Total matches played (past only, confirmed/completed)
    final playedMatches = _pastBookings.where((b) {
      final status = b['status']?.toString().toLowerCase() ?? '';
      return status != 'cancelled' && status != 'annullata';
    }).toList();

    // Total hours
    double totalHours = 0;
    for (final booking in playedMatches) {
      final duration = int.tryParse(booking['duration']?.toString() ?? '60') ?? 60;
      totalHours += duration / 60;
    }

    // Total spent (per player cost, not total field cost)
    double totalSpent = 0;
    for (final booking in playedMatches) {
      final price = double.tryParse(booking['price_per_player']?.toString() ?? '0') ?? 0;
      totalSpent += price;
    }

    // Group by sport
    final Map<String, Map<String, dynamic>> sportStats = {};
    for (final booking in playedMatches) {
      final sport = (booking['sport_type'] ?? booking['sport'] ?? 'Altro').toString();
      final duration = int.tryParse(booking['duration']?.toString() ?? '60') ?? 60;
      final court = booking['court_name']?.toString() ?? 'Campo';

      if (!sportStats.containsKey(sport)) {
        sportStats[sport] = {
          'matches': 0,
          'hours': 0.0,
          'courts': <String, int>{},
        };
      }
      sportStats[sport]!['matches'] = (sportStats[sport]!['matches'] as int) + 1;
      sportStats[sport]!['hours'] = (sportStats[sport]!['hours'] as double) + (duration / 60);

      final courts = sportStats[sport]!['courts'] as Map<String, int>;
      courts[court] = (courts[court] ?? 0) + 1;
    }

    // Find favorite day of week
    final Map<int, int> dayCount = {};
    for (final booking in playedMatches) {
      final dateStr = (booking['booking_date'] ?? booking['date'])?.toString().split('T')[0] ?? '';
      try {
        final date = DateTime.parse(dateStr);
        dayCount[date.weekday] = (dayCount[date.weekday] ?? 0) + 1;
      } catch (e) {}
    }
    int? favoriteDay;
    int maxDayCount = 0;
    dayCount.forEach((day, count) {
      if (count > maxDayCount) {
        maxDayCount = count;
        favoriteDay = day;
      }
    });

    // Find favorite time slot
    final Map<int, int> hourCount = {};
    for (final booking in playedMatches) {
      final timeStr = booking['start_time']?.toString() ?? '00:00';
      try {
        final hour = int.parse(timeStr.split(':')[0]);
        hourCount[hour] = (hourCount[hour] ?? 0) + 1;
      } catch (e) {}
    }
    int? favoriteHour;
    int maxHourCount = 0;
    hourCount.forEach((hour, count) {
      if (count > maxHourCount) {
        maxHourCount = count;
        favoriteHour = hour;
      }
    });

    return {
      'totalMatches': playedMatches.length,
      'totalHours': totalHours,
      'totalSpent': totalSpent,
      'upcomingCount': _upcomingBookings.length,
      'sportStats': sportStats,
      'favoriteDay': favoriteDay,
      'favoriteHour': favoriteHour,
    };
  }

  String _getDayName(int? weekday) {
    if (weekday == null) return '-';
    const days = ['', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
    return days[weekday];
  }

  // Helper to safely convert dynamic to double
  double _toDouble(dynamic value) {
    if (value == null) return 0.0;
    if (value is double) return value;
    if (value is int) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? 0.0;
    return 0.0;
  }

  Widget _buildStatisticsTab() {
    // Use API stats if available, otherwise fallback to local calculation
    final stats = _apiStats ?? _calculateStats();

    // Handle both API format and local format for sportStats
    Map<String, Map<String, dynamic>> sportStats = {};
    if (stats['sportStats'] != null) {
      final rawSportStats = stats['sportStats'];
      if (rawSportStats is Map) {
        rawSportStats.forEach((key, value) {
          if (value is Map) {
            sportStats[key.toString()] = Map<String, dynamic>.from(value);
          }
        });
      }
    }

    // Show loading indicator while fetching stats
    if (_isLoadingStats) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircularProgressIndicator(color: AppTheme.neonBlue),
            const SizedBox(height: 16),
            Text(
              'Caricamento statistiche...',
              style: GoogleFonts.rajdhani(
                fontSize: 16,
                color: Colors.white60,
              ),
            ),
          ],
        ),
      );
    }

    // Check for empty stats
    final totalMatches = stats['totalMatches'] ?? 0;
    final upcomingCount = stats['upcomingCount'] ?? _upcomingBookings.length;

    if (totalMatches == 0 && upcomingCount == 0 && _pastBookings.isEmpty && _upcomingBookings.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.bar_chart, size: 64, color: Colors.white24),
            const SizedBox(height: 16),
            Text(
              'Nessuna statistica disponibile',
              style: GoogleFonts.rajdhani(
                fontSize: 18,
                color: Colors.white54,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Prenota la tua prima partita!',
              style: GoogleFonts.roboto(
                fontSize: 14,
                color: Colors.white38,
              ),
            ),
          ],
        ),
      );
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Text(
            'RIEPILOGO ATTIVITÀ',
            style: GoogleFonts.orbitron(
              fontSize: 14,
              fontWeight: FontWeight.bold,
              color: AppTheme.neonBlue,
              letterSpacing: 2,
            ),
          ),
          const SizedBox(height: 16),

          // Main stats grid
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppTheme.darkCard,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
            ),
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(child: _buildStatCard(
                      icon: Icons.sports_score,
                      label: 'Partite Giocate',
                      value: '${stats['totalMatches'] ?? 0}',
                      color: AppTheme.neonGreen,
                    )),
                    const SizedBox(width: 12),
                    Expanded(child: _buildStatCard(
                      icon: Icons.timer,
                      label: 'Ore Giocate',
                      value: '${_toDouble(stats['totalHours']).toStringAsFixed(1)}h',
                      color: AppTheme.neonBlue,
                    )),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(child: _buildStatCard(
                      icon: Icons.euro,
                      label: 'Spesa Totale',
                      value: '€${_toDouble(stats['totalSpent']).toStringAsFixed(0)}',
                      color: AppTheme.neonPink,
                    )),
                    const SizedBox(width: 12),
                    Expanded(child: _buildStatCard(
                      icon: Icons.event,
                      label: 'Prossime',
                      value: '${stats['upcomingCount'] ?? _upcomingBookings.length}',
                      color: AppTheme.neonPurple,
                    )),
                  ],
                ),
              ],
            ),
          ),

          const SizedBox(height: 24),

          // Sport breakdown
          if (sportStats.isNotEmpty) ...[
            Text(
              'PER SPORT',
              style: GoogleFonts.orbitron(
                fontSize: 14,
                fontWeight: FontWeight.bold,
                color: AppTheme.neonPink,
                letterSpacing: 2,
              ),
            ),
            const SizedBox(height: 16),

            ...sportStats.entries.map((entry) {
              final sport = entry.key;
              final data = entry.value;
              // Handle courts map from both API and local format
              Map<String, int> courts = {};
              if (data['courts'] != null && data['courts'] is Map) {
                (data['courts'] as Map).forEach((k, v) {
                  courts[k.toString()] = (v is int) ? v : int.tryParse(v.toString()) ?? 0;
                });
              }
              String? favoriteCourt;
              int maxCourt = 0;
              courts.forEach((court, count) {
                if (count > maxCourt) {
                  maxCourt = count;
                  favoriteCourt = court;
                }
              });

              return Container(
                margin: const EdgeInsets.only(bottom: 12),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppTheme.darkCard,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: _getSportColor(sport).withOpacity(0.3)),
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: _getSportColor(sport).withOpacity(0.2),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Icon(
                        _getSportIcon(sport),
                        color: _getSportColor(sport),
                        size: 28,
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            sport.toUpperCase(),
                            style: GoogleFonts.rajdhani(
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                              color: Colors.white,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '${data['matches'] ?? 0} partite · ${_toDouble(data['hours']).toStringAsFixed(1)}h',
                            style: GoogleFonts.roboto(
                              fontSize: 14,
                              color: Colors.white70,
                            ),
                          ),
                          if (favoriteCourt != null) ...[
                            const SizedBox(height: 2),
                            Text(
                              'Preferito: $favoriteCourt',
                              style: GoogleFonts.roboto(
                                fontSize: 12,
                                color: Colors.white38,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              );
            }),
          ],

          const SizedBox(height: 24),

          // Records
          Text(
            'I TUOI RECORD',
            style: GoogleFonts.orbitron(
              fontSize: 14,
              fontWeight: FontWeight.bold,
              color: AppTheme.neonGreen,
              letterSpacing: 2,
            ),
          ),
          const SizedBox(height: 16),

          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppTheme.darkCard,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppTheme.neonGreen.withOpacity(0.3)),
            ),
            child: Column(
              children: [
                _buildRecordRow(
                  icon: Icons.calendar_today,
                  label: 'Giorno preferito',
                  value: _getDayName(stats['favoriteDay']),
                ),
                const Divider(color: Colors.white12, height: 24),
                _buildRecordRow(
                  icon: Icons.access_time,
                  label: 'Orario preferito',
                  value: stats['favoriteHour'] != null
                      ? '${stats['favoriteHour']}:00'
                      : '-',
                ),
              ],
            ),
          ),

          const SizedBox(height: 32),
        ],
      ),
    );
  }

  Widget _buildStatCard({
    required IconData icon,
    required String label,
    required String value,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Icon(icon, color: color, size: 24),
          const SizedBox(height: 8),
          Text(
            value,
            style: GoogleFonts.orbitron(
              fontSize: 20,
              fontWeight: FontWeight.bold,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: GoogleFonts.rajdhani(
              fontSize: 12,
              color: Colors.white54,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildRecordRow({
    required IconData icon,
    required String label,
    required String value,
  }) {
    return Row(
      children: [
        Icon(icon, color: Colors.white38, size: 20),
        const SizedBox(width: 12),
        Text(
          label,
          style: GoogleFonts.rajdhani(
            fontSize: 14,
            color: Colors.white54,
          ),
        ),
        const Spacer(),
        Text(
          value,
          style: GoogleFonts.rajdhani(
            fontSize: 16,
            fontWeight: FontWeight.bold,
            color: Colors.white,
          ),
        ),
      ],
    );
  }
}
