import os
import json
import hmac
import secrets
from datetime import datetime
from decimal import Decimal
from functools import wraps
from typing import Any
from urllib import error, request as urlrequest

import psycopg2
from bson import ObjectId
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, session
from pymongo import MongoClient


load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", secrets.token_hex(32))


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


PG_DSN = os.getenv("PG_DSN", "")
MONGO_URI = os.getenv("MONGO_URI", "")
MONGO_DB = os.getenv("MONGO_DB", "adopt-auth-test")
MONGO_AUTH_URI = os.getenv("MONGO_AUTH_URI", "")
MONGO_AUTH_DB = os.getenv("MONGO_AUTH_DB", "adopt-auth")
ACCESS_PASSWORD = os.getenv("ACCESS_PASSWORD", "2#Xv9!QmL7@rN4$kTp1Zy8")
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = env_bool("SESSION_COOKIE_SECURE", False)
DEAL_STATUS_LABELS = {
    0: "Сделка создана покупателем",
    10: "Продавец подтвердил сделку",
    20: "Продавец подтвердил передачу",
    40: "Сделка в состоянии спора",
    50: "Сделка успешно закрыта",
    60: "Сделка отменена",
}
MESSAGE_SENDER_LABELS = {
    10: "Покупатель",
    20: "Продавец",
    90: "Служба поддержки",
}
SYSTEM_MESSAGE_CODE_LABELS = {
    0: "Сделка создана покупателем",
    10: "Продавец подтвердил сделку",
    20: "Продавец подтвердил передачу",
    40: "Сделка в состоянии спора",
    50: "Сделка успешно закрыта",
    60: "Сделка отменена",
}
SUPPORT_BAN_API_URL = "https://api-support.apineural.com/api/v2/bans/ban"
SUPPORT_DISABLE_MANUAL_API_URL = (
    "https://api-support.apineural.com/api/v2/bans/disable-manual"
)


