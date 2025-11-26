architettura APP Replayo

directory: '/Users/Teofly/Library/Mobile Documents/com~apple~CloudDocs/Documents/Programmi/RePlayo'
app multipiattaforma sviluppata in Flutter/dart
app web gira su server: 192.168.1.175 user:teofly pwd:druido indirizzo internet replayo.teofly.it
sul server ci sono anche teofly.it e tunnelcamp.it che sono indipendenti da replayo
architettura porte tunnel cloudflare: api.teofly.it:3000 administrator.teofly.it:8083 replayo.teofly.it:8081 bokking.teofly.it:8084
quando terminiamo una modifica importante chiedi: se fare backup del server sul server stesso, git push su repository github
Importante: quando fai buld per ios o mac ricordati di copiare il progetto in cartella temp perchè icloud crea problemi di CodeSign
Altra nota: quando fai build con flutter incontriamo problemi di sync e spesso non vedo le modifiche: trova una soluzione ed eventualmente annotala in questo stesso file: '/Users/Teofly/Library/Mobile Documents/com~apple~CloudDocs/Documents/Programmi/RePlayo/Architettura.md'
