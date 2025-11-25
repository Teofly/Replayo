// Stub for QR Code Scanner on Web platform
// This file is used when compiling for web to avoid importing native-only packages

import 'package:flutter/material.dart';
import 'dart:async';

class Barcode {
  final String? code;
  const Barcode(this.code);
}

class QRViewController {
  final Stream<Barcode> scannedDataStream = const Stream.empty();

  void dispose() {}
  void pauseCamera() {}
  void resumeCamera() {}
}

class QRView extends StatelessWidget {
  final Function(QRViewController) onQRViewCreated;
  final Widget? overlay;

  const QRView({
    Key? key,
    required this.onQRViewCreated,
    this.overlay,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.black,
      child: const Center(
        child: Text(
          'QR Scanner not available on web',
          style: TextStyle(color: Colors.white),
        ),
      ),
    );
  }
}

class QrScannerOverlayShape extends StatelessWidget {
  final Color? borderColor;
  final double? borderRadius;
  final double? borderLength;
  final double? borderWidth;
  final double? cutOutSize;
  final double? cutOutBottomOffset;
  final Color? overlayColor;

  const QrScannerOverlayShape({
    Key? key,
    this.borderColor,
    this.borderRadius,
    this.borderLength,
    this.borderWidth,
    this.cutOutSize,
    this.cutOutBottomOffset,
    this.overlayColor,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return const SizedBox.shrink();
  }
}
