#!/bin/sh
# Runs the Netlify CLI under Node 22 without installing either system-wide.
#
# netlify-cli 27 needs Node 22.13+ and this laptop has Node 20; npx fetches
# both into its cache on first use and leaves the system Node alone.
exec npx -y -p node@22 -p netlify-cli@27.15.0 netlify "$@"
