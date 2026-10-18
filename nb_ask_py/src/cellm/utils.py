import httpx
from fastllm.chat import register_model_info


EXT_URL = "http://localhost"
EXT_PORT = "3144"


def get_ext_config():
    """Fetch token/model from the VS Code extension; fall back to .env."""
    ret = httpx.get(f"{EXT_URL}:{EXT_PORT}/config", timeout=2)
    ret.raise_for_status()
    cfg = ret.json()
    return cfg.get("token"), cfg.get("endpoint"), cfg.get("model")


def register_model(model: str, vendor_name: str):
    if vendor_name != "openrouter":
        raise NotImplementedError(f"Got {vendor_name=}")
    r = httpx.get("https://openrouter.ai/api/v1/models", timeout=10)
    models_res = r.json()
    model_info = next(x for x in models_res["data"] if x["id"] == model)
    register_model_info(
        model,
        vendor_name=vendor_name,
        input_cost_per_token=float(model_info["pricing"]["prompt"]),
        output_cost_per_token=float(model_info["pricing"]["completion"]),
        cache_read_input_token_cost=float(
            model_info["pricing"].get("prompt_cache_read", 0)
        )
        or 0,
        max_output_tokens=32_000,
    )