def json_safe(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def open_pg():
    if not PG_DSN:
        raise RuntimeError("PG_DSN is not configured")
    return psycopg2.connect(PG_DSN)


def open_mongo():
    if not MONGO_URI:
        raise RuntimeError("MONGO_URI is not configured")
    client = MongoClient(MONGO_URI)
    return client, client[MONGO_DB]


def open_mongo_auth():
    auth_uri = MONGO_AUTH_URI or MONGO_URI
    if not auth_uri:
        raise RuntimeError("MONGO_AUTH_URI or MONGO_URI is not configured")
    client = MongoClient(auth_uri)
    return client, client[MONGO_AUTH_DB]


def serialize_row(columns: list[str], row: tuple[Any, ...]) -> dict[str, Any]:
    return {columns[i]: json_safe(row[i]) for i in range(len(columns))}


def deal_status_label(status_value: Any) -> str:
    if status_value is None:
        return "Неизвестно"
    return DEAL_STATUS_LABELS.get(status_value, f"Статус {status_value}")


def sender_type_label(sender_type: Any) -> str:
    if sender_type is None:
        return "Неизвестно"
    return MESSAGE_SENDER_LABELS.get(sender_type, f"Тип {sender_type}")


def system_code_label(code: Any) -> str:
    if code is None:
        return ""
    return SYSTEM_MESSAGE_CODE_LABELS.get(code, f"Код {code}")


def is_system_message_code(code: Any) -> bool:
    return code in SYSTEM_MESSAGE_CODE_LABELS


def require_auth(view_func):
    @wraps(view_func)
    def wrapped(*args, **kwargs):
        if not session.get("authorized"):
            return jsonify({"error": "Требуется авторизация"}), 401
        return view_func(*args, **kwargs)

    return wrapped


def enrich_with_users(stores: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Temporary performance mode: skip Mongo ban checks and user enrichment.
    for store in stores:
        store["owner_user"] = None
        store["mongo_ban_scope"] = None
        store["is_banned_mongo"] = False
        store["is_banned"] = False

    return stores


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/healthz")
def healthz():
    return jsonify({"ok": True})


@app.route("/api/auth/status")
def auth_status():
    return jsonify({"authorized": bool(session.get("authorized"))})


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    payload = request.get_json(silent=True) or {}
    password = str(payload.get("password") or "")
    if not hmac.compare_digest(password, ACCESS_PASSWORD):
        return jsonify({"ok": False, "error": "Неверный пароль"}), 401
    session["authorized"] = True
    return jsonify({"ok": True})


@app.route("/api/stores")
@require_auth
def get_active_stores():
    search_query = (request.args.get("q") or "").strip()
    conn = open_pg()
    cur = conn.cursor()
    if search_query:
        like_value = f"%{search_query}%"
        cur.execute(
            """
            SELECT
                s.id,
                s.owner_id,
                s.alias,
                s.status,
                s.total_deals,
                COALESCE(ad.active_deals, 0) AS active_deals,
                s.feedbacks,
                s.deals_duration,
                s.rating,
                s.trust,
                s.is_online,
                s.created_at,
                s.updated_at
            FROM stores s
            LEFT JOIN (
                SELECT
                    d.store_id,
                    COUNT(*)::integer AS active_deals
                FROM deals d
                WHERE d.status NOT IN (50, 60)
                GROUP BY d.store_id
            ) ad ON ad.store_id = s.id
            WHERE
                CAST(s.id AS text) ILIKE %s
                OR s.owner_id ILIKE %s
                OR COALESCE(s.alias, '') ILIKE %s
            ORDER BY s.updated_at DESC
            LIMIT 500
            """,
            (like_value, like_value, like_value),
        )
    else:
        cur.execute(
            """
            SELECT
                s.id,
                s.owner_id,
                s.alias,
                s.status,
                s.total_deals,
                COALESCE(ad.active_deals, 0) AS active_deals,
                s.feedbacks,
                s.deals_duration,
                s.rating,
                s.trust,
                s.is_online,
                s.created_at,
                s.updated_at
            FROM stores s
            LEFT JOIN (
                SELECT
                    d.store_id,
                    COUNT(*)::integer AS active_deals
                FROM deals d
                WHERE d.status NOT IN (50, 60)
                GROUP BY d.store_id
            ) ad ON ad.store_id = s.id
            WHERE s.status = 2
            ORDER BY COALESCE(ad.active_deals, 0) DESC, s.updated_at DESC
            """
        )
    columns = [description[0] for description in cur.description]
    stores = [serialize_row(columns, row) for row in cur.fetchall()]
    cur.close()
    conn.close()

    stores = enrich_with_users(stores)
    return jsonify(stores)


@app.route("/api/stores/<store_id>/deals")
@require_auth
def get_store_deals(store_id: str):
    conn = open_pg()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT
            d.id,
            d.buyer_id,
            d.seller_id,
            d.store_id,
            d.account_id,
            d.status,
            d.source,
            d.duration,
            d.buyer_language,
            d.seller_language,
            d.expired_at,
            d.created_at,
            d.updated_at,
            sf.rating AS feedback_rating,
            sf.comment AS feedback_comment,
            sf.author_id AS feedback_author_id,
            sf.created_at AS feedback_created_at,
            pay.buyer_paid,
            item_meta.item_names,
            item_meta.game_names
        FROM deals d
        LEFT JOIN LATERAL (
            SELECT
                f.rating,
                f.comment,
                f.author_id,
                f.created_at
            FROM stores_feedbacks f
            WHERE f.deal_id = d.id
            ORDER BY f.created_at DESC
            LIMIT 1
        ) sf ON TRUE
        LEFT JOIN LATERAL (
            SELECT
                string_agg((p.total_paid)::text || ' ' || p.currency, ', ' ORDER BY p.currency) AS buyer_paid
            FROM (
                SELECT
                    COALESCE(di.buyer_currency, '?') AS currency,
                    SUM(COALESCE(di.buyer_price, 0) * COALESCE(di.quantity, 1)) AS total_paid
                FROM deals_items di
                WHERE di.deal_id = d.id
                GROUP BY COALESCE(di.buyer_currency, '?')
            ) p
        ) pay ON TRUE
        LEFT JOIN LATERAL (
            SELECT
                string_agg(m.item_name, ', ' ORDER BY m.item_name) AS item_names,
                string_agg(m.game_name, ', ' ORDER BY m.game_name) AS game_names
            FROM (
                SELECT DISTINCT
                    COALESCE(g.display_name, g.original_name, di.item_id::text, '?') AS item_name,
                    CASE g.game
                        WHEN 0 THEN 'Adopt me'
                        WHEN 1 THEN 'Steal a Brainrot'
                        WHEN 2 THEN 'Grow a Garden'
                        WHEN 3 THEN 'Plants Brainrot'
                        WHEN 5 THEN '99 Nights'
                        WHEN 6 THEN 'Universal Time'
                        WHEN 7 THEN 'Anime Rangers'
                        WHEN 8 THEN 'Blade Ball'
                        WHEN 9 THEN 'Blox Fruits'
                        WHEN 10 THEN 'Blue Lock'
                        WHEN 11 THEN 'Brainrot Evolution'
                        WHEN 12 THEN 'Brookhaven'
                        WHEN 13 THEN 'Dress to Impress'
                        WHEN 14 THEN 'Fisch'
                        WHEN 15 THEN 'Forsaken'
                        WHEN 16 THEN 'Rivals'
                        WHEN 17 THEN 'The Strongest Battlegrounds'
                        WHEN 18 THEN 'Pet Simulator 99'
                        WHEN 19 THEN 'Fish It'
                        WHEN 20 THEN 'The Forge'
                        WHEN 21 THEN 'Escape Tsunami For Brainrots'
                        ELSE COALESCE('Game ' || g.game::text, 'Unknown')
                    END AS game_name
                FROM deals_items di
                LEFT JOIN goods g ON g.id = di.good_id
                WHERE di.deal_id = d.id
            ) m
        ) item_meta ON TRUE
        WHERE d.store_id = %s
        ORDER BY d.created_at DESC
        LIMIT 500
        """,
        (store_id,),
    )
    columns = [description[0] for description in cur.description]
    deals = [serialize_row(columns, row) for row in cur.fetchall()]
    for deal in deals:
        deal["status_label"] = deal_status_label(deal.get("status"))
    cur.close()
    conn.close()
    return jsonify(deals)


@app.route("/api/stores/<store_id>/feedbacks")
@require_auth
def get_store_feedbacks(store_id: str):
    conn = open_pg()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT
            sf.deal_id,
            sf.store_id,
            sf.author_id,
            sf.rating,
            sf.comment,
            sf.created_at,
            pay.buyer_paid,
            d.status AS deal_status,
            item_meta.item_names,
            item_meta.game_names
        FROM stores_feedbacks sf
        LEFT JOIN deals d ON d.id = sf.deal_id
        LEFT JOIN LATERAL (
            SELECT
                string_agg((p.total_paid)::text || ' ' || p.currency, ', ' ORDER BY p.currency) AS buyer_paid
            FROM (
                SELECT
                    COALESCE(di.buyer_currency, '?') AS currency,
                    SUM(COALESCE(di.buyer_price, 0) * COALESCE(di.quantity, 1)) AS total_paid
                FROM deals_items di
                WHERE di.deal_id = sf.deal_id
                GROUP BY COALESCE(di.buyer_currency, '?')
            ) p
        ) pay ON TRUE
        LEFT JOIN LATERAL (
            SELECT
                string_agg(m.item_name, ', ' ORDER BY m.item_name) AS item_names,
                string_agg(m.game_name, ', ' ORDER BY m.game_name) AS game_names
            FROM (
                SELECT DISTINCT
                    COALESCE(g.display_name, g.original_name, di.item_id::text, '?') AS item_name,
                    CASE g.game
                        WHEN 0 THEN 'Adopt me'
                        WHEN 1 THEN 'Steal a Brainrot'
                        WHEN 2 THEN 'Grow a Garden'
                        WHEN 3 THEN 'Plants Brainrot'
                        WHEN 5 THEN '99 Nights'
                        WHEN 6 THEN 'Universal Time'
                        WHEN 7 THEN 'Anime Rangers'
                        WHEN 8 THEN 'Blade Ball'
                        WHEN 9 THEN 'Blox Fruits'
                        WHEN 10 THEN 'Blue Lock'
                        WHEN 11 THEN 'Brainrot Evolution'
                        WHEN 12 THEN 'Brookhaven'
                        WHEN 13 THEN 'Dress to Impress'
                        WHEN 14 THEN 'Fisch'
                        WHEN 15 THEN 'Forsaken'
                        WHEN 16 THEN 'Rivals'
                        WHEN 17 THEN 'The Strongest Battlegrounds'
                        WHEN 18 THEN 'Pet Simulator 99'
                        WHEN 19 THEN 'Fish It'
                        WHEN 20 THEN 'The Forge'
                        WHEN 21 THEN 'Escape Tsunami For Brainrots'
                        ELSE COALESCE('Game ' || g.game::text, 'Unknown')
                    END AS game_name
                FROM deals_items di
                LEFT JOIN goods g ON g.id = di.good_id
                WHERE di.deal_id = sf.deal_id
            ) m
        ) item_meta ON TRUE
        WHERE sf.store_id = %s
        ORDER BY sf.created_at DESC
        LIMIT 1000
        """,
        (store_id,),
    )
    columns = [description[0] for description in cur.description]
    feedbacks = [serialize_row(columns, row) for row in cur.fetchall()]
    for feedback in feedbacks:
        feedback["deal_status_label"] = deal_status_label(feedback.get("deal_status"))
    cur.close()
    conn.close()
    return jsonify(feedbacks)


@app.route("/api/deals/<deal_id>/messages")
@require_auth
def get_deal_messages(deal_id: str):
    conn = open_pg()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT
            dm.id,
            dm.deal_id,
            dm.sender_id,
            dm.sender_type,
            dm.code,
            dm.sent_at,
            tr.text AS original_text,
            tr.language AS original_language
        FROM deals_messages dm
        LEFT JOIN LATERAL (
            SELECT
                t.text,
                t.language,
                t.created_at
            FROM translations t
            WHERE t.row_id = dm.id
              AND t.is_original = TRUE
            ORDER BY t.created_at ASC
            LIMIT 1
        ) tr ON TRUE
        WHERE dm.deal_id = %s
        ORDER BY dm.sent_at ASC NULLS LAST, dm.id ASC
        """,
        (deal_id,),
    )
    columns = [description[0] for description in cur.description]
    messages = [serialize_row(columns, row) for row in cur.fetchall()]
    for message in messages:
        sender_type = message.get("sender_type")
        code = message.get("code")
        message["sender_type_label"] = sender_type_label(sender_type)
        message["is_system_message"] = is_system_message_code(code)
        if message["is_system_message"]:
            message["system_code_label"] = system_code_label(code)
        else:
            message["system_code_label"] = None
    cur.close()
    conn.close()
    return jsonify(messages)


@app.route("/api/users/ban", methods=["POST"])
@require_auth
def ban_user():
    payload = request.get_json(silent=True) or {}
    auth_token = (payload.get("token") or "").strip()
    user_id = (payload.get("userId") or "").strip()
    reason = (payload.get("reason") or "").strip()
    scopes = payload.get("scopes") or {}

    if not auth_token:
        return jsonify({"error": "Не передан authentication token"}), 400
    if not user_id:
        return jsonify({"error": "Не передан userId"}), 400
    if not reason:
        return jsonify({"error": "Не передан reason"}), 400
    if not isinstance(scopes, dict) or not scopes:
        return jsonify({"error": "Не переданы scopes"}), 400

    def call_support_api(url: str, body: dict[str, Any]) -> tuple[bool, int, dict[str, Any]]:
        request_payload = json.dumps(body).encode("utf-8")
        req = urlrequest.Request(
            url,
            data=request_payload,
            method="POST",
            headers={
                "accept": "application/json, text/plain, */*",
                "content-type": "application/json",
                "authorization": f"Bearer {auth_token}",
            },
        )
        try:
            with urlrequest.urlopen(req, timeout=20) as response:
                response_text = response.read().decode("utf-8")
                try:
                    parsed = json.loads(response_text) if response_text else {}
                except json.JSONDecodeError:
                    parsed = {"raw": response_text}
                return True, response.status, parsed
        except error.HTTPError as http_error:
            error_body = http_error.read().decode("utf-8")
            try:
                parsed_error = json.loads(error_body) if error_body else {}
            except json.JSONDecodeError:
                parsed_error = {"raw": error_body}
            return False, http_error.code, parsed_error or {"error": "Ошибка API поддержки"}

    try:
        ban_ok, ban_status, ban_payload = call_support_api(
            SUPPORT_BAN_API_URL,
            {"userId": user_id, "reason": reason, "scopes": scopes},
        )
        if not ban_ok:
            return (
                jsonify({"ok": False, "status": ban_status, "error": ban_payload}),
                ban_status,
            )

        disable_ok, disable_status, disable_payload = call_support_api(
            SUPPORT_DISABLE_MANUAL_API_URL, {"userId": user_id}
        )
        if not disable_ok:
            return (
                jsonify(
                    {
                        "ok": False,
                        "status": disable_status,
                        "error": disable_payload,
                        "ban_applied": True,
                        "disable_manual_applied": False,
                    }
                ),
                disable_status,
            )

        return (
            jsonify(
                {
                    "ok": True,
                    "status": 200,
                    "ban_applied": True,
                    "disable_manual_applied": True,
                    "ban_upstream": ban_payload,
                    "disable_manual_upstream": disable_payload,
                }
            ),
            200,
        )
    except Exception as unexpected_error:
        return (
            jsonify(
                {
                    "ok": False,
                    "error": f"Не удалось выполнить бан: {unexpected_error}",
                }
            ),
            500,
        )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
