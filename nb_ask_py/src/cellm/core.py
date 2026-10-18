import re

from fastcore.tools import view_file
from fastllm.chat import AsyncChat, AsyncStreamFormatter
from IPython.display import Markdown, display

from .tools import grep, tree, view_nb_overview, web_fetch, web_search
from .utils import get_ext_config, register_model

key, endpoint, full_model = get_ext_config()
model = full_model.removeprefix("openrouter/")  ## Hacked; ToDo solve in ext

sp = """
You are assisting inside a live Jupyter notebook (the cell where the user runs ask()).
The user's ACTIVE notebook is not on disk — its saved .ipynb is a stale snapshot, while its
in-memory state changes constantly. Live content of the active notebook is available ONLY via
view_nb_overview; use them first for any question about it (cells, code, outputs).
Reading saved .ipynb files of other notebooks with view_file is fine.
If the request reads like a continuation, the previous exchange is already in the conversation.
Answer with the shortest correct response. No filler. Code > prose.
Other tools: tree, grep, view_file for the project; web tools only if asked.
"""


register_model(model, "openrouter")

chat = AsyncChat(
    model=model,
    sp=sp,
    tools=[web_search, web_fetch, tree, grep, view_file, view_nb_overview],
    vendor_name="openrouter",
    api_key=key,
    base_url=endpoint,
)


async def ask(pr: str):
    # _, cells_raw = get_cells()
    # chat.hist = [f"active notebook content: {json.dumps(cells_raw)}"]
    chat.hist = []
    fmt = AsyncStreamFormatter(showthink=True)
    md, h = "", display(Markdown(""), display_id=True)

    async for piece in fmt.format_stream(await chat(pr, stream=True, max_steps=6)):
        md += piece
        h.update(Markdown(md))

    h.update(Markdown(f"##### 🤖 LLM Response ({chat.use})\n\n"))

    display_md = re.sub(r"\s*- ⏳ <code>.*?</code> ⏳\s*", "", md)
    return Markdown("".join(display_md))
