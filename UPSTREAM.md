# Relación con `Trade-Republic-Dashboard` (upstream)

[`Trade-Republic-Dashboard`](https://github.com/cdamken/trade-republic-dashboard)
es la base — el dashboard local de un solo usuario que corre en `localhost`.

**Este repo es un port** para ownCloud 10 multi-usuario. Las dos
instalaciones son **independientes**: no comparten credenciales, datos, ni
estado de sesión. Una corre en tu Mac, la otra en tu server ownCloud.

Este doc enumera, una a una, las divergencias respecto al upstream y por
qué existen. Si vienes del repo local, esta es tu hoja de ruta.

> Cuando upstream se mueve, este port debe alinearse a menos que la
> divergencia sea estructural (las marcadas con 🔒). Cualquier otra
> divergencia debe converger.

---

## Mapa de archivos

| Upstream (TR-Dashboard) | Port (este repo) | Cambio |
|---|---|---|
| `app/tr_fetch.py` (717 líneas) | `python/fetch_wrapper.py` (746) | Fusionado con `analyze_analytics.py` |
| `app/analyze_analytics.py` (190) | `python/fetch_wrapper.py::compute_analytics` | Inline (no subprocess) |
| `app/server.py` | `lib/Controller/ApiController.php` | PHP en lugar de Python HTTP |
| `app/index.html` | `templates/main.php` + `js/dashboard.js` + `css/dashboard.css` | Template ownCloud, CSP-friendly |
| `app/analytics.html` | `templates/analytics.php` + `js/analytics.js` | Idem |
| `dashboard.sh` | n/a — la app la habilita `occ app:enable` | No hay script |
| `~/.pytr/credentials` (texto plano) | DB `oc_preferences` (PIN cifrado) | Per-user, cifrado |
| `~/.tr-api/profiles/<phone>/` | `{datadir}/<uid>/trade_republic/profile/.tr-api/profiles/<phone>/` | Per-user, via `HOME` override |
| `DATA/` (raíz del repo) | `{datadir}/<uid>/trade_republic/` | Per-user, fuera de `files/` |

---

## Divergencias estructurales 🔒 (no convergen)

Forzadas por el contexto ownCloud. Upstream nunca tendrá esto, y este port
nunca quitará esto.

### 1. Credenciales en `oc_preferences`, no en `~/.pytr/credentials`

- **Upstream**: lee `~/.pytr/credentials` (línea 1 teléfono, línea 2 PIN,
  texto plano, `0600`).
- **Port**: lee `TR_PHONE` y `TR_PIN` de env vars. Las inyecta
  `TrService::runFetch()` después de descifrar el PIN con `ICrypto`.
- **Por qué**: multi-usuario. No hay home único; `www-data` no podría
  separar credenciales por sesión.

### 2. Profile dir per-user via `HOME` redirect

- **Upstream**: `tr-api` escribe en `~/.tr-api/profiles/<phone>/`.
- **Port**: `fetch_wrapper.py` setea `os.environ["HOME"] = profile_dir`
  antes de importar `tr-api`, así sus paths internos quedan dentro de
  `{datadir}/<uid>/trade_republic/profile/.tr-api/...`.
- **Por qué**: aislar las cookies de TR de cada usuario de ownCloud.

### 3. Pending login state per-user

- **Upstream**: `.pending_login.json` en `PROJECT_DIR/DATA/`.
- **Port**: `.pending_login.json` en `{datadir}/<uid>/trade_republic/`.
- **Por qué**: same as #2.

### 4. Data dir per-user

- **Upstream**: `PROJECT_DIR/DATA/` (descubierto vía
  `Path(__file__).resolve().parent.parent / "DATA"`).
- **Port**: `--data-dir` se pasa por CLI desde PHP. Whitelist en
  `TrService::dataPath()` previene path traversal.
- **Por qué**: PHP debe controlar la ruta para garantizar aislamiento.

### 5. Login MFA: ya no hay TTY

- **Upstream**: `tr_fetch.py` puede leer el código MFA por stdin si está en
  modo interactivo (`--non-interactive` lo evita).
- **Port**: **siempre** non-interactive. `--mfa-code` es la única forma de
  pasar el código. PHP no puede hablar a stdin después de `proc_open`.
- **Por qué**: el browser entrega el código vía POST `/api/update`; PHP
  arranca un subprocess fresco con el código en `argv`.

### 6. Analytics computado inline

- **Upstream**: `tr_fetch.py` corre `subprocess.run([sys.executable,
  "analyze_analytics.py"])` al final.
- **Port**: `fetch_wrapper.py::compute_analytics()` lo hace en el mismo
  proceso.
- **Por qué**: un solo subprocess desde PHP → un solo timeout, un solo
  exit code, un solo log. Menos partes móviles.

### 7. Update + MFA flow vive en PHP/JS, no en Python HTTP server

- **Upstream**: `app/server.py` corre en `localhost:8085`, sirve
  `index.html` estático y endpoints `/update`, `/config`, `/reset`.
- **Port**: rutas reales de ownCloud:
  - `GET /apps/trade_republic/` → `PageController::index`
  - `POST /apps/trade_republic/api/update` → `ApiController::update`
  - etc.
- **Por qué**: ownCloud ya tiene auth, CSRF, sesiones, navegación. Levantar
  un Python HTTP server sería redundante e inseguro (puerto abierto,
  sin CSRF, sin login).

### 8. Cache compartida de Chromium para Playwright

- **Upstream**: cada usuario instala Playwright/Chromium localmente
  (`pipx install pytr` + `playwright install chromium`) en su home.
- **Port**: instalación una sola vez en `/var/cache/tr-playwright/`,
  pasada al subprocess vía `PLAYWRIGHT_BROWSERS_PATH`. Configurable con
  `occ config:system:set trade_republic.playwright_browsers_path`.
- **Por qué**: la app redirige `HOME` per-user → sin la cache compartida,
  cada usuario re-bajaría ~150 MB en su primer login.

### 9. `--full` aparece también en el modal MFA

- **Upstream**: `--full` es solo CLI (`./dashboard.sh full`).
- **Port**: el modal MFA tiene un checkbox "Descarga completa" que pasa
  `{full: true}` al `POST /api/update`.
- **Por qué**: el usuario no tiene shell access al server; necesita una
  forma desde el browser.

### 10. Botón "Borrar cuenta" (no existe en upstream)

- **Upstream**: borrado manual con `./dashboard.sh reset` (CLI).
- **Port**: botón rojo en el modal **⚙ Cuenta** con confirmación tipo
  `delete`. Llama `POST /api/reset` → `TrService::reset()` que borra prefs
  y `rm -rf {datadir}/<uid>/trade_republic/`.
- **Por qué**: same as #9.

---

## Divergencias intencionales (no estructurales, pero justificadas)

Decisiones de diseño que mejoran el UX del port y no aplicarían al script
local. Documentadas para que un futuro merge desde upstream no las
sobrescriba accidentalmente.

### 11. `last_update.date` incluye hora

- **Upstream**: `datetime.now().strftime("%Y-%m-%d")` → `"2026-05-23"`.
- **Port**: `datetime.now().strftime("%Y-%m-%d %H:%M:%S")` →
  `"2026-05-23 14:32:01"`.
- **Por qué**: el header del port muestra "Última actualización: 23 may
  2026, 14:32"; el local muestra "2026-05-23". Más útil cuando varios
  usuarios refrescan a distintas horas del día.
- **Compatibilidad**: la lógica de incremental usa `.strip().split()[0]`
  en ambos lados, así que la fecha sigue siendo extraíble igual.

### 12. `net_worth_history.json` guarda valores detallados

- **Upstream**: `analyze_analytics.py` sobrescribe el archivo con
  `[{date, value}]` (solo dos campos). Trim a 180 días.
- **Port**: `_append_net_worth_history` escribe
  `{date, value, net_value, depot, cash, pl_eur}` y `compute_analytics` lo
  deja como está. Trim a 180 días (alineado con upstream desde
  [bb92d81+1]).
- **Por qué**: la página de analytics del port tiene columnas para
  Depósito y Efectivo además del valor total. El JS de upstream solo lee
  `value`, así que sigue siendo compatible si alguien migra del local al
  port (el campo `value` está presente).

### 13. Schema de cookies / pending login

- **Upstream**: `_pending_login.json` con `{phone, process_id, issued_at}`,
  TTL 5 min.
- **Port**: idéntico. **Sin divergencia** — incluido aquí para evitar
  confusión.

---

## Convergencia esperada (alineado con upstream a propósito)

Áreas donde explícitamente queremos comportamiento idéntico al local.
Si encuentras drift aquí, **es un bug** que hay que cerrar.

| Área | Comportamiento esperado |
|---|---|
| `EVENT_TYPE_MAP` (TR eventType → CSV Type) | Idéntico carácter por carácter |
| `_shape_portfolio` (mapeo TR JSON → portfolio.json) | Mismos field names, mismas reglas de fallback, misma truncación de nombres a 25 chars |
| Schema de `account_transactions.csv` | Mismas columnas, mismo `;` separador, mismo merge dedupe key `Date|Type|Value|Note` |
| Schema de `portfolio.json` | Misma estructura (`summary`, `top_25`, `winners_50plus`, `losers_25minus`, `all_positions`, `zero_value_positions`) |
| Schema de `analytics.json` | Mismas sub-keys (`cash_flow`, `dividends`, `allocation`, `history`) |
| Exit codes 0/10/11/12/20/21/30 | Mismos significados |
| Ventana incremental de transacciones (3 días overlap) | Idéntica |
| Categorización heurística allocation (ETFs / Crypto / Stocks / Cash) | Idéntica |
| Truncación de `net_worth_history` a 180 días | Idéntica |

---

## Cómo verificar que no haya drift accidental

Una sola fuente de divergencia es el wrapper:

```bash
# Desde la raíz del repo de la app:
diff -u <(sed -n '/^EVENT_TYPE_MAP/,/^}/p' python/fetch_wrapper.py) \
        <(sed -n '/^EVENT_TYPE_MAP/,/^}/p' ../Trade-Republic-Dashboard/app/tr_fetch.py)
```

Cualquier output ahí significa que el mapa de tipos divergió — investiga.
