import httpx
import json

from lisette import Chat
import os
from dotenv import load_dotenv
from IPython.display import display, Markdown

EXT_URL = "http://localhost"
EXT_PORT = "3144"


def get_cells():
    ret = httpx.get(f"{EXT_URL}:{EXT_PORT}")
    cell_content = ret.json()
    return cell_content


def insert_cell(content):
    return httpx.post(
        f"{EXT_URL}:{EXT_PORT}/insert_response",
        json={"content": content},
    )


load_dotenv()
# endpoint = os.environ["OPENAI_ENDPOINT"]
# key = os.environ["OPENIA_API_KEY"]
endpoint = os.environ["OPENROUTER_ENDPOINT"]
key = os.environ["OPENROUTER_API_KEY"]
model = os.environ["MODEL"]

sp = """
Allways be helpful and suggestive. Make an efford to always give the shortest answer possible without losing correctness.
In addition to the actual promt you are given the content of the jupyter notebook you are currently in - it's marked by `active notebook content:`.
Your output is automatically marked by this header: "### 🤖 LLM Response". Do not mimic that formatting.
Each item of the json serialized list represents one cell consisting of `index` which gives you the execution order; `kind` so if its a code or a markdown cell;
`source` is the user input to the cell; `output` is the result of the cell execution.
"""

chat = Chat(model=model, api_base=endpoint, api_key=key, sp=sp)


def ask(pr: str):
    cells_content = json.dumps(get_cells())
    chat.hist = [f"active notebook content: {cells_content}"]
    resp = chat(pr)
    chat.last_response = resp

    model_name = chat.model.split("/")[-1]
    header = f"##### 🤖 LLM Response ({model_name} | in: {resp.usage.prompt_tokens} | out: {resp.usage.completion_tokens})\n\n> "
    quoted = resp.choices[0].message.content.replace("\n", "\n> ")
    insert_cell(header + quoted)
