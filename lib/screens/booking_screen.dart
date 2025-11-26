import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import '../config/app_theme.dart';
import '../services/user_auth_service.dart';

class BookingScreen extends StatefulWidget {
  const BookingScreen({super.key});

  @override
  State<BookingScreen> createState() => _BookingScreenState();
}

class _BookingScreenState extends State<BookingScreen> {
  static const String _baseUrl = 'https://api.teofly.it/api';

  // Current step (1: Sport, 2: Date, 3: Time, 4: Court, 5: User Data)
  int _currentStep = 1;

  // Step 1: Sport selection
  String? _selectedSport;

  // Step 2: Date selection
  DateTime? _selectedDate;

  // Step 3 & 4: Available slots from API
  List<Map<String, dynamic>> _availableCourts = [];
  String? _selectedTime; // Step 3: Selected time
  Map<String, dynamic>? _selectedSlot; // Step 4: Selected slot with court
  String? _selectedCourtId;
  String? _selectedCourtName;

  // Step 5: User data
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _surnameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  bool _isRegisteredUser = false;
  bool _isCheckingUser = false;

  bool _isLoadingAvailability = false;
  bool _isBooking = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _checkLoggedInUser();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _surnameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _checkLoggedInUser() async {
    final authService = UserAuthService();
    await authService.init();
    if (authService.isLoggedIn) {
      setState(() {
        _isRegisteredUser = true;
      });

      // Carica i dati completi dal server
      try {
        debugPrint('[BookingScreen] Loading user data from API...');
        final response = await http.get(
          Uri.parse('$_baseUrl/auth/me'),
          headers: {'Authorization': 'Bearer ${authService.accessToken}'},
        ).timeout(const Duration(seconds: 10));

        debugPrint('[BookingScreen] API response status: ${response.statusCode}');
        debugPrint('[BookingScreen] API response body: ${response.body}');

        if (response.statusCode == 200) {
          final data = json.decode(response.body);
          if (data['success'] == true && data['user'] != null) {
            final user = data['user'];
            final name = user['name'] as String? ?? '';
            final nameParts = name.split(' ');
            final firstName = nameParts.isNotEmpty ? nameParts.first : '';
            final lastName = nameParts.length > 1 ? nameParts.skip(1).join(' ') : '';
            final phone = user['phone'] as String? ?? '';
            final email = user['email'] as String? ?? '';

            debugPrint('[BookingScreen] Parsed user data: name=$name, firstName=$firstName, lastName=$lastName, phone=$phone, email=$email');

            setState(() {
              _nameController.text = firstName;
              _surnameController.text = lastName;
              _emailController.text = email;
              _phoneController.text = phone;
            });
            debugPrint('[BookingScreen] Controllers updated successfully');
            debugPrint('[BookingScreen] Controller values - name: ${_nameController.text}, surname: ${_surnameController.text}, email: ${_emailController.text}, phone: ${_phoneController.text}');
            return;
          } else {
            debugPrint('[BookingScreen] API success=false or user=null');
          }
        } else {
          debugPrint('[BookingScreen] API returned non-200 status');
        }
      } catch (e) {
        debugPrint('[BookingScreen] Error loading user data: $e');
      }

      // Fallback ai dati locali
      setState(() {
        final nameParts = (authService.userName ?? '').split(' ');
        _nameController.text = nameParts.isNotEmpty ? nameParts.first : '';
        _surnameController.text = nameParts.length > 1 ? nameParts.skip(1).join(' ') : '';
        _emailController.text = authService.userEmail ?? '';
        _phoneController.text = authService.userPhone ?? '';
      });
    }
  }

  Future<void> _loadAvailability() async {
    if (_selectedDate == null) return;

    setState(() {
      _isLoadingAvailability = true;
      _errorMessage = null;
      _selectedSlot = null;
      _selectedCourtId = null;
      _selectedCourtName = null;
    });

    try {
      final dateStr = DateFormat('yyyy-MM-dd').format(_selectedDate!);
      final response = await http.get(
        Uri.parse('$_baseUrl/bookings/availability?date=$dateStr'),
        headers: {'Accept': 'application/json'},
      ).timeout(const Duration(seconds: 15));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true) {
          // Filter courts by selected sport
          final allCourts = List<Map<String, dynamic>>.from(data['courts'] ?? []);
          setState(() {
            _availableCourts = allCourts.where((c) => c['sport_type'] == _selectedSport).toList();
            _isLoadingAvailability = false;
          });
          return;
        }
      }

