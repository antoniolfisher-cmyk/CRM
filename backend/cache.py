import os, json, hashlib, logging
from typing import Any, Optional

log = logging.getLogger(__name__)

_client = None
_last_url: Optional[str] = None


def _get_redis():
    global _client, _last_url
    url = os.getenv("REDIS_URL", "")
    if not url:
        return None
    if _client is not None and url == _last_url:
        return _client
    try:
        import redis as _r
        _client = _r.from_url(url, socket_connect_timeout=1, socket_timeout=1, decode_responses=True)
        _last_url = url
    except Exception as e:
        log.warning("cache: Redis unavailable: %s", e)
        _client = None
    return _client


def cache_get(key: str) -> Optional[Any]:
    r = _get_redis()
    if not r:
        return None
    try:
        v = r.get(key)
        return json.loads(v) if v is not None else None
    except Exception:
        return None


def cache_set(key: str, value: Any, ttl: int = 30) -> None:
    r = _get_redis()
    if not r:
        return
    try:
        r.setex(key, ttl, json.dumps(value, default=str))
    except Exception:
        pass


def cache_bust(tenant_id: int, namespace: str) -> None:
    r = _get_redis()
    if not r:
        return
    try:
        pattern = f"qc:{tenant_id}:{namespace}:*"
        keys = r.keys(pattern)
        if keys:
            r.delete(*keys)
    except Exception:
        pass


def make_key(tenant_id: int, namespace: str, **params) -> str:
    h = hashlib.md5(json.dumps(params, sort_keys=True, default=str).encode()).hexdigest()[:10]
    return f"qc:{tenant_id}:{namespace}:{h}"
