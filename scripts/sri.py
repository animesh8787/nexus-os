"""Prints SRI (sha384) hashes for every third-party script Nexus OS loads, and checks the
CDN sends CORS headers (required for integrity checks). Run: python scripts/sri.py
Use --check to compare against sri.js instead of printing (exits 1 on mismatch)."""
import base64, hashlib, re, sys, urllib.request

URLS = [
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js",
]

def fetch(u):
    req = urllib.request.Request(u, headers={"Origin": "https://example.github.io", "User-Agent": "nexus-sri"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read(), r.headers.get("Access-Control-Allow-Origin")

result = {}
for u in URLS:
    body, cors = fetch(u)
    result[u] = "sha384-" + base64.b64encode(hashlib.sha384(body).digest()).decode()
    print(("OK  " if cors else "NO-CORS ") + u.split("/")[-1].ljust(34), "%8d bytes" % len(body), "cors=" + str(cors), file=sys.stderr)

if "--check" in sys.argv:
    src = open("sri.js", encoding="utf-8").read()
    bad = [u for u, h in result.items() if h not in src]
    if bad:
        print("MISMATCH:", *bad, sep="\n  "); sys.exit(1)
    print("sri.js matches the live files"); sys.exit(0)
for u, h in result.items():
    print('  "%s": "%s",' % (u, h))