      setState(() {
        _errorMessage = 'Errore nel caricamento disponibilità';
        _isLoadingAvailability = false;
      });
    } catch (e) {
      setState(() {
        _errorMessage = 'Errore di connessione';
        _isLoadingAvailability = false;
      });
    }
  }

  Future<void> _checkRegisteredUser() async {
    final email = _emailController.text.trim();
    if (email.isEmpty || !email.contains('@')) return;

    setState(() => _isCheckingUser = true);

    try {
      final response = await http.get(
        Uri.parse('$_baseUrl/users/check?email=$email'),
        headers: {'Accept': 'application/json'},
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['exists'] == true && data['user'] != null) {
          final user = data['user'];
          setState(() {
            _isRegisteredUser = true;
            _nameController.text = user['first_name'] ?? '';
            _surnameController.text = user['last_name'] ?? '';
            _phoneController.text = user['phone'] ?? '';
          });
          _showMessage('Dati importati correttamente!', isSuccess: true);
        }
      }
    } catch (e) {
      // Silently fail
    }

    setState(() => _isCheckingUser = false);
  }

  Future<void> _bookSlot() async {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedSlot == null || _selectedCourtId == null || _selectedDate == null) return;

    setState(() => _isBooking = true);

    try {
      final dateStr = DateFormat('yyyy-MM-dd').format(_selectedDate!);
      final numPlayers = _selectedSport == 'calcetto' ? 10 : 4;

      final response = await http.post(
        Uri.parse('$_baseUrl/bookings'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'court_id': _selectedCourtId,
          'booking_date': dateStr,
          'start_time': _selectedSlot!['start_time'],
          'end_time': _selectedSlot!['end_time'],
          'customer_name': '${_nameController.text.trim()} ${_surnameController.text.trim()}',
          'customer_email': _emailController.text.trim(),
          'customer_phone': _phoneController.text.trim(),
          'num_players': numPlayers,
          'auto_confirm': false,
        }),
      );

      setState(() => _isBooking = false);

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 || response.statusCode == 201) {
        if (data['success'] == true) {
          _showBookingSuccess(data);
        } else {
          _showMessage(data['message'] ?? 'Errore nella prenotazione');
        }
      } else {
        _showMessage(data['message'] ?? data['error'] ?? 'Errore nella prenotazione');
      }
    } catch (e) {
      setState(() => _isBooking = false);
      _showMessage('Errore di connessione');
    }
  }

  void _showBookingSuccess(Map<String, dynamic> data) {
    final bookingCode = data['booking']?['id']?.toString().substring(0, 8).toUpperCase() ??
                        data['booking_code'] ??
                        'OK';

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.darkCard,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Row(
          children: [
            Icon(Icons.check_circle, color: AppTheme.neonGreen, size: 28),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                'Richiesta Inviata!',
                style: GoogleFonts.rajdhani(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 18,
                ),
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'La tua richiesta di prenotazione è stata inviata.',
              style: GoogleFonts.rajdhani(color: Colors.white70, fontSize: 16),
            ),
            const SizedBox(height: 8),
            Text(
              'Riceverai conferma dal club.',
              style: GoogleFonts.rajdhani(color: Colors.white70, fontSize: 16),
            ),
            const SizedBox(height: 16),
            Text(
              'Campo: $_selectedCourtName',
              style: GoogleFonts.rajdhani(color: Colors.white70, fontSize: 14),
            ),
            Text(
              'Data: ${DateFormat('EEEE dd MMMM yyyy', 'it').format(_selectedDate!)}',
              style: GoogleFonts.rajdhani(color: Colors.white70, fontSize: 14),
            ),
            Text(
              'Orario: ${_selectedSlot!['start_time']} - ${_selectedSlot!['end_time']}',
              style: GoogleFonts.rajdhani(color: Colors.white70, fontSize: 14),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppTheme.neonBlue.withOpacity(0.2),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Column(
                children: [
                  Text(
                    'Codice prenotazione:',
                    style: GoogleFonts.rajdhani(color: Colors.white60, fontSize: 14),
                  ),
                  Text(
                    bookingCode,
                    style: GoogleFonts.orbitron(
                      color: AppTheme.neonBlue,
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              Navigator.pop(context);
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.neonGreen,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            child: Text('OK', style: GoogleFonts.rajdhani(color: Colors.white, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  void _showMessage(String message, {bool isSuccess = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isSuccess ? AppTheme.neonGreen : Colors.red,
      ),
    );
  }

  void _goToNextStep() {
    if (_currentStep < 5) {
      setState(() => _currentStep++);
      if (_currentStep == 3) {
        _loadAvailability();
      }
    }
  }

  void _goToPreviousStep() {
    if (_currentStep > 1) {
      setState(() {
        _currentStep--;
        if (_currentStep < 4) {
          _selectedSlot = null;
          _selectedCourtId = null;
          _selectedCourtName = null;
        }
        if (_currentStep < 3) {
          _selectedTime = null;
        }
        if (_currentStep < 2) _selectedDate = null;
        if (_currentStep < 1) _selectedSport = null;
      });
    } else {
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [AppTheme.darkBg, AppTheme.darkCard, AppTheme.darkBg],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            stops: const [0.0, 0.5, 1.0],
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              _buildHeader(),
              _buildProgressIndicator(),
              Expanded(
                child: _buildCurrentStep(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          IconButton(
            onPressed: _goToPreviousStep,
            icon: Icon(Icons.arrow_back_ios, color: AppTheme.neonBlue),
          ),
          Expanded(
            child: Text(
              'Prenota un Campo',
              style: GoogleFonts.orbitron(
                fontSize: 22,
                fontWeight: FontWeight.bold,
                color: Colors.white,
              ),
            ),
          ),
        ],
      ),
    ).animate().fadeIn(duration: 300.ms);
  }

  Widget _buildProgressIndicator() {
    final steps = ['Sport', 'Data', 'Orario', 'Campo', 'Dati'];
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: List.generate(steps.length, (index) {
          final stepNum = index + 1;
          final isActive = stepNum == _currentStep;
          final isCompleted = stepNum < _currentStep;

          return Expanded(
            child: Row(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    gradient: isActive || isCompleted
                        ? LinearGradient(colors: [AppTheme.neonBlue, AppTheme.neonPurple])
                        : null,
                    color: isActive || isCompleted ? null : Colors.grey.shade700,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Center(
                    child: isCompleted
                        ? const Icon(Icons.check, color: Colors.white, size: 16)
                        : Text(
                            '$stepNum',
                            style: GoogleFonts.orbitron(
                              color: Colors.white,
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                  ),
                ),
                if (index < steps.length - 1)
                  Expanded(
                    child: Container(
                      height: 2,
                      margin: const EdgeInsets.symmetric(horizontal: 4),
                      color: isCompleted ? AppTheme.neonBlue : Colors.grey.shade700,
                    ),
                  ),
              ],
            ),
          );
        }),
      ),
    );
  }

  Widget _buildCurrentStep() {
    switch (_currentStep) {
      case 1:
        return _buildSportSelection();
      case 2:
        return _buildDateSelection();
      case 3:
        return _buildTimeSelection();
      case 4:
        return _buildCourtSelection();
      case 5:
        return _buildUserDataForm();
      default:
        return const SizedBox();
    }
  }

  // Step 1: Sport Selection
  Widget _buildSportSelection() {
    final sports = [
      {'id': 'padel', 'name': 'Padel', 'duration': '90 min', 'icon': Icons.sports_tennis, 'color': AppTheme.neonBlue},
      {'id': 'calcetto', 'name': 'Calcetto', 'duration': '60 min', 'icon': Icons.sports_soccer, 'color': AppTheme.neonGreen},
      {'id': 'tennis', 'name': 'Tennis', 'duration': '60 min', 'icon': Icons.sports_baseball, 'color': AppTheme.neonPurple},
    ];

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Seleziona lo Sport',
            style: GoogleFonts.rajdhani(
              color: Colors.white,
              fontSize: 24,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Scegli lo sport che vuoi praticare',
            style: GoogleFonts.rajdhani(color: Colors.white60, fontSize: 16),
          ),
          const SizedBox(height: 24),
          ...sports.map((sport) {
            final isSelected = _selectedSport == sport['id'];
            final color = sport['color'] as Color;

            return Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: GestureDetector(
                onTap: () {
                  setState(() => _selectedSport = sport['id'] as String);
                },
                child: Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: AppTheme.darkCard,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(
                      color: isSelected ? color : Colors.white24,
                      width: isSelected ? 2 : 1,
                    ),
                    boxShadow: isSelected
                        ? [BoxShadow(color: color.withOpacity(0.3), blurRadius: 15)]
                        : null,
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: color.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(15),
                        ),
                        child: Icon(sport['icon'] as IconData, color: color, size: 32),
                      ),
                      const SizedBox(width: 20),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              sport['name'] as String,
                              style: GoogleFonts.rajdhani(
                                color: Colors.white,
                                fontSize: 22,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            Text(
                              'Durata: ${sport['duration']}',
                              style: GoogleFonts.rajdhani(color: Colors.white60, fontSize: 16),
                            ),
                          ],
                        ),
                      ),
                      if (isSelected)
                        Icon(Icons.check_circle, color: color, size: 28),
                    ],
                  ),
                ),
              ),
            ).animate().slideX(begin: -0.2, duration: 400.ms, delay: Duration(milliseconds: 100 * sports.indexOf(sport)));
          }),
          const SizedBox(height: 24),
          if (_selectedSport != null) _buildContinueButton(),
        ],
      ),
    );
  }

  // Step 2: Date Selection
  Widget _buildDateSelection() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Seleziona la Data',
            style: GoogleFonts.rajdhani(
              color: Colors.white,
              fontSize: 24,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Scegli quando vuoi giocare',
            style: GoogleFonts.rajdhani(color: Colors.white60, fontSize: 16),
          ),
          const SizedBox(height: 24),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 4,
              crossAxisSpacing: 10,
              mainAxisSpacing: 10,
              childAspectRatio: 0.85,
            ),
            itemCount: 14,
            itemBuilder: (context, index) {
              final date = DateTime.now().add(Duration(days: index));
              final isSelected = _selectedDate != null &&
                  DateFormat('yyyy-MM-dd').format(date) == DateFormat('yyyy-MM-dd').format(_selectedDate!);
              final isToday = index == 0;

              return GestureDetector(
                onTap: () {
                  setState(() => _selectedDate = date);
                },
                child: Container(
                  decoration: BoxDecoration(
                    gradient: isSelected
                        ? LinearGradient(colors: [AppTheme.neonBlue, AppTheme.neonPurple])
                        : null,
                    color: isSelected ? null : AppTheme.darkCard,
                    borderRadius: BorderRadius.circular(15),
                    border: Border.all(
                      color: isSelected ? Colors.transparent : Colors.white24,
                    ),
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        isToday ? 'Oggi' : DateFormat('EEE', 'it').format(date).toUpperCase(),
                        style: GoogleFonts.rajdhani(
                          color: Colors.white70,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      Text(
                        DateFormat('dd').format(date),
                        style: GoogleFonts.orbitron(
                          color: Colors.white,
                          fontSize: 22,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        DateFormat('MMM', 'it').format(date).toUpperCase(),
                        style: GoogleFonts.rajdhani(
                          color: Colors.white70,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ),
              ).animate().scale(begin: const Offset(0.8, 0.8), duration: 300.ms, delay: Duration(milliseconds: 30 * index));
            },
          ),
          const SizedBox(height: 24),
          if (_selectedDate != null) _buildContinueButton(),
        ],
      ),
    );
  }

  // Get default duration for sport
  int _getDefaultDuration(String? sport) {
    switch (sport) {
      case 'padel':
        return 90;
      case 'tennis':
      case 'calcetto':
        return 60;
      default:
        return 60;
    }
  }

  // Get all valid slots with full duration
  List<Map<String, dynamic>> _getValidSlots() {
    final defaultDuration = _getDefaultDuration(_selectedSport);
    List<Map<String, dynamic>> allSlots = [];

    for (final court in _availableCourts) {
      final slots = List<Map<String, dynamic>>.from(court['slots'] ?? []);
      for (final slot in slots) {
        final duration = slot['duration_minutes'] as int? ?? 0;
        // Only include slots with duration >= default duration
        if (duration >= defaultDuration) {
          allSlots.add({
            ...slot,
            'court_id': court['court_id'],
            'court_name': court['court_name'],
            'sport_type': court['sport_type'],
          });
        }
      }
    }

    return allSlots;
  }

  // Step 3: Time Selection (only unique times)
  Widget _buildTimeSelection() {
    if (_isLoadingAvailability) {
      return const Center(
        child: CircularProgressIndicator(color: AppTheme.neonBlue),
      );
    }

    if (_errorMessage != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.error_outline, color: Colors.red, size: 60),
            const SizedBox(height: 16),
            Text(_errorMessage!, style: GoogleFonts.rajdhani(color: Colors.white70, fontSize: 16)),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: _loadAvailability,
              style: ElevatedButton.styleFrom(backgroundColor: AppTheme.neonBlue),
              child: Text('Riprova', style: GoogleFonts.rajdhani(color: Colors.white)),
            ),
          ],
        ),
      );
    }

    final allSlots = _getValidSlots();

    // Get unique start times
    final Set<String> uniqueTimes = {};
    for (final slot in allSlots) {
      uniqueTimes.add(slot['start_time'] as String);
    }
    final sortedTimes = uniqueTimes.toList()..sort();

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Seleziona Orario',
            style: GoogleFonts.rajdhani(
              color: Colors.white,
              fontSize: 24,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Orari disponibili per ${_selectedSport} - ${DateFormat('dd/MM/yyyy').format(_selectedDate!)}',
            style: GoogleFonts.rajdhani(color: Colors.white60, fontSize: 16),
          ),
          const SizedBox(height: 24),
          if (sortedTimes.isEmpty)
            Center(
              child: Padding(
                padding: const EdgeInsets.all(40),
                child: Column(
                  children: [
                    Icon(Icons.event_busy, color: Colors.white30, size: 60),
                    const SizedBox(height: 16),
                    Text(
                      'Nessun orario disponibile per questa data',
                      style: GoogleFonts.rajdhani(color: Colors.white60, fontSize: 16),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
            )
          else
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 3,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
                childAspectRatio: 2.2,
              ),
              itemCount: sortedTimes.length,
              itemBuilder: (context, index) {
                final time = sortedTimes[index];
                final isSelected = _selectedTime == time;
                final sportColor = _getSportColor(_selectedSport);

                return GestureDetector(
                  onTap: () {
                    setState(() => _selectedTime = time);
                  },
                  child: Container(
                    decoration: BoxDecoration(
                      gradient: isSelected
                          ? LinearGradient(colors: [sportColor, sportColor.withOpacity(0.7)])
                          : null,
                      color: isSelected ? null : AppTheme.darkCard,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: isSelected ? sportColor : Colors.white24,
                        width: isSelected ? 2 : 1,
                      ),
                      boxShadow: isSelected
                          ? [BoxShadow(color: sportColor.withOpacity(0.3), blurRadius: 10)]
                          : null,
                    ),
                    child: Center(
                      child: Text(
                        time,
                        style: GoogleFonts.orbitron(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
                ).animate().scale(begin: const Offset(0.9, 0.9), duration: 200.ms, delay: Duration(milliseconds: 30 * index));
              },
            ),
          const SizedBox(height: 24),
          if (_selectedTime != null) _buildContinueButton(),
        ],
      ),
    );
  }

  // Step 4: Court Selection (courts available for selected time)
  Widget _buildCourtSelection() {
    final allSlots = _getValidSlots();

    // Filter slots for selected time
    final slotsForTime = allSlots.where((slot) => slot['start_time'] == _selectedTime).toList();

    // Sort by court name
    slotsForTime.sort((a, b) => (a['court_name'] as String).compareTo(b['court_name'] as String));

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Seleziona Campo',
            style: GoogleFonts.rajdhani(
              color: Colors.white,
              fontSize: 24,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Campi disponibili alle $_selectedTime',
            style: GoogleFonts.rajdhani(color: Colors.white60, fontSize: 16),
          ),
          const SizedBox(height: 24),
          if (slotsForTime.isEmpty)
            Center(
              child: Padding(
                padding: const EdgeInsets.all(40),
                child: Column(
                  children: [
                    Icon(Icons.sports_tennis, color: Colors.white30, size: 60),
                    const SizedBox(height: 16),
                    Text(
                      'Nessun campo disponibile per questo orario',
                      style: GoogleFonts.rajdhani(color: Colors.white60, fontSize: 16),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
            )
          else
            ...slotsForTime.asMap().entries.map((entry) {
              final index = entry.key;
              final slot = entry.value;
              final isSelected = _selectedCourtId == slot['court_id'];
              final sportColor = _getSportColor(slot['sport_type']);

              return Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: GestureDetector(
                  onTap: () {
                    setState(() {
                      _selectedSlot = slot;
                      _selectedCourtId = slot['court_id'];
                      _selectedCourtName = slot['court_name'];
                    });
                  },
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      gradient: isSelected
                          ? LinearGradient(colors: [sportColor, sportColor.withOpacity(0.7)])
                          : null,
                      color: isSelected ? null : AppTheme.darkCard,
                      borderRadius: BorderRadius.circular(15),
                      border: Border.all(
                        color: isSelected ? sportColor : Colors.white24,
                        width: isSelected ? 2 : 1,
                      ),
                      boxShadow: isSelected
                          ? [BoxShadow(color: sportColor.withOpacity(0.4), blurRadius: 20, spreadRadius: 2)]
                          : null,
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: sportColor.withOpacity(0.2),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Icon(_getSportIcon(slot['sport_type']), color: sportColor, size: 28),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                slot['court_name'],
                                style: GoogleFonts.rajdhani(
                                  color: Colors.white,
                                  fontSize: 18,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Row(
                                children: [
                                  Icon(Icons.access_time, color: Colors.white60, size: 16),
                                  const SizedBox(width: 4),
                                  Text(
                                    '${slot['start_time']} - ${slot['end_time']}',
                                    style: GoogleFonts.rajdhani(color: Colors.white60, fontSize: 14),
                                  ),
                                  const SizedBox(width: 12),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: sportColor.withOpacity(0.2),
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: Text(
                                      '${slot['duration_minutes']} min',
                                      style: GoogleFonts.rajdhani(color: sportColor, fontSize: 12, fontWeight: FontWeight.bold),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                        if (isSelected)
                          Icon(Icons.check_circle, color: sportColor, size: 28),
                      ],
                    ),
                  ),
                ),
              ).animate().slideX(begin: 0.2, duration: 300.ms, delay: Duration(milliseconds: 80 * index));
            }),
          const SizedBox(height: 24),
          if (_selectedSlot != null) _buildContinueButton(),
        ],
      ),
    );
  }

  // Step 5: User Data Form
  Widget _buildUserDataForm() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'I tuoi Dati',
              style: GoogleFonts.rajdhani(
                color: Colors.white,
                fontSize: 24,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Inserisci i tuoi dati per completare la prenotazione',
              style: GoogleFonts.rajdhani(color: Colors.white60, fontSize: 16),
            ),
            const SizedBox(height: 16),

            // Registered user check
            if (!_isRegisteredUser)
              Container(
                padding: const EdgeInsets.all(16),
                margin: const EdgeInsets.only(bottom: 20),
                decoration: BoxDecoration(
                  color: AppTheme.neonBlue.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(15),
                  border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.person_search, color: AppTheme.neonBlue),
                        const SizedBox(width: 10),
                        Text(
                          'Sei già registrato?',
                          style: GoogleFonts.rajdhani(
                            color: Colors.white,
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Inserisci la tua email per importare i tuoi dati',
                      style: GoogleFonts.rajdhani(color: Colors.white60, fontSize: 14),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: TextFormField(
                            controller: _emailController,
                            style: GoogleFonts.rajdhani(color: Colors.white),
                            keyboardType: TextInputType.emailAddress,
                            decoration: InputDecoration(
                              hintText: 'email@esempio.com',
                              hintStyle: GoogleFonts.rajdhani(color: Colors.white38),
                              filled: true,
                              fillColor: AppTheme.darkCard,
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(10),
                                borderSide: BorderSide.none,
                              ),
                              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        ElevatedButton(
                          onPressed: _isCheckingUser ? null : _checkRegisteredUser,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppTheme.neonBlue,
                            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                          ),
                          child: _isCheckingUser
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                                )
                              : Text('Verifica', style: GoogleFonts.rajdhani(color: Colors.white, fontWeight: FontWeight.bold)),
                        ),
                      ],
                    ),
                  ],
                ),
              ).animate().fadeIn(duration: 300.ms),

            if (_isRegisteredUser)
              Container(
                padding: const EdgeInsets.all(12),
                margin: const EdgeInsets.only(bottom: 20),
                decoration: BoxDecoration(
                  color: AppTheme.neonGreen.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppTheme.neonGreen.withOpacity(0.3)),
                ),
                child: Row(
                  children: [
                    Icon(Icons.check_circle, color: AppTheme.neonGreen),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Dati importati dal tuo profilo',
                        style: GoogleFonts.rajdhani(color: AppTheme.neonGreen, fontSize: 14),
                      ),
                    ),
                  ],
                ),
              ).animate().fadeIn(duration: 300.ms),

            // Form fields
            _buildTextField(
              controller: _nameController,
              label: 'Nome',
              icon: Icons.person_outline,
              validator: (value) => value?.isEmpty == true ? 'Inserisci il nome' : null,
            ),
            const SizedBox(height: 16),
            _buildTextField(
              controller: _surnameController,
              label: 'Cognome',
              icon: Icons.person_outline,
              validator: (value) => value?.isEmpty == true ? 'Inserisci il cognome' : null,
            ),
            const SizedBox(height: 16),
            if (!_isRegisteredUser) ...[
              _buildTextField(
                controller: _emailController,
                label: 'Email',
                icon: Icons.email_outlined,
                keyboardType: TextInputType.emailAddress,
                validator: (value) {
                  if (value?.isEmpty == true) return 'Inserisci l\'email';
                  // Regex per validare email
                  final emailRegex = RegExp(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$');
                  if (!emailRegex.hasMatch(value!)) return 'Formato email non valido';
                  return null;
                },
              ),
              const SizedBox(height: 16),
            ],
            _buildTextField(
              controller: _phoneController,
              label: 'Cellulare',
              icon: Icons.phone_outlined,
              keyboardType: TextInputType.phone,
              validator: (value) {
                if (value?.isEmpty == true) return 'Inserisci il cellulare';
                // Rimuovi spazi, trattini e il prefisso + per la validazione
                final cleanPhone = value!.replaceAll(RegExp(r'[\s\-\(\)]'), '');
                // Accetta numeri con prefisso internazionale (+39, +1, ecc.) o senza
                final phoneRegex = RegExp(r'^\+?[0-9]{8,15}$');
                if (!phoneRegex.hasMatch(cleanPhone)) {
                  return 'Formato cellulare non valido (8-15 cifre)';
                }
                return null;
              },
            ),
            const SizedBox(height: 24),

            // Booking summary
            _buildBookingSummary(),
            const SizedBox(height: 16),

            // Note
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.orange.withOpacity(0.1),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: Colors.orange.withOpacity(0.3)),
              ),
              child: Row(
                children: [
                  Icon(Icons.info_outline, color: Colors.orange, size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'La prenotazione dovrà essere confermata dal club',
                      style: GoogleFonts.rajdhani(color: Colors.orange, fontSize: 14),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Confirm button
            _buildConfirmButton(),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }

  Widget _buildTextField({
    required TextEditingController controller,
    required String label,
    required IconData icon,
    TextInputType? keyboardType,
    String? Function(String?)? validator,
  }) {
    return TextFormField(
      controller: controller,
      style: GoogleFonts.rajdhani(color: Colors.white, fontSize: 16),
      keyboardType: keyboardType,
      validator: validator,
      cursorColor: AppTheme.neonGreen,
      decoration: InputDecoration(
        labelText: label,
        labelStyle: GoogleFonts.rajdhani(color: Colors.white60),
        floatingLabelStyle: GoogleFonts.rajdhani(color: AppTheme.neonGreen, fontWeight: FontWeight.bold),
        prefixIcon: Icon(icon, color: AppTheme.neonBlue),
        filled: true,
        fillColor: AppTheme.darkCard,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(15),
          borderSide: const BorderSide(color: Colors.white24),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(15),
          borderSide: const BorderSide(color: Colors.white24),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(15),
          borderSide: BorderSide(color: AppTheme.neonGreen, width: 2.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(15),
          borderSide: const BorderSide(color: Colors.red),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(15),
          borderSide: const BorderSide(color: Colors.red, width: 2),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      ),
    );
  }

  Widget _buildBookingSummary() {
    final sportColor = _getSportColor(_selectedSport);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: sportColor.withOpacity(0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.receipt_long, color: sportColor),
              const SizedBox(width: 10),
              Text(
                'Riepilogo Prenotazione',
                style: GoogleFonts.rajdhani(
                  color: sportColor,
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          _buildSummaryRow(Icons.sports, _selectedSport!.toUpperCase()),
          _buildSummaryRow(Icons.calendar_today, DateFormat('EEEE dd MMMM yyyy', 'it').format(_selectedDate!)),
          _buildSummaryRow(Icons.access_time, '${_selectedSlot!['start_time']} - ${_selectedSlot!['end_time']}'),
          _buildSummaryRow(Icons.sports_tennis, _selectedCourtName ?? ''),
        ],
      ),
    ).animate().scale(begin: const Offset(0.95, 0.95), duration: 300.ms);
  }

  Widget _buildSummaryRow(IconData icon, String text) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(icon, color: Colors.white60, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              text,
              style: GoogleFonts.rajdhani(color: Colors.white, fontSize: 16),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildContinueButton() {
    return SizedBox(
      width: double.infinity,
      height: 55,
      child: ElevatedButton(
        onPressed: _goToNextStep,
        style: ElevatedButton.styleFrom(
          backgroundColor: Colors.transparent,
          shadowColor: Colors.transparent,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
          padding: EdgeInsets.zero,
        ),
        child: Ink(
          decoration: BoxDecoration(
            gradient: LinearGradient(colors: [AppTheme.neonBlue, AppTheme.neonPurple]),
            borderRadius: BorderRadius.circular(15),
          ),
          child: Container(
            alignment: Alignment.center,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  'Continua',
                  style: GoogleFonts.rajdhani(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(width: 10),
                const Icon(Icons.arrow_forward, color: Colors.white),
              ],
            ),
          ),
        ),
      ),
    ).animate().scale(begin: const Offset(0.9, 0.9), duration: 300.ms);
  }

  Widget _buildConfirmButton() {
    return SizedBox(
      width: double.infinity,
      height: 55,
      child: ElevatedButton(
        onPressed: _isBooking ? null : _bookSlot,
        style: ElevatedButton.styleFrom(
          backgroundColor: Colors.transparent,
          shadowColor: Colors.transparent,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
          padding: EdgeInsets.zero,
        ),
        child: Ink(
          decoration: BoxDecoration(
            gradient: LinearGradient(colors: [AppTheme.neonGreen, AppTheme.neonBlue]),
            borderRadius: BorderRadius.circular(15),
            boxShadow: [
              BoxShadow(color: AppTheme.neonGreen.withOpacity(0.4), blurRadius: 15, spreadRadius: 2),
            ],
          ),
          child: Container(
            alignment: Alignment.center,
            child: _isBooking
                ? const SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                  )
                : Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.check_circle, color: Colors.white),
                      const SizedBox(width: 10),
                      Text(
                        'Invia Richiesta',
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
      ),
    ).animate().scale(begin: const Offset(0.9, 0.9), duration: 300.ms);
  }

  Color _getSportColor(String? sportType) {
    switch (sportType) {
      case 'padel':
        return AppTheme.neonBlue;
      case 'tennis':
        return AppTheme.neonPurple;
      case 'calcetto':
        return AppTheme.neonGreen;
      default:
        return AppTheme.neonBlue;
    }
  }

  IconData _getSportIcon(String? sportType) {
    switch (sportType) {
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
}
