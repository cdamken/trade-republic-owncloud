# CHANGELOG

## 0.1.0 — 2026-05-26

Primera versión.

### Funcionalidad

- App de ownCloud 10 (`apps/trade_republic/`) con namespace `OCA\TradeRepublic` y app
  id `tr`.
- Entrada en la barra de navegación ("Trade Republic") con icono `app.svg`.
- Dos páginas:
  - `/` — dashboard de portafolio (resumen, top movers, tabla buscable
    con filtros por rango de valor y por P&L).
  - `/analytics` — cash flow mensual, dividendos, distribución por
    categoría, historial de patrimonio.
- Endpoints JSON `/data/{type}` para `portfolio`, `analytics`,
  `net_worth_history`, `last_update`.
- Configuración por usuario (`⚙ Cuenta`): teléfono E.164 + PIN. PIN
  cifrado con `ICrypto`.
- Flujo de login two-step de Trade Republic:
  - POST `/api/update` sin código → `initiate_login` → TR push de 4 dígitos
    → exit 10 / `mfa_required`.
  - POST `/api/update` con `mfa_code` → `complete_login` → cookies
    guardadas → fetch + analytics.
- Botón "Borrar cuenta" que limpia teléfono, PIN, cookies y datos
  descargados (confirmación tipo `delete`).
- Checkbox "Descarga completa" en el modal de MFA: fuerza re-bajar todo el
  historial de transacciones (vs. el modo incremental por default).
- Aislamiento por usuario garantizado por `TrService::userId()` (lazy
  desde `IUserSession`) + whitelist de archivos + redirección de `HOME`
  para que `tr-api` escriba sus cookies dentro del dir per-user.
- Configuración del server: `trade_republic.python_bin` (default `python3`).

### Estructura del repo

```
appinfo/{info.xml, app.php, routes.php}
lib/Application.php
lib/Controller/{Page,Api}Controller.php
lib/Service/TrService.php
python/fetch_wrapper.py
templates/{main,analytics}.php
js/{dashboard,analytics}.js
css/dashboard.css
img/app.svg
```

### Notas

- Estructuralmente paralela a `gbm-owncloud@0.4.0`. Mismos exit codes,
  mismo modelo de aislamiento, misma manera de inyectar credenciales por
  env vars al wrapper Python.
- Lib backend: [`tr-api`](https://github.com/cdamken/tr-api) con extras
  `[browser]` (Playwright + Chromium) para resolver el WAF de Cloudflare
  que TR pone delante de auth.
