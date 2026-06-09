"""Environment-based configuration for the SolarTrace API."""
import os

_DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://localhost:8080",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8080",
)


def google_maps_api_key() -> str | None:
    return os.environ.get("GOOGLE_MAPS_API_KEY") or None


def cors_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS", "").strip()
    if not raw:
        return list(_DEFAULT_CORS_ORIGINS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def max_upload_bytes() -> int:
    raw = os.environ.get("MAX_UPLOAD_BYTES", "10485760").strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return 10 * 1024 * 1024


def cache_refresh_secret() -> str | None:
    return os.environ.get("CACHE_REFRESH_SECRET") or None
