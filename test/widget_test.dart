import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:replayo/main.dart';

void main() {
  testWidgets('App loads splash screen', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(const RePlayoApp());

    // Verify that splash screen is shown
    expect(find.text('RePlayo'), findsOneWidget);
  });
}
