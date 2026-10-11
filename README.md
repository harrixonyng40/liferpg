# Life RPG – Mobile Multiplayer Life Simulator

A multiplayer life role-playing game that works as a **Progressive Web App (PWA)** — installable on Android & iPhone like a real mobile app.

## Features

- Email + password auth
- 5 life roles with bonuses
- Hustle jobs, buy & flex items
- 10×10 map exploration + live player presence
- Send money, live chat, leaderboard
- PvP combat
- Fake in-game money (simulated real-money purchases)
- **Mobile-first UI** with bottom navigation
- Installable on home screen (PWA)
- Works offline for static assets

## Quick Start (Web / PWA)

```bash
cd life-rpg
npm install
npm start
```

Open **http://localhost:3000** on your phone (same Wi-Fi) or computer.

### Install on your phone

**Android (Chrome)**
1. Open the site in Chrome
2. Tap the menu → “Add to Home screen” / “Install app”
3. Or wait for the install banner that appears

**iPhone (Safari)**
1. Open the site in Safari
2. Tap the Share button
3. Tap “Add to Home Screen”

It will open in full-screen standalone mode like a native app.

## Make it a real native app (optional)

You can wrap this PWA into a real Android/iOS app using **Capacitor**:

```bash
npm install @capacitor/core @capacitor/cli
npx cap init "Life RPG" com.yourname.liferpg
npx cap add android
npx cap add ios          # requires macOS
npx cap sync
npx cap open android     # opens Android Studio
```

Then build an APK / AAB or IPA and publish to the Play Store / App Store.

## Project structure

```
life-rpg/
├── server.js
├── package.json
├── data/db.json
└── public/
    ├── index.html      # Mobile-optimized UI
    ├── style.css       # Bottom nav + safe areas
    ├── script.js
    ├── manifest.json   # PWA manifest
    ├── sw.js           # Service worker
    └── icons/
```

## Notes

- In-game money stays fake forever.
- For production: add proper JWT, rate limiting, MongoDB, Stripe, and Firebase Auth for Google Sign-In.
- The UI is designed for portrait mobile first, with a fixed bottom navigation bar.

Enjoy the hustle on mobile!
