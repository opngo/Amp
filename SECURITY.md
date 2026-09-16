# Security

Amp runs locally and stores your library and settings as plain JSON in your user
data directory. The only network features are the ones you turn on:

- AudioBookBay search (outbound, when you search)
- cover lookups on Open Library and Google Books (outbound, when you search for
  a cover)
- qBittorrent Web API (localhost by default, credentials from settings.json)
- the optional remote server, which requires a token and listens on your tailnet
  or LAN only if you enable it
- the update check, which asks GitHub for the latest release tag

## Reporting a vulnerability

Open a private security advisory on the repository, or email the maintainer
address in the profile. Please include the version, platform, and a minimal
reproduction. Do not open a public issue for anything that could be exploited
before a fix is available.

## What Amp will never do

- Upload your audio, transcripts or library anywhere.
- Require an account, or phone home on start-up.
- Write into your audio files without an explicit action: chapter writing and
  splitting always produce new files next to the originals.
