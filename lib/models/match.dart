enum SportType {
  padel,
  tennis,
  soccer,
  calcetto,
}

class Match {
  final String id;
  final String bookingCode;
  final SportType sportType;
  final DateTime matchDate;
  final String location;
  final List<String> playerIds;
  final String? accessPassword;
  final DateTime? passwordExpiry;
  final bool isActive;
  final DateTime createdAt;

  Match({
    required this.id,
    required this.bookingCode,
    required this.sportType,
    required this.matchDate,
    required this.location,
    required this.playerIds,
    this.accessPassword,
    this.passwordExpiry,
    this.isActive = true,
    required this.createdAt,
  });

  factory Match.fromMap(Map<String, dynamic> map) {
    return Match(
      id: map['id'] as String,
      bookingCode: map['booking_code'] as String,
      sportType: SportType.values.firstWhere(
        (e) => e.name == map['sport_type'],
        orElse: () => SportType.soccer,
      ),
      matchDate: DateTime.parse(map['match_date'] as String),
      location: map['location'] as String,
      playerIds: (map['player_ids'] as List<dynamic>).cast<String>(),
      accessPassword: map['access_password'] as String?,
      passwordExpiry: map['password_expiry'] != null
          ? DateTime.parse(map['password_expiry'] as String)
          : null,
      isActive: map['is_active'] as bool,
      createdAt: DateTime.parse(map['created_at'] as String),
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'booking_code': bookingCode,
      'sport_type': sportType.name,
      'match_date': matchDate.toIso8601String(),
      'location': location,
      'player_ids': playerIds,
      'access_password': accessPassword,
      'password_expiry': passwordExpiry?.toIso8601String(),
      'is_active': isActive,
      'created_at': createdAt.toIso8601String(),
    };
  }

  bool isPasswordValid() {
    if (passwordExpiry == null) return true;
    return DateTime.now().isBefore(passwordExpiry!);
  }
}
