import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:chewie/chewie.dart';
import 'package:video_player/video_player.dart' as vp;
import 'package:google_fonts/google_fonts.dart';
import 'package:share_plus/share_plus.dart';
import '../config/app_theme.dart';
import '../models/video.dart';
import '../services/database_service.dart';
import '../services/api_service.dart';
import '../config/database_config.dart';

class VideoPlayerScreen extends StatefulWidget {
  final Video video;

  const VideoPlayerScreen({super.key, required this.video});

  @override
  State<VideoPlayerScreen> createState() => _VideoPlayerScreenState();
}

class _VideoPlayerScreenState extends State<VideoPlayerScreen> {
  late vp.VideoPlayerController _videoController;
  ChewieController? _chewieController;
  final DatabaseService _dbService = DatabaseService();
  bool _isLoading = true;
  bool _hasError = false;
  String _errorMessage = '';
  bool _isDownloading = false;
  double _downloadProgress = 0.0;

  @override
  void initState() {
    super.initState();
    _initializePlayer();
    _incrementViewCount();
    SystemChrome.setPreferredOrientations([
      DeviceOrientation.portraitUp,
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]);
  }

  @override
  void dispose() {
    _videoController.dispose();
    _chewieController?.dispose();
    SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
    super.dispose();
  }

  Future<void> _initializePlayer() async {
    try {
      // Build streaming URL from API
      final streamUrl = '${ApiService.baseUrl}/videos/${widget.video.id}/stream';
      print('Loading video from: $streamUrl');

      _videoController = vp.VideoPlayerController.networkUrl(
        Uri.parse(streamUrl),
      );

      await _videoController.initialize();

      _chewieController = ChewieController(
        videoPlayerController: _videoController,
        autoPlay: true,
        looping: false,
        allowFullScreen: true,
        allowMuting: true,
        showControls: true,
        placeholder: Container(
          color: AppTheme.darkBg,
          child: Center(
            child: CircularProgressIndicator(color: AppTheme.neonBlue),
          ),
        ),
        materialProgressColors: ChewieProgressColors(
          playedColor: AppTheme.neonBlue,
          handleColor: AppTheme.neonPink,
          backgroundColor: Colors.white30,
          bufferedColor: AppTheme.neonPurple.withOpacity(0.5),
        ),
      );

      setState(() {
        _isLoading = false;
        _hasError = false;
      });
    } catch (e) {
      setState(() {
        _isLoading = false;
        _hasError = true;
        _errorMessage = 'Errore caricamento video: ${e.toString()}';
      });
    }
  }

  Future<void> _incrementViewCount() async {
    await _dbService.incrementVideoViewCount(widget.video.id);
  }

