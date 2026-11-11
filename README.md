# Project Launcher

Lokalna strona z listą projektów z wybranych folderów i przyciskiem uruchomienia. Node ≥ 16, bez zależności.

## Start

    node server.js [folder1 folder2 ...]

Port 5000 jest ustawiony w `.env`; otwórz http://localhost:5000. Aby zmienić port, edytuj `PORT` w `.env`. Zmienna środowiskowa `PORT`, jeśli jest ustawiona, ma pierwszeństwo.

Na Windows możesz uruchomić `start.bat` dwuklikiem albo z terminala. Opcjonalne foldery przekaż jako argumenty, np. `start.bat "C:\Users\Jan\projekty"`. Wymagany jest Node.js 16 lub nowszy dostępny w `PATH`.

Wpisz własne hasło w linii `LAUNCHER_PASSWORD=...` w `.env`. Plik `.env` jest ignorowany przez Git. Jeśli pliku brakuje w nowej kopii projektu, skopiuj `.env.example` do `.env`. Jeśli hasło nie zostanie ustawione w `.env` ani w środowisku procesu, serwer wygeneruje losowe hasło i wypisze je w konsoli. Zmienna środowiskowa `LAUNCHER_PASSWORD`, jeśli jest ustawiona, ma pierwszeństwo przed `.env`.

## Jak działa

- **Foldery** – dodajesz folder (np. `~/projekty`); każdy jego podfolder (do 2 poziomów) rozpoznany jako projekt trafia na listę.
- **Nazwa** – z nazwy folderu. **Opis** – pierwszy akapit README. **Komenda** – wykrywana z `package.json` (dev/start/serve), `main.py`/`app.py`, `Cargo.toml`, `go.mod`, docker-compose, `Makefile` (cel `run`), `index.html`. Możesz też podać adres strony projektu (`http://` lub `https://`), który pojawi się jako przycisk na karcie. Wszystko edytowalne; ręczne zmiany nie są nadpisywane przy ponownym skanie („Resetuj z plików” przywraca wykryte wartości).
- **Tożsamość** – w folderze projektu zapisywany jest plik `.project-launcher-id` (UUID), a w `data.json` odcisk: hash listy plików, lista nazw i pierwszy commit gita.
- **Ignorowanie** – przycisk „Ignoruj” zmienia nazwę znacznika na `.project-launcher-id-ignore`, usuwa projekt z `data.json` i pomija go przy kolejnych skanach. Aby przywrócić wykrywanie, zmień nazwę znacznika z powrotem na `.project-launcher-id`.
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
