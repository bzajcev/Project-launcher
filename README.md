# Project Launcher

Lokalna strona z listą projektów z wybranych folderów i przyciskiem uruchomienia. Node ≥ 16, bez zależności.

## Start

    node server.js [folder1 folder2 ...]

Otwórz http://localhost:4777 (zmiana portu: `PORT=5000 node server.js`).

Na Windows możesz uruchomić `start.bat` dwuklikiem albo z terminala. Opcjonalne foldery przekaż jako argumenty, np. `start.bat "C:\Users\Jan\projekty"`. Wymagany jest Node.js 16 lub nowszy dostępny w `PATH`.

Po uruchomieniu serwer wypisuje losowe hasło logowania w konsoli. Zachowaj je, aby zalogować się do launchera. Możesz zamiast tego ustawić własne hasło w zmiennej środowiskowej `LAUNCHER_PASSWORD` przed uruchomieniem serwera.

W PowerShell:

    $env:LAUNCHER_PASSWORD = "wpisz-wlasne-silne-haslo"
    node server.js

## Jak działa

- **Foldery** – dodajesz folder (np. `~/projekty`); każdy jego podfolder (do 2 poziomów) rozpoznany jako projekt trafia na listę.
- **Nazwa** – z nazwy folderu. **Opis** – pierwszy akapit README. **Komenda** – wykrywana z `package.json` (dev/start/serve), `main.py`/`app.py`, `Cargo.toml`, `go.mod`, docker-compose, `Makefile` (cel `run`), `index.html`. Możesz też podać adres strony projektu (`http://` lub `https://`), który pojawi się jako przycisk na karcie. Wszystko edytowalne; ręczne zmiany nie są nadpisywane przy ponownym skanie („Resetuj z plików” przywraca wykryte wartości).
- **Tożsamość** – w folderze projektu zapisywany jest plik `.project-launcher-id` (UUID), a w `data.json` odcisk: hash listy plików, lista nazw i pierwszy commit gita.
- **Weryfikacja** – status odświeżany co 3 s. Brak folderu lub inny identyfikator pod ścieżką → ostrzeżenie i propozycje nowej ścieżki (punktacja: ten sam ID 100%, podobna zawartość, ta sama nazwa folderu, ten sam pierwszy commit). Nic nie zmienia się bez Twojego kliknięcia „Użyj”.
- **Folder projektu** – ikona obok ścieżki otwiera folder w Eksploratorze plików.
- **Uruchamianie** – komenda w powłoce w folderze projektu, logi na żywo, zatrzymanie ubija całe drzewo procesów. Zamknięcie serwera zatrzymuje uruchomione projekty.

## Bezpieczeństwo

Serwer nasłuchuje tylko na `127.0.0.1`. Wszystkie endpointy API poza logowaniem wymagają sesji po zalogowaniu; ciasteczko sesyjne jest `HttpOnly`, `SameSite=Strict` i wygasa po 8 godzinach. Próby logowania są ograniczane. Dodatkowo serwer sprawdza nagłówki `Host`/`Origin` (ochrona przed DNS rebinding i CSRF), bo wykonuje komendy z `data.json`.


## Uruchamianie programów
Przy nowym lub importowanym projekcie najczęściej będziesz chciał uruchomić
`mv .venv .venv_old`
`py -m venv .venv`
`.venv\Scripts\python -m pip install -r requirements.txt`
`.venv\Scripts\python.exe -m pip install --upgrade pip`
