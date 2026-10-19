"""Junta Trading Pedro en un único archivo "Trading Pedro.html" que funciona sin Python.

Uso:  python construir_html.py

Mete dentro del .html los estilos, el logo, la librería de gráficos y el código
(smc.js + standalone.js + app.js). Ejecútalo cada vez que cambies algo en web/
y envía el .html resultante.
"""
import base64
import os
import re
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
OUT = os.path.join(ROOT, "Trading Pedro.html")
LWC_URL = "https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js"
LWC_FILE = os.path.join(WEB, "vendor", "lightweight-charts-4.2.0.js")


def read(name):
    with open(os.path.join(WEB, name), encoding="utf-8") as f:
        return f.read()


def version():
    src = open(os.path.join(ROOT, "trading_pedro.py"), encoding="utf-8").read()
    return re.search(r'^VERSION = "([^"]+)"', src, re.M).group(1)


def charts_lib():
    """La librería se descarga una sola vez y se guarda en web/vendor/."""
    if not os.path.exists(LWC_FILE):
        os.makedirs(os.path.dirname(LWC_FILE), exist_ok=True)
        with urllib.request.urlopen(LWC_URL, timeout=60) as r:
            data = r.read()
        with open(LWC_FILE, "wb") as f:
            f.write(data)
    with open(LWC_FILE, encoding="utf-8") as f:
        return f.read()


def script(code):
    # "</script" dentro del código cerraría la etiqueta antes de tiempo
    return "<script>\n" + code.replace("</script", "<\\/script") + "\n</script>"


def main():
    html = read("index.html")
    logo = "data:image/svg+xml;base64," + base64.b64encode(read("logo.svg").encode()).decode()
    ver = version()

    html = html.replace('<link rel="stylesheet" href="style.css">', "<style>\n" + read("style.css") + "\n</style>")
    lwc_tag = f'<script src="{LWC_URL}"></script>'
    app_tag = '<script src="app.js"></script>'
    assert lwc_tag in html and app_tag in html, "index.html cambió: revisa las etiquetas <script>"
    html = html.replace(lwc_tag, script(charts_lib()))
    for name in ("binance.js", "smc.js", "calc.js"):
        tag = f'<script src="{name}"></script>'
        assert tag in html, f"index.html cambió: falta {name}"
        html = html.replace(tag, script(read(name)))
    html = html.replace(app_tag, "\n".join([
        f'<script>window.TP_VERSION = "{ver}";</script>',
        script(read("standalone.js")),
        script(read("app.js")),
    ]))
    html = html.replace('"logo.svg"', f'"{logo}"').replace("'logo.svg'", f"'{logo}'")

    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    print(f"Creado: {OUT}  ({os.path.getsize(OUT) // 1024} KB, versión {ver})")


if __name__ == "__main__":
    main()
