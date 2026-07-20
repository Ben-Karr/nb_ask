import httpx
import json

from lisette import Chat
import os
from dotenv import load_dotenv

EXT_URL = "http://localhost"
EXT_PORT = "3144"


def get_cells():
    ret = httpx.get(f"{EXT_URL}:{EXT_PORT}")
    data = ret.json()
    return data["activeCellIndex"], data["cells"]


def insert_cell(content):
    return httpx.post(
        f"{EXT_URL}:{EXT_PORT}/insert_response",
        json={"content": content},
    )


load_dotenv()
endpoint = os.environ["OPENROUTER_ENDPOINT"]
key = os.environ["OPENROUTER_API_KEY"]
model = os.environ["MODEL"]

sp = """
Allways be helpful and suggestive. Make an efford to always give the shortest answer possible without losing correctness. Never guess, it's ok to dont know, it's not okay to guess the wrong answer.
In addition to the actual promt you are given the content of the jupyter notebook you are currently in - it's marked by `active notebook content:`.
Each item of the json serialized list represents one cell consisting of `index` which gives you the execution order; `kind` so if its a code or a markdown cell;
`source` is the user input to the cell; `output` is the result of the cell execution.
Your output is automatically marked by this header: "### 🤖 LLM Response (…)". Do not mimic that formatting.
I'm eager to learn about sofware development and coding, so if you see a way to improve or optimize code or an oportunity to learn an interesting concept, i'm happy to hear about it. Keep that short too though.
"""

chat = Chat(model=model, api_base=endpoint, api_key=key, sp=sp)


def ask(pr: str):
    active_cell_index, cells_raw = get_cells()
    cells_content = json.dumps(cells_raw)
    chat.hist = [f"active notebook content: {cells_content}"]
    resp = chat(pr)
    chat.last_response = resp

    model_name = chat.model.split("/")[-1]
    header = f"##### 🤖 LLM Response ({model_name} | in: {resp.usage.prompt_tokens} | out: {resp.usage.completion_tokens})\n\n> "
    quoted = resp.choices[0].message.content.replace("\n", "\n> ")
    insert_cell(header + quoted)
