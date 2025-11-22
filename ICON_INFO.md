# Icona App Integrata

## Stato Attuale
L'icona RePlayo.icns è stata copiata in:
- `macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_1024.png`

## Per completare l'integrazione su tutte le piattaforme:

### 1. Genera icone per tutte le dimensioni

Usa un tool online o ImageMagick:

```bash
# Installa ImageMagick se necessario
brew install imagemagick

# Converti ICNS in PNG
# (L'icona è già in formato icns, estraila)
```

### 2. Android
Sostituisci i file in:
- `android/app/src/main/res/mipmap-hdpi/ic_launcher.png` (72x72)
- `android/app/src/main/res/mipmap-mdpi/ic_launcher.png` (48x48)
- `android/app/src/main/res/mipmap-xhdpi/ic_launcher.png` (96x96)
- `android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png` (144x144)
- `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` (192x192)

### 3. iOS
L'icona deve essere in:
- `ios/Runner/Assets.xcassets/AppIcon.appiconset/`
Con vari formati (20x20, 29x29, 40x40, 60x60, 76x76, 83.5x83.5, 1024x1024)

### 4. Web
- `web/icons/Icon-192.png`
- `web/icons/Icon-512.png`
- `web/icons/Icon-maskable-192.png`
- `web/icons/Icon-maskable-512.png`

### 5. Tool Automatico (CONSIGLIATO)

Usa il plugin `flutter_launcher_icons`:

```yaml
# In pubspec.yaml aggiungi:
dev_dependencies:
  flutter_launcher_icons: ^0.13.1

flutter_launcher_icons:
  android: true
  ios: true
  image_path: "assets/icon/replayo_icon.png"
  web:
    generate: true
    image_path: "assets/icon/replayo_icon.png"
  windows:
    generate: true
    image_path: "assets/icon/replayo_icon.png"
  macos:
    generate: true
    image_path: "assets/icon/replayo_icon.png"
```

Poi esegui:
```bash
flutter pub get
flutter pub run flutter_launcher_icons
```

## Icona attuale
L'icona è disponibile in: `/Users/Teofly/Downloads/RePlayo.icns`

Per ora è configurata solo per macOS. Per le altre piattaforme
serve convertirla in PNG alle dimensioni corrette.
