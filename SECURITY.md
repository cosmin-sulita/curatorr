# Security policy

## Supported versions

Only the latest release gets security fixes. The `latest` image always points at it, so `docker compose pull && docker compose up -d` brings them in.

## Reporting a vulnerability

Please don't open a public issue. Report it privately on GitHub instead, under **Security → Report a vulnerability** ([direct link](https://github.com/cosmin-sulita/curatorr/security/advisories/new)).

Say which version you found it in (it's at the bottom of Settings), how to reproduce it and what someone could do with it. Leave out real tokens and API keys, and never send your `curatorr.db`: it holds your Plex or Jellyfin sign-in and your Radarr and Seerr API keys.

Curatorr is maintained by one person, so a reply can take a few days. A fix ships in a release, and the advisory is published afterwards, crediting you if you'd like.

## What to report

Curatorr is made for a home network. The README's "Exposing it to the internet?" note says what it protects and what it doesn't. Worth reporting, for example:

- reading the tokens and API keys Curatorr keeps, or making it send them somewhere;
- changing Settings without being the Plex server owner or a Jellyfin administrator, once one is connected;
- opening a profile that has a Plex PIN without the PIN, or getting past a profile's parental limits;
- calling Radarr's webhook without its token;
- making Curatorr request addresses it shouldn't, through its image proxies for example;
- running a script in someone else's browser.

Not a vulnerability on its own:

- anyone who reaches Curatorr can pick a profile without a PIN and browse the library;
- before Plex or Jellyfin is connected, anyone who reaches it can change its settings;
- anything that needs access to the host or to Curatorr's config folder.
