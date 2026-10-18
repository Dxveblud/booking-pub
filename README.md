# booking-template

Sistema di prenotazioni online riutilizzabile per piccole attività locali (barbieri, estetiste, parrucchieri, centri massaggi…).

Un'unica installazione offre:

| Componente | URL | A cosa serve |
|---|---|---|
| **Pagina della piattaforma** | `/` | Presenta il prodotto ai futuri clienti, con demo e pulsante "Accedi" |
| **Widget** | `/widget/widget.js` | Pulsante "Prenota" da incollare in **qualunque sito esistente** (WordPress, Wix, HTML…) |
| **Pagina del negozio** | `/s/<codice>` | Sito completo e pronto per chi **non ha un sito** (contiene già il widget) |
| **Pannello admin** | `/admin` | Calendario, prenotazioni, blocchi, servizi, orari e avvisi email |

Stack: Node.js + Express, MongoDB (Mongoose), frontend HTML/CSS/JS vanilla, mobile-first.

---

## Una piattaforma, tanti negozi

Un solo server serve **tutti i clienti**. Ogni negozio ha:
- un **codice** (es. `barberia-mario`) da mettere nel widget: `<script src="https://booking.dxveblud.dev/widget/widget.js" data-shop="barberia-mario" defer></script>`;
- la sua **pagina pronta** per chi non ha un sito: `https://booking.dxveblud.dev/s/barberia-mario`;
- il suo **pannello** (`/admin`) con username e password propri: il titolare vede solo le sue prenotazioni, i suoi servizi e i suoi orari;
- nome, testi, colori, logo e foto propri, modificabili dalla sezione **Negozio** del pannello (dove trova anche il codice da incollare nel sito).

Tu entri come **super admin** e nella sezione **Negozi** puoi:
- creare un negozio (nome, tipo di attività → servizi e orari di partenza, codice) e ricevere le credenziali da mandare al cliente;
- entrare nel pannello di qualunque negozio per assistenza (**Gestisci**);
- generare una nuova password per un titolare o disattivare un negozio (widget e pagina smettono di accettare prenotazioni).

Il negozio definito in `config.json` (`business.id`, qui la demo "Barberia Novecento") è quello predefinito: risponde su `/s/demo` e al widget senza `data-shop`. In `/` c'è la pagina della piattaforma (vedi [Sezione `platform`](#sezione-platform-pagina-della-piattaforma)). Il primo admin (da `ADMIN_USERNAME`/`ADMIN_PASSWORD`, o quello già esistente nelle installazioni precedenti) diventa il super admin.

Logo e foto caricati dai negozi vengono salvati in `uploads/` (configurabile con `UPLOAD_DIR`): in caso di backup ricordati di copiare anche quella cartella.

## Indice

