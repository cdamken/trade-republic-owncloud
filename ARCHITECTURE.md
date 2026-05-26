# ARCHITECTURE — trade-republic-owncloud

Cómo está construida la app, dónde vive cada cosa y por qué.

Estructuralmente paralela a [`gbm-owncloud`](https://github.com/cdamken/gbm-owncloud).
Si conoces ese repo, este se entiende en cinco minutos — lo único realmente
distinto es el flujo de login (TR usa **2-step push** en lugar de TOTP).

## Diagrama de alto nivel

```
┌────────────────────────────────────────────────────────────────────────┐
│  Browser del usuario (logueado en ownCloud, su propia sesión + cookie) │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ HTTPS
                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│  ownCloud 10  (Apache + PHP-FPM)                                       │
│                                                                        │
│  Router → OCA\TradeRepublic\Controller\PageController   (GET  /)       │
│        → OCA\TradeRepublic\Controller\ApiController     (GET/POST /api)│
│                                                                        │
│  CSRF middleware activo en los POST (setConfig, update, reset)         │
│                                                                        │
│  Controllers reciben TrService vía DI auto-wiring.                     │
│  TrService resuelve userId LAZILY desde IUserSession en cada request.  │
│                                                                        │
│  TrService.runFetch($mfaCode, $full)                                   │
│    └─ proc_open([                                                      │
│           trade_republic.python_bin,                                               │
│           apps/trade_republic/python/fetch_wrapper.py,                             │
│           --profile-dir {datadir}/<uid>/trade_republic/profile,                    │
│           --data-dir    {datadir}/<uid>/tr,                            │
│           --mfa-code    (si lo mandó el browser)                       │
│           --full        (si el usuario marcó "descarga completa")      │
│       ], env=TR_PHONE, TR_PIN (descifrado via ICrypto), ...)           │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ subprocess
                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│  fetch_wrapper.py  (Python 3.10+, venv con tr-api[browser])            │
│                                                                        │
│   set HOME = --profile-dir   (redirige ~/.tr-api/ del lib a per-user)  │
│                                                                        │
│   ┌── Paso 1 (sin --mfa-code, cookies muertas) ────────────────────┐   │
│   │   auth.initiate_login(phone, pin)                               │   │
│   │     → TR push 4-digit code al móvil                            │   │
│   │     → guarda processId en {data-dir}/.pending_login.json       │   │
│   │     → exit 10 (mfa_required)                                   │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│   ┌── Paso 2 (--mfa-code provisto) ─────────────────────────────────┐  │
│   │   process_id = read({data-dir}/.pending_login.json)             │  │
│   │   auth.complete_login(process_id, code)                         │  │
│   │     → cookies persistidas a {profile-dir}/.tr-api/.../cookies   │  │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│   ► portfolio.snapshot_full(client)  → portfolio.json + raw           │
│   ► transactions.fetch_since / fetch_all → account_transactions.csv   │
│   ► compute_analytics() inline → analytics.json + net_worth_history   │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ HTTPS WebSocket
                               ▼
                       Trade Republic API
                  (auth + WS api.traderepublic.com)
```

## Layout en disco (por usuario)

```
{datadirectory}/<uid>/trade_republic/
├── profile/                           ← tr-api profile dir (0700)
│   └── .tr-api/profiles/<phone>/
│       ├── cookies.json               ← persistidas por tr-api
│       └── profile.json
├── .pending_login.json                ← processId in-flight (0600, TTL 5 min)
├── portfolio.json                     ← consumed by dashboard
├── portfolio_raw.json                 ← raw TR WS payload (debug)
├── account_transactions.csv           ← timeline en formato pytr-compatible
├── analytics.json                     ← cash flow, dividends, allocation
├── net_worth_history.json             ← daily snapshot rows
├── last_update.date                   ← "YYYY-MM-DD HH:MM:SS"
└── fetch.log                          ← stdout/stderr del último run
```

`{datadirectory}` viene de `occ config:system:get datadirectory`. Todo se
crea con `0700` para directorios y `0600` para archivos.

## Aislamiento por usuario — el modelo

El usuario `alice` no puede ver los datos de `bob`. Garantizado así:

1. **Identidad atada en construcción.** `TrService::userId()` se resuelve
   lazily desde `IUserSession->getUser()->getUID()`. No hay setter. No hay
   forma de construir `TrService` con un userId arbitrario.

2. **Paths derivados del userId.** Cada ruta de archivo dentro del servicio
   se construye como `$this->dataDirRoot . '/' . $this->userId() . '/tr/...'`.

3. **Whitelist en `dataPath()`.** El método que mapea un nombre de archivo
   a ruta filtra con whitelist explícita (`portfolio.json`, `analytics.json`,
   `net_worth_history.json`, `last_update.date`). Path traversal no funciona.

4. **CSRF activo en endpoints de mutación.** `setConfig`, `update` y `reset`
   validan el token de ownCloud. Otro tab/dominio no puede dispararlos sin la
   cookie de sesión del usuario.

5. **`@NoAdminRequired` no significa "público"**. El middleware de auth de
   ownCloud sigue exigiendo login. Sin login no hay user → `userId()` lanza
   `RuntimeException` y la request muere.

6. **HOME redirigido por usuario.** El wrapper Python hace
   `os.environ["HOME"] = profile_dir`, así que `tr-api` escribe sus cookies
   y `processId` dentro del dir per-user. Aunque dos usuarios usen el mismo
   teléfono (caso raro), sus profile dirs son distintos.

## Credenciales — dónde y cómo

| Campo | Forma | Tabla / Path | Cifrado |
|---|---|---|---|
| Teléfono | string E.164 | DB `oc_preferences` (`<uid>`, `trade_republic`, `phone`) | No (no es secreto) |
| PIN | string 4-6 dígitos | DB `oc_preferences` (`<uid>`, `trade_republic`, `pin_enc`) | **Sí**, `ICrypto::encrypt` |
| Cookies TR | JSON | Filesystem `{datadir}/<uid>/trade_republic/profile/.tr-api/...` (0700) | No (vida corta) |
| processId in-flight | JSON | Filesystem `{datadir}/<uid>/trade_republic/.pending_login.json` (0600) | No (TTL 5 min) |

`ICrypto::encrypt` de ownCloud usa AES-256-CBC con el `secret` definido en
`config.php`. Sin acceso al `config.php` del server, los PINs cifrados en
`oc_preferences` no se pueden recuperar.

## Por qué el login es de dos pasos (vs. el TOTP de gbm-owncloud)

TR no usa TOTP — usa un **push challenge**:

1. Llamas a `auth.initiate_login(phone, pin)`. TR responde con un
   `processId` y envía un código de 4 dígitos a la app móvil del usuario.
2. Recibes el código del usuario y llamas a
   `auth.complete_login(processId, code)`. TR responde con cookies de sesión.

Esto fuerza dos roundtrips HTTP entre browser y servidor: el primer POST
`/api/update` dispara `initiate_login` y guarda el `processId` en disco;
el segundo POST `/api/update` (con `mfa_code`) lee ese `processId` y
completa el login.

El archivo `.pending_login.json` es el puente entre ambos. Tiene TTL de 5
minutos: si el usuario abre el modal y luego se distrae, al volver puede
darle a "Actualizar" sin código y se inicia un push nuevo (porque el TTL
ya pasó y _load_pending devuelve None); si vuelve antes del TTL, NO se
reinicia el push (porque el código viejo todavía es válido).

Comparado con gbm-owncloud (TOTP):
- En GBM, el código lo genera el usuario en su app autenticadora, y el
  fetch es stateless: un solo POST con `totp_code` resuelve todo.
- En TR, el código lo emite TR como respuesta a `initiate_login`. El
  servidor TIENE que recordar el `processId` entre el push y el submit
  del usuario.

## Por qué los datos viven en `appdata`-like y no en `files/`

Tres razones:

1. **No queremos que aparezcan en el File explorer.** Si los pongo en
   `{datadir}/<uid>/files/TR/`, los vería en la web y se le sincronizarían
   al desktop client.
2. **Privacidad relativa.** Cualquier mecanismo que enseñe `files/`
   (compartido, link público) podría exponer los JSON. Fuera de `files/` no
   hay forma de listarlos sin acceso al filesystem.
3. **Limpieza explícita.** Cuando un usuario se va o resetea, basta con
   borrar el dir `tr/` — no hay que cazar archivos sueltos dentro de
   `files/`.

## Por qué bridge Python en lugar de port a PHP

`tr-api` es la fuente de verdad de los endpoints WebSocket reales de TR.
Cuando TR cambie algo, `tr-api` se actualiza y este app gana la corrección
automáticamente con un `pip install -U tr-api`. Portar el WebSocket + el
WAF/Playwright a PHP sería una inversión enorme con cero beneficio.

Si en algún momento `tr-api` exporta su WS sobre HTTP (microservicio),
podríamos hablar a ese endpoint desde PHP y dejar de hacer `proc_open` — la
interfaz `TrService` no cambiaría y los controllers no se enterarían.

## Modelo de errores

`fetch_wrapper.py` usa exit codes que `TrService` mapea a status JSON que
el JS interpreta:

| Exit | JSON status     | HTTP | Significado |
|------|-----------------|------|-------------|
| 0    | `ok`            | 200  | Todo bien |
| 10   | `mfa_required`  | 401  | Cookies muertas / no había código → browser muestra modal de 4 dígitos |
| 11   | `mfa_invalid`   | 401  | Código equivocado o expirado |
| 12   | `auth_failed`   | 401  | Teléfono/PIN rechazados |
| 20   | `api_error`     | 502  | TR falló o `tr-api` tronó |
| 21   | `rate_limited`  | 429  | TR limitó los intentos de login |
| 30   | `config_error`  | 500  | Wrapper no encontrado, lib faltante, env vacío |

El JS del browser tiene una rama explícita para cada uno (abre modal de
MFA, abre modal de config, muestra alert de rate-limit, etc.).

## Diferencias con la arquitectura de `Trade-Republic-Dashboard`

`Trade-Republic-Dashboard` corre un mini HTTP server Python en localhost y
sirve HTML estático + endpoints `/update` y `/config`. Aquí:

- El HTTP server **es ownCloud** — la app no levanta un server propio.
- `/update`, `/config` y `/reset` se vuelven rutas de ownCloud, con auth +
  CSRF + per-user scope reales.
- Las páginas HTML se vuelven templates renderizadas por ownCloud (con su
  layout, navegación, etc.).
- `tr_fetch.py` + `analyze_analytics.py` se fusionan en `fetch_wrapper.py`
  para que PHP solo tenga que hacer un `proc_open`.
- Las credenciales vienen de la DB de ownCloud (PIN cifrado) en lugar de
  `~/.pytr/credentials`.

## Punto de extensión: añadir una nueva vista

Para añadir, p.ej., una página de "alertas":

1. Añadir ruta en `appinfo/routes.php`:
   `['name' => 'page#alerts', 'url' => '/alerts', 'verb' => 'GET']`
2. Añadir método `alerts()` en `PageController` que devuelva un
   `TemplateResponse` (con `@NoCSRFRequired`).
3. Crear `templates/alerts.php` y `js/alerts.js`.
4. Las URLs de datos siguen viniendo del array `routes` que el template
   inyecta en `#tr-app` data-attributes.

No se tocan controllers de API ni el servicio.

## Punto de extensión: añadir un nuevo dato a sincronizar

Caso típico: querer guardar también órdenes pendientes (no solo
ejecutadas).

1. Modificar `python/fetch_wrapper.py` para añadir el fetch nuevo y
   escribir, p.ej., `orders_pending.json`.
2. Añadir `'orders_pending.json'` a la whitelist en `TrService::dataPath()`.
3. Añadir `'orders_pending' => 'orders_pending.json'` en
   `ApiController::data()`.
4. Cualquier nueva vista que lo quiera consumir lo pide vía
   `dataUrl('orders_pending')`.

`fetch_wrapper.py` es el único punto donde se decide qué se baja y cómo se
estructura — todo lo demás es presentación.
