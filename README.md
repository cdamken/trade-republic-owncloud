# trade-republic-owncloud

App para **ownCloud 10** que da a cada usuario su propio dashboard de
**Trade Republic**. El teléfono, el PIN y los datos descargados viven aislados
por usuario dentro del propio ownCloud.

> ⚠️ **No oficial.** No está afiliada, endorsed ni patrocinada por Trade
> Republic Bank GmbH. Hecha por ingeniería inversa de su WebSocket interno
> (vía [`tr-api`](https://github.com/cdamken/tr-api)). Los endpoints pueden
> cambiar sin aviso. Usar bajo tu propio riesgo.

---

## Qué hace

- Aparece como un app más en la barra de navegación de ownCloud, junto a
  Files, Calendar, etc.
- Cada usuario:
  - Configura una vez su **teléfono (E.164)** + **PIN** de Trade Republic
    desde la propia app (modal **⚙ Cuenta**). El PIN se cifra antes de
    guardarse.
  - Verifica el **código de 4 dígitos** que TR le envía a su app móvil la
    primera vez (después la sesión se reusa mientras las cookies sigan vivas).
  - Descarga su portafolio (todas las posiciones con precio actual, precio
    promedio y P&L), efectivo en EUR, transacciones (depósitos, retiros,
    compras, ventas, dividendos, intereses) y analytics (cash flow por mes,
    P&L de por vida, distribución por categoría, historial de patrimonio).
  - Renderiza un dashboard oscuro con resumen, top movers, tabla buscable
    + ordenable de posiciones, y una página de analytics con cash flow,
    dividendos, allocation y patrimonio histórico.
- **Aislamiento por usuario garantizado por construcción** — ver
  [ARCHITECTURE.md](ARCHITECTURE.md).

## Diferencia con `Trade-Republic-Dashboard`

|                       | [Trade-Republic-Dashboard](https://github.com/cdamken/trade-republic-dashboard) | **trade-republic-owncloud (este repo)** |
|-----------------------|--------------------------------------------------------------------------|-----------------------------------------|
| Forma                 | Script local Python + browser en localhost                               | App de ownCloud multi-usuario           |
| Quién la ejecuta      | Tú en tu Mac                                                             | Tu instancia de ownCloud                |
| Datos por usuario     | N/A (un solo usuario)                                                    | Sí, aislados en `{datadir}/<uid>/trade_republic/`   |
| Credenciales          | `~/.pytr/credentials` con `0600` en tu home                              | DB de ownCloud, PIN cifrado con `ICrypto` |
| Acceso remoto         | No (solo localhost)                                                      | Sí (vía URL de tu ownCloud, con su login) |
| Auto-actualización    | Manual con `./dashboard.sh`                                              | Botón ⟳ Actualizar en el header         |

Si solo quieres verlo tú en tu máquina, usa `Trade-Republic-Dashboard`. Si
quieres que varios usuarios de tu ownCloud lo tengan, este es el repo.

## Diferencia con `gbm-owncloud`

Esta app es el equivalente para Trade Republic de
[`gbm-owncloud`](https://github.com/cdamken/gbm-owncloud) (GBM México).
Misma arquitectura (PageController + ApiController + Service + Python
wrapper), mismos exit codes mapeados a HTTP, mismas garantías de aislamiento
por usuario. Lo que cambia:

- **Credenciales**: teléfono + PIN, no email + password.
- **2FA**: código de **4 dígitos push** que TR envía a tu app móvil, no
  TOTP de 6 dígitos.
- **Lib backend**: [`tr-api`](https://github.com/cdamken/tr-api),
  no [`gbm-mx-api`](https://github.com/cdamken/gbm-mx-api).
- **Datos**: portafolio + transacciones + analytics, no posiciones por
  cuenta + órdenes.

## Dependencias

- **ownCloud 10.x**.
- **Python 3.10+** en el server.
- **[`tr-api`](https://github.com/cdamken/tr-api)** instalado en ese Python
  (un venv dedicado funciona perfecto). Necesita `[browser]` extra para
  Playwright (TR mete un WAF de Cloudflare en el login inicial).

Ver [INSTALL.md](INSTALL.md) para los pasos exactos.

## Instalación corta

```bash
# 1. Venv con la lib Python
sudo python3 -m venv /opt/tr-venv
sudo /opt/tr-venv/bin/pip install 'tr-api[browser]'
sudo /opt/tr-venv/bin/playwright install chromium

# 2. Clonar el app a la carpeta de apps de ownCloud
cd /var/www/owncloud/apps
sudo -u www-data git clone https://github.com/cdamken/trade-republic-owncloud.git trade_republic

# 3. Habilitar y apuntar al venv
sudo -u www-data php /var/www/owncloud/occ app:enable trade_republic
sudo -u www-data php /var/www/owncloud/occ config:system:set trade_republic.python_bin --value=/opt/tr-venv/bin/python
```

Listo — cada usuario abre `https://tu-owncloud/index.php/apps/trade_republic/`, mete
teléfono + PIN en el modal, introduce el código de 4 dígitos que le llega a
su app de TR, y ya está.

## Uso

1. **Primera vez** — al entrar al app aparece el modal **⚙ Cuenta** pidiendo
   teléfono (formato `+491701234567`) y PIN.
2. **Al guardar** — se dispara una sincronización. Como aún no hay cookies de
   sesión, TR envía un push con un código de **4 dígitos** a tu móvil y se
   abre el modal **🔐 Código de Trade Republic**.
3. **Tecleas el código** — se completa el login, se guardan las cookies, se
   descarga tu portafolio, las transacciones y se computan los analytics.
   Aparece el dashboard.
4. **Update** — el botón **⟳ Actualizar** rebaja datos. Si las cookies siguen
   vivas no pide código; si TR las invalidó, vuelve a abrir el modal de MFA.
5. **Cambiar credenciales** — el botón **⚙ Cuenta** reabre el modal.
6. **Borrar cuenta** — desde el modal de **⚙ Cuenta**, botón **Borrar
   cuenta** (escribe `delete` para confirmar). Limpia teléfono, PIN, cookies
   y todos los datos descargados.

## Configuración

Valores del server (`occ config:system:set ...`):

| Clave            | Default     | Para qué |
|------------------|-------------|----------|
| `trade_republic.python_bin`  | `python3`   | Ruta al Python con `tr-api` instalado. |

```bash
sudo -u www-data php occ config:system:set trade_republic.python_bin --value=/opt/tr-venv/bin/python
```

## Dónde se guarda cada cosa

| Dato | Lugar |
|---|---|
| Teléfono (por usuario) | DB de ownCloud (`oc_preferences`) |
| PIN (por usuario, **cifrado**) | DB de ownCloud (`oc_preferences`), cifrado con `ICrypto` |
| Cookies de sesión TR | Filesystem: `{datadir}/<uid>/trade_republic/profile/.tr-api/...` (`0700`) |
| Portafolio / transacciones / analytics | Filesystem: `{datadir}/<uid>/trade_republic/*.{json,csv}` |
| Pending login (entre push y submit) | Filesystem: `{datadir}/<uid>/trade_republic/.pending_login.json` (`0600`, TTL 5 min) |
| `fetch.log` del último run | Filesystem: `{datadir}/<uid>/trade_republic/fetch.log` |
| `trade_republic.python_bin` | `config.php` de ownCloud |

Detalle completo y razones en [ARCHITECTURE.md](ARCHITECTURE.md).

## Desinstalar (limpio)

```bash
sudo -u www-data php occ app:disable trade_republic
# por cada usuario que la haya usado:
sudo -u www-data php occ user:setting <uid> trade_republic --delete
sudo rm -rf {datadir}/<uid>/trade_republic/
```

## Estado

Alpha. Estructuralmente paralela a `gbm-owncloud` (que sí ha rodado en
producción casera). Si lo pruebas y rompe algo, abre un
[issue](https://github.com/cdamken/trade-republic-owncloud/issues).

## Licencia

[Business Source License 1.1](LICENSE) — alineada con `tr-api` y
`Trade-Republic-Dashboard`. Convierte a Apache 2.0 a los 4 años. Si quieres
usarla en producción comercial antes de eso, escríbeme.

## Créditos

- API Trade Republic → [`tr-api`](https://github.com/cdamken/tr-api).
- Dashboard original (versión local) → [`Trade-Republic-Dashboard`](https://github.com/cdamken/trade-republic-dashboard).
- App de ownCloud (este repo) → Carlos Damken.
- Inspiración estructural → [`gbm-owncloud`](https://github.com/cdamken/gbm-owncloud) y las apps `pong` / `drawio` de ownCloud.