  Future<void> _downloadVideo() async {
    setState(() {
      _isDownloading = true;
      _downloadProgress = 0.0;
    });

    try {
      // Simulate download progress
      for (int i = 0; i <= 100; i += 10) {
        await Future.delayed(const Duration(milliseconds: 200));
        setState(() => _downloadProgress = i / 100);
      }

      await _dbService.incrementVideoDownloadCount(widget.video.id);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Video scaricato con successo!',
              style: GoogleFonts.roboto(color: Colors.white),
            ),
            backgroundColor: AppTheme.neonGreen,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(10),
            ),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Errore download: ${e.toString()}',
              style: GoogleFonts.roboto(color: Colors.white),
            ),
            backgroundColor: AppTheme.neonPink,
          ),
        );
      }
    } finally {
      setState(() {
        _isDownloading = false;
        _downloadProgress = 0.0;
      });
    }
  }

  Future<void> _shareVideo() async {
    try {
      final text =
          'Guarda il video della mia partita: ${widget.video.title}\n\nScarica RePlayo per vedere i tuoi video!';

      await Share.share(
        text,
        subject: 'RePlayo - ${widget.video.title}',
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Errore condivisione: ${e.toString()}',
              style: GoogleFonts.roboto(color: Colors.white),
            ),
            backgroundColor: AppTheme.neonPink,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(),
            Expanded(
              child: _isLoading
                  ? _buildLoadingState()
                  : _hasError
                      ? _buildErrorState()
                      : _buildPlayer(),
            ),
            if (!_isLoading && !_hasError) _buildControls(),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.all(16),
      color: AppTheme.darkCard,
      child: Row(
        children: [
          IconButton(
            icon: Icon(Icons.arrow_back, color: AppTheme.neonBlue),
            onPressed: () => Navigator.pop(context),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  widget.video.title,
                  style: GoogleFonts.rajdhani(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  widget.video.formattedDuration,
                  style: GoogleFonts.roboto(
                    fontSize: 12,
                    color: AppTheme.neonBlue,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLoadingState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          CircularProgressIndicator(color: AppTheme.neonBlue),
          const SizedBox(height: 20),
          Text(
            'Caricamento video...',
            style: GoogleFonts.roboto(
              color: Colors.white70,
              fontSize: 16,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.error_outline,
              size: 80,
              color: AppTheme.neonPink,
            ),
            const SizedBox(height: 20),
            Text(
              'Errore',
              style: GoogleFonts.orbitron(
                fontSize: 24,
                fontWeight: FontWeight.bold,
                color: AppTheme.neonPink,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              _errorMessage,
              textAlign: TextAlign.center,
              style: GoogleFonts.roboto(
                color: Colors.white70,
                fontSize: 14,
              ),
            ),
            const SizedBox(height: 30),
            ElevatedButton(
              onPressed: () {
                setState(() {
                  _isLoading = true;
                  _hasError = false;
                });
                _initializePlayer();
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.neonBlue,
                foregroundColor: Colors.white,
              ),
              child: Text(
                'RIPROVA',
                style: GoogleFonts.rajdhani(fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPlayer() {
    if (_chewieController == null) {
      return const SizedBox.shrink();
    }

    return Center(
      child: AspectRatio(
        aspectRatio: _videoController.value.aspectRatio,
        child: Chewie(controller: _chewieController!),
      ),
    );
  }

  Widget _buildControls() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        border: Border(
          top: BorderSide(
            color: AppTheme.neonBlue.withOpacity(0.3),
            width: 1,
          ),
        ),
      ),
      child: Column(
        children: [
          if (_isDownloading)
            Column(
              children: [
                LinearProgressIndicator(
                  value: _downloadProgress,
                  backgroundColor: AppTheme.neonBlue.withOpacity(0.2),
                  valueColor: AlwaysStoppedAnimation<Color>(AppTheme.neonBlue),
                ),
                const SizedBox(height: 8),
                Text(
                  'Download: ${(_downloadProgress * 100).toInt()}%',
                  style: GoogleFonts.roboto(
                    color: AppTheme.neonBlue,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 16),
              ],
            ),
          Row(
            children: [
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: _isDownloading ? null : _downloadVideo,
                  icon: Icon(
                    _isDownloading ? Icons.downloading : Icons.download,
                  ),
                  label: Text(
                    _isDownloading ? 'SCARICAMENTO...' : 'SCARICA',
                    style: GoogleFonts.rajdhani(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 1,
                    ),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.neonBlue,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(15),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              ElevatedButton(
                onPressed: _shareVideo,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.neonPurple,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.all(16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(15),
                  ),
                ),
                child: const Icon(Icons.share, size: 24),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _buildStatDisplay(
                Icons.visibility,
                '${widget.video.viewCount}',
                'Visualizzazioni',
                AppTheme.neonBlue,
              ),
              _buildStatDisplay(
                Icons.download,
                '${widget.video.downloadCount}',
                'Download',
                AppTheme.neonPurple,
              ),
              _buildStatDisplay(
                Icons.storage,
                widget.video.formattedFileSize,
                'Dimensione',
                AppTheme.neonPink,
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStatDisplay(
      IconData icon, String value, String label, Color color) {
    return Column(
      children: [
        Icon(icon, color: color, size: 20),
        const SizedBox(height: 4),
        Text(
          value,
          style: GoogleFonts.rajdhani(
            fontSize: 16,
            fontWeight: FontWeight.bold,
            color: Colors.white,
          ),
        ),
        Text(
          label,
          style: GoogleFonts.roboto(
            fontSize: 10,
            color: Colors.white60,
          ),
        ),
      ],
    );
  }
}
