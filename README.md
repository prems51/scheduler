# Timetable Manager

## Development

From the project folder, install dependencies and start the desktop app:

```powershell
npm.cmd install
npm.cmd run dev
```

## Tests

Run the lint checks and test suite:

```powershell
npm.cmd test
```

## Build a Windows installer

Build the app and create a per-user NSIS installer:

```powershell
npm.cmd run dist
```

The installer is written to `dist/`, with a name such as
`Timetable Manager Setup 0.1.0.exe`. The app and its runtime dependencies are
packaged together; Node.js is not required on the computer where it is
installed.

The SQLite native addon is unpacked from the ASAR archive. The schema SQL is
bundled into the main-process build, so first launch can create the database
without locating a separate source file.

## Data and restore

The database is stored at `%APPDATA%\Timetable Manager\timetable.db`.
Automatic and manual backups are under the app's `Backups` folder in the same
user-data directory; application logs are under `logs`.

To move data to a new PC, copy a backup to that PC, install and launch the app,
then open **Settings > Restore backup** and select the copied database backup.
The app also makes a safety backup before restoring.

## Packaged-app test checklist

On a clean Windows PC without Node.js:

1. Install the generated `.exe` and launch Timetable Manager.
2. Confirm first launch creates the database and the app opens without a
   console window.
3. Add timetable data, close the app, relaunch it, and confirm the data
   persists.
4. Export a timetable and confirm the file is saved to the chosen location.
5. Create a backup, restore it, and confirm the timetable data is recovered.
