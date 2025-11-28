import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import '../config/app_theme.dart';
import '../services/notification_service.dart';

class NotificationsScreen extends StatefulWidget {
  final VoidCallback? onNotificationRead;

  const NotificationsScreen({
    super.key,
    this.onNotificationRead,
  });

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  final NotificationService _notificationService = NotificationService();
  List<Map<String, dynamic>> _notifications = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadNotifications();
  }

  Future<void> _loadNotifications() async {
    setState(() => _isLoading = true);
    try {
      final notifications = await _notificationService.fetchAndScheduleNotifications();
      setState(() {
        _notifications = notifications;
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
      debugPrint('Error loading notifications: $e');
    }
  }

  Future<void> _markAsRead(int notificationId) async {
    // Optimistic update - update UI immediately
    setState(() {
      final index = _notifications.indexWhere((n) => n['id'] == notificationId);
      if (index != -1) {
        _notifications[index]['read_at'] = DateTime.now().toIso8601String();
      }
    });
    widget.onNotificationRead?.call();

    // Sync with backend in background
    _notificationService.markAsRead(notificationId);
    _notificationService.updateBadgeCount();
  }

  Future<void> _dismissNotification(int notificationId) async {
    // Optimistic update - remove from UI immediately
    setState(() {
      _notifications.removeWhere((n) => n['id'] == notificationId);
    });
    widget.onNotificationRead?.call();

    // Sync with backend in background
    _notificationService.dismissNotification(notificationId);
    _notificationService.updateBadgeCount();
  }

  Future<void> _markAllAsRead() async {
    // Optimistic update - mark all as read immediately
    setState(() {
      for (var notif in _notifications) {
        if (notif['read_at'] == null) {
          notif['read_at'] = DateTime.now().toIso8601String();
        }
      }
    });
    widget.onNotificationRead?.call();

    // Sync with backend in background
    for (final notif in _notifications) {
      _notificationService.markAsRead(notif['id']);
    }
    _notificationService.updateBadgeCount();
  }

  IconData _getNotificationIcon(String type) {
    switch (type) {
      case 'booking_confirmed':
        return Icons.check_circle_outline;
      case 'booking_reminder':
        return Icons.alarm;
      case 'booking_cancelled':
        return Icons.cancel_outlined;
      case 'video_ready':
        return Icons.videocam;
      default:
        return Icons.notifications;
    }
  }

  Color _getNotificationColor(String type) {
    switch (type) {
      case 'booking_confirmed':
        return AppTheme.neonGreen;
      case 'booking_reminder':
        return AppTheme.neonBlue;
      case 'booking_cancelled':
        return Colors.redAccent;
      case 'video_ready':
        return AppTheme.neonPurple;
      default:
        return AppTheme.neonPink;
    }
  }

  String _formatDate(String? dateString) {
    if (dateString == null) return '';
    try {
      final date = DateTime.parse(dateString);
      final now = DateTime.now();
      final diff = now.difference(date);

      if (diff.inMinutes < 1) {
        return 'Adesso';
      } else if (diff.inMinutes < 60) {
        return '${diff.inMinutes} min fa';
      } else if (diff.inHours < 24) {
        return '${diff.inHours} ore fa';
      } else if (diff.inDays < 7) {
        return '${diff.inDays} giorni fa';
      } else {
        return DateFormat('dd/MM/yyyy HH:mm').format(date);
      }
    } catch (e) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final unreadCount = _notifications.where((n) => n['read_at'] == null).length;

    return Scaffold(
      backgroundColor: AppTheme.darkBg,
      appBar: AppBar(
        backgroundColor: AppTheme.darkCard,
        title: Text(
          'Notifiche',
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
        actions: [
          if (unreadCount > 0)
            TextButton(
              onPressed: _markAllAsRead,
              child: Text(
                'Leggi tutto',
                style: GoogleFonts.rajdhani(
                  color: AppTheme.neonBlue,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
        ],
      ),
      body: _isLoading
          ? const Center(
              child: CircularProgressIndicator(color: AppTheme.neonPink),
            )
          : _notifications.isEmpty
              ? _buildEmptyState()
              : RefreshIndicator(
                  onRefresh: _loadNotifications,
                  color: AppTheme.neonPink,
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _notifications.length,
                    itemBuilder: (context, index) {
                      final notif = _notifications[index];
                      return _buildNotificationCard(notif);
                    },
                  ),
                ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.notifications_off_outlined,
            size: 80,
            color: Colors.white24,
          ),
          const SizedBox(height: 16),
          Text(
            'Nessuna notifica',
            style: GoogleFonts.rajdhani(
              fontSize: 20,
              color: Colors.white54,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Riceverai notifiche per le tue prenotazioni',
            style: GoogleFonts.roboto(
              fontSize: 14,
              color: Colors.white38,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNotificationCard(Map<String, dynamic> notif) {
    final isRead = notif['read_at'] != null;
    final type = notif['type'] ?? 'info';
    final color = _getNotificationColor(type);
    final icon = _getNotificationIcon(type);

    return Dismissible(
      key: Key('notif_${notif['id']}'),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        margin: const EdgeInsets.only(bottom: 12),
        decoration: BoxDecoration(
          color: Colors.red.withOpacity(0.3),
          borderRadius: BorderRadius.circular(15),
        ),
        child: const Icon(
          Icons.delete_outline,
          color: Colors.red,
          size: 28,
        ),
      ),
      onDismissed: (_) => _dismissNotification(notif['id']),
      child: GestureDetector(
        onTap: () {
          if (!isRead) {
            _markAsRead(notif['id']);
          }
        },
        child: Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: isRead ? AppTheme.darkCard : AppTheme.darkCard.withOpacity(0.9),
            borderRadius: BorderRadius.circular(15),
            border: Border.all(
              color: isRead ? Colors.transparent : color.withOpacity(0.5),
              width: isRead ? 0 : 1,
            ),
            boxShadow: isRead
                ? null
                : [
                    BoxShadow(
                      color: color.withOpacity(0.2),
                      blurRadius: 10,
                      spreadRadius: 1,
                    ),
                  ],
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  icon,
                  color: color,
                  size: 24,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            notif['title'] ?? 'Notifica',
                            style: GoogleFonts.rajdhani(
                              fontSize: 16,
                              fontWeight: isRead ? FontWeight.w500 : FontWeight.bold,
                              color: isRead ? Colors.white70 : Colors.white,
                            ),
                          ),
                        ),
                        if (!isRead)
                          Container(
                            width: 8,
                            height: 8,
                            decoration: BoxDecoration(
                              color: color,
                              shape: BoxShape.circle,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      notif['message'] ?? '',
                      style: GoogleFonts.roboto(
                        fontSize: 14,
                        color: isRead ? Colors.white38 : Colors.white60,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _formatDate(notif['created_at']),
                      style: GoogleFonts.roboto(
                        fontSize: 12,
                        color: Colors.white30,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
