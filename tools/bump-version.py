#!/usr/bin/env python3
"""Ajoute ?v=<version> à toutes les références internes (modules JS, CSS, scripts vendor).
Évite qu'un navigateur mélange des fichiers d'anciennes et de nouvelles versions après une mise à jour.
Usage : python3 tools/bump-version.py   (à lancer avant chaque commit qui modifie js/, css/ ou vendor/)"""
import re, pathlib, datetime
root = pathlib.Path(__file__).resolve().parent.parent
v = datetime.datetime.now().strftime('%Y%m%d%H%M')
pat_js = re.compile(r"""((?:from|import)\s*\(?\s*['"])(\.{1,2}/[^'"?]+\.js)(\?v=\w+)?(['"])""")
for f in (root / 'js').glob('*.js'):
    s = f.read_text(); n = pat_js.sub(lambda m: f"{m[1]}{m[2]}?v={v}{m[4]}", s)
    if n != s: f.write_text(n)
idx = root / 'index.html'; s = idx.read_text()
s = re.sub(r"""((?:src|href)=")((?:js|css|vendor)/[^"?]+\.(?:js|css))(\?v=\w+)?(")""", lambda m: f"{m[1]}{m[2]}?v={v}{m[4]}", s)
idx.write_text(s)
f = root / 'js' / 'blocks.js'; s = f.read_text()
s = re.sub(r"'vendor/mermaid\.min\.js(\?v=\w+)?'", f"'vendor/mermaid.min.js?v={v}'", s); f.write_text(s)
print('version', v)
