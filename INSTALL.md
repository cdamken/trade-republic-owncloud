# INSTALL — trade-republic-owncloud

Pasos exactos para instalar el app en una instancia de ownCloud 10. Se asume
Ubuntu 20.04+ / Debian 11+ con Apache + PHP-FPM, pero el app es agnóstico al
SO; solo necesita Python 3.10+ con `tr-api` instalado y un ownCloud 10.x.

## 1. Python 3.10+ con `tr-api`

`tr-api` requiere Python 3.10 o superior. Si tu sistema solo tiene 3.8 (típico
en Ubuntu 20.04), instala uno standalone — un venv aparte funciona perfecto y
no toca el sistema.

```bash
# Si ya tienes python3.10+ en el server:
sudo python3 -m venv /opt/tr-venv

# Si no, en Ubuntu 22.04+ basta con:
sudo apt install python3.10-venv
sudo python3.10 -m venv /opt/tr-venv

# En Ubuntu 20.04 (focal), deadsnakes ya no publica para focal. La salida es
# instalar Python 3.11 standalone con uv o pyenv y crear el venv a partir de
# ese binario. Detalle abajo si te aplica.
```

Instalar `tr-api` con extras de browser (para el WAF de TR):

```bash
sudo /opt/tr-venv/bin/pip install --upgrade pip
sudo /opt/tr-venv/bin/pip install 'tr-api[browser]'
sudo /opt/tr-venv/bin/playwright install chromium

# Verificar
sudo /opt/tr-venv/bin/python -c "import tr_api; print(tr_api.__version__)"
```

### Si estás en Ubuntu 20.04 (focal)

`python3.10-venv` no se publica para focal. Opciones:

```bash
# Opción A: pyenv
curl https://pyenv.run | bash
pyenv install 3.11.9
sudo $(pyenv which python) -m venv /opt/tr-venv

# Opción B: uv (más simple)
curl -LsSf https://astral.sh/uv/install.sh | sh
sudo uv venv --python 3.11 /opt/tr-venv
```

Después continúa con `pip install 'tr-api[browser]'` igual que arriba.

## 2. Permisos del venv y de Playwright

ownCloud corre como `www-data`. El subprocess que arranca PHP necesita poder
**leer** el venv y **escribir** la cache de Playwright. Lo más simple:

```bash
sudo chown -R root:www-data /opt/tr-venv
sudo chmod -R g+rX /opt/tr-venv

# Playwright cachea Chromium en ~/.cache. Como mandamos HOME=tempdir desde PHP,
# Playwright lo recreará ahí cada vez. Para evitarlo, exporta una cache
# compartida via env (alternativa: dejar que el primer fetch tarde un poco más).
sudo mkdir -p /var/cache/tr-playwright
sudo chown www-data:www-data /var/cache/tr-playwright
sudo chmod 0750 /var/cache/tr-playwright
```

Si quieres usar la cache compartida, añade en tu configuración de PHP-FPM
(pool `www`) algo como:

```ini
env[PLAYWRIGHT_BROWSERS_PATH] = /var/cache/tr-playwright
```

y reinicia `php-fpm`. (Opcional — si lo omites, cada usuario reinstalará
chromium en su tempdir la primera vez.)

## 3. Clonar y habilitar el app

```bash
cd /var/www/owncloud/apps
sudo -u www-data git clone https://github.com/cdamken/trade-republic-owncloud.git tr

# Verificar permisos
sudo -u www-data ls -la /var/www/owncloud/apps/trade_republic

# Habilitar
sudo -u www-data php /var/www/owncloud/occ app:enable trade_republic

# Apuntar al venv
sudo -u www-data php /var/www/owncloud/occ config:system:set trade_republic.python_bin --value=/opt/tr-venv/bin/python
```

## 4. Smoke test

```bash
# Forzar que el wrapper se queje claramente si algo está mal:
sudo -u www-data /opt/tr-venv/bin/python /var/www/owncloud/apps/trade_republic/python/fetch_wrapper.py --help
```

Debería imprimir el `argparse` help con `--profile-dir`, `--data-dir`,
`--mfa-code` y `--full`. Si dice "tr-api is not installed", revisa la ruta
del venv y el comando `config:system:set`.

## 5. Primer login desde el browser

Abre `https://tu-owncloud/index.php/apps/trade_republic/`:

1. Aparece el modal **⚙ Cuenta**. Mete teléfono (`+491701234567`) y PIN.
2. Al guardar, dispara un /update. Como no hay cookies, TR envía un código
   push de 4 dígitos a tu app de TR en tu móvil.
3. Se abre el modal **🔐 Código de Trade Republic**. Tecléalo y dale a
   Actualizar.
4. El backend descarga tu portafolio, transacciones y computa analytics.
   Tarda entre 30 s y 2 min según el tamaño del historial.

## 6. Troubleshooting

| Síntoma | Causa probable / fix |
|---|---|
| Modal de error "tr-api is not installed" | El `trade_republic.python_bin` no apunta al venv correcto. Verifica con `occ config:system:get trade_republic.python_bin`. |
| `playwright._impl._api_types.Error: Executable doesn't exist` | Falta `playwright install chromium` en el venv, o `www-data` no puede escribir en `$HOME` de PHP. Mira la sección 2. |
| El modal de MFA se reabre con "Código incorrecto" varias veces | El código expira en ~60 s. Si te llega tarde, espera al siguiente push (vuelve a darle al botón Actualizar). |
| `rate_limited` | TR limita los intentos de login. Espera 5–15 min. Esta app cachea el `processId` del último push 5 min y reutiliza, justo para no quemar intentos. |
| `auth_failed` | Teléfono o PIN incorrecto. Reabre **⚙ Cuenta** y guárdalos otra vez. |
| El fetch tarda > 2 min y se corta | El timeout del servicio PHP es 240 s. Si tu historial es muy grande, usa el checkbox "Descarga completa" del modal de MFA solo cuando lo necesites — el resto del tiempo el modo incremental tarda 5–15 s. |

## 7. Datos por usuario

Después del primer fetch, en disco verás:

```
{datadirectory}/<uid>/trade_republic/
├── profile/                         ← cookies + perfil de tr-api (0700)
│   └── .tr-api/profiles/<phone>/
├── portfolio.json                   ← consumido por el dashboard
├── portfolio_raw.json               ← payload crudo de TR (debug)
├── account_transactions.csv         ← timeline en formato CSV
├── analytics.json                   ← cash flow / dividendos / allocation
├── net_worth_history.json           ← snapshot diario
├── last_update.date
└── fetch.log                        ← stdout/stderr del último run
```
