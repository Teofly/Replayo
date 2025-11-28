import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter_app_badger/flutter_app_badger.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/timezone.dart' as tz;
import 'package:timezone/data/latest.dart' as tz_data;
import 'user_auth_service.dart';

class NotificationService {
  static final NotificationService _instance = NotificationService._internal();
  factory NotificationService() => _instance;
  NotificationService._internal();

  final FlutterLocalNotificationsPlugin _localNotifications =
      FlutterLocalNotificationsPlugin();

  bool _isInitialized = false;

  // API Base URL
  static const String _baseUrl = 'https://api.teofly.it';

  /// Initialize the notification service
  Future<void> initialize() async {
    if (_isInitialized) return;

    // Initialize timezone
    tz_data.initializeTimeZones();
    tz.setLocalLocation(tz.getLocation('Europe/Rome'));

    // Initialize local notifications
    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosSettings = DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: true,
      requestSoundPermission: true,
    );

    const initSettings = InitializationSettings(
      android: androidSettings,
      iOS: iosSettings,
    );

    await _localNotifications.initialize(
      initSettings,
      onDidReceiveNotificationResponse: _onNotificationTapped,
    );

    _isInitialized = true;
    debugPrint('[NotificationService] Initialized');
  }

  /// Request notification permissions (iOS)
  Future<bool> requestPermissions() async {
    if (Platform.isIOS) {
      final result = await _localNotifications
          .resolvePlatformSpecificImplementation<
              IOSFlutterLocalNotificationsPlugin>()
          ?.requestPermissions(
            alert: true,
            badge: true,
            sound: true,
          );
      return result ?? false;
    }
    return true;
  }

  /// Handle notification tap
  void _onNotificationTapped(NotificationResponse response) {
    debugPrint('[NotificationService] Notification tapped: ${response.payload}');
    // TODO: Navigate to relevant screen based on payload
  }

  /// Fetch notifications from backend and schedule local reminders
  Future<List<Map<String, dynamic>>> fetchAndScheduleNotifications({bool isRetry = false}) async {
    try {
      // Use UserAuthService for token - it's a singleton and always has the latest token
      final authService = UserAuthService();
      final token = authService.accessToken;

      debugPrint('[NotificationService] Token found: ${token != null ? "YES (${token.length > 20 ? token.substring(0, 20) : token}...)" : "NO"}');

      if (token == null) {
        debugPrint('[NotificationService] No auth token, skipping fetch');
        return [];
      }

      debugPrint('[NotificationService] Fetching from $_baseUrl/api/notifications');
      final response = await http.get(
        Uri.parse('$_baseUrl/api/notifications'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      );

      debugPrint('[NotificationService] Response status: ${response.statusCode}');
      debugPrint('[NotificationService] Response body: ${response.body.substring(0, response.body.length > 200 ? 200 : response.body.length)}');

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final notifications = List<Map<String, dynamic>>.from(data['notifications'] ?? []);
        debugPrint('[NotificationService] Parsed ${notifications.length} notifications');

        // Schedule local notifications for upcoming reminders
        for (final notif in notifications) {
          if (notif['type'] == 'booking_reminder' && notif['scheduled_at'] != null) {
            final scheduledAt = DateTime.parse(notif['scheduled_at']);
            if (scheduledAt.isAfter(DateTime.now())) {
              await scheduleLocalNotification(
                id: notif['id'],
                title: notif['title'],
                body: notif['message'],
                scheduledDate: scheduledAt,
                payload: json.encode(notif),
              );
            }
          }
        }

        debugPrint('[NotificationService] Fetched ${notifications.length} notifications');
        return notifications;
      } else if (response.statusCode == 401 && !isRetry) {
        // Token expired - try to refresh
        debugPrint('[NotificationService] Token expired, attempting refresh...');
        final refreshed = await authService.refreshAccessToken();
        if (refreshed) {
          debugPrint('[NotificationService] Token refreshed, retrying fetch...');
          return fetchAndScheduleNotifications(isRetry: true);
        } else {
          debugPrint('[NotificationService] Token refresh failed');
          return [];
        }
      } else if (response.statusCode == 401) {
        debugPrint('[NotificationService] Token still invalid after refresh');
        return [];
      } else {
        debugPrint('[NotificationService] Error: ${response.statusCode}');
        return [];
      }
    } catch (e) {
      debugPrint('[NotificationService] Error fetching notifications: $e');
      return [];
    }
  }

  /// Schedule a local notification for a specific date/time
  Future<void> scheduleLocalNotification({
    required int id,
    required String title,
    required String body,
    required DateTime scheduledDate,
    String? payload,
  }) async {
    try {
      final tzScheduledDate = tz.TZDateTime.from(scheduledDate, tz.local);

      // Don't schedule if it's in the past
      if (tzScheduledDate.isBefore(tz.TZDateTime.now(tz.local))) {
        debugPrint('[NotificationService] Skipping past notification: $id');
        return;
      }

      const androidDetails = AndroidNotificationDetails(
        'replayo_reminders',
        'Promemoria Partite',
        channelDescription: 'Notifiche per ricordare le partite prenotate',
        importance: Importance.high,
        priority: Priority.high,
        icon: '@mipmap/ic_launcher',
      );

      const iosDetails = DarwinNotificationDetails(
        presentAlert: true,
        presentBadge: true,
        presentSound: true,
      );

      const notificationDetails = NotificationDetails(
        android: androidDetails,
        iOS: iosDetails,
      );

      await _localNotifications.zonedSchedule(
        id,
        title,
        body,
        tzScheduledDate,
        notificationDetails,
        androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
        uiLocalNotificationDateInterpretation:
            UILocalNotificationDateInterpretation.absoluteTime,
        payload: payload,
      );

      debugPrint('[NotificationService] Scheduled notification $id for $scheduledDate');
    } catch (e) {
      debugPrint('[NotificationService] Error scheduling notification: $e');
    }
  }

  /// Show an immediate local notification
  Future<void> showLocalNotification({
    required int id,
    required String title,
    required String body,
    String? payload,
  }) async {
    const androidDetails = AndroidNotificationDetails(
      'replayo_instant',
      'Notifiche RePlayo',
      channelDescription: 'Notifiche immediate da RePlayo',
      importance: Importance.high,
      priority: Priority.high,
      icon: '@mipmap/ic_launcher',
    );

    const iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
    );

    const notificationDetails = NotificationDetails(
      android: androidDetails,
      iOS: iosDetails,
    );

    await _localNotifications.show(id, title, body, notificationDetails, payload: payload);
  }

  /// Cancel a scheduled notification
  Future<void> cancelNotification(int id) async {
    await _localNotifications.cancel(id);
    debugPrint('[NotificationService] Cancelled notification $id');
  }

  /// Cancel all scheduled notifications
  Future<void> cancelAllNotifications() async {
    await _localNotifications.cancelAll();
    debugPrint('[NotificationService] Cancelled all notifications');
  }

  /// Mark notification as read on backend
  Future<void> markAsRead(int notificationId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('accessToken');
      if (token == null) return;

      await http.put(
        Uri.parse('$_baseUrl/api/notifications/$notificationId/read'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      );
    } catch (e) {
      debugPrint('[NotificationService] Error marking as read: $e');
    }
  }

  /// Dismiss notification on backend
  Future<void> dismissNotification(int notificationId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('accessToken');
      if (token == null) return;

      await http.put(
        Uri.parse('$_baseUrl/api/notifications/$notificationId/dismiss'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      );

      // Also cancel any local scheduled notification
      await cancelNotification(notificationId);
    } catch (e) {
      debugPrint('[NotificationService] Error dismissing: $e');
    }
  }

  /// Get unread notification count
  Future<int> getUnreadCount() async {
    final notifications = await fetchAndScheduleNotifications();
    return notifications.where((n) => n['read_at'] == null).length;
  }

  /// Update app badge with unread notification count
  Future<void> updateBadgeCount() async {
    try {
      // Check if badge is supported on this device
      final isSupported = await FlutterAppBadger.isAppBadgeSupported();
      if (!isSupported) {
        debugPrint('[NotificationService] Badge not supported on this device');
        return;
      }

      final unreadCount = await getUnreadCount();
      if (unreadCount > 0) {
        await FlutterAppBadger.updateBadgeCount(unreadCount);
        debugPrint('[NotificationService] Badge updated to $unreadCount');
      } else {
        await FlutterAppBadger.removeBadge();
        debugPrint('[NotificationService] Badge removed');
      }
    } catch (e) {
      debugPrint('[NotificationService] Error updating badge: $e');
    }
  }

  /// Clear app badge
  Future<void> clearBadge() async {
    try {
      await FlutterAppBadger.removeBadge();
      debugPrint('[NotificationService] Badge cleared');
    } catch (e) {
      debugPrint('[NotificationService] Error clearing badge: $e');
    }
  }

  /// Fetch notifications and update badge in one call
  Future<List<Map<String, dynamic>>> fetchNotificationsAndUpdateBadge({bool isRetry = false}) async {
    final notifications = await fetchAndScheduleNotifications(isRetry: isRetry);
    await updateBadgeCount();
    return notifications;
  }
}
