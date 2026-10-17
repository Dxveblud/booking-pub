# booking-template

Sistema di prenotazioni online riutilizzabile per piccole attività locali (barbieri, estetiste, parrucchieri, centri massaggi…).

Un'unica installazione offre tre cose:

| Componente | URL | A cosa serve |
|---|---|---|
| **Widget** | `/widget/widget.js` | Pulsante "Prenota" da incollare in **qualunque sito esistente** (WordPress, Wix, HTML…) |
| **Sito template** | `/` | Sito completo e pronto per chi **non ha un sito** (contiene già il widget) |
| **Pannello admin** | `/admin` | Calendario, prenotazioni, blocchi, servizi e orari |

Stack: Node.js + Express, MongoDB (Mongoose), frontend HTML/CSS/JS vanilla, mobile-first.

---

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
- [Come funziona l'anti doppia prenotazione](#come-funziona-lanti-doppia-prenotazione)
- [Estensioni future: notifiche e Google Calendar](#estensioni-future-notifiche-e-google-calendar)
- [Test](#test)

---

## Funzionalità

**Cliente (widget / sito)**
- Flusso guidato: servizio → giorno → orario libero → nome e telefono → conferma
- Mostra **solo gli orari realmente disponibili**: considera orari di apertura, prenotazioni esistenti, durata del servizio, blocchi, preavviso minimo e giorni massimi di anticipo
- Se nel frattempo qualcuno prende lo stesso orario, il cliente viene avvisato e gli orari vengono ricaricati

**Admin (`/admin`)**
- Login con password hashata (bcrypt) e sessione salvata su MongoDB
- Calendario **giornaliero e settimanale** (su mobile parte dalla vista giornaliera)
- Aggiunta manuale di prenotazioni (clienti di persona o al telefono): basta cliccare su uno spazio libero del calendario
- Modifica (anche cambio giorno/orario/servizio) e cancellazione
- Blocco di giorni interi o fasce orarie (ferie, pause, chiusure), anche su più giorni
- Gestione servizi (nome, durata, prezzo, descrizione, attivo/disattivo)
- Gestione orari di apertura (più fasce al giorno) e regole di prenotazione

**Garanzie**
- **Nessuna doppia prenotazione**, nemmeno con richieste simultanee (vedi [sotto](#come-funziona-lanti-doppia-prenotazione))
- Anti-spam: limite di prenotazioni e di tentativi di login per IP
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

### `.env`: segreti e parametri di deploy

Vedi [`.env.example`](.env.example). Le principali:

| Variabile | Descrizione |
|---|---|
| `MONGODB_URI` | Stringa di connessione MongoDB |
| `SESSION_SECRET` | Segreto per i cookie di sessione (obbligatorio in produzione) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Primo amministratore, creato solo se non ne esiste nessuno |
| `WIDGET_ALLOWED_ORIGINS` | Siti autorizzati a incorporare il widget (`*` = tutti) |
| `BOOKING_RATE_LIMIT` | Prenotazioni online per IP ogni 15 minuti (default 10) |

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
- **Servizi**: aggiungi, modifica, disattiva (non più prenotabile online) o elimina. Le prenotazioni già fatte conservano nome, durata e prezzo originali.
- **Orari**: fasce di apertura per ogni giorno e regole di prenotazione online.

Password dimenticata? `npm run create-admin -- admin NuovaPassword123` (in locale, puntando allo stesso database).

---

## Deploy sulla VM Oracle

Il server gira sulla VM insieme agli altri servizi: MongoDB in un container
Docker (raggiungibile solo dalla VM), l'app come servizio systemd e Caddy
davanti con HTTPS automatico. Uno script fa tutto.

### 1. DNS e porte (una volta)
- Crea un record **A** `booking.dxveblud.dev` → IP pubblico della VM.
- Nella **Security List** di Oracle devono essere aperte le porte **80** e **443** (TCP, da `0.0.0.0/0`).

### 2. Clona la repo sulla VM
La repo è privata, quindi la VM deve potersi autenticare su GitHub. Se `git clone` chiede la password, crea una **deploy key** (sola lettura):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/booking_deploy -N "" -C "vm-booking"
cat ~/.ssh/booking_deploy.pub
# GitHub → repo booking → Settings → Deploy keys → Add deploy key → incolla
cat >> ~/.ssh/config <<'CFG'
Host github-booking
  HostName github.com
  User git
  IdentityFile ~/.ssh/booking_deploy
CFG
git clone git@github-booking:Dxveblud/booking.git ~/booking
```

### 3. Installa
```bash
bash ~/booking/deploy/setup-vm.sh booking.dxveblud.dev
```

A fine script vengono stampati l'indirizzo e la **password admin** (generata a caso e salvata in `~/booking/.env`).
Lo script si può rilanciare senza problemi: salta i passi già fatti e non sovrascrive `.env`.

### Aggiornamenti
Automatici: un timer controlla GitHub ogni 2 minuti e, se c'è un commit nuovo su `main`, scarica il codice e riavvia (`deploy/autoupdate.sh`). A mano: `bash ~/booking/deploy/deploy.sh`.

| Cosa | Comando |
|---|---|
| Log dell'app | `journalctl -u booking -f` |
| Riavvio | `sudo systemctl restart booking` |
| Stato aggiornamenti | `systemctl list-timers booking-autoupdate.timer` |
| Backup del database | `sudo docker exec booking-mongo mongodump --archive --db booking > backup-$(date +%F).archive` |
| Ripristino | `sudo docker exec -i booking-mongo mongorestore --archive < backup.archive` |

> Caddy: il sito è in `/etc/caddy/sites/booking.caddy`, importato dal `Caddyfile` principale. Se un altro script riscrive il `Caddyfile` da zero, rilancia `setup-vm.sh` per rimettere la riga `import`.

---

## Deploy su Render (alternativa)

### 1. Database: MongoDB Atlas (gratuito)
1. Crea un account su [MongoDB Atlas](https://www.mongodb.com/atlas) e un cluster **M0 (free)**.
2. *Database Access* → crea un utente con password.
3. *Network Access* → aggiungi `0.0.0.0/0` (Render non ha IP fissi nel piano gratuito).
4. *Connect → Drivers* → copia la stringa e aggiungi il nome del database, es.
   `mongodb+srv://utente:password@cluster0.xxxxx.mongodb.net/booking-mario?retryWrites=true&w=majority`

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
├── deploy/                     # script per la VM (setup, deploy, aggiornamento automatico)
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
│   │   ├── blockService.js     #   blocchi
│   │   ├── settingsService.js  #   orari e regole
│   │   ├── adminService.js     #   login e admin iniziale
│   │   ├── bootstrap.js        #   dati iniziali all'avvio
│   │   ├── events.js           #   bus eventi (booking.created/updated/cancelled)
│   │   ├── notifications/      #   PREDISPOSTO: email, WhatsApp
│   │   └── integrations/       #   PREDISPOSTO: Google Calendar
│   └── utils/                  # date/orari, errori HTTP
├── public/
│   ├── index.html, css/, js/   # sito template
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

| Metodo | Percorso | Descrizione |
|---|---|---|
| GET | `/api/business` | Dati dell'attività |
| GET | `/api/services` | Servizi attivi |
| GET | `/api/opening-hours` | Orari di apertura settimanali |
| GET | `/api/availability/days?serviceId=…` | Giorni prenotabili con numero di orari liberi |
| GET | `/api/availability?serviceId=…&date=YYYY-MM-DD` | Orari liberi di un giorno |
| POST | `/api/bookings` | Crea prenotazione `{ serviceId, date, time, customer: { name, phone }, notes }` |

### Admin (`/admin/api`, richiedono login)

| Metodo | Percorso | Descrizione |
|---|---|---|
| POST | `/login`, `/logout` | Accesso / uscita |
| GET | `/me` | Utente corrente |
| GET/POST | `/bookings?from=&to=` | Elenco / creazione manuale |
| PUT/DELETE | `/bookings/:id` | Modifica / cancellazione |
| GET/POST | `/services` | Elenco / creazione |
| PUT/DELETE | `/services/:id` | Modifica / eliminazione |
| GET/POST | `/blocks?from=&to=` | Elenco / creazione `{ fromDate, toDate, allDay, start, end, reason }` |
| DELETE | `/blocks/:id` | Rimozione |
| GET/PUT | `/settings` | Orari di apertura e regole |

Gli errori hanno sempre il formato `{ "error": { "code": "SLOT_TAKEN", "message": "…" } }`.

---

## Come funziona l'anti doppia prenotazione

Controllare "è libero?" e poi salvare non basta: due clienti che confermano nello stesso istante passerebbero entrambi il controllo.

Per questo ogni prenotazione **occupa dei "lucchetti"** (`SlotLock`), uno per ogni blocco di 5 minuti che copre (10:00–10:30 → 10:00, 10:05, …, 10:25). La collezione ha un **indice univoco** su `(attività, data, minuto)`: MongoDB accetta un solo documento per blocco, quindi in caso di richieste simultanee una sola va a buon fine e le altre ricevono `409 SLOT_TAKEN`. Funziona anche con servizi di durata diversa che si sovrappongono solo in parte, e non richiede transazioni né replica set.

Per questo le durate dei servizi devono essere **multipli di 5 minuti**. Modificare o cancellare una prenotazione aggiorna o libera i lucchetti. Un test di integrazione invia 8 richieste simultanee per lo stesso orario e verifica che ne passi esattamente una.

---

## Estensioni future: notifiche e Google Calendar

Il codice è già predisposto ma **non implementato**. Le prenotazioni emettono eventi su un bus interno (`src/services/events.js`):

- `booking.created`
- `booking.updated`
- `booking.cancelled`

Le integrazioni si limitano ad "ascoltarli", quindi aggiungerle non richiede di toccare la logica delle prenotazioni. Un errore in un'integrazione viene loggato e non blocca mai la prenotazione.

**Notifiche email / WhatsApp**: `src/services/notifications/`
1. Implementa `send()` in `email.js` (es. nodemailer o Resend) o `whatsapp.js` (WhatsApp Cloud API o Twilio).
2. Fai restituire `true` a `isEnabled()` leggendo `NOTIFY_EMAIL_ENABLED` / `NOTIFY_WHATSAPP_ENABLED`.
3. Per i promemoria (es. 24h prima) è già previsto il campo `booking.notifications.reminderSentAt`.

**Google Calendar**: `src/services/integrations/googleCalendar.js`
1. `npm install googleapis` e crea un service account con accesso al calendario.
2. Implementa `createEvent` / `updateEvent` / `deleteEvent`.
3. Salva l'ID evento in `booking.externalRefs.googleCalendarEventId` (il campo esiste già).
4. Per la sincronizzazione inversa (impegni su Google che bloccano orari) basta creare documenti `Block`.

Le variabili d'ambiente previste sono già elencate (commentate) in `.env.example`.

### Più attività su un solo server
Oggi ogni deploy serve una sola attività. Tutti i documenti hanno però già un campo `businessId` (preso da `config.json → business.id`), e gli indici univoci lo includono. Per passare a un modello multi-attività bisognerà ricavare `businessId` dalla richiesta (es. `data-business` nel widget o sottodominio) invece che dalla configurazione, e spostare i dati di `config.json` in una collezione `Business`.

---

## Test

```bash
npm test
```

I test usano `node:test` e `mongodb-memory-server` (scarica automaticamente un MongoDB temporaneo, non serve configurare nulla). Coprono il calcolo degli orari, le richieste simultanee, le sovrapposizioni tra servizi di durata diversa, l'autenticazione admin, la protezione CSRF, la modifica e cancellazione delle prenotazioni, i blocchi e gli orari.
