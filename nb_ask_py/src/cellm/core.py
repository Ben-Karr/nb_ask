import json
import os

import httpx
from dotenv import load_dotenv
from fastcore.tools import view_file
from lisette import Chat

from .tools import grep, tree, web_fetch, web_search

EXT_URL = "http://localhost"
EXT_PORT = "3144"


def get_cells():
    ret = httpx.get(f"{EXT_URL}:{EXT_PORT}")
    data = ret.json()
    return data["precedingCellsHash"], data["precedingCells"], data["activeCellId"]


def insert_cell(content, target_cell_id):
    return httpx.post(
        f"{EXT_URL}:{EXT_PORT}/insert_response",
        json={"content": content, "targetCellId": target_cell_id},
    )


load_dotenv()
endpoint = os.environ["OPENROUTER_ENDPOINT"]
key = os.environ["OPENROUTER_API_KEY"]
model = os.environ["MODEL"]

sp_depr = """
Allways be helpful and suggestive. Make an efford to always give the shortest answer possible without losing correctness. Never guess, it's ok to dont know, it's not okay to guess the wrong answer.
In addition to the actual promt you are given the content of the jupyter notebook you are currently in - it's marked by `active notebook content:`.
Each item of the json serialized list represents one cell consisting of `index` which gives you the execution order; `kind` so if its a code or a markdown cell;
`source` is the user input to the cell; `output` is the result of the cell execution.
Your output is automatically marked by this header: "### 🤖 LLM Response (…)". Do not mimic that formatting.
I'm eager to learn about sofware development and coding, so if you see a way to improve or optimize code or an oportunity to learn an interesting concept, i'm happy to hear about it. Keep that short too though.
Look for information in this order, moving to the next only if the previous one doesn't answer the question:
1. The notebook (already in the conversation)
2. local tools (tree, grep, view_file)
3. web tools (web_search, web_fetch)
If sources conflict, prefer the earlier one and mention the conflict.
Question a user claim only if it seems implausible. If you want to use a tool, you can if it's absolutely neccessary, if it isn't ask and wait for permision!
"""

sp = """
Answer with the shortest correct response. No filler, no summarizing the question. Code > prose.
Use notebook context first, then tools (tree, grep, view_file; web tools only if asked).
"""

chat = Chat(
    model=model,
    api_base=endpoint,
    api_key=key,
    sp=sp,
    tools=[web_search, web_fetch, tree, grep, view_file],
)


def ask(pr: str):
    _, cells_raw, active_cell_id = get_cells()
    cells_content = json.dumps(cells_raw)
    chat.hist = [f"active notebook content: {cells_content}"]
    resp = chat(pr)
    chat.last_response = resp

    model_name = chat.model.split("/")[-1]
    header = f"##### 🤖 LLM Response ({model_name} | in: {resp.usage.prompt_tokens} | out: {resp.usage.completion_tokens})\n\n> "
    quoted = resp.choices[0].message.content.replace("\n", "\n> ")
    insert_cell(header + quoted, active_cell_id)
