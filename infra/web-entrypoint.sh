#!/bin/sh
# Entrypoint for the Muamalat web container.
#
# Two jobs, both of which have to happen at container start rather than at image build
# time, so that one image can be promoted unchanged from dev to staging to production:
#
#   1. Render nginx.conf from its template (API upstream, Content-Security-Policy origin).
#   2. Publish /config.json so the SPA can discover its API and identity provider at
#      runtime instead of having them baked into the JavaScript bundle.
#
# Runs as uid 101 (nginx). It therefore writes only to /tmp and to the web root, both of
# which are writable by that user. The stock nginx image entrypoint is deliberately not
# used: it skips /docker-entrypoint.d when the container is not root.

set -eu

: "${WEB_API_UPSTREAM:=http://api:8080}"
: "${WEB_KEYCLOAK_ORIGIN:=http://localhost:8081}"
: "${WEB_KEYCLOAK_REALM:=muamalat}"
: "${WEB_KEYCLOAK_CLIENT_ID:=muamalat-web}"
: "${WEB_API_BASE_URL:=/api}"

export WEB_API_UPSTREAM WEB_KEYCLOAK_ORIGIN

# Only these two placeholders are substituted. Naming them explicitly stops envsubst from
# eating nginx's own $variables ($host, $request_uri, $proxy_add_x_forwarded_for, ...).
#
# The single quotes are required and not a mistake: envsubst's SHELL-FORMAT argument must
# reach it as the literal text "${WEB_API_UPSTREAM} ${WEB_KEYCLOAK_ORIGIN}". If the shell
# expanded it first, envsubst would receive the values and substitute nothing.
# shellcheck disable=SC2016
envsubst '${WEB_API_UPSTREAM} ${WEB_KEYCLOAK_ORIGIN}' \
  < /etc/nginx/nginx.conf.template \
  > /tmp/nginx.conf

# Runtime configuration for the SPA.
#
# This is a convenience, not a contract: if the Angular app hardcodes its endpoints or
# reads them from an environment.ts, the file is simply never fetched and costs nothing.
# If it does fetch it (an APP_INITIALIZER that GETs /config.json before bootstrap is the
# usual shape), the same built bundle works against any environment.
cat > /usr/share/nginx/html/config.json <<JSON
{
  "apiBaseUrl": "${WEB_API_BASE_URL}",
  "keycloak": {
    "url": "${WEB_KEYCLOAK_ORIGIN}",
    "realm": "${WEB_KEYCLOAK_REALM}",
    "clientId": "${WEB_KEYCLOAK_CLIENT_ID}"
  }
}
JSON

echo "muamalat-web: proxying /api -> ${WEB_API_UPSTREAM}; identity provider ${WEB_KEYCLOAK_ORIGIN}/realms/${WEB_KEYCLOAK_REALM}"

# Fail fast and readably on a bad config rather than crash-looping under compose.
nginx -c /tmp/nginx.conf -t

exec nginx -c /tmp/nginx.conf -g 'daemon off;'
