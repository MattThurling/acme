"""Acme Ltd — demo dental equipment supplier.

Demonstrates integration with the Medifinance public API:

* ``POST /api/quotes/`` — used to price each product as "from £X/month" on
  the shop page.
* ``POST /api/deals/``  — used by the customer "Get Finance" button and the
  staff portal to create a finance application in the Medifinance CRM.

Both calls are proxied server-side so the bearer API key is never exposed
to the browser. Configure via environment (or a ``.env`` file):

    MEDIFINANCE_API_URL   base URL of the Medifinance app (default http://localhost:8000)
    MEDIFINANCE_API_KEY   bearer key issued to Acme Ltd in the Medifinance admin
"""

import os
import time

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

load_dotenv()

API_BASE = os.environ.get("MEDIFINANCE_API_URL", "http://localhost:8000").rstrip("/")
API_KEY = os.environ.get("MEDIFINANCE_API_KEY", "")

# Term used for the indicative "from £X/month" price on the shop page.
QUOTE_TERM_MONTHS = 60
QUOTE_CACHE_TTL_SECONDS = 300

PRODUCTS = [
    {
        "id": "cbct-scanner",
        "name": "OrthoVision 3D CBCT Scanner",
        "description": "Cone-beam CT with full-arch 3D imaging, low-dose "
                       "protocols and chairside treatment planning software.",
        "price": 64500,
    },
    {
        "id": "cadcam-mill",
        "name": "CeraMill Pro CAD/CAM Milling Unit",
        "description": "5-axis wet/dry milling for same-day crowns, bridges "
                       "and implant abutments. Includes design suite licence.",
        "price": 48900,
    },
    {
        "id": "chair-package",
        "name": "ErgoDent Signature Surgery Package",
        "description": "Premium treatment centre: chair, delivery unit, "
                       "operating light and stools, fully installed.",
        "price": 32750,
    },
    {
        "id": "panoramic-xray",
        "name": "PanoraMax OPG/Ceph X-ray System",
        "description": "Digital panoramic and cephalometric imaging with "
                       "automatic patient positioning.",
        "price": 27400,
    },
    {
        "id": "intraoral-scanner",
        "name": "ScanRite IO Intraoral Scanner",
        "description": "Powder-free full-colour intraoral scanning with "
                       "open STL export and cart workstation.",
        "price": 18950,
    },
    {
        "id": "sterilisation-suite",
        "name": "SteriSafe Decontamination Suite",
        "description": "B-class autoclave, washer-disinfector and reverse "
                       "osmosis unit — a complete compliant decon room.",
        "price": 14200,
    },
]

app = Flask(__name__)

_quote_cache: dict[int, tuple[float, dict | None]] = {}


def _product(product_id: str) -> dict | None:
    return next((p for p in PRODUCTS if p["id"] == product_id), None)


def _api_headers() -> dict:
    return {"Authorization": f"Bearer {API_KEY}"}


def fetch_quote(amount: int) -> dict | None:
    """Indicative quote for `amount` over QUOTE_TERM_MONTHS, or None if the
    API is unreachable / has no rate for it. Cached briefly so a page load
    doesn't hammer the quotes endpoint once per product."""
    cached = _quote_cache.get(amount)
    if cached and time.time() - cached[0] < QUOTE_CACHE_TTL_SECONDS:
        return cached[1]
    quote = None
    try:
        resp = requests.post(
            f"{API_BASE}/api/quotes/",
            json={"amount": amount, "term_months": QUOTE_TERM_MONTHS},
            headers=_api_headers(),
            timeout=5,
        )
        if resp.status_code == 200:
            quote = resp.json()
    except requests.RequestException:
        pass
    _quote_cache[amount] = (time.time(), quote)
    return quote


def create_deal(*, product: dict, first_name: str, last_name: str,
                email: str, ltd: bool, source: str) -> tuple[dict, int]:
    """POST /api/deals/ and translate the outcome into a (payload, status)
    the templates/JS can show to a human."""
    body = {
        "name": f"{product['name']} — Acme Ltd ({source})",
        "amount": product["price"],
        "first_name": first_name,
        "last_name": last_name,
        "email": email,
        "ltd": ltd,
    }
    try:
        resp = requests.post(
            f"{API_BASE}/api/deals/",
            json=body,
            headers=_api_headers(),
            timeout=10,
        )
    except requests.RequestException:
        return {"ok": False, "message": "Could not reach the finance provider. "
                                        "Please try again shortly."}, 502

    try:
        data = resp.json()
    except ValueError:
        data = {}

    if resp.status_code in (200, 201):
        if data.get("deduplicated"):
            message = ("We already have a recent application for this email "
                       "address — check your inbox for the application link.")
        else:
            message = ("Application received! Check your email for a secure "
                       "link to complete your finance application.")
        return {"ok": True, "deal_id": data.get("id"),
                "deduplicated": bool(data.get("deduplicated")),
                "message": message}, 200

    friendly = {
        400: data.get("detail", "Some of the details were invalid."),
        401: "Finance service authorisation failed — Acme's API key is "
             "missing or has been revoked.",
        429: "Too many applications submitted just now — please try again "
             "in a little while.",
        503: "Finance applications are temporarily unavailable.",
    }
    message = friendly.get(resp.status_code,
                           "Something went wrong submitting your application.")
    return {"ok": False, "message": message,
            "error": data.get("error"), "status": resp.status_code}, resp.status_code


@app.route("/")
def shop():
    products = [{**p, "quote": fetch_quote(p["price"])} for p in PRODUCTS]
    return render_template("shop.html", products=products,
                           term_months=QUOTE_TERM_MONTHS)


@app.post("/api/finance")
def finance():
    """Called by the shop page's Get Finance modal (fetch/JSON)."""
    data = request.get_json(silent=True) or {}
    product = _product(str(data.get("product_id", "")))
    first_name = str(data.get("first_name", "")).strip()
    last_name = str(data.get("last_name", "")).strip()
    email = str(data.get("email", "")).strip()
    if product is None or not (first_name and last_name and email):
        return jsonify({"ok": False,
                        "message": "Please fill in all the fields."}), 400
    payload, status = create_deal(
        product=product,
        first_name=first_name,
        last_name=last_name,
        email=email,
        ltd=bool(data.get("ltd")),
        source="online store",
    )
    return jsonify(payload), status


@app.route("/portal", methods=["GET", "POST"])
def portal():
    result = None
    if request.method == "POST":
        product = _product(request.form.get("product_id", ""))
        first_name = request.form.get("first_name", "").strip()
        last_name = request.form.get("last_name", "").strip()
        email = request.form.get("email", "").strip()
        if product is None or not (first_name and last_name and email):
            result = {"ok": False, "message": "Please fill in all the fields."}
        else:
            result, _ = create_deal(
                product=product,
                first_name=first_name,
                last_name=last_name,
                email=email,
                ltd=request.form.get("ltd") == "on",
                source="staff portal",
            )
            result["product_name"] = product["name"]
            result["customer"] = f"{first_name} {last_name} <{email}>"
    return render_template("portal.html", products=PRODUCTS, result=result)


if __name__ == "__main__":
    # 5001: macOS AirPlay squats on 5000.
    app.run(debug=True, port=int(os.environ.get("PORT", 5001)))
