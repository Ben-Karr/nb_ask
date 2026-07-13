import httpx
import json

from lisette import Chat
import os
from dotenv import load_dotenv


def get_cells():
    ret = httpx.get("http://localhost:3000/")
    cell_content = ret.json()
    return cell_content


load_dotenv()
endpoint = os.environ["OPENAI_ENDPOINT"]
key = os.environ["OPENIA_API_KEY"]

sp = """Allways be helpful and suggestive. Make an efford to always give the shortest answer possible without losing correctness. In addition to the actual promt you are given the content of the jupyter notebook you are currently in - it's marked by `active notebook content:`. Each item of the json serialized list represents one cell consisting of `index` which gives you the execution order; `kind` so if its a code or a markdown cell; `source` is the user input to the cell; `output`
 is the result of the cell execution."""

chat = Chat(model="azure_ai/gpt-4-turbo-1106", api_base=endpoint, api_key=key, sp=sp)


def ask(pr: str):
    cells_content = json.dumps(get_cells())
    chat.hist = [f"active notebook content: {cells_content}"]
    return chat(pr)
