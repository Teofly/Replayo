architettura APP Replayo

directory: '/Users/Teofly/Library/Mobile Documents/com~apple~CloudDocs/Documents/Programmi/RePlayo'
app multipiattaforma sviluppata in Flutter/dart
app web gira su server: 192.168.1.175 user:teofly pwd:druido indirizzo internet replayo.teofly.it
sul server ci sono anche teofly.it e tunnelcamp.it che sono indipendenti da replayo
architettura porte tunnel cloudflare: api.teofly.it:3000 administrator.teofly.it:8083 replayo.teofly.it:8081 bokking.teofly.it:8084
percorso flutter: /Users/Teofly/flutter/bin/flutter
fare ibuild ios con flutter run
quando terminiamo una modifica importante chiedi: se fare backup del server sul server stesso, git push su repository github
Importante: quando fai buld per ios o mac ricordati di copiare il progetto in cartella temp perchè icloud crea problemi di CodeSign
Altra nota: quando fai build con flutter incontriamo problemi di sync e spesso non vedo le modifiche: trova una soluzione ed eventualmente annotala in questo stesso file: '/Users/Teofly/Library/Mobile Documents/com~apple~CloudDocs/Documents/Programmi/RePlayo/Architettura.md'

prossime implementazioni: (sono suggerimenti che dovrai propormi senza modificare ma prima chiedere)
1 creare menu nell'admin dashboard dove si possono settare le varie logiche: orari cron, minutaggi default per tipo sport eco [FATTO PARZIALE - UI creata, mancano alcuni collegamenti]
2  implementare messaggistica whatsapp che possa interagire con giocatori/prenotazioni e inviare promozioni
3  Sezione personalizzazione modelli mail esistenti + aggiunta modelli mail
4 in prenotazione, quando inserisco nome di riferimento o nome giocatore, dopo averlo inserito, metti iconcina per aggiungerlo a utenti, aprendo modal con input dati utente [FATTO]
5 quando un utente riceve conferma prenotazione, integra aggiunta a calendario personale

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
