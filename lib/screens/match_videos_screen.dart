import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import '../config/app_theme.dart';
import '../models/match.dart';
import '../models/video.dart';
import '../services/database_service.dart';
import 'video_player_screen.dart';

class MatchVideosScreen extends StatefulWidget {
  final Match match;

  const MatchVideosScreen({super.key, required this.match});

  @override
  State<MatchVideosScreen> createState() => _MatchVideosScreenState();
}

class _MatchVideosScreenState extends State<MatchVideosScreen>
    with SingleTickerProviderStateMixin {
  final DatabaseService _dbService = DatabaseService();
  List<Video> _videos = [];
  List<Video> _highlights = [];
  bool _isLoading = true;
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadVideos();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadVideos() async {
    setState(() => _isLoading = true);

    final videos = await _dbService.getVideosByMatchId(widget.match.id);
    _videos = videos.where((v) => !v.isHighlight).toList();
    _highlights = videos.where((v) => v.isHighlight).toList();

    setState(() => _isLoading = false);
  }

  String _getSportIcon() {
    switch (widget.match.sportType) {
      case SportType.padel:
        return '🎾';
      case SportType.tennis:
        return '🎾';
      case SportType.soccer:
        return '⚽';
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
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              _buildHeader(),
              _buildMatchInfo(),
              _buildTabBar(),
              Expanded(
                child: TabBarView(
                  controller: _tabController,
                  children: [
                    _buildVideosList(_videos),
                    _buildVideosList(_highlights),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Row(
        children: [
          IconButton(
            icon: Icon(Icons.arrow_back, color: AppTheme.neonBlue),
            onPressed: () => Navigator.pop(context),
          ),
          Expanded(
            child: Text(
              'I Tuoi Video',
              textAlign: TextAlign.center,
              style: GoogleFonts.orbitron(
                fontSize: 24,
                fontWeight: FontWeight.bold,
                color: AppTheme.neonBlue,
              ),
            ),
          ),
          const SizedBox(width: 48),
        ],
      ).animate().fadeIn(),
    );
  }

  Widget _buildMatchInfo() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [AppTheme.neonBlue, AppTheme.neonPurple],
        ),
        borderRadius: BorderRadius.circular(20),
        boxShadow: AppTheme.neonGlow(AppTheme.neonBlue),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Text(
                    _getSportIcon(),
                    style: const TextStyle(fontSize: 32),
                  ),
                  const SizedBox(width: 12),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.match.sportType.name.toUpperCase(),
                        style: GoogleFonts.orbitron(
                          fontSize: 20,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                      ),
                      Text(
                        widget.match.location,
                        style: GoogleFonts.roboto(
                          fontSize: 14,
                          color: Colors.white70,
                        ),
                      ),
                      const SizedBox(height: 4),
                      GestureDetector(
                        onTap: () {
                          Clipboard.setData(ClipboardData(text: widget.match.bookingCode));
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text('Codice ${widget.match.bookingCode} copiato!'),
                              backgroundColor: AppTheme.neonBlue,
                              duration: const Duration(seconds: 2),
                            ),
                          );
                        },
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              widget.match.bookingCode,
                              style: GoogleFonts.robotoMono(
                                fontSize: 13,
                                color: Colors.white,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Icon(
                              Icons.copy,
                              size: 14,
                              color: Colors.white70,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  DateFormat('dd/MM/yyyy').format(widget.match.matchDate),
                  style: GoogleFonts.roboto(
                    fontSize: 12,
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _buildStatItem(
                Icons.videocam,
                '${_videos.length}',
                'Video',
              ),
              Container(
                width: 1,
                height: 30,
                color: Colors.white30,
              ),
              _buildStatItem(
                Icons.auto_awesome,
                '${_highlights.length}',
                'Highlights',
              ),
              Container(
                width: 1,
                height: 30,
                color: Colors.white30,
              ),
              _buildStatItem(
                Icons.people,
                '${widget.match.playerIds.length}',
                'Giocatori',
              ),
            ],
          ),
        ],
      ),
    ).animate().slideY(begin: -0.3, duration: 600.ms);
  }

  Widget _buildStatItem(IconData icon, String value, String label) {
    return Column(
      children: [
        Row(
          children: [
            Icon(icon, color: Colors.white, size: 20),
            const SizedBox(width: 4),
            Text(
              value,
              style: GoogleFonts.rajdhani(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: Colors.white,
              ),
            ),
          ],
        ),
        Text(
          label,
          style: GoogleFonts.roboto(
            fontSize: 12,
            color: Colors.white70,
          ),
        ),
      ],
    );
  }

  Widget _buildTabBar() {
    return Container(
      margin: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
      ),
      child: TabBar(
        controller: _tabController,
        indicatorSize: TabBarIndicatorSize.tab,
        indicator: BoxDecoration(
          gradient: LinearGradient(
            colors: [AppTheme.neonBlue, AppTheme.neonPurple],
          ),
          borderRadius: BorderRadius.circular(15),
        ),
        labelStyle: GoogleFonts.rajdhani(
          fontSize: 16,
          fontWeight: FontWeight.bold,
        ),
        unselectedLabelColor: Colors.white60,
        labelColor: Colors.white,
        tabs: const [
          Tab(text: 'MATCH COMPLETO'),
          Tab(text: 'HIGHLIGHTS'),
        ],
      ),
    ).animate().fadeIn(delay: 300.ms);
  }

  Widget _buildVideosList(List<Video> videos) {
    if (_isLoading) {
      return Center(
        child: CircularProgressIndicator(color: AppTheme.neonBlue),
      );
    }

    if (videos.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.videocam_off,
              size: 80,
              color: Colors.white30,
            ),
            const SizedBox(height: 20),
            Text(
              'Nessun video disponibile',
              style: GoogleFonts.roboto(
                fontSize: 18,
                color: Colors.white60,
              ),
            ),
          ],
        ).animate().fadeIn(),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: videos.length,
      itemBuilder: (context, index) {
        return _buildVideoCard(videos[index], index);
      },
    );
  }

  Widget _buildVideoCard(Video video, int index) {
    return GestureDetector(
      onTap: () => _openVideo(video),
      child: Container(
        margin: const EdgeInsets.only(bottom: 16),
        decoration: BoxDecoration(
          color: AppTheme.darkCard,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: AppTheme.neonBlue.withOpacity(0.3),
          ),
          boxShadow: [
            BoxShadow(
              color: AppTheme.neonBlue.withOpacity(0.1),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Thumbnail
            ClipRRect(
              borderRadius:
                  const BorderRadius.vertical(top: Radius.circular(20)),
              child: Stack(
                children: [
                  Container(
                    height: 200,
                    width: double.infinity,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [
                          AppTheme.neonBlue.withOpacity(0.3),
                          AppTheme.neonPurple.withOpacity(0.3),
                        ],
                      ),
                    ),
                    child: Icon(
                      Icons.play_circle_outline,
                      size: 80,
                      color: Colors.white.withOpacity(0.7),
                    ),
                  ),
                  Positioned(
                    top: 12,
                    right: 12,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.black.withOpacity(0.7),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        video.formattedDuration,
                        style: GoogleFonts.roboto(
                          fontSize: 12,
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
                  if (video.isHighlight)
                    Positioned(
                      top: 12,
                      left: 12,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [AppTheme.neonYellow, AppTheme.neonPink],
                          ),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Row(
                          children: [
                            const Icon(
                              Icons.auto_awesome,
                              size: 14,
                              color: Colors.white,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              'HIGHLIGHT',
                              style: GoogleFonts.rajdhani(
                                fontSize: 12,
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),

            // Video info
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    video.title,
                    style: GoogleFonts.rajdhani(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Icon(
                        Icons.calendar_today,
                        size: 14,
                        color: AppTheme.neonBlue,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        DateFormat('dd/MM/yyyy HH:mm')
                            .format(video.recordedAt),
                        style: GoogleFonts.roboto(
                          fontSize: 14,
                          color: Colors.white60,
                        ),
                      ),
                      const Spacer(),
                      Icon(
                        Icons.storage,
                        size: 14,
                        color: AppTheme.neonPurple,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        video.formattedFileSize,
                        style: GoogleFonts.roboto(
                          fontSize: 14,
                          color: Colors.white60,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      _buildStatBadge(
                        Icons.visibility,
                        '${video.viewCount}',
                        AppTheme.neonBlue,
                      ),
                      const SizedBox(width: 12),
                      _buildStatBadge(
                        Icons.download,
                        '${video.downloadCount}',
                        AppTheme.neonPurple,
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    )
        .animate()
        .fadeIn(delay: (100 * index).ms)
        .slideY(begin: 0.2, duration: 400.ms);
  }

  Widget _buildStatBadge(IconData icon, String value, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withOpacity(0.2),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withOpacity(0.5)),
      ),
      child: Row(
        children: [
          Icon(icon, size: 16, color: color),
          const SizedBox(width: 4),
          Text(
            value,
            style: GoogleFonts.roboto(
              fontSize: 12,
              color: color,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }

  void _openVideo(Video video) {
    Navigator.of(context).push(
      PageRouteBuilder(
        pageBuilder: (context, animation, secondaryAnimation) =>
            VideoPlayerScreen(video: video),
        transitionsBuilder: (context, animation, secondaryAnimation, child) {
          return FadeTransition(opacity: animation, child: child);
        },
      ),
    );
  }
}
