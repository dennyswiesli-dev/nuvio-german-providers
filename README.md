# German Providers für Nuvio

## Eigenständige Nuvio-Portierung

Dieses Repository ist ein Fork der Arbeit von `InvalidPandaa/nuvio-german-providers` und wird von Dennys Wiesli eigenständig für Nuvio weitergeführt. Die zugrunde liegende Provider-Logik stammt aus `Bnyro/GermanProviders`. Änderungen am CloudStream-Original werden regelmäßig überwacht; aufgrund der unterschiedlichen Implementierungen werden sie nicht blind in JavaScript überschrieben, sondern als Upstream-Update zur Prüfung gemeldet.

> [!WARNING]
> Dieses Projekt ist noch in Entwicklung. Einzelne Provider können ausfallen, weil sich die Seiten oder Hoster ändern.
> Wenn etwas nicht funktioniert, [öffne gerne ein Issue](https://github.com/dennyswiesli-dev/nuvio-german-providers/issues/new).

Deutsche Quellen für [Nuvio](https://github.com/NuvioMedia), portiert aus dem CloudStream-Repo
[Bnyro/GermanProviders](https://github.com/Bnyro/GermanProviders). Anders als die CloudStream-`.cs3`-Erweiterungen
(Android-Bytecode, in Nuvio nur auf Android nutzbar) sind das reine JavaScript-Plugins im Nuvio-Format und laufen
auf allen Plattformen: Android, Android TV, iOS, macOS, Windows.

## Installation

In Nuvio in den Plugin-Einstellungen ein Repository mit der **rohen** URL der `manifest.json` hinzufügen:

```
https://dennyswiesli-dev.github.io/nuvio-german-providers/manifest.json
```


## Provider

| Provider | Inhalte | Hinweise |
|---|---|---|
| ARD Mediathek | Filme, Serien | FSK16+ nur 22–6 Uhr (ARD-Regel) |
| Arte | Filme, Serien | Jugendschutz-Titel nur 22–6 Uhr |
| DMAX, TELE 5, TLC | Filme, Serien | Stream-URLs laufen nach ca. 6 Minuten ab |
| PlutoTV | Filme, Serien | Pluto zeigt nur wechselnde Teile einer Staffel |
| South Park | Serie | nur frei verfügbare Folgen |
| Netzkino | Filme | Suche der Netzkino-API ist lückenhaft |
| FilmFrei24, Filmo, FlixiTV, KellerKino, Megakino, FilmPalast, HDFilme, Moflix, Huhu | Filme (teils Serien) | über Hoster wie VOE, Vidara, VidSonic, FireStream, MixDrop … |
| KinoKing | Serien | Filme sind abgeschaltet: die Filmseite braucht 12–20 s pro Abruf |
| Serienstream, Aniworld | Serien / Anime | s.to zeigt nach ~10 Links pro IP ein Captcha, dann fehlen weitere Links; hilft ein IP-Wechsel (z. B. Mobilfunk statt WLAN) |



## Status

Ein täglicher [Smoke-Test](.github/workflows/smoke.yml) ruft jeden Provider mit bekannten Titeln auf. Liefert ein Provider keine Streams mehr, öffnet der Workflow das Issue „Provider-Smoke-Test: Ausfälle" und schließt es wieder, sobald alles läuft. Den aktuellen Stand findest du im [Workflow-Verlauf](https://github.com/dennyswiesli-dev/nuvio-german-providers/actions/workflows/smoke.yml).

## Was die Streamliste zeigt

Nuvio listet jedes Plugin als eigene Gruppe. Innerhalb eines Plugins gelten diese Regeln (`provider()` in `shared/http.js`), jede mit Rückfall auf „alles zeigen", damit die Liste nie leer wird:

- **Nur die beste Sprache:** deutsche Synchro; gibt es keine, deutsche Untertitel; gibt es auch die nicht, alles.
- **Keine Kinomitschnitte:** Streams, die als CAM, TS oder Telesync gekennzeichnet sind, fallen weg.
- **Tote Streams raus:** Meldet die Playlist oder Datei HTTP 404/410, fällt der Stream weg. Bei 403 bleibt er, weil dann nur unsere Anfrage gesperrt sein kann.
- **Ein Eintrag pro Hoster und Sprache:** der mit der besten Auflösung (dann Bitrate).
- **Über 360p:** Bekannte Auflösungen bis 360p fallen weg, solange es etwas Besseres gibt.
- **Beste zuerst, höchstens vier:** nach Auflösung absteigend, unbekannte dahinter.
- **Früher aufhören:** Hoster werden zu dritt aufgelöst; sind sechs Streams da, startet kein weiterer Abruf. Das spart Zeit und Links bei Seiten, die sie zählen (s.to).

Die Titelzeile (Nuvio TV) nennt zusätzlich Codec, Bitrate, HDR, Dateigröße und Release-Tags, soweit bekannt. Die Grenzen (`MAX_STREAMS`, `MIN_HEIGHT`) stehen oben im Abschnitt „what the stream list shows" in `shared/http.js`.

## Entwicklung

```bash
npm ci
npm run build        # src/<provider>/index.js -> providers/<provider>.js (die Bundles werden mit eingecheckt)
npm test             # Offline-Selbsttest (check.js)
npm run probe -- <provider> <tmdbId> <movie|tv> [staffel] [folge]   # echter Aufruf, braucht TMDB_API_KEY
npm run bump -- patch   # Version in manifest.json und package.json setzen
npm run meta         # Provider-Auswahl der Issue-Vorlage aus manifest.json erzeugen
```

Pull Requests prüfen, dass die eingecheckten Bundles zum Quellcode passen (`npm run build` vor dem Commit). Für den Smoke-Test muss im Repository das Secret `TMDB_API_KEY` gesetzt sein.

Upstream-Änderungen von `Bnyro/GermanProviders` landen täglich als Draft-PR `automation/upstream-sync` mit einer Liste der betroffenen Dateien. Der PR wird bei neuen Upstream-Commits aktualisiert.

## Lizenz

GPL-3.0-or-later. Seiten-Logik nach [Bnyro/GermanProviders](https://github.com/Bnyro/GermanProviders) (GPL-3.0),
Hoster-Decoder nach [recloudstream/cloudstream](https://github.com/recloudstream/cloudstream) (GPL-3.0).
Die Plugins hosten keine Inhalte, sie verhalten sich wie ein Browser, der öffentlich erreichbare Seiten aufruft.
