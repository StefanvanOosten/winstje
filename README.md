# Winstje

Webapp om bij te houden wat je inkoopt, verkoopt en verdient. Installeerbaar op Android, werkt ook zonder internet.

## Starten

```bash
npm start
```

Open daarna http://localhost:8123.

## Testen

```bash
npm test
```

## Opbouw

| Bestand | Inhoud |
|---|---|
| `app.js` | Schermen en bediening |
| `logic.js` | Berekeningen en CSV-export, zonder scherm of opslag |
| `db.js` | Opslag op het toestel; vervang dit bestand om over te stappen op een online database |
| `sw.js` | Offline gebruik; nieuwe versies komen vanzelf door |
| `tools/make-icons.mjs` | Tekent de app-iconen |

Bedragen worden overal als hele centen opgeslagen.
