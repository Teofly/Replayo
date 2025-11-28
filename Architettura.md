architettura APP Replayo

directory: '/Users/Teofly/Library/Mobile Documents/com~apple~CloudDocs/Documents/Programmi/RePlayo'
app multipiattaforma sviluppata in Flutter/dart
app web gira su server: 192.168.1.175 user:teofly pwd:druido indirizzo internet replayo.teofly.it
sul server ci sono anche teofly.it e tunnelcamp.it che sono indipendenti da replayo
architettura porte tunnel cloudflare: api.teofly.it:3000 administrator.teofly.it:8083 replayo.teofly.it:8081 bokking.teofly.it:8084
nas per storage video: 192.168.1.69 usr:admin pwd:Druido#00
percorso flutter: /Users/Teofly/flutter/bin/flutter
fare ibuild ios con flutter run
quando terminiamo una modifica importante chiedi: se fare backup del server sul server stesso, git push su repository github
Importante: quando fai buld per ios o mac ricordati di copiare il progetto in cartella temp perchè icloud crea problemi di CodeSign
Altra nota: quando fai build con flutter incontriamo problemi di sync e spesso non vedo le modifiche: trova una soluzione ed eventualmente annotala in questo stesso file: '/Users/Teofly/Library/Mobile Documents/com~apple~CloudDocs/Documents/Programmi/RePlayo/Architettura.md'
quando implementi campi di ricerca preferibilmente devono avere una finestra che mostra i risultati e posso navigare con freccia su e giù + invio per selezionare

prossime implementazioni: (sono suggerimenti che dovrai propormi senza modificare ma prima chiedere)
0 analizza se e come puoi estrerre da un video caricato nel nas un intervallo temporale specifico (es video da 5 minuti: estraggo un video dal min 1:00 al min 1:10) [FATTO - vedi sezione HIGHLIGHTS sotto]
1 creare menu nell'admin dashboard dove si possono settare le varie logiche: orari cron, minutaggi default per tipo sport eco [FATTO PARZIALE - UI creata, mancano alcuni collegamenti]
2  implementare messaggistica whatsapp che possa interagire con giocatori/prenotazioni e inviare promozioni
3  Sezione personalizzazione modelli mail esistenti + aggiunta modelli mail
4 in prenotazione, quando inserisco nome di riferimento o nome giocatore, dopo averlo inserito, metti iconcina per aggiungerlo a utenti, aprendo modal con input dati utente [FATTO]
5 quando un utente riceve conferma prenotazione, integra aggiunta a calendario personale
6 Distinguere Admin users da Users BackEnd (gli users Backend possono accedere al back end come gli admin, ma non accedono a determinati menu di configurazione) meglio se configurabili le funzioni lettura/scrittura/modifica delle varie sezioni backend in un configuratore Privilegi utente
7 fare scansione cvartelle progetto (specialmente app server) per capire se ci sono problemi di codici duplicati o cartelle stare (non modificare niente senza chiedere solo analizza)

TODO DA COMPLETARE:
- booking_advance_days: collegare configurazione al backend/Flutter per limitare giorni anticipo prenotazione [FATTO - app Flutter legge config da backend]
- booking_cancel_hours: collegare per limitare cancellazioni last-minute [FATTO - endpoint /api/bookings/:id/user-cancel con verifica ore, pulsante annulla in app iOS]
- booking_reminder_hours: collegare per invio reminder automatici (da implementare cron job)

COMPLETATI (28/11/2024):
- Icona "+" per aggiungere giocatori non registrati direttamente dalla prenotazione
- Nome riferimento auto-aggiunto come primo giocatore
- App iOS: pulsante "Annulla Prenotazione" con blocco last-minute configurabile
- App iOS: visualizza nome cliente invece di codice prenotazione in "Mie Prenotazioni"
- App iOS: refresh automatico token JWT quando scade (401)
- Admin dashboard: resize handler per calendario/timeline (si aggiorna automaticamente quando ridimensioni finestra)
- Fix calcolo prezzo prenotazione (usa price_per_player * num_players)
- Admin dashboard: fix bug getAuthHeaders() -> getAuthHeader() per notifiche
- Admin dashboard: stile dark per input notifiche
- Admin dashboard: aumentato font input notifiche
- App iOS: pulsante "Invia Richiesta" fisso in basso (come selettore orari)
- App iOS: notifiche push abilitate
- Fix: notification_service.dart usava chiave sbagliata 'auth_token' invece di 'accessToken' per recuperare JWT (28/11/2025)
- Fix: user_auth_service.dart usava endpoint sbagliato '/auth/refresh-token' invece di '/auth/refresh' (28/11/2025)
- Fix: notification_service.dart ora fa refresh automatico del token quando riceve 401 (28/11/2025)
- NOTA: Se utente ha refresh token scaduto deve fare logout e ri-login per ottenere nuovi token
- Fix CRITICO: JWT_SECRET mismatch sul backend - endpoint /api/notifications usava chiave diversa ('replayo_jwt_secret_2024') rispetto a /api/auth/* ('replayo-jwt-secret-change-in-production-2024'). Unificata a seconda chiave (28/11/2025)
- Fix: notification_service.dart ora usa UserAuthService().accessToken direttamente invece di SharedPreferences per evitare problemi di cache (28/11/2025)
- IMPORTANTE: Dopo questo fix, tutti gli utenti devono fare LOGOUT e LOGIN per ottenere nuovi token compatibili

COMPLETATI (28/11/2025) - NOTIFICHE ADMIN:
- Notifica quando club elimina prenotazione (booking_deleted)
- Notifica quando club modifica prenotazione (booking_modified) - solo per cambi data/ora/campo
- Condizione: utente deve essere registrato con stessa email della prenotazione

COMPLETATI (28/11/2025) - HIGHLIGHTS:
- Sistema estrazione highlights video implementato
- Admin Dashboard: nuova sezione "Generatore Highlights" in Impostazioni
  - Seleziona prenotazione con video associato
  - Aggiungi marker con tempo inizio/fine (MM:SS)
  - Margine automatico configurabile (default +2 sec)
  - Pulsante "Genera Highlights" per estrazione immediata
- Backend: endpoint /api/highlights/extract usa FFmpeg per tagliare clip
- Backend: tabella highlight_markers per salvare marker in DB
- Trigger automatico: quando si associa video a partita con marker pending, estrae automaticamente gli highlights
- I clip generati hanno is_highlight=true -> appaiono nel tab "Highlights" dell'app iOS (già implementato)
- Naming file: {nomeOriginale}_HL{n}.mp4 nella stessa cartella del video originale
- NOTA: Eseguire migrazione DB: backend/migrations/002_highlight_markers.sql
- Prossimo step: pulsante fisico ESP32 per marker real-time durante partita
