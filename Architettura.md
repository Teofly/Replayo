architettura APP Replayo

directory: '/Users/Teofly/Library/Mobile Documents/com~apple~CloudDocs/Documents/Programmi/RePlayo'
app multipiattaforma sviluppata in Flutter/dart
app web gira su server: 192.168.1.175 user:teofly pwd:druido indirizzo internet replayo.teofly.it
sul server ci sono anche teofly.it e tunnelcamp.it che sono indipendenti da replayo
architettura porte tunnel cloudflare: api.teofly.it:3000 administrator.teofly.it:8083 replayo.teofly.it:8081 bokking.teofly.it:8084
quando terminiamo una modifica importante chiedi: se fare backup del server sul server stesso, git push su repository github
Importante: quando fai buld per ios o mac ricordati di copiare il progetto in cartella temp perchè icloud crea problemi di CodeSign
Altra nota: quando fai build con flutter incontriamo problemi di sync e spesso non vedo le modifiche: trova una soluzione ed eventualmente annotala in questo stesso file: '/Users/Teofly/Library/Mobile Documents/com~apple~CloudDocs/Documents/Programmi/RePlayo/Architettura.md'

prossime implementazioni: (sono suggerimenti che dovrai propormi senza modificare ma prima chiedere)
1 creare menu nell'admin dashboard dove si possono settare le varie logiche: orari cron, minutaggi default per tipo sport eco [FATTO PARZIALE - UI creata, mancano alcuni collegamenti]
2  implementare messaggistica whatsapp che possa interagire con giocatori/prenotazioni e inviare promozioni
3  Sezione personalizzazione modelli mail esistenti + aggiunta modelli mail
4 in prenotazione, quando inserisco nome di riferimento o nome giocatore, dopo averlo inserito, metti iconcina per aggiungerlo a utenti, aprendo modal con input dati utente

TODO DA COMPLETARE:
- booking_advance_days: collegare configurazione al backend/Flutter per limitare giorni anticipo prenotazione (attualmente hardcoded a 14)
- booking_cancel_hours: collegare per limitare cancellazioni last-minute
- booking_reminder_hours: collegare per invio reminder automatici