- [Funzionalità](#funzionalità)
- [Avvio in locale](#avvio-in-locale)
- [Configurazione](#configurazione)
- [Integrare il widget in un sito esistente](#integrare-il-widget-in-un-sito-esistente)
- [Pannello admin](#pannello-admin)
- [Deploy sulla VM Oracle](#deploy-sulla-vm-oracle)
- [Deploy su Render (alternativa)](#deploy-su-render-alternativa)
- [Struttura del progetto](#struttura-del-progetto)
- [API](#api)
- [Collaboratori (agende separate)](#collaboratori-agende-separate)
- [Come funziona l'anti doppia prenotazione](#come-funziona-lanti-doppia-prenotazione)
- [Email: avvisi, conferme, promemoria](#email-avvisi-conferme-promemoria)
- [Privacy (GDPR)](#privacy-gdpr)
- [Backup e monitoraggio](#backup-e-monitoraggio)
- [Estensioni future: WhatsApp e Google Calendar](#estensioni-future-whatsapp-e-google-calendar)
- [Test](#test)

---

## Funzionalità

**Cliente (widget / sito)**
- Flusso guidato: servizio → con chi (se il negozio ha più collaboratori, oppure "chiunque") → giorno → orario libero → nome, telefono ed email facoltativa → conferma
- Mostra **solo gli orari realmente disponibili**: considera orari di apertura, prenotazioni esistenti, durata del servizio, blocchi, preavviso minimo e giorni massimi di anticipo
- Se nel frattempo qualcuno prende lo stesso orario, il cliente viene avvisato e gli orari vengono ricaricati
- Email di **conferma** e **promemoria** (se lascia l'email) e **link personale per disdire** (`/disdici/<codice>`), fino al preavviso scelto dal negozio
- Informativa privacy del negozio a un clic dal modulo

**Admin (`/admin`)**
- Login con password hashata (bcrypt) e sessione salvata su MongoDB
- Calendario **giornaliero, settimanale e mensile** (su mobile parte dalla vista giornaliera)
- Aggiunta manuale di prenotazioni (clienti di persona o al telefono): basta cliccare su uno spazio libero del calendario
- Modifica (anche cambio giorno/orario/servizio) e cancellazione
- Blocco di giorni interi o fasce orarie (ferie, pause, chiusure), anche su più giorni
- Gestione servizi (nome, durata, prezzo, descrizione, attivo/disattivo)
- **Collaboratori** con agende separate: chi fa quali servizi, orari propri, ferie del singolo, calendario a colonne per collaboratore
- Gestione orari di apertura (più fasce al giorno) e regole di prenotazione, disdetta e promemoria
- Email al titolare a ogni prenotazione online e a ogni disdetta
- Cambio password e "password dimenticata" (link via email); cambiando password gli altri dispositivi vengono scollegati

**Garanzie**
- **Nessuna doppia prenotazione**, nemmeno con richieste simultanee (vedi [sotto](#come-funziona-lanti-doppia-prenotazione))
- Anti-spam: limite di prenotazioni e di tentativi di login per IP, massimo di prenotazioni attive per numero di telefono (`booking.maxActivePerPhone`, default 3), campo trappola per i bot
- Header di sicurezza (Helmet/CSP), cookie `httpOnly` + `SameSite=strict`, protezione CSRF

---

## Avvio in locale

Requisiti: **Node.js 22+** e un MongoDB (locale oppure un cluster gratuito su [MongoDB Atlas](https://www.mongodb.com/atlas)).

```bash
git clone <url-della-repo> booking-template
cd booking-template
npm install
cp .env.example .env      # poi modifica MONGODB_URI, SESSION_SECRET, ADMIN_PASSWORD
npm run dev               # riavvio automatico a ogni modifica
```

Apri:
- http://localhost:3000 → sito template
- http://localhost:3000/admin → pannello admin (credenziali `ADMIN_USERNAME` / `ADMIN_PASSWORD`)

Al primo avvio vengono creati automaticamente:
- le impostazioni (orari di apertura) e i servizi di esempio presi da `config.json`;
- l'amministratore, se nel database non ne esiste ancora uno.

Comandi utili:

| Comando | Descrizione |
|---|---|
| `npm start` | Avvio in produzione |
| `npm run dev` | Avvio con riavvio automatico |
| `npm test` | Test unitari e di integrazione (MongoDB in memoria, nessun DB da configurare) |
| `npm run seed` | Crea impostazioni e servizi di esempio (se il catalogo è vuoto) |
| `npm run create-admin -- <utente> <password>` | Crea un admin o ne reimposta la password |

---

## Configurazione

### `config.json`: i dati dell'attività

Per ogni nuovo cliente modifica solo questo file (e il logo in `public/img/`):

```jsonc
{
  "business": {
    "id": "barberia-mario",        // identificativo interno (vedi "Più attività")
    "name": "Barberia Mario",
    "tagline": "Taglio, barba e cura dal 1990",
    "description": "Testo della sezione Chi siamo…",
    "logo": "/img/logo.svg",       // percorso in public/ oppure URL https
    "address": "Via Roma 1, Città",
    "phone": "+39 …",
    "email": "info@…",
    "primaryColor": "#1f6f5c",     // colore di pulsanti e dettagli
    "timezone": "Europe/Rome",     // fuso orario dell'attività
    "currency": "EUR",
    "locale": "it-IT"
  },
  "booking": {                     // valori iniziali, poi modificabili dall'admin
    "slotStepMinutes": 15,         // orari proposti ogni 15 minuti
    "minNoticeMinutes": 60,        // preavviso minimo per prenotare online
    "maxDaysAhead": 60             // fino a quanti giorni avanti
  },
  "defaults": {                    // usati SOLO al primo avvio (DB vuoto)
    "openingHours": { "2": [{ "start": "09:00", "end": "13:00" }] },  // 0 = domenica … 6 = sabato
    "services": [{ "name": "Taglio", "durationMinutes": 30, "price": 18 }]
  }
}
```

> Orari, servizi e regole, una volta creati, si gestiscono dal pannello admin. I `defaults` servono solo come punto di partenza.

### Sezione `platform` (pagina della piattaforma)
Testi della pagina `/` che presenta il prodotto:

```jsonc
"platform": {
  "name": "Dxveblud Booking",   // nome del prodotto (titolo, menu, footer)
  "email": "",                  // se c'è, compare il pulsante "Scrivimi una email"
  "phone": "",                  // se c'è, compare il pulsante "Chiama"
  "demoShop": "demo",           // negozio aperto da "Prova a prenotare" e "Guarda il sito demo"
  "landing": true               // false = in "/" si apre direttamente il negozio predefinito
}
```

Il modello HTML è `src/views/landing.html` (stile in `public/css/landing.css`). Le prenotazioni fatte sul negozio demo non mandano avvisi finché `demo.enabled` è attivo.

### Sezione `site` (sito template)
Foto e contenuti della pagina pubblica: `heroImage`, `aboutImage`, `aboutTitle`, `highlights` (3 punti di forza), `gallery` (elenco di immagini) e `demoNotice` (se presente mostra la fascia "Sito dimostrativo"). Le immagini vanno in `public/img/` oppure possono essere URL https.

### Modalità demo (`demo.enabled`)
Pensata per la vetrina/portfolio, **da lasciare disattivata per un cliente reale**:
- quando cambia `demo.seedVersion` ricarica servizi e orari da `config.json`;
- ogni 6 ore riempie circa `fillRatio` degli orari nei prossimi `daysToFill` giorni con prenotazioni finte (`isDemo: true`), così il widget mostra una disponibilità realistica e il calendario admin non è vuoto;
- le prenotazioni finte non inviano notifiche e non toccano quelle vere.

### `.env`: segreti e parametri di deploy

Vedi [`.env.example`](.env.example). Le principali:

| Variabile | Descrizione |
|---|---|
| `MONGODB_URI` | Stringa di connessione MongoDB |
| `SESSION_SECRET` | Segreto per i cookie di sessione (obbligatorio in produzione) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Primo amministratore, creato solo se non ne esiste nessuno |
| `WIDGET_ALLOWED_ORIGINS` | Siti autorizzati a incorporare il widget (`*` = tutti) |
| `BOOKING_RATE_LIMIT` | Prenotazioni online per IP ogni 15 minuti (default 10) |
| `UPLOAD_DIR` | Cartella per logo e foto caricati dai negozi (default `uploads/`) |

---

## Integrare il widget in un sito esistente

Incolla questa riga prima di `</body>` nel sito del cliente (sostituisci il dominio):

```html
<script src="https://booking-mario.onrender.com/widget/widget.js" defer></script>
```

Compare un pulsante "Prenota" flottante in basso a destra che apre il flusso di prenotazione in un popup (a tutto schermo su mobile).

### Opzioni

```html
<script src="https://…/widget/widget.js"
        data-mode="inline"
        data-target="#prenota"
        data-label="Prenota un taglio"
        data-color="#b5482a"
        data-position="left"
        defer></script>
```

| Attributo | Valori | Default |
|---|---|---|
| `data-mode` | `floating` (pulsante fisso), `inline` (pulsante nel punto indicato), `none` (nessun pulsante) | `floating` |
| `data-target` | selettore CSS del contenitore per `inline` | subito dopo lo script |
| `data-label` | testo del pulsante | `Prenota` |
| `data-color` | colore del pulsante | `#1f6f5c` |
| `data-position` | `right` / `left` (solo `floating`) | `right` |

Puoi anche usare **i pulsanti del sito** del cliente: qualunque elemento con l'attributo `data-booking-open` apre il widget.

```html
<a href="#" data-booking-open>Prenota ora</a>
<script src="https://…/widget/widget.js" data-mode="none" defer></script>
```

Oppure via JavaScript: `BookingWidget.open()` / `BookingWidget.close()`.

**WordPress**: incolla lo snippet in un blocco "HTML personalizzato", oppure nel footer con un plugin tipo *WPCode*.
**Wix / Squarespace**: usa l'elemento "Embed / Codice personalizzato".

### Come funziona e perché è sicuro

Il flusso di prenotazione gira in un **iframe** servito dal tuo server: gli stili del sito ospite non lo "rompono" e il widget non tocca il sito ospite. Tutte le chiamate API restano sullo stesso dominio del server, quindi non serve configurare CORS.
Per limitare quali siti possono incorporarlo imposta `WIDGET_ALLOWED_ORIGINS`, ad esempio:

```
WIDGET_ALLOWED_ORIGINS=https://www.barberiamario.it https://barberiamario.it
```

---

## Pannello admin

Vai su `/admin` ed effettua il login.

- **Calendario**: ‹ › per spostarti, *Oggi* per tornare a oggi, *Giorno/Settimana* per cambiare vista. Le zone grigie sono gli orari di chiusura, quelle tratteggiate i blocchi. Le prenotazioni online sono in verde, quelle inserite a mano in giallo.
  - Clicca su uno spazio vuoto per **aggiungere** una prenotazione a quell'ora.
  - Clicca su una prenotazione per **modificarla** o **cancellarla**.
  - L'admin può inserire prenotazioni anche fuori orario o in giorni bloccati, ma **mai sovrapposte** a un'altra prenotazione.
- **Blocchi e ferie**: blocca uno o più giorni (giornata intera o fascia oraria). Se nel periodo ci sono già prenotazioni, non vengono cancellate: compare un elenco con i clienti da contattare.
- **Servizi**: aggiungi, modifica, disattiva (non più prenotabile online) o elimina. Le prenotazioni già fatte conservano nome, durata e prezzo originali. In cima alla stessa sezione ci sono i **collaboratori** (vedi [sotto](#collaboratori-agende-separate)).
- **Orari**: fasce di apertura per ogni giorno, regole di prenotazione online, fino a quante ore prima il cliente può disdire dal link e quante ore prima mandare il promemoria.
- **Negozio**: dati, aspetto, email per gli avvisi e cambio password.

**Password dimenticata**: dalla pagina di login il titolare riceve un link (valido un'ora) all'email degli avvisi o del negozio; il super admin all'indirizzo `ADMIN_EMAIL`. Servono l'email configurata e `PUBLIC_URL`. In alternativa, sulla VM: `cd ~/booking && npm run create-admin -- admin NuovaPassword123`.

---

## Deploy sulla VM Oracle

Il server gira sulla VM insieme agli altri servizi: MongoDB in un container
Docker (raggiungibile solo dalla VM), l'app come servizio systemd e Caddy
davanti con HTTPS automatico. Uno script fa tutto.

### 1. DNS e porte (una volta)
- Crea un record **A** `booking.dxveblud.dev` → IP pubblico della VM.
- Nella **Security List** di Oracle devono essere aperte le porte **80** e **443** (TCP, da `0.0.0.0/0`).

### 2. Clona la repo sulla VM
La copia pubblica [`Dxveblud/booking-pub`](https://github.com/Dxveblud/booking-pub) si scarica senza credenziali:

```bash
git clone https://github.com/Dxveblud/booking-pub ~/booking
```

### 3. Installa
```bash
bash ~/booking/deploy/setup-vm.sh booking.dxveblud.dev
```

A fine script vengono stampati l'indirizzo e la **password admin** (generata a caso e salvata in `~/booking/.env`).
Lo script si può rilanciare senza problemi: salta i passi già fatti e non sovrascrive `.env`.

> **VM già installata?** Gli aggiornamenti automatici portano il nuovo codice, ma due cose vanno fatte a mano una volta:
> 1. aggiungi a `~/booking/.env` le righe `PUBLIC_URL=…` e `SMTP_*` (vedi [Email](#email-avvisi-conferme-promemoria)) e riavvia con `sudo systemctl restart booking`;
> 2. rilancia `bash ~/booking/deploy/setup-vm.sh booking.dxveblud.dev` per attivare il backup notturno.

### Aggiornamenti
Automatici: un timer controlla GitHub ogni 2 minuti e, se c'è un commit nuovo su `main`, scarica il codice e riavvia (`deploy/autoupdate.sh`). A mano: `bash ~/booking/deploy/deploy.sh`.

| Cosa | Comando |
|---|---|
| Log dell'app | `journalctl -u booking -f` |
| Riavvio | `sudo systemctl restart booking` |
| Stato aggiornamenti | `systemctl list-timers booking-autoupdate.timer` |
| Backup adesso | `bash ~/booking/deploy/backup.sh` (vedi [Backup](#backup-e-monitoraggio)) |
| Stato backup | `systemctl list-timers booking-backup.timer` |

> Caddy: il sito è in `/etc/caddy/sites/booking.caddy`, importato dal `Caddyfile` principale. Se un altro script riscrive il `Caddyfile` da zero, rilancia `setup-vm.sh` per rimettere la riga `import`.

---

## Deploy su Render (alternativa)

### 1. Database: MongoDB Atlas (gratuito)
1. Crea un account su [MongoDB Atlas](https://www.mongodb.com/atlas) e un cluster **M0 (free)**.
2. *Database Access* → crea un utente con password.
3. *Network Access* → aggiungi `0.0.0.0/0` (Render non ha IP fissi nel piano gratuito).
4. *Connect → Drivers* → copia la stringa e aggiungi il nome del database, es.
   `mongodb+srv://<UTENTE>:<PASSWORD>@<CLUSTER>/booking-mario?retryWrites=true&w=majority`

### 2. Web service su Render

**Opzione A: Blueprint (consigliata)**
1. Pubblica la repo su GitHub.
2. Su [Render](https://dashboard.render.com) → **New → Blueprint** → seleziona la repo. Render legge `render.yaml`.
3. Inserisci `MONGODB_URI` e `ADMIN_PASSWORD` quando richiesti. `SESSION_SECRET` viene generato automaticamente.

**Opzione B: manuale**
1. **New → Web Service** → collega la repo.
2. Runtime **Node**, Build command `npm ci --omit=dev`, Start command `npm start`.
3. Variabili d'ambiente: `NODE_ENV=production`, `MONGODB_URI`, `SESSION_SECRET` (lunga e casuale), `ADMIN_USERNAME`, `ADMIN_PASSWORD`.
4. Health check path: `/health`.

Al primo avvio vengono creati admin, orari e servizi di esempio. Dopo il primo login puoi rimuovere `ADMIN_PASSWORD` dalle variabili.

### 3. Dominio personalizzato (facoltativo)
Render → *Settings → Custom Domains* (es. `prenota.barberiamario.it`), poi aggiungi il record CNAME indicato dal provider del dominio. HTTPS è automatico.

> **Nota sul piano gratuito**: il servizio "si addormenta" dopo 15 minuti di inattività e la prima richiesta successiva può impiegare 30–60 secondi. Per un cliente reale conviene il piano *Starter*.

### Un deploy per ogni cliente
Per ogni attività: duplica la repo (o crea un branch), modifica `config.json` e il logo, e crea un nuovo servizio Render con il suo database (`.../booking-nomecliente`).

---

## Struttura del progetto

```
booking-template/
├── config.json                 # dati dell'attività (nome, logo, default…)
├── .env.example                # variabili d'ambiente di esempio
├── deploy/                     # script per la VM (setup, deploy, aggiornamento automatico, backup)
├── render.yaml                 # blueprint per il deploy su Render (alternativa)
├── scripts/
│   ├── create-admin.js         # crea/reimposta un amministratore
│   └── seed.js                 # dati iniziali
├── src/
│   ├── server.js               # avvio: DB, bootstrap, integrazioni, HTTP
│   ├── app.js                  # configurazione Express (sicurezza, sessione, rotte)
│   ├── db.js                   # connessione Mongoose
│   ├── config/index.js         # lettura di .env e config.json
│   ├── models/                 # schemi Mongoose
│   │   ├── Booking.js          #   prenotazione
│   │   ├── SlotLock.js         #   "lucchetti" anti doppia prenotazione
│   │   ├── Service.js          #   servizio
│   │   ├── Staff.js            #   collaboratore (agenda, servizi, orari propri)
│   │   ├── Block.js            #   fascia/giorno bloccato
│   │   ├── Settings.js         #   orari di apertura e regole
│   │   └── AdminUser.js        #   amministratore (password bcrypt)
│   ├── routes/
│   │   ├── public.js           # /api/*        (widget e sito)
│   │   └── admin.js            # /admin/api/*  (pannello, richiede login)
│   ├── middleware/             # auth, JSON obbligatorio, gestione errori
│   ├── services/               # logica di business
│   │   ├── availability.js     #   calcolo orari liberi
│   │   ├── bookingService.js   #   crea/modifica/cancella prenotazioni
│   │   ├── slotLocks.js        #   riserva/libera gli orari
│   │   ├── catalogService.js   #   servizi
│   │   ├── staffService.js     #   collaboratori
│   │   ├── blockService.js     #   blocchi
│   │   ├── settingsService.js  #   orari e regole
│   │   ├── adminService.js     #   login e admin iniziale
│   │   ├── bootstrap.js        #   dati iniziali all'avvio
│   │   ├── events.js           #   bus eventi (booking.created/updated/cancelled)
│   │   ├── landing.js          #   pagina "/" della piattaforma
│   │   ├── mailer.js           #   invio email (SMTP)
│   │   ├── privacyService.js   #   cancellazione dei dati vecchi
│   │   ├── notifications/      #   email al titolare e ai clienti, promemoria · PREDISPOSTO: WhatsApp
│   │   └── integrations/       #   PREDISPOSTO: Google Calendar
│   ├── utils/                  # date/orari, errori HTTP
│   └── views/                  # landing.html (pagina "/") e privacy.html (informative)
├── public/
│   ├── index.html, css/, js/   # pagina del negozio (/s/<codice>) · css/landing.css: pagina "/"
│   ├── manage.html             # pagina "gestisci o disdici" del cliente (/disdici/<codice>)
│   ├── img/logo.svg            # logo segnaposto
│   ├── widget/
│   │   ├── widget.js           # loader da incorporare nei siti
│   │   └── booking.*           # flusso di prenotazione (dentro l'iframe)
│   └── admin/                  # pannello admin (login + SPA)
└── test/                       # node:test + mongodb-memory-server
```

Convenzione su date e orari: le date sono stringhe `YYYY-MM-DD` e gli orari minuti dalla mezzanotte, **sempre nel fuso orario dell'attività** (`business.timezone`). Il server può quindi girare in UTC (come su Render) senza spostamenti di orario.

---

## API

### Pubbliche (`/api`)

Ogni chiamata indica il negozio con `?shop=<codice>` (senza, si usa il negozio predefinito).

| Metodo | Percorso | Descrizione |
|---|---|---|
| GET | `/api/business` | Dati del negozio |
| GET | `/api/services` | Servizi attivi |
| GET | `/api/staff?serviceId=…` | Collaboratori che fanno quel servizio (vuoto = agenda unica) |
| GET | `/api/opening-hours` | Orari di apertura settimanali |
| GET | `/api/availability/days?serviceId=…[&staffId=…]` | Giorni prenotabili con numero di orari liberi |
| GET | `/api/availability?serviceId=…&date=YYYY-MM-DD[&staffId=…]` | Orari liberi di un giorno (senza `staffId`: di chiunque) |
| POST | `/api/bookings` | Crea prenotazione `{ serviceId, date, time, staffId?, customer: { name, phone, email? }, notes }`; la risposta contiene `manageUrl` e `staffName` |
| GET | `/api/manage/:codice` | Dettagli dell'appuntamento dal link del cliente |
| POST | `/api/manage/:codice/cancel` | Disdetta dal link del cliente |

### Admin (`/admin/api`, richiedono login)

| Metodo | Percorso | Descrizione |
|---|---|---|
| POST | `/login`, `/logout` | Accesso / uscita |
| POST | `/password/forgot`, `/password/reset` | Recupero password (senza login) `{ username }` / `{ token, password }` |
| PUT | `/password` | Cambio password `{ current, password }` |
| GET | `/me` | Utente corrente |
| GET/POST | `/bookings?from=&to=` | Elenco / creazione manuale |
| PUT/DELETE | `/bookings/:id` | Modifica / cancellazione |
| GET/POST | `/staff` | Collaboratori: elenco / creazione `{ name, serviceIds?, customHours?, openingHours? }` |
| PUT/DELETE | `/staff/:id` | Modifica (anche `active`) / eliminazione (solo senza appuntamenti futuri) |
| GET/POST | `/services` | Elenco / creazione |
| PUT/DELETE | `/services/:id` | Modifica / eliminazione |
| GET/POST | `/blocks?from=&to=` | Elenco / creazione `{ fromDate, toDate, allDay, start, end, reason, staffId? }` |
| DELETE | `/blocks/:id` | Rimozione |
| GET/PUT | `/settings` | Orari di apertura e regole |
| GET/PUT | `/business` | Dati, colori e foto del negozio |
| POST | `/uploads` | Carica un'immagine (corpo binario, `Content-Type: image/jpeg|png|webp|gif`) |
| GET/POST | `/platform/shops` | *(super admin)* Elenco / creazione negozi |
| PUT | `/platform/shops/:codice` | *(super admin)* Attiva/disattiva, note |
| POST | `/platform/shops/:codice/enter` | *(super admin)* Gestisci quel negozio |
| POST | `/platform/shops/:codice/reset-password` | *(super admin)* Nuova password del titolare |

Gli errori hanno sempre il formato `{ "error": { "code": "SLOT_TAKEN", "message": "…" } }`.

---

## Collaboratori (agende separate)

Un negozio senza collaboratori ha un'**agenda unica**, come sempre. Appena il titolare aggiunge almeno un collaboratore (**Servizi → Collaboratori**), ognuno ha la sua agenda:

- **Online** il cliente sceglie con chi, oppure "chiunque": vede gli orari in cui almeno un collaboratore adatto è libero e la prenotazione va al collega libero con meno appuntamenti quel giorno. Se il servizio lo fa una sola persona il passo non compare.
- **Servizi che fa**: per ogni collaboratore si spuntano i servizi (nessuna spunta = tutti).
- **Orari propri** (es. part-time): se attivati valgono al posto di quelli del negozio.
- **Ferie e blocchi**: in **Ferie** si sceglie "Tutto il negozio" o un collaboratore.
- **Calendario**: in alto i filtri *Tutti / Marco / Luca…*; nella vista giornaliera con *Tutti* c'è una colonna per collaboratore. Gli appuntamenti contemporanei della settimana vengono affiancati.
- **Dal pannello** il collaboratore va sempre indicato; due collaboratori diversi possono avere un appuntamento alla stessa ora, lo stesso collaboratore no.
- Un collaboratore con appuntamenti futuri non si può eliminare: si **disattiva** (sparisce dal widget, i suoi appuntamenti restano).
- Il nome del collaboratore compare nelle email, nella pagina "gestisci o disdici" e a fine prenotazione.

**Negozi che aggiungono i collaboratori dopo aver già ricevuto prenotazioni**: gli appuntamenti esistenti restano "da assegnare" (colonna a parte nel calendario) e, per prudenza, **occupano tutti** finché il titolare non li assegna a qualcuno aprendoli dal calendario.

**Aggiornamento di un'installazione esistente**: all'avvio i lucchetti degli orari vengono migrati da soli (vecchio indice `businessId_1_date_1_minute_1` sostituito da quello per agenda). Non serve fare nulla, ma conviene avere un backup recente prima del primo avvio con questa versione.

## Come funziona l'anti doppia prenotazione

Controllare "è libero?" e poi salvare non basta: due clienti che confermano nello stesso istante passerebbero entrambi il controllo.

Per questo ogni prenotazione **occupa dei "lucchetti"** (`SlotLock`), uno per ogni blocco di 5 minuti che copre (10:00–10:30 → 10:00, 10:05, …, 10:25). La collezione ha un **indice univoco** su `(attività, agenda, data, minuto)`, dove l'agenda è il collaboratore (o quella unica del negozio): MongoDB accetta un solo documento per blocco, quindi in caso di richieste simultanee una sola va a buon fine e le altre ricevono `409 SLOT_TAKEN`. Funziona anche con servizi di durata diversa che si sovrappongono solo in parte, e non richiede transazioni né replica set.

Per questo le durate dei servizi devono essere **multipli di 5 minuti**. Modificare o cancellare una prenotazione aggiorna o libera i lucchetti. Un test di integrazione invia 8 richieste simultanee per lo stesso orario e verifica che ne passi esattamente una.

---

## Email: avvisi, conferme, promemoria

| Chi | Quando |
|---|---|
| Titolare | Nuova prenotazione **online**; disdetta fatta dal cliente dal suo link |
| Cliente (se ha lasciato l'email) | Conferma con link "Gestisci o disdici"; appuntamento spostato o annullato dal negozio; disdetta registrata; **promemoria** `reminderHours` ore prima (default 24) |
| Titolare / super admin | Link per reimpostare la password |

Non partono email per le prenotazioni finte della demo né dal negozio dimostrativo (così nessuno può usare la demo per mandare email a indirizzi altrui). Il campo email nel widget compare solo se il negozio può davvero mandare la conferma. Il promemoria non arriva a chi ha prenotato quando mancava già meno di quel tempo (ha appena ricevuto la conferma).

1. **Sul server**: in `.env` imposta un server SMTP qualunque e riavvia (`sudo systemctl restart booking`):
   ```bash
   SMTP_HOST=smtp-relay.brevo.com     # Brevo: gratis fino a 300 email al giorno
   SMTP_PORT=587
   SMTP_USER=...
   SMTP_PASS=...
   MAIL_FROM="Prenotazioni <noreply@dxveblud.dev>"
   PUBLIC_URL=https://booking.dxveblud.dev
   ```
   Va bene anche Gmail con una [password per le app](https://myaccount.google.com/apppasswords) (`smtp.gmail.com`, porta 465). Senza `SMTP_HOST` l'invio è spento e il pannello lo segnala.
2. **Nel pannello**: ogni titolare inserisce il suo indirizzo in **Negozio → Avvisi** (vuoto = nessun avviso) e sceglie in **Orari** il preavviso per disdire e le ore del promemoria.

`PUBLIC_URL` serve per i link nelle email (disdetta, calendario, recupero password): senza, le email partono senza link e il recupero password è spento.

Il codice è in `src/services/mailer.js` (invio), `src/services/notifications/owner.js` e `customer.js` (contenuti e promemoria), `layout.js` (aspetto comune).

---

## Privacy (GDPR)

- **Informative pronte**: `/s/<negozio>/privacy` (titolare = il negozio, con i suoi dati; la piattaforma è responsabile del trattamento) e `/privacy` (sito della piattaforma e titolari dei negozi). Il modulo di prenotazione e il sito del negozio le collegano. Il testo è in `src/views/privacy.html`: è una base ragionevole, **non una consulenza legale**, fallo rileggere prima di vendere il servizio.
- **Base giuridica**: esecuzione della richiesta del cliente (art. 6.1.b), quindi niente casella di consenso.
- **Conservazione**: ogni giorno i dati dei clienti (nome, telefono, email, note) delle prenotazioni più vecchie di `privacy.retentionMonths` mesi (config.json, default 24) vengono cancellati; resta un record anonimo per le statistiche.
- **Cookie**: il widget e le pagine pubbliche non usano cookie; il pannello usa solo il cookie tecnico di sessione. Nessun banner necessario.
- Con ogni negozio va firmato un **accordo di nomina a responsabile del trattamento** (art. 28): bastano due paragrafi, si trovano molti modelli gratuiti.

---

## Backup e monitoraggio

**Backup**: `setup-vm.sh` attiva il timer `booking-backup.timer`, che ogni notte alle 3:30 lancia `deploy/backup.sh`:
- database in `~/booking-backups/booking-<data>.archive.gz`, foto in `uploads-<data>.tar.gz`;
- tiene gli ultimi `BACKUP_KEEP_DAYS` giorni (default 14);
- con `BACKUP_RCLONE_REMOTE` in `.env` copia anche fuori dalla VM (consigliato: se la VM si rompe, i backup che ci sono dentro si perdono con lei). Installa rclone (`sudo apt install rclone`) e configura una destinazione con `rclone config` (Google Drive, OneDrive, Oracle Object Storage…).

Ripristino:
```bash
sudo docker exec -i booking-mongo mongorestore --gzip --archive --drop < ~/booking-backups/booking-AAAA-MM-GG_HHMM.archive.gz
tar -xzf ~/booking-backups/uploads-AAAA-MM-GG_HHMM.tar.gz -C ~/booking
```

**Monitoraggio**: `GET /health` risponde `200 {"ok":true}` solo se anche il database è collegato (altrimenti `503`). Crea un controllo gratuito su [UptimeRobot](https://uptimerobot.com) (o simili) su `https://booking.dxveblud.dev/health` ogni 5 minuti: ti avvisa per email se il sito va giù.

---

## Estensioni future: WhatsApp e Google Calendar

Il codice è già predisposto ma **non implementato**. Le prenotazioni emettono eventi su un bus interno (`src/services/events.js`):

- `booking.created`
- `booking.updated`
- `booking.cancelled`

Le integrazioni si limitano ad "ascoltarli", quindi aggiungerle non richiede di toccare la logica delle prenotazioni. Un errore in un'integrazione viene loggato e non blocca mai la prenotazione.

**WhatsApp**: `src/services/notifications/whatsapp.js`
1. Implementa `send()` (WhatsApp Cloud API o Twilio; per i messaggi avviati dal negozio servono template approvati da Meta).
2. Fai restituire `true` a `isEnabled()` leggendo `NOTIFY_WHATSAPP_ENABLED`.

**Google Calendar**: `src/services/integrations/googleCalendar.js`
1. `npm install googleapis` e crea un service account con accesso al calendario.
2. Implementa `createEvent` / `updateEvent` / `deleteEvent`.
3. Salva l'ID evento in `booking.externalRefs.googleCalendarEventId` (il campo esiste già).
4. Per la sincronizzazione inversa (impegni su Google che bloccano orari) basta creare documenti `Block`.

Le variabili d'ambiente previste sono già elencate (commentate) in `.env.example`.

### Possibili evoluzioni
- **Dominio personalizzato per negozio** (es. `prenota.barberiamario.it` invece di `/s/barberia-mario`): aggiungere un campo `domains` al negozio, risolverlo dall'header `Host` e il sito a Caddy.
- **Più collaboratori per negozio** (es. due barbieri con agende separate): un modello `Staff` e il lucchetto degli orari per collaboratore.

---

## Test

```bash
npm test
```

I test usano `node:test` e `mongodb-memory-server` (scarica automaticamente un MongoDB temporaneo, non serve configurare nulla). Coprono il calcolo degli orari, le richieste simultanee, le sovrapposizioni tra servizi di durata diversa, l'autenticazione admin, la protezione CSRF, la modifica e cancellazione delle prenotazioni, i blocchi e gli orari, i negozi separati, la pagina della piattaforma, le email (intercettate, nessun invio vero), la disdetta dal link, i promemoria, l'anti-spam, cambio e recupero password, la cancellazione dei dati vecchi e i collaboratori (agende separate, "chiunque" con richieste simultanee, orari propri, ferie del singolo, prenotazioni da assegnare, migrazione dei lucchetti).

---

## Crediti

- Foto della demo: [Unsplash](https://unsplash.com) (licenza Unsplash, uso libero anche commerciale).
- Font: Playfair Display e Inter (Google Fonts, licenza SIL Open Font License), inclusi in `public/fonts/`.
